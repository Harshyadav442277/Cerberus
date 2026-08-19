import { ok, strictEqual } from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { closePool, getPool } from "../pool.js";
import {
  APPROVAL_TTL_SECONDS,
  claimHumanDecision,
  consumeAuthorization,
  evaluateApprovalFreshness,
  getHumanApproval,
  getIssuedAuthorization,
  recordHumanApproval,
  recordIssuedAuthorization,
} from "../authorizations.js";
import { bindAuthorization, reserveBudget } from "../reservations.js";
import {
  AT,
  insertMandate,
  mandateFixture,
  race,
  reserveInput,
  resetFixtures,
  seedAgent,
  seedProposal,
} from "./fixtures.js";

/**
 * Phase 3 — durable replay protection and approval freshness, against real Postgres.
 *
 * The property under test is precisely that these guarantees do NOT live in process
 * memory, so testing them against an in-memory stub would assert the opposite of what
 * matters.
 */

const PROPOSAL_HASH = `0x${"ab".repeat(32)}`;
const OTHER_HASH = `0x${"cd".repeat(32)}`;

before(async () => {
  await getPool().query("SELECT 1 FROM execution_authorization LIMIT 1");
  await getPool().query("SELECT 1 FROM human_approval LIMIT 1");
});

after(async () => {
  await closePool();
});

beforeEach(async () => {
  await resetFixtures();
  await seedAgent("agent_a");
  await insertMandate(mandateFixture({ mandateId: "m_auth", agentId: "agent_a", maxTotal: 100 }));
});

/** A reservation with an authorization bound to it, ready to be consumed. */
async function issued(id: string, nonce: string) {
  const proposal = await seedProposal({
    id,
    agentId: "agent_a",
    mandateId: "m_auth",
    amount: 5,
  });
  const reserved = await reserveBudget(reserveInput(proposal, 100));
  ok(reserved.outcome === "created");
  const authorizationId = `auth_${id}`;
  await bindAuthorization(reserved.reservation.reservation_id, authorizationId, AT);
  await recordIssuedAuthorization({
    authorizationId,
    reservationId: reserved.reservation.reservation_id,
    auditId: proposal.auditId,
    actionId: proposal.actionId,
    proposalHash: PROPOSAL_HASH,
    mandateId: "m_auth",
    mandateVersion: 1,
    nonce,
    expiresAt: "2026-08-18T12:01:00.000Z",
    issuedAt: AT,
  });
  return { proposal, authorizationId };
}

describe("durable authorization consumption", () => {
  it("consumes once and refuses every later attempt", async () => {
    const nonce = `0x${"11".repeat(32)}`;
    const { authorizationId } = await issued("dur_1", nonce);

    strictEqual(await consumeAuthorization(authorizationId, nonce, AT), true);
    strictEqual(
      await consumeAuthorization(authorizationId, nonce, AT),
      false,
      "a replay is refused",
    );
    strictEqual((await getIssuedAuthorization(authorizationId))!.status, "CONSUMED");
  });

  it("refuses a replay after the executor process that consumed it is gone", async () => {
    // The Phase 1 store was a Set in executor memory. Restarting the executor emptied
    // it, so the same authorization could be spent again. Nothing here is in memory:
    // the second attempt is made with no knowledge of the first.
    const nonce = `0x${"22".repeat(32)}`;
    const { authorizationId } = await issued("dur_restart", nonce);
    strictEqual(await consumeAuthorization(authorizationId, nonce, AT), true);

    await closePool(); // the process that consumed it dies, pool and all

    strictEqual(
      await consumeAuthorization(authorizationId, nonce, AT),
      false,
      "a restarted executor still refuses it",
    );
  });

  it("lets only one of many concurrent consumers win", async () => {
    // Several executor processes racing the same replayed authorization.
    const nonce = `0x${"33".repeat(32)}`;
    const { authorizationId } = await issued("dur_race", nonce);

    const results = await race(8, () => consumeAuthorization(authorizationId, nonce, AT));
    strictEqual(results.filter(Boolean).length, 1, "exactly one consumer may win");
  });

  it("refuses an authorization whose nonce does not match its record", async () => {
    const nonce = `0x${"44".repeat(32)}`;
    const { authorizationId } = await issued("dur_nonce", nonce);
    strictEqual(await consumeAuthorization(authorizationId, `0x${"99".repeat(32)}`, AT), false);
    strictEqual((await getIssuedAuthorization(authorizationId))!.status, "ISSUED");
  });

  it("refuses an authorization the control plane never issued", async () => {
    strictEqual(await consumeAuthorization("auth_forged", `0x${"55".repeat(32)}`, AT), false);
  });

  it("refuses consumption at the database after authorization expiry", async () => {
    const nonce = `0x${"66".repeat(32)}`;
    const { authorizationId } = await issued("dur_expired", nonce);
    strictEqual(
      await consumeAuthorization(authorizationId, nonce, "2026-08-18T12:01:00.000Z"),
      false,
      "the final database CAS enforces the exact expiry boundary",
    );
    strictEqual((await getIssuedAuthorization(authorizationId))!.status, "ISSUED");
  });
});

describe("human approval binding", () => {
  async function escalation(id: string) {
    return seedProposal({ id, agentId: "agent_a", mandateId: "m_auth", amount: 5 });
  }

  it("binds the decision to the exact proposal, version and expiry", async () => {
    const p = await escalation("app_1");
    const binding = await recordHumanApproval({
      auditId: p.auditId,
      actionId: p.actionId,
      agentId: "agent_a",
      proposalHash: PROPOSAL_HASH,
      mandateId: "m_auth",
      mandateVersion: 1,
      reviewerId: "compliance_officer_01",
      decision: "approved",
      decidedAt: AT,
    });

    strictEqual(binding.proposal_hash, PROPOSAL_HASH);
    strictEqual(binding.mandate_version, 1);
    strictEqual(
      Date.parse(binding.expires_at) - Date.parse(binding.decided_at),
      APPROVAL_TTL_SECONDS * 1000,
      "an approval is not permanent",
    );
  });

  it("keeps the first decision when a second reviewer submits one", async () => {
    const p = await escalation("app_2");
    const base = {
      auditId: p.auditId,
      actionId: p.actionId,
      agentId: "agent_a",
      proposalHash: PROPOSAL_HASH,
      mandateId: "m_auth",
      mandateVersion: 1,
      decidedAt: AT,
    };
    await recordHumanApproval({ ...base, reviewerId: "officer_a", decision: "approved" });
    const second = await recordHumanApproval({ ...base, reviewerId: "officer_b", decision: "denied" });

    strictEqual(second.reviewer_id, "officer_a");
    strictEqual(second.decision, "approved", "the first decision stands");
  });

  it("writes the review and the binding together, and only once", async () => {
    const p = await escalation("app_3");
    const input = {
      auditId: p.auditId,
      actionId: p.actionId,
      agentId: "agent_a",
      proposalHash: PROPOSAL_HASH,
      mandateId: "m_auth",
      mandateVersion: 1,
      reviewerId: "compliance_officer_01",
      decision: "approved" as const,
      decidedAt: AT,
      humanReview: {
        reviewer_id: "compliance_officer_01",
        decision: "approved" as const,
        decided_at: AT,
        note: "Verified out of band",
      },
    };

    // A double-click: two reviewers racing the same escalation.
    const results = await race(2, () => claimHumanDecision(input));
    strictEqual(results.filter((r) => r.claimed).length, 1, "one claim wins");

    const binding = await getHumanApproval(p.auditId);
    ok(binding, "the winning claim left a binding");
    const { rows } = await getPool().query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM human_approval WHERE audit_id = $1`,
      [p.auditId],
    );
    strictEqual(rows[0]!.n, "1");
  });

  it("leaves no binding behind when the claim loses the race", async () => {
    const p = await escalation("app_4");
    const base = {
      auditId: p.auditId,
      actionId: p.actionId,
      agentId: "agent_a",
      proposalHash: PROPOSAL_HASH,
      mandateId: "m_auth",
      mandateVersion: 1,
      decidedAt: AT,
      decision: "approved" as const,
    };
    await claimHumanDecision({
      ...base,
      reviewerId: "officer_a",
      humanReview: { reviewer_id: "officer_a", decision: "approved", decided_at: AT, note: "first" },
    });
    const loser = await claimHumanDecision({
      ...base,
      reviewerId: "officer_b",
      humanReview: { reviewer_id: "officer_b", decision: "denied", decided_at: AT, note: "second" },
    });

    strictEqual(loser.claimed, false);
    strictEqual((await getHumanApproval(p.auditId))!.reviewer_id, "officer_a");
  });
});

describe("approval freshness", () => {
  const binding = {
    audit_id: "audit_x",
    action_id: "action_x",
    agent_id: "agent_a",
    proposal_hash: PROPOSAL_HASH,
    mandate_id: "m_auth",
    mandate_version: 17,
    reviewer_id: "compliance_officer_01",
    decision: "approved" as const,
    decided_at: "2026-08-18T12:00:00.000Z",
    expires_at: "2026-08-18T12:30:00.000Z",
  };
  const at = Date.parse("2026-08-18T12:05:00.000Z");
  const fresh = {
    proposalHash: PROPOSAL_HASH,
    currentMandateId: "m_auth",
    currentMandateVersion: 17,
    nowMs: at,
  };

  it("accepts an approval that still covers the proposal and the authority", () => {
    strictEqual(evaluateApprovalFreshness(binding, fresh).usable, true);
  });

  it("refuses an approval given under a superseded mandate version", () => {
    // The Critique scenario: approved under v17, the administrator published v18.
    const verdict = evaluateApprovalFreshness(binding, { ...fresh, currentMandateVersion: 18 });
    strictEqual(verdict.usable, false);
    ok(!verdict.usable && verdict.reason === "STALE_MANDATE");
  });

  it("refuses an approval whose proposal was edited afterwards", () => {
    const verdict = evaluateApprovalFreshness(binding, { ...fresh, proposalHash: OTHER_HASH });
    ok(!verdict.usable && verdict.reason === "PROPOSAL_CHANGED");
  });

  it("refuses an approval that has aged out", () => {
    const verdict = evaluateApprovalFreshness(binding, {
      ...fresh,
      nowMs: Date.parse("2026-08-18T13:00:00.000Z"),
    });
    ok(!verdict.usable && verdict.reason === "EXPIRED");
  });

  it("refuses a denial and a missing decision", () => {
    const denied = evaluateApprovalFreshness({ ...binding, decision: "denied" }, fresh);
    ok(!denied.usable && denied.reason === "DENIED");
    const missing = evaluateApprovalFreshness(null, fresh);
    ok(!missing.usable && missing.reason === "MISSING");
  });
});

/**
 * D6 — human approval expiry, to the millisecond.
 *
 * The suite above covers whether an approval still binds the right proposal and the
 * right mandate version. This covers only WHEN it stops binding at all, at exactly
 * -1ms, the boundary instant, and +1ms — because both `<` and `<=` pass every test
 * written a whole minute away from the boundary.
 *
 * The convention, matching execution-authorization expiry: expiry is EXCLUSIVE. An
 * approval is usable strictly before its expiry instant and unusable at it. When the
 * question is "may money move", the boundary instant resolves to no.
 */
describe("human approval expiry boundaries", () => {
  const EXPIRES_AT = Date.parse("2026-08-18T12:30:00.000Z");
  const boundaryBinding = {
    audit_id: "audit_boundary",
    action_id: "action_boundary",
    agent_id: "agent_boundary",
    proposal_hash: PROPOSAL_HASH,
    mandate_id: "m_auth",
    mandate_version: 17,
    reviewer_id: "compliance_officer_01",
    decision: "approved" as const,
    decided_at: "2026-08-18T12:00:00.000Z",
    expires_at: "2026-08-18T12:30:00.000Z",
  };
  const context = {
    proposalHash: PROPOSAL_HASH,
    currentMandateId: "m_auth",
    currentMandateVersion: 17,
  };

  it("is usable one millisecond before expiry", () => {
    const verdict = evaluateApprovalFreshness(boundaryBinding, {
      ...context,
      nowMs: EXPIRES_AT - 1,
    });
    strictEqual(verdict.usable, true);
  });

  it("is refused at exactly the expiry instant", () => {
    const verdict = evaluateApprovalFreshness(boundaryBinding, { ...context, nowMs: EXPIRES_AT });
    ok(!verdict.usable && verdict.reason === "EXPIRED");
  });

  it("is refused one millisecond after expiry", () => {
    const verdict = evaluateApprovalFreshness(boundaryBinding, {
      ...context,
      nowMs: EXPIRES_AT + 1,
    });
    ok(!verdict.usable && verdict.reason === "EXPIRED");
  });

  it("is usable at the instant it was decided", () => {
    // The lower bound matters too: an approval not yet valid at its own decision
    // instant would be unusable for its entire life.
    const verdict = evaluateApprovalFreshness(boundaryBinding, {
      ...context,
      nowMs: Date.parse(boundaryBinding.decided_at),
    });
    strictEqual(verdict.usable, true);
  });

  it("reports the strongest reason when an approval is both stale and expired", () => {
    // An expired approval for a superseded mandate must not report EXPIRED and let a
    // caller conclude that re-approving on the same authority would be enough.
    const verdict = evaluateApprovalFreshness(boundaryBinding, {
      ...context,
      currentMandateVersion: 18,
      nowMs: EXPIRES_AT + 1,
    });
    ok(!verdict.usable && verdict.reason === "STALE_MANDATE");
  });
});

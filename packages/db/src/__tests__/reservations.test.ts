import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { closePool, getPool } from "../pool.js";
import {
  beginSubmission,
  bindAuthorization,
  claimReconciliation,
  committedVelocityCount,
  committedSpend,
  deferReconciliation,
  expireStaleReservations,
  getLiveReservationForAudit,
  getReservation,
  markFailed,
  markOutcomeUnknown,
  markReconciledFailed,
  markReconciledSettled,
  markSettled,
  recordPaymentAttempt,
  reserveBudget,
  windowHours,
  type ReserveBudgetResult,
} from "../reservations.js";
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
 * Phase 2 — atomic budget reservations, tested against a real PostgreSQL.
 *
 * Every concurrency test below runs its competing requests through `race()`, which
 * pre-warms the connection pool and releases all callers from one barrier, so they
 * genuinely overlap inside the database. None of them is a sequential simulation:
 * deleting the advisory lock from reserveBudget makes tests 1, 2 and 3 fail.
 *
 * The invariant under test, for a (mandate, currency) budget authority:
 *
 *     settled + active reserved <= rolling_window.max_total
 */

const RUN_LABEL = "phase2";
let databaseReachable = false;

before(async () => {
  // Fail loudly, not silently: a skipped concurrency suite would be indistinguishable
  // from a passing one, and "we did not test it" must never read as "it is safe".
  await getPool().query("SELECT 1");
  databaseReachable = true;
  await getPool().query("SELECT 1 FROM payment_reservation LIMIT 1");
});

after(async () => {
  if (databaseReachable) await closePool();
});

beforeEach(async () => {
  await resetFixtures();
});

/** How many times a two-way race is repeated before it is trusted. */
const ROUNDS = 10;

/** Every reservation that still holds capacity, for direct invariant assertions. */
async function activeAmounts(mandateId: string): Promise<number> {
  const total = await committedSpend({ mandateId, currency: "USDC", rollingWindow: "24h", at: AT });
  return Number(total);
}

async function committedAt(mandateId: string, at: string): Promise<number> {
  return Number(await committedSpend({ mandateId, currency: "USDC", rollingWindow: "24h", at }));
}

/** Distinct instant per round, so rounds cannot leak capacity into one another. */
function roundInstant(round: number): string {
  return new Date(Date.parse(AT) + round * 1000).toISOString();
}

async function clearReservations(): Promise<void> {
  await getPool().query("DELETE FROM payment_reservation");
}

function created(results: ReserveBudgetResult[]): ReserveBudgetResult[] {
  return results.filter((r) => r.outcome === "created");
}
describe("atomic budget reservations", () => {
  it("parses the mandate rolling window rather than assuming 24h", () => {
    strictEqual(windowHours("24h"), 24);
    strictEqual(windowHours("7d"), 168);
  });

  // ── 1 ─────────────────────────────────────────────────────────────────────────
  it("lets only one of two concurrent 80s reserve against a budget of 100", async () => {
    await seedAgent("agent_a");
    await insertMandate(mandateFixture({ mandateId: "m_1", agentId: "agent_a", maxTotal: 100 }));

    // Repeated rounds, each on a clean budget. A single two-way race is real but
    // timing-dependent: the two transactions do not always overlap, so one round can
    // pass by luck even with no lock at all. Ten rounds removes that luck — verified
    // by deleting the advisory lock and watching this test fail.
    for (let round = 0; round < ROUNDS; round += 1) {
      const a = await seedProposal({ id: `${RUN_LABEL}_a${round}`, agentId: "agent_a", mandateId: "m_1", amount: 80 });
      const b = await seedProposal({ id: `${RUN_LABEL}_b${round}`, agentId: "agent_a", mandateId: "m_1", amount: 80 });
      const at = roundInstant(round);

      const results = await race(2, (i) =>
        reserveBudget(reserveInput(i === 0 ? a : b, 100, { at })),
      );

      strictEqual(created(results).length, 1, `round ${round}: exactly one reservation may win`);
      deepStrictEqual(
        results.map((r) => r.outcome).sort(),
        ["created", "insufficient_budget"],
        "the loser must be refused for budget, not silently duplicated",
      );
      strictEqual(await committedAt("m_1", at), 80, `round ${round}: budget holds`);
      await clearReservations();
    }
  });

  // ── 2 ─────────────────────────────────────────────────────────────────────────
  it("holds the invariant across 20 concurrent requests of 6 against a budget of 100", async () => {
    await seedAgent("agent_a");
    await insertMandate(mandateFixture({ mandateId: "m_2", agentId: "agent_a", maxTotal: 100 }));
    const proposals = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        seedProposal({ id: `${RUN_LABEL}_burst_${i}`, agentId: "agent_a", mandateId: "m_2", amount: 6 }),
      ),
    );

    const results = await race(20, (i) => reserveBudget(reserveInput(proposals[i]!, 100)));

    const wins = created(results).length;
    // 16 x 6 = 96 fits; a 17th would reach 102. The point is the ceiling, not the count.
    strictEqual(wins, 16);
    const committed = await activeAmounts("m_2");
    strictEqual(committed, wins * 6);
    ok(committed <= 100, `committed ${committed} must never exceed the 100 budget`);
  });

  // ── 3 ─────────────────────────────────────────────────────────────────────────
  it("holds one shared budget when two different agents race the same mandate", async () => {
    await seedAgent("agent_a");
    await seedAgent("agent_b");
    // One corporate mandate, two agents operating under it. Locking per agent_id
    // would give each of them a full view of the budget; locking the mandate does not.
    await insertMandate(mandateFixture({ mandateId: "m_shared", agentId: "agent_a", version: 1, maxTotal: 100 }));
    await insertMandate(mandateFixture({ mandateId: "m_shared", agentId: "agent_b", version: 2, maxTotal: 100 }));

    for (let round = 0; round < ROUNDS; round += 1) {
      const a = await seedProposal({ id: `${RUN_LABEL}_sa${round}`, agentId: "agent_a", mandateId: "m_shared", mandateVersion: 1, amount: 60 });
      const b = await seedProposal({ id: `${RUN_LABEL}_sb${round}`, agentId: "agent_b", mandateId: "m_shared", mandateVersion: 2, amount: 60 });
      const at = roundInstant(round);

      const results = await race(2, (i) =>
        reserveBudget(reserveInput(i === 0 ? a : b, 100, { at })),
      );

      strictEqual(
        created(results).length,
        1,
        `round ${round}: two agents sharing a mandate share one budget`,
      );
      strictEqual(await committedAt("m_shared", at), 60);
      await clearReservations();
    }
  });

  // ── 4 ─────────────────────────────────────────────────────────────────────────
  it("creates one financial effect when an identical proposal is submitted concurrently", async () => {
    await seedAgent("agent_a");
    await insertMandate(mandateFixture({ mandateId: "m_4", agentId: "agent_a", maxTotal: 100 }));
    const p = await seedProposal({ id: `${RUN_LABEL}_dup`, agentId: "agent_a", mandateId: "m_4", amount: 10 });

    const results = await race(8, () => reserveBudget(reserveInput(p, 100)));

    strictEqual(created(results).length, 1);
    const ids = new Set(
      results.flatMap((r) => ("reservation" in r ? [r.reservation.reservation_id] : [])),
    );
    strictEqual(ids.size, 1, "every caller must see the same single reservation");
    strictEqual(await activeAmounts("m_4"), 10, "capacity is consumed once, not eight times");

    const { rows } = await getPool().query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM payment_reservation WHERE action_id = $1`,
      [p.actionId],
    );
    strictEqual(rows[0]!.n, "1", "one proposal, one reservation row");
  });

  // ── 5 ─────────────────────────────────────────────────────────────────────────
  it("gives one audit exactly one executable authorization, however many are requested", async () => {
    await seedAgent("agent_a");
    await insertMandate(mandateFixture({ mandateId: "m_5", agentId: "agent_a", maxTotal: 100 }));
    const p = await seedProposal({ id: `${RUN_LABEL}_auth`, agentId: "agent_a", mandateId: "m_5", amount: 10 });

    const first = await reserveBudget(reserveInput(p, 100));
    ok(first.outcome === "created");
    const reservationId = first.reservation.reservation_id;

    // The attack: the same audit asks for AUTH A and AUTH B, concurrently.
    const binds = await race(2, (i) =>
      bindAuthorization(reservationId, i === 0 ? "auth_A" : "auth_B", AT),
    );
    strictEqual(binds.filter(Boolean).length, 1, "only one authorization may ever bind");
    const winner = binds.find((b) => b !== null)!;

    // And the loser cannot execute: the durable CAS is keyed on the bound id.
    const loserId = winner.authorization_id === "auth_A" ? "auth_B" : "auth_A";
    strictEqual(await beginSubmission(reservationId, loserId, AT), null);

    const submitting = await beginSubmission(reservationId, winner.authorization_id!, AT);
    ok(submitting, "the bound authorization executes");
    strictEqual(submitting.status, "SUBMITTING");

    // A replay of the winner, after a restart or from a second executor process.
    strictEqual(
      await beginSubmission(reservationId, winner.authorization_id!, AT),
      null,
      "durable one-shot: a second submission is refused",
    );
    strictEqual(await activeAmounts("m_5"), 10, "one financial effect, not two");
  });

  // ── 6 ─────────────────────────────────────────────────────────────────────────
  it("releases capacity on positively known settlement failure, and only then", async () => {
    await seedAgent("agent_a");
    await insertMandate(mandateFixture({ mandateId: "m_6", agentId: "agent_a", maxTotal: 100 }));
    const p = await seedProposal({ id: `${RUN_LABEL}_fail`, agentId: "agent_a", mandateId: "m_6", amount: 90 });

    const reserved = await reserveBudget(reserveInput(p, 100));
    ok(reserved.outcome === "created");
    const id = reserved.reservation.reservation_id;
    await bindAuthorization(id, "auth_fail", AT);
    await beginSubmission(id, "auth_fail", AT);
    strictEqual(await activeAmounts("m_6"), 90, "capacity is held while submitting");

    await markFailed(id, AT);
    strictEqual((await getReservation(id))!.status, "FAILED");
    strictEqual(await activeAmounts("m_6"), 0, "a known non-payment gives the budget back");

    // The released capacity is genuinely reusable.
    const retry = await seedProposal({ id: `${RUN_LABEL}_retry`, agentId: "agent_a", mandateId: "m_6", amount: 90 });
    strictEqual((await reserveBudget(reserveInput(retry, 100))).outcome, "created");
  });

  it("refuses the final submission transition after reservation expiry", async () => {
    await seedAgent("agent_a");
    await insertMandate(mandateFixture({ mandateId: "m_expired", agentId: "agent_a", maxTotal: 100 }));
    const p = await seedProposal({ id: "reservation_expired", agentId: "agent_a", mandateId: "m_expired", amount: 5 });
    const reserved = await reserveBudget(reserveInput(p, 100));
    ok(reserved.outcome === "created");
    await bindAuthorization(reserved.reservation.reservation_id, "auth_expired", AT);
    strictEqual(
      await beginSubmission(
        reserved.reservation.reservation_id,
        "auth_expired",
        reserved.reservation.expires_at,
      ),
      null,
      "the database rejects the exact reservation expiry boundary",
    );
    strictEqual((await getReservation(reserved.reservation.reservation_id))!.status, "AUTHORIZED");
  });

  it("never releases capacity for an ambiguous outcome, even past its TTL", async () => {
    await seedAgent("agent_a");
    await insertMandate(mandateFixture({ mandateId: "m_unknown", agentId: "agent_a", maxTotal: 100 }));
    const p = await seedProposal({ id: `${RUN_LABEL}_unknown`, agentId: "agent_a", mandateId: "m_unknown", amount: 90 });

    const reserved = await reserveBudget(reserveInput(p, 100, { ttlSeconds: 1 }));
    ok(reserved.outcome === "created");
    const id = reserved.reservation.reservation_id;
    await bindAuthorization(id, "auth_unknown", AT);
    await beginSubmission(id, "auth_unknown", AT);
    await markOutcomeUnknown(id, AT);

    // Long past the TTL. The payment may have been broadcast, so the money is treated
    // as gone until Phase 5 reconciles it against the chain.
    const later = "2026-08-18T12:30:00.000Z";
    strictEqual(await expireStaleReservations(later), 0, "OUTCOME_UNKNOWN is not sweepable");
    strictEqual((await getReservation(id))!.status, "OUTCOME_UNKNOWN");

    const committed = await committedSpend({
      mandateId: "m_unknown",
      currency: "USDC",
      rollingWindow: "24h",
      at: later,
    });
    strictEqual(Number(committed), 90, "ambiguous outcomes keep holding their capacity");

    const other = await seedProposal({ id: `${RUN_LABEL}_after`, agentId: "agent_a", mandateId: "m_unknown", amount: 20 });
    strictEqual(
      (await reserveBudget(reserveInput(other, 100, { at: later }))).outcome,
      "insufficient_budget",
    );
  });

  it("releases a pre-broadcast reservation once its TTL passes", async () => {
    await seedAgent("agent_a");
    await insertMandate(mandateFixture({ mandateId: "m_ttl", agentId: "agent_a", maxTotal: 100 }));
    const grief = await seedProposal({ id: `${RUN_LABEL}_grief`, agentId: "agent_a", mandateId: "m_ttl", amount: 99 });

    const held = await reserveBudget(reserveInput(grief, 100, { ttlSeconds: 60 }));
    ok(held.outcome === "created");

    const later = "2026-08-18T12:05:00.000Z";
    strictEqual(await expireStaleReservations(later), 1);
    const after = await seedProposal({ id: `${RUN_LABEL}_ttl_next`, agentId: "agent_a", mandateId: "m_ttl", amount: 99 });
    strictEqual((await reserveBudget(reserveInput(after, 100, { at: later }))).outcome, "created");
  });

  // ── 7 ─────────────────────────────────────────────────────────────────────────
  it("keeps the reservation durable when the process dies before authorization", async () => {
    await seedAgent("agent_a");
    await insertMandate(mandateFixture({ mandateId: "m_7", agentId: "agent_a", maxTotal: 100 }));
    const p = await seedProposal({ id: `${RUN_LABEL}_crash`, agentId: "agent_a", mandateId: "m_7", amount: 40 });

    const tsx = fileURLToPath(new URL("../../../../node_modules/tsx/dist/cli.mjs", import.meta.url));
    const script = fileURLToPath(new URL("./crash-after-reserve.ts", import.meta.url));
    const child = spawn(process.execPath, [tsx, script, JSON.stringify(reserveInput(p, 100))], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    const exitCode: number = await new Promise((resolve) => child.on("close", resolve));

    strictEqual(exitCode, 9, "the child really did exit abruptly");
    const childResult = JSON.parse(stdout.trim());
    strictEqual(childResult.outcome, "created");

    // Everything below runs in THIS process, against state the dead one committed.
    const survivor = await getLiveReservationForAudit(p.auditId);
    ok(survivor, "the reservation survived the crash");
    strictEqual(survivor.status, "RESERVED", "still pre-authorization, and still holding");
    strictEqual(survivor.reservation_id, childResult.reservation.reservation_id);
    strictEqual(await activeAmounts("m_7"), 40, "the crashed request's capacity is still committed");

    // Recoverable: retrying the same proposal resumes the existing hold rather than
    // taking a second one, so a crash cannot become a double reservation.
    const resumed = await reserveBudget(reserveInput(p, 100));
    strictEqual(resumed.outcome, "existing");
    ok(resumed.outcome === "existing");
    strictEqual(resumed.reservation.reservation_id, survivor.reservation_id);
    strictEqual(await activeAmounts("m_7"), 40);
  });

  it("counts settled spend and active reservations against one shared ceiling", async () => {
    await seedAgent("agent_a");
    await insertMandate(mandateFixture({ mandateId: "m_mix", agentId: "agent_a", maxTotal: 100 }));

    const done = await seedProposal({ id: `${RUN_LABEL}_settled`, agentId: "agent_a", mandateId: "m_mix", amount: 70 });
    const settled = await reserveBudget(reserveInput(done, 100));
    ok(settled.outcome === "created");
    await bindAuthorization(settled.reservation.reservation_id, "auth_settled", AT);
    await beginSubmission(settled.reservation.reservation_id, "auth_settled", AT);
    await markSettled(settled.reservation.reservation_id, "0xabc", AT);

    strictEqual(await activeAmounts("m_mix"), 70, "settled spend still counts against the window");

    const next = await seedProposal({ id: `${RUN_LABEL}_over`, agentId: "agent_a", mandateId: "m_mix", amount: 40 });
    strictEqual((await reserveBudget(reserveInput(next, 100))).outcome, "insufficient_budget");

    const fits = await seedProposal({ id: `${RUN_LABEL}_fits`, agentId: "agent_a", mandateId: "m_mix", amount: 30 });
    strictEqual((await reserveBudget(reserveInput(fits, 100))).outcome, "created");
    strictEqual(await activeAmounts("m_mix"), 100, "settled + reserved may reach the ceiling exactly");
  });
});

describe("atomic velocity reservations", () => {
  it("allows at most one of two concurrent actions below a limit of one", async () => {
    await seedAgent("agent_velocity_pair");
    await insertMandate(
      mandateFixture({ mandateId: "m_velocity_pair", agentId: "agent_velocity_pair", maxTotal: 100 }),
    );
    const proposals = await Promise.all([
      seedProposal({ id: "velocity_pair_a", agentId: "agent_velocity_pair", mandateId: "m_velocity_pair", amount: 1 }),
      seedProposal({ id: "velocity_pair_b", agentId: "agent_velocity_pair", mandateId: "m_velocity_pair", amount: 1 }),
    ]);

    const results = await race(2, (index) =>
      reserveBudget(reserveInput(proposals[index]!, 100, { velocityLimit: 1 })),
    );
    strictEqual(results.filter((result) => result.outcome === "created").length, 1);
    strictEqual(results.filter((result) => result.outcome === "velocity_escalation").length, 1);
    strictEqual(
      await committedVelocityCount({ agentId: "agent_velocity_pair", at: AT }),
      1,
    );
  });

  it("holds the configured transaction count across a concurrent burst", async () => {
    const agentId = "agent_velocity_burst";
    const mandateId = "m_velocity_burst";
    await seedAgent(agentId);
    await insertMandate(mandateFixture({ mandateId, agentId, maxTotal: 100 }));
    const proposals = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        seedProposal({ id: `velocity_burst_${index}`, agentId, mandateId, amount: 1 }),
      ),
    );

    const results = await race(20, (index) =>
      reserveBudget(reserveInput(proposals[index]!, 100, { velocityLimit: 5 })),
    );
    strictEqual(results.filter((result) => result.outcome === "created").length, 5);
    strictEqual(results.filter((result) => result.outcome === "velocity_escalation").length, 15);
    strictEqual(await committedVelocityCount({ agentId, at: AT }), 5);
  });

  it("serializes one agent's velocity across distinct mandate budget locks", async () => {
    for (let round = 0; round < 10; round += 1) {
      const agentId = `agent_velocity_round_${round}`;
      const firstMandate = `m_velocity_round_${round}_a`;
      const secondMandate = `m_velocity_round_${round}_b`;
      await seedAgent(agentId);
      // Distinct mandate ids deliberately produce distinct budget advisory locks.
      // Only the per-agent velocity lock can serialize this race.
      await insertMandate(mandateFixture({ mandateId: firstMandate, agentId, maxTotal: 100 }));
      await insertMandate(mandateFixture({ mandateId: secondMandate, agentId, maxTotal: 100 }));
      const first = await seedProposal({ id: `velocity_round_${round}_a`, agentId, mandateId: firstMandate, amount: 1 });
      const second = await seedProposal({ id: `velocity_round_${round}_b`, agentId, mandateId: secondMandate, amount: 1 });
      const results = await race(2, (index) =>
        reserveBudget(
          reserveInput(index === 0 ? first : second, 100, { velocityLimit: 1 }),
        ),
      );
      deepStrictEqual(
        results.map((result) => result.outcome).sort(),
        ["created", "velocity_escalation"],
      );
    }
  });
});

describe("durable outcome reconciliation state", () => {
  async function submission(id: string, withCorrelation = true) {
    await seedAgent("agent_reconcile");
    await insertMandate(mandateFixture({
      mandateId: "m_reconcile",
      agentId: "agent_reconcile",
      maxTotal: 100,
    }));
    const proposal = await seedProposal({
      id,
      agentId: "agent_reconcile",
      mandateId: "m_reconcile",
      amount: 5,
    });
    const reserved = await reserveBudget(reserveInput(proposal, 100));
    ok(reserved.outcome === "created");
    const reservationId = reserved.reservation.reservation_id;
    await bindAuthorization(reservationId, `auth_${id}`, AT);
    ok(await beginSubmission(reservationId, `auth_${id}`, AT));
    if (withCorrelation) {
      ok(await recordPaymentAttempt(
        reservationId,
        {
          payer: "0x4444444444444444444444444444444444444444",
          payTo: "0x1111111111111111111111111111111111111111",
          nonce: `0x${"55".repeat(32)}`,
          payloadHash: `0x${"66".repeat(32)}`,
          validBefore: "1800000300",
          submissionBlock: "12345678",
        },
        AT,
        AT,
      ));
    }
    return reservationId;
  }

  it("persists chain correlation and never frees UNKNOWN by reservation TTL", async () => {
    const id = await submission("recon_correlation");
    await markOutcomeUnknown(id, AT, AT);
    const unknown = (await getReservation(id))!;
    strictEqual(unknown.status, "OUTCOME_UNKNOWN");
    strictEqual(unknown.payment_nonce, `0x${"55".repeat(32)}`);
    strictEqual(unknown.submission_block, "12345678");

    const afterTtl = new Date(Date.parse(unknown.expires_at) + 86_400_000).toISOString();
    strictEqual(await expireStaleReservations(afterTtl), 0);
    strictEqual((await getReservation(id))!.status, "OUTCOME_UNKNOWN");
  });

  it("lets only one of many reconciliation workers claim an ambiguous payment", async () => {
    const id = await submission("recon_race");
    await markOutcomeUnknown(id, AT, AT);
    const claims = await race(8, () => claimReconciliation({ at: AT, leaseSeconds: 30 }));
    const winners = claims.filter((claim) => claim !== null);
    strictEqual(winners.length, 1);
    strictEqual(winners[0]!.reservation_id, id);
    strictEqual(winners[0]!.status, "RECONCILING");
    strictEqual(winners[0]!.reconciliation_attempts, 1);
    ok(winners[0]!.reconciliation_token);
  });

  it("reclaims a crashed worker lease and fences the stale worker", async () => {
    const id = await submission("recon_restart");
    await markOutcomeUnknown(id, AT, AT);
    const first = await claimReconciliation({ at: AT, leaseSeconds: 1 });
    ok(first?.reconciliation_token);

    const afterLease = new Date(Date.parse(AT) + 2_000).toISOString();
    const restarted = await claimReconciliation({ at: afterLease, leaseSeconds: 30 });
    ok(restarted?.reconciliation_token);
    strictEqual(restarted.reservation_id, id);
    strictEqual(restarted.reconciliation_attempts, 2);
    strictEqual(first.reconciliation_token === restarted.reconciliation_token, false);

    strictEqual(
      await markReconciledSettled(id, first.reconciliation_token, "0xstale", afterLease),
      false,
      "the expired worker cannot finalize after its lease is fenced",
    );
    strictEqual(
      await markReconciledSettled(id, restarted.reconciliation_token, "0xsettled", afterLease),
      true,
    );
    const terminal = (await getReservation(id))!;
    strictEqual(terminal.status, "SETTLED");
    strictEqual(terminal.settlement_tx, "0xsettled");
  });

  it("keeps inconclusive evidence UNKNOWN, then safely releases proven non-payment", async () => {
    const id = await submission("recon_defer");
    await markOutcomeUnknown(id, AT, AT);
    const first = await claimReconciliation({ at: AT });
    ok(first?.reconciliation_token);
    const retryAt = new Date(Date.parse(AT) + 60_000).toISOString();
    strictEqual(
      await deferReconciliation(id, first.reconciliation_token, retryAt, "authorization still live", AT),
      true,
    );
    strictEqual((await getReservation(id))!.status, "OUTCOME_UNKNOWN");

    const second = await claimReconciliation({ at: retryAt });
    ok(second?.reconciliation_token);
    strictEqual(
      await markReconciledFailed(
        id,
        second.reconciliation_token,
        "authorization expired unused; safe to retry",
        retryAt,
      ),
      true,
    );
    strictEqual((await getReservation(id))!.status, "FAILED");
  });

  it("can safely release a stale SUBMITTING row with no persisted attempt", async () => {
    const id = await submission("recon_pre_transport_crash", false);
    await getPool().query(
      `UPDATE payment_reservation SET reconcile_after = $2 WHERE reservation_id = $1`,
      [id, AT],
    );
    const claim = await claimReconciliation({ at: AT });
    ok(claim?.reconciliation_token);
    strictEqual(claim.payment_nonce, null);
    strictEqual(
      await markReconciledFailed(
        id,
        claim.reconciliation_token,
        "no persisted payment attempt; transport was unreachable",
        AT,
      ),
      true,
    );
    strictEqual((await getReservation(id))!.status, "FAILED");
  });
});

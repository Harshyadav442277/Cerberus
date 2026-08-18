import { deepStrictEqual, rejects, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuditLogRecord, ProposedAction } from "@safr/core";
import type { HumanApprovalBinding, PaymentReservation } from "@safr/db";
import {
  AuthorizationError,
  buildExecutionTarget,
  hashProposal,
  issueExecutionAuthorization,
} from "@safr/execution-authorization";
import type { X402Payer } from "@safr/x402-client";
import { privateKeyToAccount } from "viem/accounts";
import { createIsolatedExecutor, ExecutionRefusedError } from "../execution.js";

const AUTH_KEY = `0x${"11".repeat(32)}` as const;
const RESERVATION_ID = "res_phase2_fixture";
const AUTHORIZATION_ID = "auth_1";
const BAD_KEY = `0x${"22".repeat(32)}` as const;
const NOW = 1_800_000_000_000;
const TARGET_CONFIG = {
  chainId: 84532,
  token: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  payTo: "0x1111111111111111111111111111111111111111",
  merchantBaseUrl: "http://localhost:4021",
};

const ACTION: ProposedAction = {
  action_id: "action_1",
  agent_id: "agent_treasury_01",
  action_type: "payment",
  proposed_at: "2026-08-18T10:00:00.000Z",
  payload: {
    counterparty: "merchant_xyz",
    amount: 0.5,
    currency: "USDC",
    purpose: "service_fulfillment",
    reference: "invoice_1",
  },
};

const AUDIT: AuditLogRecord = {
  audit_id: "audit_1",
  action_id: ACTION.action_id,
  agent_id: ACTION.agent_id,
  mandate_id: "mandate_001",
  mandate_version: 1,
  disposition: "ALLOW",
  reason: "within_mandate",
  rule_triggered: null,
  evaluated_at: "2026-08-18T10:00:00.100Z",
  human_review: null,
  settlement: null,
};

async function signed(key = AUTH_KEY) {
  return issueExecutionAuthorization({
    action: ACTION,
    mandateId: AUDIT.mandate_id,
    mandateVersion: AUDIT.mandate_version,
    reservationId: RESERVATION_ID,
    target: buildExecutionTarget(ACTION, TARGET_CONFIG),
    authorizerPrivateKey: key,
    nowMs: NOW,
    authorizationId: AUTHORIZATION_ID,
    nonce: `0x${"33".repeat(32)}`,
  });
}

const RESERVATION: PaymentReservation = {
  reservation_id: RESERVATION_ID,
  audit_id: AUDIT.audit_id,
  action_id: ACTION.action_id,
  agent_id: ACTION.agent_id,
  mandate_id: AUDIT.mandate_id,
  mandate_version: AUDIT.mandate_version,
  budget_key: `mandate:${AUDIT.mandate_id}`,
  currency: "USDC",
  amount_decimal: "0.500000",
  amount_atomic: "500000",
  chain_id: 84532,
  token: TARGET_CONFIG.token,
  status: "AUTHORIZED",
  authorization_id: AUTHORIZATION_ID,
  settlement_tx: null,
  counts_at: "2026-08-18T10:00:00.100Z",
  expires_at: "2026-08-18T10:02:00.100Z",
  created_at: "2026-08-18T10:00:00.100Z",
  updated_at: "2026-08-18T10:00:00.100Z",
};

/**
 * Stands in for the reservation table. `beginSubmission` keeps the real
 * compare-and-set semantics — AUTHORIZED once, then never again — so the durable
 * one-shot boundary is exercised here and not merely assumed.
 */
function reservationStore(initial: PaymentReservation | null = RESERVATION) {
  let current = initial ? { ...initial } : null;
  const calls: string[] = [];
  return {
    calls,
    port: {
      async beginSubmission(reservationId: string, authorizationId: string) {
        if (
          !current ||
          current.reservation_id !== reservationId ||
          current.authorization_id !== authorizationId ||
          current.status !== "AUTHORIZED"
        ) {
          return null;
        }
        current = { ...current, status: "SUBMITTING" };
        return current;
      },
      async markSettled(_id: string, tx: string | null) {
        calls.push(`settled:${tx}`);
        if (current) current = { ...current, status: "SETTLED" };
      },
      async markFailed() {
        calls.push("failed");
        if (current) current = { ...current, status: "FAILED" };
      },
      async markOutcomeUnknown() {
        calls.push("outcome_unknown");
        if (current) current = { ...current, status: "OUTCOME_UNKNOWN" };
      },
    },
    status: () => current?.status ?? null,
  };
}

const CURRENT_MANDATE = { mandate_id: AUDIT.mandate_id, version: AUDIT.mandate_version };
const APPROVAL: HumanApprovalBinding = {
  audit_id: AUDIT.audit_id,
  action_id: ACTION.action_id,
  agent_id: ACTION.agent_id,
  proposal_hash: hashProposal(ACTION),
  mandate_id: AUDIT.mandate_id,
  mandate_version: AUDIT.mandate_version,
  reviewer_id: "compliance_officer_01",
  decision: "approved",
  decided_at: new Date(NOW - 60_000).toISOString(),
  expires_at: new Date(NOW + 60_000).toISOString(),
};

function harness(
  context: {
    audit: AuditLogRecord;
    action: ProposedAction;
    reservation?: PaymentReservation | null;
    currentMandate?: { mandate_id: string; version: number } | null;
    approval?: HumanApprovalBinding | null;
  } = {
    audit: AUDIT,
    action: ACTION,
  },
  store = reservationStore(context.reservation === undefined ? RESERVATION : context.reservation),
  payerImpl?: X402Payer["pay"],
) {
  let constructed = 0;
  let paid = 0;
  const payer: X402Payer = {
    address: "0x4444444444444444444444444444444444444444",
    async pay(request) {
      paid += 1;
      if (payerImpl) return payerImpl(request);
      return {
        status: "settled",
        tx_hash: "0xdeadbeef",
        rail: "x402",
        settled_at: "2026-08-18T10:00:01.000Z",
      };
    },
  };
  const executor = createIsolatedExecutor({
    context: {
      async resolve() {
        return {
          audit: context.audit,
          action: context.action,
          reservation: context.reservation === undefined ? RESERVATION : context.reservation,
          currentMandate:
            context.currentMandate === undefined ? CURRENT_MANDATE : context.currentMandate,
          approval: context.approval === undefined ? null : context.approval,
        };
      },
    },
    reservations: store.port,
    expectedAuthorizer: privateKeyToAccount(AUTH_KEY).address,
    target: TARGET_CONFIG,
    payerFactory() {
      constructed += 1;
      return payer;
    },
    nowMs: () => NOW,
  });
  return { executor, store, constructed: () => constructed, paid: () => paid };
}

describe("isolated executor", () => {
  it("uses the signing path exactly once for a valid authorization", async () => {
    const h = harness();
    const settlement = await h.executor.execute({ audit_id: AUDIT.audit_id, envelope: await signed() });
    strictEqual(settlement.status, "settled");
    strictEqual(h.constructed(), 1);
    strictEqual(h.paid(), 1);
  });

  it("rejects a forged authorization before the payer exists", async () => {
    const h = harness();
    const envelope = await signed(BAD_KEY);
    await rejects(
      () => h.executor.execute({ audit_id: AUDIT.audit_id, envelope }),
    );
    strictEqual(h.constructed(), 0);
    strictEqual(h.paid(), 0);
  });

  it("rejects replay before a second signing attempt", async () => {
    const h = harness();
    const envelope = await signed();
    await h.executor.execute({ audit_id: AUDIT.audit_id, envelope });
    await rejects(
      () => h.executor.execute({ audit_id: AUDIT.audit_id, envelope }),
      (error) => error instanceof AuthorizationError && error.code === "AUTHORIZATION_REPLAY",
    );
    strictEqual(h.constructed(), 1);
    strictEqual(h.paid(), 1);
  });

  it("refuses a DENY audit before authorization or payer construction", async () => {
    const denied = { ...AUDIT, disposition: "DENY" as const, reason: "cap", rule_triggered: "spend_caps.per_transaction_max" };
    const h = harness({ audit: denied, action: ACTION });
    const envelope = await signed();
    await rejects(
      () => h.executor.execute({ audit_id: denied.audit_id, envelope }),
      (error) => error instanceof ExecutionRefusedError && error.code === "AUDIT_NOT_EXECUTABLE",
    );
    strictEqual(h.constructed(), 0);
  });

  it("rejects a proposal mutated after authorization without touching the key", async () => {
    const mutated = { ...ACTION, payload: { ...ACTION.payload, amount: 0.75 } };
    const h = harness({ audit: AUDIT, action: mutated });
    const envelope = await signed();
    await rejects(
      () => h.executor.execute({ audit_id: AUDIT.audit_id, envelope }),
    );
    strictEqual(h.constructed(), 0);
    strictEqual(h.paid(), 0);
  });

  it("executes an approved escalation only while its bound approval is fresh", async () => {
    const escalated: AuditLogRecord = {
      ...AUDIT,
      disposition: "ESCALATE",
      reason: "counterparty_not_on_allowlist",
      rule_triggered: "counterparty_policy",
      human_review: {
        reviewer_id: APPROVAL.reviewer_id,
        decision: "approved",
        decided_at: APPROVAL.decided_at,
        note: "Verified out of band",
      },
    };
    const h = harness({ audit: escalated, action: ACTION, approval: APPROVAL });

    strictEqual(
      (await h.executor.execute({ audit_id: escalated.audit_id, envelope: await signed() })).status,
      "settled",
    );
    strictEqual(h.constructed(), 1);
  });

  it("refuses an approval that expired after signing before the payment key exists", async () => {
    const escalated: AuditLogRecord = {
      ...AUDIT,
      disposition: "ESCALATE",
      reason: "counterparty_not_on_allowlist",
      rule_triggered: "counterparty_policy",
      human_review: {
        reviewer_id: APPROVAL.reviewer_id,
        decision: "approved",
        decided_at: APPROVAL.decided_at,
        note: "Verified out of band",
      },
    };
    const expired = { ...APPROVAL, expires_at: new Date(NOW).toISOString() };
    const h = harness({ audit: escalated, action: ACTION, approval: expired });

    await rejects(
      async () => h.executor.execute({ audit_id: escalated.audit_id, envelope: await signed() }),
      (error) => error instanceof ExecutionRefusedError && error.code === "STALE_APPROVAL",
    );
    strictEqual(h.constructed(), 0);
    strictEqual(h.store.status(), "AUTHORIZED", "the reservation is left untouched");
  });
});

describe("committed financial state gates execution", () => {
  it("refuses an audit with no live reservation before the payer exists", async () => {
    const h = harness({ audit: AUDIT, action: ACTION, reservation: null });
    const envelope = await signed();
    await rejects(
      () => h.executor.execute({ audit_id: AUDIT.audit_id, envelope }),
      (error) => error instanceof ExecutionRefusedError && error.code === "RESERVATION_NOT_FOUND",
    );
    strictEqual(h.constructed(), 0);
  });

  it("refuses an authorization that is not the one bound to the reservation", async () => {
    // AUTH B for a reservation whose committed state names AUTH A. Both are validly
    // signed; only one was ever committed to execution.
    const otherAuth = { ...RESERVATION, authorization_id: "auth_B" };
    const h = harness({ audit: AUDIT, action: ACTION, reservation: otherAuth }, reservationStore(otherAuth));
    const envelope = await signed();
    await rejects(
      () => h.executor.execute({ audit_id: AUDIT.audit_id, envelope }),
      (error) =>
        error instanceof ExecutionRefusedError && error.code === "RESERVATION_NOT_EXECUTABLE",
    );
    strictEqual(h.constructed(), 0);
    strictEqual(h.paid(), 0);
  });

  it("refuses a replay from a SECOND executor process with its own clean memory", async () => {
    // This is the case Phase 1's in-memory one-shot could not cover: the replay
    // arrives at a different process, whose use-store has never seen the nonce.
    const store = reservationStore();
    const first = harness({ audit: AUDIT, action: ACTION }, store);
    const second = harness({ audit: AUDIT, action: ACTION }, store);
    const envelope = await signed();

    strictEqual((await first.executor.execute({ audit_id: AUDIT.audit_id, envelope })).status, "settled");
    await rejects(
      () => second.executor.execute({ audit_id: AUDIT.audit_id, envelope }),
      (error) =>
        error instanceof ExecutionRefusedError && error.code === "RESERVATION_NOT_EXECUTABLE",
    );
    strictEqual(second.constructed(), 0, "the second process never reaches the payment key");
    strictEqual(store.status(), "SETTLED");
  });

  it("settles the reservation on a known successful payment", async () => {
    const h = harness();
    await h.executor.execute({ audit_id: AUDIT.audit_id, envelope: await signed() });
    deepStrictEqual(h.store.calls, ["settled:0xdeadbeef"]);
    strictEqual(h.store.status(), "SETTLED");
  });

  it("releases the reservation only on a positively reported failure", async () => {
    const h = harness({ audit: AUDIT, action: ACTION }, undefined, async () => ({
      status: "failed" as const,
      tx_hash: null,
      rail: "x402" as const,
      settled_at: null,
      error: "insufficient_funds",
    }));
    const settlement = await h.executor.execute({ audit_id: AUDIT.audit_id, envelope: await signed() });
    strictEqual(settlement.status, "failed");
    deepStrictEqual(h.store.calls, ["failed"]);
    strictEqual(h.store.status(), "FAILED");
  });

  it("refuses to spend under a mandate that has been superseded", async () => {
    // The control plane authorised this a moment ago; an administrator has published
    // a new version since. The process holding the payment key checks for itself.
    const h = harness({
      audit: AUDIT,
      action: ACTION,
      currentMandate: { mandate_id: AUDIT.mandate_id, version: AUDIT.mandate_version + 1 },
    });
    const envelope = await signed();
    await rejects(
      () => h.executor.execute({ audit_id: AUDIT.audit_id, envelope }),
      (error) => error instanceof ExecutionRefusedError && error.code === "STALE_MANDATE",
    );
    strictEqual(h.constructed(), 0, "the payment key is never reached");
    strictEqual(h.store.status(), "AUTHORIZED", "the reservation is left untouched");
  });

  it("refuses to spend when no mandate authorises the agent any more", async () => {
    const h = harness({ audit: AUDIT, action: ACTION, currentMandate: null });
    const envelope = await signed();
    await rejects(
      () => h.executor.execute({ audit_id: AUDIT.audit_id, envelope }),
      (error) => error instanceof ExecutionRefusedError && error.code === "STALE_MANDATE",
    );
    strictEqual(h.constructed(), 0);
  });

  it("holds capacity as OUTCOME_UNKNOWN when settlement throws", async () => {
    // A thrown error is not evidence that the money stayed put. Releasing here is how
    // a system double-pays, so the reservation keeps holding the budget.
    const h = harness({ audit: AUDIT, action: ACTION }, undefined, async () => {
      throw new Error("socket hang up after broadcast");
    });
    const envelope = await signed();
    await rejects(() => h.executor.execute({ audit_id: AUDIT.audit_id, envelope }));
    deepStrictEqual(h.store.calls, ["outcome_unknown"]);
    strictEqual(h.store.status(), "OUTCOME_UNKNOWN");
  });
});

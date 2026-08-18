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
import {
  X402ChallengeError,
  paymentRequestUrl,
  type SettlementResult,
  type X402Challenge,
  type X402Payer,
} from "@safr/x402-client";
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

const LIVE_CHALLENGE: X402Challenge = {
  method: "GET",
  requestUrl: paymentRequestUrl(ACTION.payload, TARGET_CONFIG.merchantBaseUrl),
  paymentRequired: {
    x402Version: 2,
    error: "Payment required",
    resource: {
      url: paymentRequestUrl(ACTION.payload, TARGET_CONFIG.merchantBaseUrl),
      description: "fixture",
      mimeType: "application/json",
    },
    accepts: [{
      scheme: "exact",
      network: "eip155:84532",
      amount: "500000",
      asset: TARGET_CONFIG.token,
      payTo: TARGET_CONFIG.payTo,
      maxTimeoutSeconds: 300,
      extra: { name: "USDC", version: "2" },
    }],
  },
};

function challengeWith(
  update: Partial<X402Challenge["paymentRequired"]["accepts"][number]>,
): X402Challenge {
  return {
    ...LIVE_CHALLENGE,
    paymentRequired: {
      ...LIVE_CHALLENGE.paymentRequired,
      accepts: [{ ...LIVE_CHALLENGE.paymentRequired.accepts[0]!, ...update }],
    },
  };
}

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

async function signed(key = AUTH_KEY, ttlSeconds = 60) {
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
    ttlSeconds,
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
  payment_payer: null,
  payment_pay_to: null,
  payment_nonce: null,
  payment_payload_hash: null,
  payment_valid_before: null,
  submission_block: null,
  reconcile_after: null,
  reconciliation_attempts: 0,
  reconciliation_token: null,
  reconciliation_error: null,
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
        current = {
          ...current,
          status: "SUBMITTING",
          reconcile_after: new Date(NOW + 120_000).toISOString(),
        };
        return current;
      },
      async recordPaymentAttempt(
        reservationId: string,
        correlation: {
          payer: string;
          payTo: string;
          nonce: string;
          payloadHash: string;
          validBefore: string;
          submissionBlock: string;
        },
        reconcileAfter: string,
      ) {
        if (!current || current.reservation_id !== reservationId || current.status !== "SUBMITTING") {
          return null;
        }
        current = {
          ...current,
          payment_payer: correlation.payer,
          payment_pay_to: correlation.payTo,
          payment_nonce: correlation.nonce,
          payment_payload_hash: correlation.payloadHash,
          payment_valid_before: correlation.validBefore,
          submission_block: correlation.submissionBlock,
          reconcile_after: reconcileAfter,
        };
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
  payerImpl?: () => Promise<SettlementResult>,
  challenges: X402Challenge[] = [LIVE_CHALLENGE],
  runtime: {
    nowMs?: () => number;
    resolve?: (call: number) => Promise<{
      audit: AuditLogRecord;
      action: ProposedAction;
      reservation: PaymentReservation | null;
      currentMandate: { mandate_id: string; version: number } | null;
      approval: HumanApprovalBinding | null;
    }>;
    challengeFetcher?: () => Promise<X402Challenge>;
  } = {},
) {
  let constructed = 0;
  let paid = 0;
  let challenged = 0;
  let resolved = 0;
  const payer: X402Payer = {
    address: "0x4444444444444444444444444444444444444444",
    async prepare() {
      const correlation = {
        payer: "0x4444444444444444444444444444444444444444",
        payTo: TARGET_CONFIG.payTo,
        nonce: `0x${"77".repeat(32)}`,
        payloadHash: `0x${"88".repeat(32)}`,
        validBefore: "1800000300",
        submissionBlock: "12345678",
      };
      return {
        correlation,
        async submit(persist) {
          if (!(await persist(correlation))) throw new Error("attempt persistence refused");
          paid += 1;
          if (payerImpl) return payerImpl();
          return {
            status: "settled",
            tx_hash: "0xdeadbeef",
            rail: "x402",
            settled_at: "2026-08-18T10:00:01.000Z",
          };
        },
      };
    },
  };
  const executor = createIsolatedExecutor({
    context: {
      async resolve() {
        resolved += 1;
        if (runtime.resolve) return runtime.resolve(resolved);
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
    async challengeFetcher() {
      if (runtime.challengeFetcher) {
        challenged += 1;
        return runtime.challengeFetcher();
      }
      const challenge = challenges[Math.min(challenged, challenges.length - 1)];
      challenged += 1;
      if (!challenge) throw new Error("missing challenge fixture");
      return challenge;
    },
    payerFactory() {
      constructed += 1;
      return payer;
    },
    nowMs: runtime.nowMs ?? (() => NOW),
  });
  return {
    executor,
    store,
    challenged: () => challenged,
    constructed: () => constructed,
    paid: () => paid,
    resolved: () => resolved,
  };
}

describe("isolated executor", () => {
  it("uses the signing path exactly once for a valid authorization", async () => {
    const h = harness();
    const settlement = await h.executor.execute({ audit_id: AUDIT.audit_id, envelope: await signed() });
    strictEqual(settlement.status, "settled");
    strictEqual(h.constructed(), 1);
    strictEqual(h.paid(), 1);
    strictEqual(h.challenged(), 1);
  });

  it("rejects a forged authorization before the payer exists", async () => {
    const h = harness();
    const envelope = await signed(BAD_KEY);
    await rejects(
      () => h.executor.execute({ audit_id: AUDIT.audit_id, envelope }),
    );
    strictEqual(h.constructed(), 0);
    strictEqual(h.paid(), 0);
    strictEqual(h.challenged(), 0, "forged authority cannot trigger merchant I/O");
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

  it("refuses when the merchant delays until the authorization expires", async () => {
    let now = NOW;
    const h = harness(undefined, undefined, undefined, undefined, {
      nowMs: () => now,
      async challengeFetcher() {
        now = NOW + 60_000;
        return LIVE_CHALLENGE;
      },
    });

    await rejects(
      async () => h.executor.execute({ audit_id: AUDIT.audit_id, envelope: await signed() }),
      (error) => error instanceof AuthorizationError && error.code === "AUTHORIZATION_EXPIRED",
    );
    strictEqual(h.resolved(), 2, "trusted state is read again after the merchant response");
    strictEqual(h.constructed(), 0);
    strictEqual(h.store.status(), "AUTHORIZED");
  });

  it("refuses when the mandate is revoked during the unsigned challenge fetch", async () => {
    const h = harness(undefined, undefined, undefined, undefined, {
      async resolve(call) {
        return {
          audit: AUDIT,
          action: ACTION,
          reservation: RESERVATION,
          currentMandate: call === 1 ? CURRENT_MANDATE : null,
          approval: null,
        };
      },
    });

    await rejects(
      async () => h.executor.execute({ audit_id: AUDIT.audit_id, envelope: await signed() }),
      (error) => error instanceof ExecutionRefusedError && error.code === "STALE_MANDATE",
    );
    strictEqual(h.constructed(), 0);
    strictEqual(h.store.status(), "AUTHORIZED");
  });

  it("refuses when human approval expires during the unsigned challenge fetch", async () => {
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
    let now = NOW;
    const shortApproval = { ...APPROVAL, expires_at: new Date(NOW + 1_000).toISOString() };
    const h = harness({ audit: escalated, action: ACTION, approval: shortApproval }, undefined, undefined, undefined, {
      nowMs: () => now,
      async challengeFetcher() {
        now = NOW + 2_000;
        return LIVE_CHALLENGE;
      },
    });

    await rejects(
      async () => h.executor.execute({ audit_id: AUDIT.audit_id, envelope: await signed(AUTH_KEY, 300) }),
      (error) => error instanceof ExecutionRefusedError && error.code === "STALE_APPROVAL",
    );
    strictEqual(h.constructed(), 0);
    strictEqual(h.store.status(), "AUTHORIZED");
  });

  it("refuses a challenge timeout without consuming authority or reaching the key", async () => {
    const h = harness(undefined, undefined, undefined, undefined, {
      async challengeFetcher() {
        throw new X402ChallengeError("CHALLENGE_TIMEOUT");
      },
    });
    await rejects(
      async () => h.executor.execute({ audit_id: AUDIT.audit_id, envelope: await signed() }),
      (error) => error instanceof X402ChallengeError && error.code === "CHALLENGE_TIMEOUT",
    );
    strictEqual(h.resolved(), 1, "timeout occurs before the final trusted-state read");
    strictEqual(h.constructed(), 0);
    strictEqual(h.store.status(), "AUTHORIZED");
  });
});

describe("exact live x402 challenge binding", () => {
  const attacks: Array<{
    name: string;
    challenge: X402Challenge;
    code: X402ChallengeError["code"];
  }> = [
    {
      name: "amount 5 USDC → 50 USDC",
      challenge: challengeWith({ amount: "50000000" }),
      code: "AMOUNT_MISMATCH",
    },
    {
      name: "payee Alice → attacker",
      challenge: challengeWith({ payTo: "0x2222222222222222222222222222222222222222" }),
      code: "PAYEE_MISMATCH",
    },
    {
      name: "wrong token",
      challenge: challengeWith({ asset: "0x2222222222222222222222222222222222222222" }),
      code: "TOKEN_MISMATCH",
    },
    {
      name: "wrong chain",
      challenge: challengeWith({ network: "eip155:8453" }),
      code: "NETWORK_MISMATCH",
    },
    {
      name: "wrong scheme",
      challenge: challengeWith({ scheme: "upto" }),
      code: "SCHEME_MISMATCH",
    },
    {
      name: "wrong EIP-712 token domain",
      challenge: challengeWith({ extra: { name: "Fake USDC", version: "2" } }),
      code: "EIP712_DOMAIN_MISMATCH",
    },
    {
      name: "transfer-method switch",
      challenge: challengeWith({
        extra: { name: "USDC", version: "2", assetTransferMethod: "permit2" },
      }),
      code: "TRANSFER_METHOD_MISMATCH",
    },
    {
      name: "wrong x402 protocol version",
      challenge: {
        ...LIVE_CHALLENGE,
        paymentRequired: {
          ...LIVE_CHALLENGE.paymentRequired,
          x402Version: 1,
        } as unknown as X402Challenge["paymentRequired"],
      },
      code: "VERSION_MISMATCH",
    },
  ];

  for (const attack of attacks) {
    it(`rejects ${attack.name} before the payment key exists`, async () => {
      const h = harness(undefined, undefined, undefined, [attack.challenge]);
      const envelope = await signed();
      await rejects(
        () => h.executor.execute({ audit_id: AUDIT.audit_id, envelope }),
        (error) => error instanceof X402ChallengeError && error.code === attack.code,
      );
      strictEqual(h.challenged(), 1);
      strictEqual(h.constructed(), 0);
      strictEqual(h.paid(), 0);
      strictEqual(h.store.status(), "AUTHORIZED");
      deepStrictEqual(h.store.calls, []);
    });
  }

  it("rejects a wrong resource before the payment key exists", async () => {
    const malicious: X402Challenge = {
      ...LIVE_CHALLENGE,
      paymentRequired: {
        ...LIVE_CHALLENGE.paymentRequired,
        resource: {
          ...LIVE_CHALLENGE.paymentRequired.resource,
          url: "http://localhost:4021/pay/attacker?amount=0.5",
        },
      },
    };
    const h = harness(undefined, undefined, undefined, [malicious]);
    const envelope = await signed();
    await rejects(
      () => h.executor.execute({ audit_id: AUDIT.audit_id, envelope }),
      (error) => error instanceof X402ChallengeError && error.code === "RESOURCE_MISMATCH",
    );
    strictEqual(h.constructed(), 0);
    strictEqual(h.store.status(), "AUTHORIZED");
  });

  it("leaves authority reusable after mismatch because no signature was constructed", async () => {
    const h = harness(
      undefined,
      undefined,
      undefined,
      [challengeWith({ amount: "50000000" }), LIVE_CHALLENGE],
    );
    const envelope = await signed();
    await rejects(
      () => h.executor.execute({ audit_id: AUDIT.audit_id, envelope }),
      (error) => error instanceof X402ChallengeError && error.code === "AMOUNT_MISMATCH",
    );
    strictEqual(h.store.status(), "AUTHORIZED");
    strictEqual(h.constructed(), 0);

    const settlement = await h.executor.execute({ audit_id: AUDIT.audit_id, envelope });
    strictEqual(settlement.status, "settled");
    strictEqual(h.constructed(), 1);
    strictEqual(h.paid(), 1);
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

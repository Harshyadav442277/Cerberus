import { rejects, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuditLogRecord, ProposedAction } from "@safr/core";
import {
  AuthorizationError,
  buildExecutionTarget,
  issueExecutionAuthorization,
  phase1ReservationId,
} from "@safr/execution-authorization";
import type { X402Payer } from "@safr/x402-client";
import { privateKeyToAccount } from "viem/accounts";
import { createIsolatedExecutor, ExecutionRefusedError } from "../execution.js";

const AUTH_KEY = `0x${"11".repeat(32)}` as const;
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
    reservationId: phase1ReservationId(AUDIT.audit_id),
    target: buildExecutionTarget(ACTION, TARGET_CONFIG),
    authorizerPrivateKey: key,
    nowMs: NOW,
    authorizationId: "auth_1",
    nonce: `0x${"33".repeat(32)}`,
  });
}

function harness(context = { audit: AUDIT, action: ACTION }) {
  let constructed = 0;
  let paid = 0;
  const payer: X402Payer = {
    address: "0x4444444444444444444444444444444444444444",
    async pay() {
      paid += 1;
      return {
        status: "settled",
        tx_hash: "0xdeadbeef",
        rail: "x402",
        settled_at: "2026-08-18T10:00:01.000Z",
      };
    },
  };
  const executor = createIsolatedExecutor({
    context: { async resolve() { return context; } },
    expectedAuthorizer: privateKeyToAccount(AUTH_KEY).address,
    target: TARGET_CONFIG,
    payerFactory() {
      constructed += 1;
      return payer;
    },
    nowMs: () => NOW,
  });
  return { executor, constructed: () => constructed, paid: () => paid };
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
});

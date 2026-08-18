import { rejects, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuditLogRecord, Mandate, ProposedAction } from "@safr/core";
import { privateKeyToAccount } from "viem/accounts";
import {
  AuthorizationIssuanceError,
  createExecutionAuthorizer,
} from "../execution-authorizer.js";

const KEY = `0x${"11".repeat(32)}`;
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
const MANDATE: Mandate = {
  mandate_id: "mandate_001",
  agent_id: ACTION.agent_id,
  version: 1,
  effective_from: "2026-08-01T00:00:00.000Z",
  effective_to: null,
  status: "active",
  scope: { action_types: ["payment"], currencies: ["USDC"] },
  controls: {
    spend_caps: { per_transaction_max: 1, rolling_window: { window: "24h", max_total: 3 } },
    counterparty_policy: {
      mode: "allowlist",
      allowlist: ["merchant_xyz"],
      unknown_counterparty_disposition: "ESCALATE",
    },
    time_window: {
      allowed_hours_utc: ["00:00-23:59"],
      allowed_days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    },
    velocity: { max_transactions_per_hour: 10 },
  },
  default_disposition_on_breach: "DENY",
  created_by: "compliance_officer_01",
  approved_by: "compliance_officer_01",
};
const AUDIT: AuditLogRecord = {
  audit_id: "audit_1",
  action_id: ACTION.action_id,
  agent_id: ACTION.agent_id,
  mandate_id: MANDATE.mandate_id,
  mandate_version: MANDATE.version,
  disposition: "ALLOW",
  reason: "within_mandate",
  rule_triggered: null,
  evaluated_at: "2026-08-18T10:00:00.100Z",
  human_review: null,
  settlement: null,
};

function authorizer(action = ACTION, audit = AUDIT) {
  return createExecutionAuthorizer({
    context: {
      async getAudit() { return audit; },
      async getAction() { return action; },
      async loadEvaluationContext() {
        return { mandate: MANDATE, counters: { rolling_total_24h: 0, hourly_tx_count: 0 } };
      },
    },
    authorizerPrivateKey: KEY,
    target: {
      chainId: 84532,
      payTo: "0x1111111111111111111111111111111111111111",
      merchantBaseUrl: "http://localhost:4021",
    },
    nowMs: () => 1_800_000_000_000,
  });
}

describe("trusted execution authorizer", () => {
  it("fails closed on invalid signer/target configuration before reading audit state", async () => {
    let reads = 0;
    const invalid = createExecutionAuthorizer({
      context: {
        async getAudit() { reads += 1; return AUDIT; },
        async getAction() { reads += 1; return ACTION; },
        async loadEvaluationContext() {
          reads += 1;
          return { mandate: MANDATE, counters: { rolling_total_24h: 0, hourly_tx_count: 0 } };
        },
      },
      authorizerPrivateKey: `0x${"00".repeat(32)}`,
      target: {
        chainId: 84532,
        payTo: "not-an-address",
        merchantBaseUrl: "http://localhost:4021",
      },
    });
    await rejects(
      () => invalid.issue(AUDIT.audit_id),
      (error) =>
        error instanceof AuthorizationIssuanceError &&
        error.code === "AUTHORIZER_NOT_CONFIGURED",
    );
    strictEqual(reads, 0);
  });

  it("re-evaluates an ALLOW and signs the pinned audit context", async () => {
    const envelope = await authorizer().issue(AUDIT.audit_id);
    strictEqual(envelope.authorization.mandateId, MANDATE.mandate_id);
    strictEqual(envelope.authorization.mandateVersion, MANDATE.version);
    strictEqual(envelope.authorization.amount, "500000");
    strictEqual(envelope.authorization.payTo, "0x1111111111111111111111111111111111111111");
    strictEqual(privateKeyToAccount(KEY as `0x${string}`).address.length, 42);
  });

  it("refuses a cap breach even if a compromised caller presents an ALLOW audit", async () => {
    const breach = { ...ACTION, payload: { ...ACTION.payload, amount: 5 } };
    await rejects(
      () => authorizer(breach).issue(AUDIT.audit_id),
      (error) =>
        error instanceof AuthorizationIssuanceError &&
        error.code === "DISPOSITION_NOT_EXECUTABLE",
    );
  });

  it("requires persisted approval for an ESCALATE", async () => {
    const unknown = { ...ACTION, payload: { ...ACTION.payload, counterparty: "merchant_new" } };
    const escalated = {
      ...AUDIT,
      disposition: "ESCALATE" as const,
      reason: "counterparty_not_on_allowlist",
      rule_triggered: "counterparty_policy",
    };
    await rejects(
      () => authorizer(unknown, escalated).issue(AUDIT.audit_id),
      (error) =>
        error instanceof AuthorizationIssuanceError && error.code === "HUMAN_APPROVAL_REQUIRED",
    );
  });
});

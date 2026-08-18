import { ok, rejects, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuditLogRecord, Mandate, ProposedAction } from "@safr/core";
import type { PaymentReservation, ReserveBudgetInput, ReserveBudgetResult } from "@safr/db";
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

/**
 * Stands in for the reservation table with the same two guarantees the real one has:
 * a hard ceiling on committed capacity, and at most one authorization ever bound to a
 * reservation. The database-level proof of both lives in the packages/db suite, which
 * runs against a real PostgreSQL; this fake exists so the authorizer's ORDERING can be
 * asserted without one.
 */
function reservations(options: { ceiling?: number } = {}) {
  const ceiling = options.ceiling ?? 100;
  const rows = new Map<string, PaymentReservation>();
  const calls = { reserve: 0, bind: 0 };

  function committed(): number {
    return [...rows.values()]
      .filter((r) => r.status !== "FAILED" && r.status !== "EXPIRED")
      .reduce((sum, r) => sum + Number(r.amount_decimal), 0);
  }

  return {
    calls,
    rows,
    port: {
      async reserve(input: ReserveBudgetInput): Promise<ReserveBudgetResult> {
        calls.reserve += 1;
        const live = [...rows.values()].find(
          (r) => r.audit_id === input.auditId || r.action_id === input.actionId,
        );
        if (live) return { outcome: "existing", reservation: live };
        if (committed() + Number(input.amountDecimal) > ceiling) {
          return {
            outcome: "insufficient_budget",
            committed: committed().toString(),
            requested: input.amountDecimal,
            limit: ceiling.toString(),
          };
        }
        const reservation: PaymentReservation = {
          reservation_id: `res_${rows.size + 1}`,
          audit_id: input.auditId,
          action_id: input.actionId,
          agent_id: input.agentId,
          mandate_id: input.mandateId,
          mandate_version: input.mandateVersion,
          budget_key: `mandate:${input.mandateId}`,
          currency: input.currency,
          amount_decimal: input.amountDecimal,
          amount_atomic: input.amountAtomic,
          chain_id: input.chainId,
          token: input.token,
          status: "RESERVED",
          authorization_id: null,
          settlement_tx: null,
          counts_at: "2026-08-18T10:00:00.000Z",
          expires_at: "2026-08-18T10:02:00.000Z",
          created_at: "2026-08-18T10:00:00.000Z",
          updated_at: "2026-08-18T10:00:00.000Z",
        };
        rows.set(reservation.reservation_id, reservation);
        return { outcome: "created", reservation };
      },
      async bindAuthorization(reservationId: string, authorizationId: string) {
        calls.bind += 1;
        const row = rows.get(reservationId);
        if (!row || row.status !== "RESERVED" || row.authorization_id !== null) return null;
        const bound: PaymentReservation = {
          ...row,
          status: "AUTHORIZED",
          authorization_id: authorizationId,
        };
        rows.set(reservationId, bound);
        return bound;
      },
    },
  };
}

function authorizer(action = ACTION, audit = AUDIT, store = reservations()) {
  return createExecutionAuthorizer({
    context: {
      async getAudit() { return audit; },
      async getAction() { return action; },
      async loadEvaluationContext() {
        return { mandate: MANDATE, counters: { rolling_total_24h: 0, hourly_tx_count: 0 } };
      },
    },
    reservations: store.port,
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
      reservations: reservations().port,
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

describe("authorization is backed by committed capacity", () => {
  it("binds the signed authorization to a real reservation, not a derived string", async () => {
    const store = reservations();
    const envelope = await authorizer(ACTION, AUDIT, store).issue(AUDIT.audit_id);

    const reservation = [...store.rows.values()][0]!;
    strictEqual(envelope.authorization.reservationId, reservation.reservation_id);
    ok(!envelope.authorization.reservationId.startsWith("phase1_unreserved"));
    strictEqual(reservation.status, "AUTHORIZED");
    strictEqual(reservation.authorization_id, envelope.authorization.authorizationId);
    strictEqual(reservation.amount_decimal, "0.500000", "reserved amount matches the atomic amount");
  });

  it("refuses to issue when the shared budget cannot cover the proposal", async () => {
    const store = reservations({ ceiling: 0.25 });
    await rejects(
      () => authorizer(ACTION, AUDIT, store).issue(AUDIT.audit_id),
      (error) =>
        error instanceof AuthorizationIssuanceError && error.code === "INSUFFICIENT_BUDGET",
    );
    strictEqual(store.calls.bind, 0, "nothing is signed when capacity is refused");
  });

  it("gives one audit a single executable authorization however often it asks", async () => {
    // The Phase 1 gap: one audit could mint AUTH A and AUTH B, both validly signed,
    // both seeing settlement === null. Committed capacity is now the source of truth.
    const store = reservations();
    const issuer = authorizer(ACTION, AUDIT, store);
    const first = await issuer.issue(AUDIT.audit_id);

    await rejects(
      () => issuer.issue(AUDIT.audit_id),
      (error) =>
        error instanceof AuthorizationIssuanceError &&
        error.code === "AUTHORIZATION_ALREADY_ISSUED",
    );
    strictEqual(store.rows.size, 1, "the second request created no second reservation");
    strictEqual(
      [...store.rows.values()][0]!.authorization_id,
      first.authorization.authorizationId,
    );
  });

  it("does not reserve capacity for a DENY", async () => {
    const store = reservations();
    const breach = { ...ACTION, payload: { ...ACTION.payload, amount: 5 } };
    await rejects(() => authorizer(breach, AUDIT, store).issue(AUDIT.audit_id));
    strictEqual(store.calls.reserve, 0, "a denied proposal never touches financial state");
  });
});

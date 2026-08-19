import { ok, rejects, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentIdentity, AuditLogRecord, Mandate, ProposedAction } from "@safr/core";
import type {
  HumanApprovalBinding,
  PaymentReservation,
  ReserveBudgetInput,
  ReserveBudgetResult,
} from "@safr/db";
import { hashProposal } from "@safr/execution-authorization";
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
function reservations(options: { ceiling?: number; velocityEscalation?: boolean } = {}) {
  const ceiling = options.ceiling ?? 100;
  const rows = new Map<string, PaymentReservation>();
  const calls = { reserve: 0, bind: 0, promote: 0 };

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
        if (options.velocityEscalation && !input.velocityOverrideApproved) {
          return {
            outcome: "velocity_escalation",
            committed: input.velocityLimit,
            limit: input.velocityLimit,
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
          counts_at: "2026-08-18T10:00:00.000Z",
          expires_at: "2026-08-18T10:02:00.000Z",
          created_at: "2026-08-18T10:00:00.000Z",
          updated_at: "2026-08-18T10:00:00.000Z",
        };
        rows.set(reservation.reservation_id, reservation);
        return { outcome: "created", reservation };
      },
      async recordIssued() {
        return undefined;
      },
      async promoteVelocityEscalation() {
        calls.promote += 1;
        return true;
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

/** An approval bound to exactly this proposal under exactly this mandate version. */
function approval(overrides: Partial<HumanApprovalBinding> = {}): HumanApprovalBinding {
  return {
    audit_id: AUDIT.audit_id,
    action_id: ACTION.action_id,
    agent_id: ACTION.agent_id,
    proposal_hash: hashProposal(ACTION),
    mandate_id: MANDATE.mandate_id,
    mandate_version: MANDATE.version,
    reviewer_id: "compliance_officer_01",
    decision: "approved",
    decided_at: "2027-01-15T22:00:00.000Z",
    expires_at: "2027-01-15T22:30:00.000Z",
    ...overrides,
  };
}

/** The trusted identity row the control plane reads. Active unless a test says otherwise. */
function agentIdentity(status: AgentIdentity["status"] = "active"): AgentIdentity {
  return {
    agent_id: ACTION.agent_id,
    display_name: "Treasury Agent",
    owner_org: "acme_corp",
    created_at: "2026-08-01T00:00:00.000Z",
    wallet_address: "0x2222222222222222222222222222222222222222",
    status,
  };
}

function authorizer(
  action = ACTION,
  audit = AUDIT,
  store = reservations(),
  options: {
    mandate?: Mandate;
    currentMandate?: Mandate | null;
    approval?: HumanApprovalBinding | null;
    /** Null models an agent with no identity row at all. */
    agent?: AgentIdentity | null;
    nowIso?: string;
  } = {},
) {
  const historical = options.mandate ?? MANDATE;
  const current = options.currentMandate === undefined ? historical : options.currentMandate;
  const agent = options.agent === undefined ? agentIdentity() : options.agent;
  return createExecutionAuthorizer({
    context: {
      async getAudit() { return audit; },
      async getAction() { return action; },
      async getAgent() { return agent; },
      async loadEvaluationContext(_agentId: string, at: string) {
        // The authorizer asks twice: once at proposed_at for the historical record,
        // once at "now" for current authority. Answering differently is what lets a
        // revoked or superseded mandate be tested at all.
        const mandate = at === action.proposed_at ? historical : current;
        return { mandate, counters: { rolling_total_24h: 0, hourly_tx_count: 0 } };
      },
      async getApproval() { return options.approval ?? null; },
    },
    reservations: store.port,
    authorizerPrivateKey: KEY,
    target: {
      chainId: 84532,
      payTo: "0x1111111111111111111111111111111111111111",
      merchantBaseUrl: "http://localhost:4021",
    },
    nowMs: () => Date.parse(options.nowIso ?? "2027-01-15T22:05:00.000Z"),
  });
}

describe("trusted execution authorizer", () => {
  it("fails closed on invalid signer/target configuration before reading audit state", async () => {
    let reads = 0;
    const invalid = createExecutionAuthorizer({
      context: {
        async getAudit() { reads += 1; return AUDIT; },
        async getAction() { reads += 1; return ACTION; },
        async getAgent() { reads += 1; return agentIdentity(); },
        async loadEvaluationContext() {
          reads += 1;
          return { mandate: MANDATE, counters: { rolling_total_24h: 0, hourly_tx_count: 0 } };
        },
        async getApproval() { reads += 1; return null; },
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

  it("records a transaction-time velocity race as ESCALATE before refusing authority", async () => {
    const store = reservations({ velocityEscalation: true });
    await rejects(
      () => authorizer(ACTION, AUDIT, store).issue(AUDIT.audit_id),
      (error) =>
        error instanceof AuthorizationIssuanceError &&
        error.code === "VELOCITY_ESCALATION_REQUIRED",
    );
    strictEqual(store.calls.promote, 1, "the trusted control plane records the escalation");
    strictEqual(store.calls.bind, 0, "no authorization is bound before human review");
    strictEqual(store.rows.size, 0, "the raced request holds no financial capacity");
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

describe("current authority is checked, not just historical", () => {
  it("uses trusted issuance time for the current time-window check", async () => {
    const officeHours: Mandate = {
      ...MANDATE,
      controls: {
        ...MANDATE.controls,
        time_window: {
          allowed_hours_utc: ["09:00-17:00"],
          allowed_days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
        },
      },
    };
    const store = reservations();

    // The caller's proposed_at is 10:00 and historically valid. Trusted nowMs is
    // 22:05, so a capability must not be minted after the window has closed.
    await rejects(
      () => authorizer(ACTION, AUDIT, store, { mandate: officeHours }).issue(AUDIT.audit_id),
      (error) =>
        error instanceof AuthorizationIssuanceError && error.code === "CURRENT_AUTHORITY_DENIES",
    );
    strictEqual(store.calls.reserve, 0);
  });

  it("does not let a forged future proposed_at replace trusted issuance time", async () => {
    const officeHours: Mandate = {
      ...MANDATE,
      controls: {
        ...MANDATE.controls,
        time_window: {
          allowed_hours_utc: ["09:00-17:00"],
          allowed_days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
        },
      },
    };
    const future = { ...ACTION, proposed_at: "2027-01-18T10:00:00.000Z" };
    const store = reservations();

    await rejects(
      () => authorizer(future, AUDIT, store, { mandate: officeHours }).issue(AUDIT.audit_id),
      (error) =>
        error instanceof AuthorizationIssuanceError && error.code === "CURRENT_AUTHORITY_DENIES",
    );
    strictEqual(store.calls.reserve, 0);
  });

  it("issues when both historical proposal time and trusted now are inside the window", async () => {
    const officeHours: Mandate = {
      ...MANDATE,
      controls: {
        ...MANDATE.controls,
        time_window: {
          allowed_hours_utc: ["09:00-17:00"],
          allowed_days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
        },
      },
    };

    const envelope = await authorizer(ACTION, AUDIT, reservations(), {
      mandate: officeHours,
      nowIso: "2027-01-15T10:30:00.000Z",
    }).issue(AUDIT.audit_id);
    strictEqual(envelope.authorization.proposalHash, hashProposal(ACTION));
  });

  it("preserves the documented inclusive whole-minute boundary at trusted now", async () => {
    const officeHours: Mandate = {
      ...MANDATE,
      controls: {
        ...MANDATE.controls,
        time_window: {
          allowed_hours_utc: ["09:00-17:00"],
          allowed_days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
        },
      },
    };

    const atBoundary = await authorizer(ACTION, AUDIT, reservations(), {
      mandate: officeHours,
      nowIso: "2027-01-15T17:00:59.999Z",
    }).issue(AUDIT.audit_id);
    strictEqual(atBoundary.authorization.proposalHash, hashProposal(ACTION));

    const afterBoundary = reservations();
    await rejects(
      () => authorizer(ACTION, AUDIT, afterBoundary, {
        mandate: officeHours,
        nowIso: "2027-01-15T17:01:00.000Z",
      }).issue(AUDIT.audit_id),
      (error) =>
        error instanceof AuthorizationIssuanceError && error.code === "CURRENT_AUTHORITY_DENIES",
    );
    strictEqual(afterBoundary.calls.reserve, 0);
  });

  it("refuses when the mandate has been superseded since the decision", async () => {
    const store = reservations();
    await rejects(
      () => authorizer(ACTION, AUDIT, store, { currentMandate: { ...MANDATE, version: 2 } })
        .issue(AUDIT.audit_id),
      (error) => error instanceof AuthorizationIssuanceError && error.code === "STALE_MANDATE",
    );
    strictEqual(store.calls.reserve, 0, "stale authority never reaches financial state");
  });

  it("refuses when no mandate authorises the agent any more", async () => {
    const store = reservations();
    await rejects(
      () => authorizer(ACTION, AUDIT, store, { currentMandate: null }).issue(AUDIT.audit_id),
      (error) => error instanceof AuthorizationIssuanceError && error.code === "MANDATE_REVOKED",
    );
    strictEqual(store.calls.reserve, 0);
  });

  it("refuses when limits were tightened in place, without a version bump", async () => {
    // Editing controls without moving the version is exactly the case a version
    // comparison alone would miss, so the rules are re-run under current authority.
    const tightened: Mandate = {
      ...MANDATE,
      controls: {
        ...MANDATE.controls,
        spend_caps: { per_transaction_max: 0.1, rolling_window: { window: "24h", max_total: 3 } },
      },
    };
    const store = reservations();
    await rejects(
      () => authorizer(ACTION, AUDIT, store, { currentMandate: tightened }).issue(AUDIT.audit_id),
      (error) =>
        error instanceof AuthorizationIssuanceError && error.code === "CURRENT_AUTHORITY_DENIES",
    );
    strictEqual(store.calls.reserve, 0);
  });

  it("turns a settled ALLOW into an escalation when the counterparty is removed", async () => {
    // The audit record correctly says ALLOW: at proposed_at, merchant_xyz was on the
    // allowlist. It no longer is, so executing now needs a human who never saw it.
    const removed: Mandate = {
      ...MANDATE,
      controls: {
        ...MANDATE.controls,
        counterparty_policy: { ...MANDATE.controls.counterparty_policy, allowlist: [] },
      },
    };
    const store = reservations();
    await rejects(
      () => authorizer(ACTION, AUDIT, store, { currentMandate: removed }).issue(AUDIT.audit_id),
      (error) =>
        error instanceof AuthorizationIssuanceError && error.code === "HUMAN_APPROVAL_REQUIRED",
    );
    strictEqual(store.calls.reserve, 0);
  });
});

describe("human approval must still cover what is about to happen", () => {
  const ESCALATED_ACTION = {
    ...ACTION,
    action_id: "action_new",
    payload: { ...ACTION.payload, counterparty: "merchant_new" },
  };
  const ESCALATED_AUDIT = {
    ...AUDIT,
    action_id: ESCALATED_ACTION.action_id,
    disposition: "ESCALATE" as const,
    reason: "counterparty_not_on_allowlist",
    rule_triggered: "counterparty_policy",
  };
  const bound = () =>
    approval({
      audit_id: ESCALATED_AUDIT.audit_id,
      action_id: ESCALATED_ACTION.action_id,
      proposal_hash: hashProposal(ESCALATED_ACTION),
    });

  it("issues when the approval binds this proposal under the current version", async () => {
    const envelope = await authorizer(ESCALATED_ACTION, ESCALATED_AUDIT, reservations(), {
      approval: bound(),
    }).issue(ESCALATED_AUDIT.audit_id);
    strictEqual(envelope.authorization.proposalHash, hashProposal(ESCALATED_ACTION));
  });

  it("refuses an approval that has aged out", async () => {
    const store = reservations();
    await rejects(
      () =>
        authorizer(ESCALATED_ACTION, ESCALATED_AUDIT, store, {
          approval: { ...bound(), expires_at: "2027-01-15T22:01:00.000Z" },
        }).issue(ESCALATED_AUDIT.audit_id),
      (error) => error instanceof AuthorizationIssuanceError && error.code === "STALE_APPROVAL",
    );
    strictEqual(store.calls.reserve, 0);
  });

  it("refuses an approval bound to a different proposal", async () => {
    // The payload was edited after the reviewer looked at it.
    const store = reservations();
    await rejects(
      () =>
        authorizer(ESCALATED_ACTION, ESCALATED_AUDIT, store, {
          approval: { ...bound(), proposal_hash: hashProposal(ACTION) },
        }).issue(ESCALATED_AUDIT.audit_id),
      (error) => error instanceof AuthorizationIssuanceError && error.code === "STALE_APPROVAL",
    );
    strictEqual(store.calls.reserve, 0);
  });

  it("refuses a denial recorded as a decision", async () => {
    await rejects(
      () =>
        authorizer(ESCALATED_ACTION, ESCALATED_AUDIT, reservations(), {
          approval: { ...bound(), decision: "denied" },
        }).issue(ESCALATED_AUDIT.audit_id),
      (error) =>
        error instanceof AuthorizationIssuanceError && error.code === "HUMAN_APPROVAL_REQUIRED",
    );
  });

  it("refuses an escalation with no recorded decision at all", async () => {
    await rejects(
      () =>
        authorizer(ESCALATED_ACTION, ESCALATED_AUDIT, reservations(), { approval: null })
          .issue(ESCALATED_AUDIT.audit_id),
      (error) =>
        error instanceof AuthorizationIssuanceError && error.code === "HUMAN_APPROVAL_REQUIRED",
    );
  });
});

// ── Suspension must remove financial authority, not merely label it ──────────
//
// agent_identity.status has existed since migration 001, but storing "suspended"
// and refusing to act on it are different things. These assert the control plane
// reads the trusted identity itself and refuses BEFORE any capacity is committed,
// so a suspension already in force can never consume budget or mint a capability.
describe("suspension is a kill switch at authorization issuance", () => {
  it("refuses to issue a capability to a suspended agent", async () => {
    const store = reservations();
    await rejects(
      () =>
        authorizer(ACTION, AUDIT, store, { agent: agentIdentity("suspended") }).issue(
          AUDIT.audit_id,
        ),
      (error) => error instanceof AuthorizationIssuanceError && error.code === "AGENT_SUSPENDED",
    );
    strictEqual(store.calls.reserve, 0, "no capacity is committed for a suspended agent");
    strictEqual(store.calls.bind, 0, "no capability is bound");
    strictEqual(store.rows.size, 0, "no reservation row exists at all");
  });

  it("refuses an agent with no identity row rather than assuming authority", async () => {
    const store = reservations();
    await rejects(
      () => authorizer(ACTION, AUDIT, store, { agent: null }).issue(AUDIT.audit_id),
      (error) => error instanceof AuthorizationIssuanceError && error.code === "AGENT_SUSPENDED",
    );
    strictEqual(store.calls.reserve, 0);
    strictEqual(store.rows.size, 0);
  });

  it("refuses when suspension lands between the identity read and the reservation", async () => {
    // The reservation transaction performs its own status check, so even a
    // suspension that arrives inside the issuance window commits no capacity.
    const store = reservations();
    const racing = {
      ...store,
      port: {
        ...store.port,
        async reserve(): Promise<ReserveBudgetResult> {
          store.calls.reserve += 1;
          return { outcome: "agent_suspended" };
        },
      },
    };
    await rejects(
      () => authorizer(ACTION, AUDIT, racing).issue(AUDIT.audit_id),
      (error) => error instanceof AuthorizationIssuanceError && error.code === "AGENT_SUSPENDED",
    );
    strictEqual(store.calls.bind, 0, "nothing is signed when the reservation refuses");
    strictEqual(store.rows.size, 0, "no reservation row was created");
  });

  it("refuses to reuse a reservation that describes a different payment", async () => {
    // The reservation layer holds its own invariant. Whatever the caller believes it
    // is paying for, capacity committed for another payment is never handed over.
    const store = reservations();
    const mismatching = {
      ...store,
      port: {
        ...store.port,
        async reserve(input: ReserveBudgetInput): Promise<ReserveBudgetResult> {
          store.calls.reserve += 1;
          return {
            outcome: "context_mismatch",
            reservation: {
              reservation_id: "res_existing",
              audit_id: input.auditId,
              action_id: input.actionId,
              agent_id: input.agentId,
              mandate_id: input.mandateId,
              mandate_version: input.mandateVersion,
              budget_key: `mandate:${input.mandateId}`,
              currency: input.currency,
              amount_decimal: "1",
              amount_atomic: "1000000",
              chain_id: input.chainId,
              token: input.token,
              status: "RESERVED",
              authorization_id: null,
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
              counts_at: "2026-08-18T10:00:00.000Z",
              expires_at: "2026-08-18T10:02:00.000Z",
              created_at: "2026-08-18T10:00:00.000Z",
              updated_at: "2026-08-18T10:00:00.000Z",
            },
            mismatched: ["amount_decimal", "amount_atomic"],
          };
        },
      },
    };
    await rejects(
      () => authorizer(ACTION, AUDIT, mismatching).issue(AUDIT.audit_id),
      (error) =>
        error instanceof AuthorizationIssuanceError &&
        error.code === "RESERVATION_CONTEXT_MISMATCH",
    );
    strictEqual(store.calls.bind, 0, "no capability is minted against mismatched capacity");
  });
});

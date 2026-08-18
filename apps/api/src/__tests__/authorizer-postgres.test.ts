import { ok, rejects, strictEqual } from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import type { AuditLogRecord, Mandate, ProposedAction } from "@safr/core";
import { loadEvaluationContext } from "@safr/controls-repository";
import {
  bindAuthorization,
  closePool,
  getHumanApproval,
  getAuditLogRecord,
  getIssuedAuthorization,
  getLiveReservationForAudit,
  getMandate,
  getPool,
  getProposedAction,
  insertAgentIdentity,
  insertAuditLogRecord,
  insertMandate,
  insertProposedAction,
  recordIssuedAuthorization,
  reserveBudget,
} from "@safr/db";
import {
  AuthorizationIssuanceError,
  createExecutionAuthorizer,
} from "../execution-authorizer.js";

/**
 * The authorizer wired to the REAL database, not to a fake reservation store.
 *
 * The unit suite proves the authorizer's ordering; this proves the production wiring
 * — the same `reserveBudget` and `bindAuthorization` the route passes in, against a
 * real PostgreSQL. A duplicate-authorization bug can live entirely in the seam
 * between those two suites, so both exist.
 */

const KEY = `0x${"11".repeat(32)}`;
const AGENT = "agent_treasury_01";
const AT = "2026-08-18T10:00:00.000Z";

const MANDATE: Mandate = {
  mandate_id: "mandate_pg",
  agent_id: AGENT,
  version: 17,
  effective_from: "2026-08-01T00:00:00.000Z",
  effective_to: null,
  status: "active",
  scope: { action_types: ["payment"], currencies: ["USDC"] },
  controls: {
    spend_caps: { per_transaction_max: 1, rolling_window: { window: "24h", max_total: 1.2 } },
    counterparty_policy: {
      mode: "allowlist",
      allowlist: ["merchant_xyz"],
      unknown_counterparty_disposition: "ESCALATE",
    },
    time_window: {
      allowed_hours_utc: ["00:00-23:59"],
      allowed_days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    },
    velocity: { max_transactions_per_hour: 100 },
  },
  default_disposition_on_breach: "DENY",
  created_by: "compliance_officer_01",
  approved_by: "compliance_officer_01",
};

function action(id: string, amount: number): ProposedAction {
  return {
    action_id: `action_${id}`,
    agent_id: AGENT,
    action_type: "payment",
    proposed_at: AT,
    payload: {
      counterparty: "merchant_xyz",
      amount,
      currency: "USDC",
      purpose: "service_fulfillment",
      reference: `invoice_${id}`,
    },
  };
}

function audit(id: string): AuditLogRecord {
  return {
    audit_id: `audit_${id}`,
    action_id: `action_${id}`,
    agent_id: AGENT,
    mandate_id: MANDATE.mandate_id,
    mandate_version: MANDATE.version,
    disposition: "ALLOW",
    reason: "within_mandate",
    rule_triggered: null,
    evaluated_at: AT,
    human_review: null,
    settlement: null,
  };
}

async function seed(id: string, amount: number): Promise<string> {
  await insertProposedAction(action(id, amount));
  await insertAuditLogRecord(audit(id));
  return `audit_${id}`;
}

const authorizer = createExecutionAuthorizer({
  context: {
    getAudit: getAuditLogRecord,
    getAction: getProposedAction,
    loadEvaluationContext,
    getApproval: getHumanApproval,
  },
  reservations: {
    reserve: reserveBudget,
    bindAuthorization,
    recordIssued: recordIssuedAuthorization,
  },
  authorizerPrivateKey: KEY,
  target: {
    chainId: 84532,
    payTo: "0x1111111111111111111111111111111111111111",
    merchantBaseUrl: "http://localhost:4021",
  },
  nowMs: () => 1_800_000_000_000,
});

before(async () => {
  await getPool().query("SELECT 1 FROM payment_reservation LIMIT 1");
});

after(async () => {
  await closePool();
});

beforeEach(async () => {
  await getPool().query(
    `TRUNCATE TABLE human_approval, execution_authorization, payment_reservation,
                    audit_anchor, audit_log, proposed_action, mandate, agent_identity
     RESTART IDENTITY CASCADE`,
  );
  await insertAgentIdentity({
    agent_id: AGENT,
    display_name: "Treasury Payments Agent",
    owner_org: "acme_corp",
    created_at: "2026-08-01T00:00:00.000Z",
    wallet_address: "0x0000000000000000000000000000000000000000",
    status: "active",
  });
  await insertMandate(MANDATE);
});

describe("execution authorizer over PostgreSQL", () => {
  it("commits a durable reservation and binds the signed authorization to it", async () => {
    const auditId = await seed("pg_1", 0.5);
    const envelope = await authorizer.issue(auditId);

    const reservation = await getLiveReservationForAudit(auditId);
    ok(reservation, "a reservation row exists in the database");
    strictEqual(envelope.authorization.reservationId, reservation.reservation_id);
    strictEqual(reservation.status, "AUTHORIZED");
    strictEqual(reservation.authorization_id, envelope.authorization.authorizationId);
    strictEqual(reservation.budget_key, `mandate:${MANDATE.mandate_id}`);
    strictEqual(reservation.amount_atomic, "500000");
    strictEqual(Number(reservation.amount_decimal), 0.5);
  });

  it("refuses a second authorization for the same audit", async () => {
    const auditId = await seed("pg_2", 0.5);
    await authorizer.issue(auditId);

    await rejects(
      () => authorizer.issue(auditId),
      (error) =>
        error instanceof AuthorizationIssuanceError &&
        error.code === "AUTHORIZATION_ALREADY_ISSUED",
    );

    const { rows } = await getPool().query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM payment_reservation WHERE audit_id = $1`,
      [auditId],
    );
    strictEqual(rows[0]!.n, "1", "no second reservation was created");
  });

  it("refuses concurrent authorizations that would exceed the shared mandate budget", async () => {
    // Budget 1.2, two proposals of 0.8. Each passes the per-transaction cap and each
    // passes the rolling-window check on settled-only counters, which is precisely the
    // pre-Phase-2 overspend. Committed capacity is what stops the second one.
    const first = await seed("pg_3a", 0.8);
    const second = await seed("pg_3b", 0.8);

    const results = await Promise.allSettled([
      authorizer.issue(first),
      authorizer.issue(second),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    strictEqual(fulfilled.length, 1, "only one of the two may be authorized");

    const refused = results.find((r) => r.status === "rejected");
    ok(refused && refused.status === "rejected");
    ok(refused.reason instanceof AuthorizationIssuanceError);
    strictEqual(refused.reason.code, "INSUFFICIENT_BUDGET");
  });

  it("rejects an in-place v17 policy mutation after authorization before key use", async () => {
    const auditId = await seed("immutable_v17", 0.5);
    const envelope = await authorizer.issue(auditId);
    strictEqual(envelope.authorization.mandateVersion, 17);

    let paymentKeyBoundaryReached = 0;
    await rejects(
      async () => {
        await getPool().query(
          `UPDATE mandate
              SET controls = jsonb_set(controls, '{spend_caps,per_transaction_max}', '0.1')
            WHERE mandate_id = $1 AND version = $2`,
          [MANDATE.mandate_id, MANDATE.version],
        );
        // Represents the first executor step that could construct the payer. The
        // database rejection aborts the attack before this boundary is reachable.
        paymentKeyBoundaryReached += 1;
      },
      (error) =>
        (error as { code?: string; constraint?: string }).code === "23514" &&
        (error as { constraint?: string }).constraint ===
          "mandate_published_content_immutable",
    );

    strictEqual(paymentKeyBoundaryReached, 0, "the payment key boundary was not reached");
    const stored = await getMandate(MANDATE.mandate_id, MANDATE.version);
    strictEqual(stored?.controls.spend_caps.per_transaction_max, 1);
    const issued = await getIssuedAuthorization(envelope.authorization.authorizationId);
    strictEqual(issued?.status, "ISSUED", "the rejected edit did not consume authority");
  });

  it("rejects every policy-bearing field rewrite for the same version", async () => {
    const attacks: Array<[string, string]> = [
      ["mandate identity", "mandate_id = 'mandate_rewritten'"],
      ["version", "version = 18"],
      ["agent binding", "agent_id = 'agent_attacker'"],
      ["effective authority start", "effective_from = '2026-07-01T00:00:00.000Z'"],
      ["scope", "scope = '{\"action_types\":[\"payment\"],\"currencies\":[\"USDT\"]}'::jsonb"],
      ["default disposition", "default_disposition_on_breach = 'ALLOW'"],
      ["creator", "created_by = 'attacker'"],
      ["approver", "approved_by = 'attacker'"],
    ];

    for (const [label, assignment] of attacks) {
      await rejects(
        () =>
          getPool().query(
            `UPDATE mandate SET ${assignment} WHERE mandate_id = $1 AND version = $2`,
            [MANDATE.mandate_id, MANDATE.version],
          ),
        (error) =>
          (error as { code?: string; constraint?: string }).code === "23514" &&
          (error as { constraint?: string }).constraint ===
            "mandate_published_content_immutable",
        label,
      );
    }
  });

  it("allows one-way lifecycle closure but rejects reopening or rewriting it", async () => {
    const closedAt = "2026-09-01T00:00:00.000Z";
    await insertMandate({ ...MANDATE, status: "superseded", effective_to: closedAt });
    const closed = await getMandate(MANDATE.mandate_id, MANDATE.version);
    strictEqual(closed?.status, "superseded");
    strictEqual(closed?.effective_to, closedAt);

    await rejects(
      () => insertMandate(MANDATE),
      (error) =>
        (error as { code?: string; constraint?: string }).code === "23514" &&
        (error as { constraint?: string }).constraint === "mandate_lifecycle_monotonic",
    );
    await rejects(
      () => insertMandate({ ...MANDATE, status: "revoked", effective_to: closedAt }),
      (error) =>
        (error as { code?: string; constraint?: string }).code === "23514" &&
        (error as { constraint?: string }).constraint === "mandate_lifecycle_monotonic",
    );
  });
});

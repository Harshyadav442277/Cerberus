import { ok, strictEqual } from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import pg from "pg";
import { recordIssuedAuthorization } from "../authorizations.js";
import { closePool, getDatabaseUrl, getPool } from "../pool.js";
import { insertMandate } from "../repository.js";
import { bindAuthorization, reserveBudget } from "../reservations.js";
import {
  AT,
  mandateFixture,
  reserveInput,
  resetFixtures,
  seedAgent,
  seedProposal,
} from "./fixtures.js";

const LOGIN_PASSWORD = "cerberus_test_password_35b";
const LOGINS = {
  agent: "cerberus_test_agent_login",
  control: "cerberus_test_control_login",
  executor: "cerberus_test_executor_login",
  reconciler: "cerberus_test_reconciler_login",
  anchor: "cerberus_test_anchor_login",
} as const;

function loginUrl(username: string): string {
  const url = new URL(getDatabaseUrl());
  url.username = username;
  url.password = LOGIN_PASSWORD;
  return url.toString();
}

const agent = new pg.Pool({ connectionString: loginUrl(LOGINS.agent) });
const control = new pg.Pool({ connectionString: loginUrl(LOGINS.control) });
const executor = new pg.Pool({ connectionString: loginUrl(LOGINS.executor) });
const reconciler = new pg.Pool({ connectionString: loginUrl(LOGINS.reconciler) });
const anchor = new pg.Pool({ connectionString: loginUrl(LOGINS.anchor) });

async function expectPermissionDenied(run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (error) {
    strictEqual((error as { code?: string }).code, "42501", (error as Error).message);
    return;
  }
  throw new Error("operation unexpectedly succeeded with AGENT database credentials");
}

let seededReservationId = "";

before(async () => {
  const requiredGroups = [
    "cerberus_agent_role",
    "cerberus_control_plane_role",
    "cerberus_executor_role",
    "cerberus_reconciler_role",
    "cerberus_anchor_role",
  ];
  const groups = await getPool().query<{ rolname: string }>(
    "SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[])",
    [requiredGroups],
  );
  strictEqual(
    groups.rowCount,
    requiredGroups.length,
    "apply migrations 005 and 011 before running tests",
  );

  for (const login of Object.values(LOGINS)) {
    await getPool().query(`DROP ROLE IF EXISTS ${login}`);
    await getPool().query(`CREATE ROLE ${login} LOGIN PASSWORD '${LOGIN_PASSWORD}'`);
  }
  await getPool().query(`GRANT cerberus_agent_role TO ${LOGINS.agent}`);
  await getPool().query(`GRANT cerberus_control_plane_role TO ${LOGINS.control}`);
  await getPool().query(`GRANT cerberus_executor_role TO ${LOGINS.executor}`);
  await getPool().query(`GRANT cerberus_reconciler_role TO ${LOGINS.reconciler}`);
  await getPool().query(`GRANT cerberus_anchor_role TO ${LOGINS.anchor}`);
});

after(async () => {
  await Promise.all([agent.end(), control.end(), executor.end(), reconciler.end(), anchor.end()]);
  for (const login of Object.values(LOGINS)) {
    await getPool().query(`DROP ROLE IF EXISTS ${login}`);
  }
  await closePool();
});

beforeEach(async () => {
  await resetFixtures();
  await seedAgent("agent_privilege_test");
  await insertMandate(
    mandateFixture({
      mandateId: "mandate_privilege_test",
      agentId: "agent_privilege_test",
      maxTotal: 100,
    }),
  );
  const proposal = await seedProposal({
    id: "privilege_attack",
    agentId: "agent_privilege_test",
    mandateId: "mandate_privilege_test",
    amount: 5,
  });
  const reserved = await reserveBudget(reserveInput(proposal, 100));
  ok(reserved.outcome === "created");
  seededReservationId = reserved.reservation.reservation_id;
  await bindAuthorization(seededReservationId, "auth_privilege_attack", AT);
  await recordIssuedAuthorization({
    authorizationId: "auth_privilege_attack",
    reservationId: seededReservationId,
    auditId: proposal.auditId,
    actionId: proposal.actionId,
    proposalHash: `0x${"ab".repeat(32)}`,
    mandateId: "mandate_privilege_test",
    mandateVersion: 1,
    nonce: "nonce_privilege_attack",
    expiresAt: "2026-08-18T13:00:00.000Z",
    issuedAt: AT,
  });
});

describe("AGENT database authority is denied at PostgreSQL", () => {
  it("cannot create human approval or execution authority", async () => {
    await expectPermissionDenied(() =>
      agent.query(
        `INSERT INTO human_approval (
           audit_id, action_id, agent_id, proposal_hash, mandate_id, mandate_version,
           reviewer_id, decision, decided_at, expires_at)
         VALUES ('audit_privilege_attack', 'action_privilege_attack', 'agent_privilege_test',
                 $1, 'mandate_privilege_test', 1, 'forged_reviewer', 'approved', $2, $3)`,
        [`0x${"ab".repeat(32)}`, AT, "2026-08-18T12:30:00.000Z"],
      ),
    );
    await expectPermissionDenied(() =>
      agent.query(
        `INSERT INTO execution_authorization (
           authorization_id, reservation_id, audit_id, action_id, proposal_hash,
           mandate_id, mandate_version, nonce, expires_at, status, issued_at)
         VALUES ('auth_forged', $1, 'audit_privilege_attack', 'action_privilege_attack',
                 $2, 'mandate_privilege_test', 1, 'nonce_forged', $3, 'ISSUED', $4)`,
        [seededReservationId, `0x${"cd".repeat(32)}`, "2026-08-18T13:00:00.000Z", AT],
      ),
    );
  });

  it("cannot modify mandate policy", async () => {
    await expectPermissionDenied(() =>
      agent.query(
        `UPDATE mandate
            SET controls = jsonb_set(controls, '{spend_caps,per_transaction_max}', '999999')
          WHERE mandate_id = 'mandate_privilege_test' AND version = 1`,
      ),
    );
  });

  it("cannot forge the control plane's transaction-time velocity verdict", async () => {
    await expectPermissionDenied(() =>
      agent.query(
        `UPDATE audit_log
            SET disposition = 'ESCALATE',
                reason = 'velocity_threshold_exceeded',
                rule_triggered = 'velocity.max_transactions_per_hour'
          WHERE audit_id = 'audit_privilege_attack'`,
      ),
    );
  });

  it("cannot bind or transition a payment reservation", async () => {
    await expectPermissionDenied(() =>
      agent.query(
        `UPDATE payment_reservation
            SET status = 'AUTHORIZED', authorization_id = 'auth_agent_forged', updated_at = $2
          WHERE reservation_id = $1`,
        [seededReservationId, AT],
      ),
    );
    await expectPermissionDenied(() =>
      agent.query(
        `UPDATE payment_reservation SET status = 'SUBMITTING', updated_at = $2
          WHERE reservation_id = $1`,
        [seededReservationId, AT],
      ),
    );
  });

  it("cannot consume an execution authorization", async () => {
    await expectPermissionDenied(() =>
      agent.query(
        `UPDATE execution_authorization
            SET status = 'CONSUMED', consumed_at = $2
          WHERE authorization_id = $1`,
        ["auth_privilege_attack", AT],
      ),
    );
  });

  it("leaves all trusted authority state unchanged after the attacks", async () => {
    const approval = await getPool().query("SELECT 1 FROM human_approval");
    strictEqual(approval.rowCount, 0);
    const reservation = await getPool().query<{
      status: string;
      authorization_id: string;
    }>(
      "SELECT status, authorization_id FROM payment_reservation WHERE reservation_id = $1",
      [seededReservationId],
    );
    strictEqual(reservation.rows[0]?.status, "AUTHORIZED");
    strictEqual(reservation.rows[0]?.authorization_id, "auth_privilege_attack");
    const authorization = await getPool().query<{ status: string }>(
      "SELECT status FROM execution_authorization WHERE authorization_id = 'auth_privilege_attack'",
    );
    strictEqual(authorization.rows[0]?.status, "ISSUED");
  });
});

describe("least-privilege roles preserve the existing execution path", () => {
  it("allows proposal/audit, control-plane authority, then executor transitions", async () => {
    await agent.query(
      `INSERT INTO proposed_action (action_id, agent_id, action_type, proposed_at, payload)
       VALUES ('action_role_path', 'agent_privilege_test', 'payment', $1, $2)`,
      [
        AT,
        JSON.stringify({
          counterparty: "merchant_new",
          amount: 1,
          currency: "USDC",
          purpose: "service_fulfillment",
          reference: "role_path",
        }),
      ],
    );
    await agent.query(
      `INSERT INTO audit_log (
         audit_id, action_id, agent_id, mandate_id, mandate_version,
         disposition, reason, rule_triggered, evaluated_at)
       VALUES ('audit_role_path', 'action_role_path', 'agent_privilege_test',
               'mandate_privilege_test', 1, 'ESCALATE', 'unknown counterparty',
               'counterparty_policy', $1)`,
      [AT],
    );
    const mandateRead = await agent.query(
      "SELECT controls FROM mandate WHERE mandate_id = 'mandate_privilege_test' AND version = 1",
    );
    strictEqual(mandateRead.rowCount, 1);

    const review = {
      reviewer_id: "trusted_test_reviewer",
      decision: "approved",
      decided_at: AT,
      note: "role path",
    };
    await control.query(
      "UPDATE audit_log SET human_review = $2 WHERE audit_id = $1",
      ["audit_role_path", JSON.stringify(review)],
    );
    await control.query(
      `INSERT INTO human_approval (
         audit_id, action_id, agent_id, proposal_hash, mandate_id, mandate_version,
         reviewer_id, decision, decided_at, expires_at)
       VALUES ('audit_role_path', 'action_role_path', 'agent_privilege_test', $1,
               'mandate_privilege_test', 1, 'trusted_test_reviewer', 'approved', $2, $3)`,
      [`0x${"ef".repeat(32)}`, AT, "2026-08-18T12:30:00.000Z"],
    );
    await control.query(
      `INSERT INTO payment_reservation (
         reservation_id, audit_id, action_id, agent_id, mandate_id, mandate_version,
         budget_key, currency, amount_decimal, amount_atomic, chain_id, token,
         status, counts_at, expires_at, created_at, updated_at)
       VALUES ('res_role_path', 'audit_role_path', 'action_role_path', 'agent_privilege_test',
               'mandate_privilege_test', 1, 'mandate:mandate_privilege_test', 'USDC',
               1, 1000000, 84532, '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
               'RESERVED', $1, $2, $1, $1)`,
      [AT, "2026-08-18T12:30:00.000Z"],
    );
    await control.query(
      `UPDATE payment_reservation
          SET status = 'AUTHORIZED', authorization_id = 'auth_role_path', updated_at = $2
        WHERE reservation_id = $1`,
      ["res_role_path", AT],
    );
    await control.query(
      `INSERT INTO execution_authorization (
         authorization_id, reservation_id, audit_id, action_id, proposal_hash,
         mandate_id, mandate_version, nonce, expires_at, status, issued_at)
       VALUES ('auth_role_path', 'res_role_path', 'audit_role_path', 'action_role_path', $1,
               'mandate_privilege_test', 1, 'nonce_role_path', $2, 'ISSUED', $3)`,
      [`0x${"ef".repeat(32)}`, "2026-08-18T13:00:00.000Z", AT],
    );

    const consumed = await executor.query(
      `UPDATE execution_authorization
          SET status = 'CONSUMED', consumed_at = $2
        WHERE authorization_id = $1 AND status = 'ISSUED'`,
      ["auth_privilege_attack", AT],
    );
    strictEqual(consumed.rowCount, 1);
    const submitting = await executor.query(
      `UPDATE payment_reservation SET status = 'SUBMITTING', updated_at = $2
        WHERE reservation_id = $1 AND status = 'AUTHORIZED'`,
      ["res_role_path", AT],
    );
    strictEqual(submitting.rowCount, 1);
    const settled = await executor.query(
      `UPDATE payment_reservation
          SET status = 'SETTLED', settlement_tx = '0xtest', updated_at = $2
        WHERE reservation_id = $1 AND status = 'SUBMITTING'`,
      ["res_role_path", AT],
    );
    strictEqual(settled.rowCount, 1);

    // Terminal audit truth is written by the process that PROVED the payment, in the
    // same transaction that settled the reservation. Before Remediation 4 this line
    // was `agent.query(...)`, and a crash between the two left the reservation SETTLED
    // with the audit settlement NULL.
    const auditSettled = await executor.query(
      "UPDATE audit_log SET settlement = $2 WHERE audit_id = $1 AND settlement IS NULL",
      [
        "audit_role_path",
        JSON.stringify({
          status: "settled",
          tx_hash: "0xtest",
          rail: "x402",
          settled_at: AT,
        }),
      ],
    );
    strictEqual(auditSettled.rowCount, 1, "the executor writes terminal audit truth");

    // The executor may only REQUEST anchoring. It cannot author the anchor either.
    await executor.query(
      "INSERT INTO audit_finalization (audit_id) VALUES ($1) ON CONFLICT DO NOTHING",
      ["audit_role_path"],
    );

    // Only the anchor worker's role may write the proof itself.
    await anchor.query(
      `INSERT INTO audit_anchor (audit_id, record_hash, status, created_at)
       VALUES ('audit_role_path', $1, 'pending', $2)`,
      [`0x${"12".repeat(32)}`, AT],
    );
    const anchored = await anchor.query(
      `UPDATE audit_anchor
          SET status = 'anchored', anchor_tx_hash = '0xanchor', anchored_at = $2
        WHERE audit_id = $1`,
      ["audit_role_path", AT],
    );
    strictEqual(anchored.rowCount, 1, "the anchor worker authors the proof");
  });
});

/**
 * Attack B — a hostile agent must not own final audit truth.
 *
 * Every statement below is issued with the AGENT's real database credentials, which
 * is the whole point: this is not a code-level guard that a compromised agent process
 * could route around, it is the database refusing. A compromised AI that can write
 * `audit_log.settlement` can claim a payment settled that never happened; one that
 * can write `audit_anchor` can manufacture its own proof of having behaved.
 */
describe("hostile agent cannot author final audit truth", () => {
  it("cannot claim its own payment settled", async () => {
    await expectPermissionDenied(() =>
      agent.query("UPDATE audit_log SET settlement = $2 WHERE audit_id = $1", [
        "audit_privilege_attack",
        JSON.stringify({
          status: "settled",
          tx_hash: "0xfabricated",
          rail: "x402",
          settled_at: AT,
        }),
      ]),
    );
  });

  it("cannot insert an audit anchor", async () => {
    await expectPermissionDenied(() =>
      agent.query(
        `INSERT INTO audit_anchor (audit_id, record_hash, status, created_at)
         VALUES ('audit_privilege_attack', $1, 'pending', $2)`,
        [`0x${"aa".repeat(32)}`, AT],
      ),
    );
  });

  it("cannot mark an anchor as anchored on chain", async () => {
    await expectPermissionDenied(() =>
      agent.query(
        `UPDATE audit_anchor
            SET status = 'anchored', anchor_tx_hash = '0xfabricated', anchored_at = $2
          WHERE audit_id = $1`,
        ["audit_privilege_attack", AT],
      ),
    );
  });

  it("cannot mark its own finalization request complete", async () => {
    // The one finalization power the agent keeps is INSERT (audit_id): "please
    // anchor this row". It cannot set the status, so it cannot retire a job the
    // worker has not actually done.
    await agent.query(
      "INSERT INTO audit_finalization (audit_id) VALUES ($1) ON CONFLICT DO NOTHING",
      ["audit_privilege_attack"],
    );
    await expectPermissionDenied(() =>
      agent.query("UPDATE audit_finalization SET status = 'DONE' WHERE audit_id = $1", [
        "audit_privilege_attack",
      ]),
    );
  });

  it("leaves audit settlement and anchor state untouched after the attacks", async () => {
    const settlement = await getPool().query<{ settlement: unknown }>(
      "SELECT settlement FROM audit_log WHERE audit_id = $1",
      ["audit_privilege_attack"],
    );
    strictEqual(settlement.rows[0]?.settlement ?? null, null, "no fabricated settlement");
    const anchors = await getPool().query(
      "SELECT 1 FROM audit_anchor WHERE audit_id = $1 AND status = 'anchored'",
      ["audit_privilege_attack"],
    );
    strictEqual(anchors.rowCount, 0, "no fabricated anchor");
  });
});

/**
 * Remediation 7 — the reconciler no longer inherits the executor role wholesale.
 *
 * It needs to prove chain outcomes and terminalize. It does not need to consume
 * execution authorizations, and holding that power was strictly more authority than
 * reconciliation requires.
 */
describe("reconciler role is narrower than the executor role", () => {
  it("cannot consume an execution authorization", async () => {
    await expectPermissionDenied(() =>
      reconciler.query(
        `UPDATE execution_authorization SET status = 'CONSUMED', consumed_at = $2
          WHERE authorization_id = $1`,
        ["auth_privilege_attack", AT],
      ),
    );
  });

  it("cannot bind an authorization to a reservation", async () => {
    await expectPermissionDenied(() =>
      reconciler.query(
        "UPDATE payment_reservation SET authorization_id = $2 WHERE reservation_id = $1",
        [seededReservationId, "auth_forged"],
      ),
    );
  });

  it("cannot create human approval or mutate mandate policy", async () => {
    await expectPermissionDenied(() =>
      reconciler.query(
        `INSERT INTO human_approval (
           audit_id, action_id, agent_id, proposal_hash, mandate_id, mandate_version,
           reviewer_id, decision, decided_at, expires_at)
         VALUES ('audit_privilege_attack', 'action_privilege_attack', 'agent_privilege_test', $1,
                 'mandate_privilege_test', 1, 'forged', 'approved', $2, $3)`,
        [`0x${"cd".repeat(32)}`, AT, "2026-08-18T12:30:00.000Z"],
      ),
    );
    await expectPermissionDenied(() =>
      reconciler.query("UPDATE mandate SET controls = controls WHERE mandate_id = $1", [
        "mandate_privilege_test",
      ]),
    );
  });

  it("cannot author an audit anchor", async () => {
    await expectPermissionDenied(() =>
      reconciler.query(
        `INSERT INTO audit_anchor (audit_id, record_hash, status, created_at)
         VALUES ('audit_privilege_attack', $1, 'pending', $2)`,
        [`0x${"bb".repeat(32)}`, AT],
      ),
    );
  });

  it("can still claim, fence and terminalize a reconciliation", async () => {
    // The refusals above must not have been bought by breaking reconciliation. These
    // are the exact writes reconcileOne performs: take a fenced lease, then resolve.
    const claimed = await reconciler.query(
      `UPDATE payment_reservation
          SET status = 'RECONCILING', reconciliation_token = 'tok_test',
              reconciliation_attempts = reconciliation_attempts + 1,
              reconcile_after = NULL, updated_at = $2
        WHERE reservation_id = $1`,
      [seededReservationId, AT],
    );
    strictEqual(claimed.rowCount, 1, "the reconciler can take a fenced lease");

    const settled = await reconciler.query(
      `UPDATE payment_reservation
          SET status = 'SETTLED', settlement_tx = '0xproven',
              reconciliation_token = NULL, updated_at = $2
        WHERE reservation_id = $1 AND reconciliation_token = 'tok_test'`,
      [seededReservationId, AT],
    );
    strictEqual(settled.rowCount, 1, "the reconciler can terminalize what it proved");

    const audited = await reconciler.query(
      "UPDATE audit_log SET settlement = $2 WHERE audit_id = $1 AND settlement IS NULL",
      [
        "audit_privilege_attack",
        JSON.stringify({ status: "settled", tx_hash: "0xproven", rail: "x402", settled_at: AT }),
      ],
    );
    strictEqual(audited.rowCount, 1, "the reconciler writes terminal audit truth");

    await reconciler.query(
      "INSERT INTO audit_finalization (audit_id) VALUES ($1) ON CONFLICT DO NOTHING",
      ["audit_privilege_attack"],
    );
  });
});

/**
 * The anchor worker authors final proof, and nothing else.
 *
 * It is the one role that may write `audit_anchor`, so it is also the role that must
 * be proven powerless over money.
 */
describe("anchor worker has no financial authority", () => {
  it("cannot transition a payment reservation", async () => {
    await expectPermissionDenied(() =>
      anchor.query("UPDATE payment_reservation SET status = 'SETTLED' WHERE reservation_id = $1", [
        seededReservationId,
      ]),
    );
  });

  it("cannot consume an execution authorization", async () => {
    await expectPermissionDenied(() =>
      anchor.query(
        `UPDATE execution_authorization SET status = 'CONSUMED' WHERE authorization_id = $1`,
        ["auth_privilege_attack"],
      ),
    );
  });

  it("cannot rewrite audit settlement", async () => {
    await expectPermissionDenied(() =>
      anchor.query("UPDATE audit_log SET settlement = NULL WHERE audit_id = $1", [
        "audit_privilege_attack",
      ]),
    );
  });
});

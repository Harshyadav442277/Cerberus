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
  ];
  const groups = await getPool().query<{ rolname: string }>(
    "SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[])",
    [requiredGroups],
  );
  strictEqual(
    groups.rowCount,
    requiredGroups.length,
    "apply migration 005_database_privilege_separation before running tests",
  );

  for (const login of Object.values(LOGINS)) {
    await getPool().query(`DROP ROLE IF EXISTS ${login}`);
    await getPool().query(`CREATE ROLE ${login} LOGIN PASSWORD '${LOGIN_PASSWORD}'`);
  }
  await getPool().query(`GRANT cerberus_agent_role TO ${LOGINS.agent}`);
  await getPool().query(`GRANT cerberus_control_plane_role TO ${LOGINS.control}`);
  await getPool().query(`GRANT cerberus_executor_role TO ${LOGINS.executor}`);
});

after(async () => {
  await Promise.all([agent.end(), control.end(), executor.end()]);
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
      ["auth_role_path", AT],
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

    await agent.query("UPDATE audit_log SET settlement = $2 WHERE audit_id = $1", [
      "audit_role_path",
      JSON.stringify({
        status: "settled",
        tx_hash: "0xtest",
        rail: "x402",
        settled_at: AT,
      }),
    ]);
    await agent.query(
      `INSERT INTO audit_anchor (audit_id, record_hash, status, created_at)
       VALUES ('audit_role_path', $1, 'pending', $2)`,
      [`0x${"12".repeat(32)}`, AT],
    );
    await agent.query(
      `UPDATE audit_anchor
          SET status = 'anchored', anchor_tx_hash = '0xanchor', anchored_at = $2
        WHERE audit_id = $1`,
      ["audit_role_path", AT],
    );
  });
});

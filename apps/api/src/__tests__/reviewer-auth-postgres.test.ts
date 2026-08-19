import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, beforeEach, describe, it } from "node:test";
import type { AddressInfo } from "node:net";
import type { AuditLogRecord, Mandate, ProposedAction } from "@safr/core";
import {
  closePool,
  getAuditLogRecordByActionId,
  getHumanApproval,
  getPool,
  insertAgentIdentity,
  insertAuditLogRecord,
  insertMandate,
  insertProposedAction,
} from "@safr/db";
import express from "express";
import { createEscalationsRouter } from "../routes/escalations.js";

const TOKEN = "reviewer-test-token-with-at-least-32-bytes";
const TRUSTED_REVIEWER = "trusted_compliance_officer";
const AGENT = "agent_reviewer_auth_test";
const ACTION_ID = "action_reviewer_auth_test";
const AUDIT_ID = "audit_reviewer_auth_test";

let server: Server;
let baseUrl: string;

const mandate: Mandate = {
  mandate_id: "mandate_reviewer_auth_test",
  agent_id: AGENT,
  version: 1,
  effective_from: "2026-01-01T00:00:00.000Z",
  effective_to: null,
  status: "active",
  scope: { action_types: ["payment"], currencies: ["USDC"] },
  controls: {
    spend_caps: { per_transaction_max: 1, rolling_window: { window: "24h", max_total: 3 } },
    counterparty_policy: {
      mode: "allowlist",
      allowlist: ["merchant_known"],
      unknown_counterparty_disposition: "ESCALATE",
    },
    time_window: {
      allowed_hours_utc: ["00:00-23:59"],
      allowed_days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    },
    velocity: { max_transactions_per_hour: 10 },
  },
  default_disposition_on_breach: "DENY",
  created_by: TRUSTED_REVIEWER,
  approved_by: TRUSTED_REVIEWER,
};

const action: ProposedAction = {
  action_id: ACTION_ID,
  agent_id: AGENT,
  action_type: "payment",
  proposed_at: "2026-08-19T10:00:00.000Z",
  payload: {
    counterparty: "merchant_unknown",
    amount: 0.5,
    currency: "USDC",
    purpose: "service_fulfillment",
    reference: "reviewer_auth_invoice",
  },
};

const audit: AuditLogRecord = {
  audit_id: AUDIT_ID,
  action_id: ACTION_ID,
  agent_id: AGENT,
  mandate_id: mandate.mandate_id,
  mandate_version: mandate.version,
  disposition: "ESCALATE",
  reason: "counterparty_not_on_allowlist",
  rule_triggered: "counterparty_policy",
  evaluated_at: "2026-08-19T10:00:01.000Z",
  human_review: null,
  settlement: null,
};

async function post(headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}/escalations/${ACTION_ID}/decision`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({
      decision: "approved",
      reviewer_id: "forged_agent_identity",
      note: "forged body identity must not grant authority",
      mandate_version: 1,
    }),
  });
}

async function assertNoAuthorityWrite(): Promise<void> {
  const record = await getAuditLogRecordByActionId(ACTION_ID);
  assert.equal(record?.human_review, null, "unauthenticated request must not write human_review");
  assert.equal(await getHumanApproval(AUDIT_ID), null, "unauthenticated request must not write approval");
  const authorizations = await getPool().query(
    "SELECT 1 FROM execution_authorization WHERE audit_id = $1",
    [AUDIT_ID],
  );
  assert.equal(
    authorizations.rowCount,
    0,
    "unauthenticated request must not create payment authorization",
  );
}

before(async () => {
  await getPool().query("SELECT 1 FROM human_approval LIMIT 1");
  const app = express();
  app.use(express.json());
  app.use(
    "/escalations",
    createEscalationsRouter({ token: TOKEN, reviewerId: TRUSTED_REVIEWER }),
  );
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
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
    display_name: "Reviewer auth test agent",
    owner_org: "acme_corp",
    created_at: "2026-01-01T00:00:00.000Z",
    wallet_address: "0x0000000000000000000000000000000000000000",
    status: "active",
  });
  await insertMandate(mandate);
  await insertProposedAction(action);
  await insertAuditLogRecord(audit);
});

describe("authenticated reviewer decision endpoint over PostgreSQL", () => {
  it("rejects agent-style and forged reviewer requests without creating authority", async () => {
    const missing = await post();
    assert.equal(missing.status, 401);
    await assertNoAuthorityWrite();

    const invalid = await post({ authorization: "Bearer attacker-controlled-token" });
    assert.equal(invalid.status, 403);
    await assertNoAuthorityWrite();
  });

  it("accepts the trusted credential and uses server-controlled reviewer identity", async () => {
    const response = await post({ authorization: `Bearer ${TOKEN}` });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      human_review: { reviewer_id: string; decision: string };
    };
    assert.equal(body.human_review.reviewer_id, TRUSTED_REVIEWER);
    assert.equal(body.human_review.decision, "approved");

    const record = await getAuditLogRecordByActionId(ACTION_ID);
    assert.equal(record?.human_review?.reviewer_id, TRUSTED_REVIEWER);
    const binding = await getHumanApproval(AUDIT_ID);
    assert.equal(binding?.reviewer_id, TRUSTED_REVIEWER);
    assert.equal(binding?.decision, "approved");
  });
});

/**
 * Attack H — pending escalation information must not be readable without authority.
 *
 * A pending escalation names a counterparty, an amount and an agent that is waiting
 * to spend right now. Until Remediation 6D this list was served to anyone who could
 * reach the port. It is not a mutation, which is exactly why it was easy to miss: no
 * money moves, but an unauthenticated reader learns which payments are sitting in
 * front of a human and how much each one is for.
 *
 * The dashboard reaches this through its own server-side proxy, which holds the
 * bearer token, so protecting the route does not push a credential into the browser.
 */
describe("pending escalation exposure", () => {
  async function list(headers: Record<string, string> = {}) {
    return fetch(`${baseUrl}/escalations`, { headers });
  }

  it("refuses an unauthenticated read of pending escalations", async () => {
    const response = await list();
    assert.equal(response.status, 401);
    const body = (await response.json()) as { error?: string; items?: unknown };
    assert.equal(body.error, "reviewer_auth_required");
    assert.equal(body.items, undefined, "no escalation data leaks in the refusal");
  });

  it("refuses a forged bearer token", async () => {
    const response = await list({ authorization: "Bearer not-the-reviewer-token-but-long-enough" });
    assert.equal(response.status, 403);
    const body = (await response.json()) as { error?: string; items?: unknown };
    assert.equal(body.error, "reviewer_auth_invalid");
    assert.equal(body.items, undefined);
  });

  it("refuses an agent-style request with no credential at all", async () => {
    // The hostile agent's own view: it can reach the port, and learns nothing.
    const response = await list({ "content-type": "application/json" });
    assert.equal(response.status, 401);
    assert.equal((await response.text()).includes("merchant_unknown"), false);
  });

  it("serves the list to the authenticated reviewer control plane", async () => {
    // The refusals above must not have been bought by breaking the screen.
    const response = await list({ authorization: `Bearer ${TOKEN}` });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { items: Array<{ record: { action_id: string } }> };
    assert.ok(
      body.items.some((item) => item.record.action_id === ACTION_ID),
      "the pending escalation is visible to an authenticated reviewer",
    );
  });
});

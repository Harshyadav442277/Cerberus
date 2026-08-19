import { strictEqual } from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { config } from "dotenv";
import { loadEvaluationContext } from "@safr/controls-repository";
import {
  closePool,
  getPool,
  insertAgentIdentity,
  insertMandate,
} from "@safr/db";
import type { Mandate } from "@safr/core";

const AGENT_ID = "agent_real_role_regression";
const MANDATE_ID = "mandate_real_role_regression";
const AT = "2026-08-18T12:00:00.000Z";

const mandate: Mandate = {
  mandate_id: MANDATE_ID,
  agent_id: AGENT_ID,
  version: 1,
  effective_from: "2026-08-01T00:00:00.000Z",
  effective_to: null,
  status: "active",
  scope: { action_types: ["payment"], currencies: ["USDC"] },
  controls: {
    spend_caps: {
      per_transaction_max: 1,
      rolling_window: { window: "24h", max_total: 3 },
    },
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
  created_by: "test",
  approved_by: "test",
};

before(async () => {
  // Seed with the schema owner, then discard that pool before entering the hostile
  // process boundary. Every product read below uses the provisioned agent login.
  await insertAgentIdentity({
    agent_id: AGENT_ID,
    display_name: "Real Role Regression Agent",
    owner_org: "test",
    created_at: "2026-08-01T00:00:00.000Z",
    wallet_address: "0x0000000000000000000000000000000000000000",
    status: "active",
  });
  await insertMandate(mandate);
  await closePool();

  config({ path: ".env.agent" });
  const agentDatabaseUrl = process.env["AGENT_DATABASE_URL"]?.trim();
  if (!agentDatabaseUrl) {
    throw new Error("AGENT_DATABASE_URL is required; run npm run db:roles first");
  }
  process.env["DATABASE_URL"] = agentDatabaseUrl;
});

after(async () => {
  await closePool();
});

describe("normal evaluation under the real hostile-agent database role", () => {
  it("loads its mandate and settled counters without reservation-table access", async () => {
    const context = await loadEvaluationContext(AGENT_ID, AT);

    strictEqual(context.mandate?.mandate_id, MANDATE_ID);
    strictEqual(context.counters.rolling_total_24h, 0);
    strictEqual(context.counters.hourly_tx_count, 0);

    try {
      await getPool().query("SELECT 1 FROM payment_reservation LIMIT 1");
    } catch (error) {
      strictEqual((error as { code?: string }).code, "42501");
      return;
    }
    throw new Error("agent role unexpectedly read payment_reservation");
  });
});

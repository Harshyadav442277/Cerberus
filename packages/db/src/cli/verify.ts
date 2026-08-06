/**
 * Phase 2 Definition of Done, checked by running it rather than asserting it.
 *
 *   1. The seeded mandate round-trips out of Postgres and through the zod schema with
 *      ZERO field renaming or shape loss (deep equality against the source object).
 *   2. getActiveMandate honours effective_from / effective_to at a given instant.
 *   3. Every Bible Section 7 column exists under its exact Bible name.
 *
 * It also guards the seam between Phase 2 and Phase 3: the mandate as actually stored
 * in Postgres is fed to the real Disposition Engine and must produce the three Bible
 * Section 9 demo dispositions. The engine's own unit tests use an in-memory fixture,
 * so without this the seed and the engine could drift apart and the failure would
 * surface for the first time during the live demo.
 *
 * Migration apply/rollback is covered separately by `npm run db:migrate:down` followed
 * by `npm run db:migrate`.
 *
 * Run: npm run db:verify
 */
import { deepStrictEqual } from "node:assert/strict";
import type { Mandate, ProposedAction } from "@safr/core";
import { evaluate } from "@safr/disposition-engine";
import { closePool, getPool } from "../pool.js";
import {
  getActiveMandate,
  getAgentIdentity,
  getMandate,
  insertAgentIdentity,
  insertMandate,
} from "../repository.js";
import { SEED_AGENT, SEED_MANDATE } from "../seed-data.js";

let failures = 0;

function check(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`  OK    ${label}`);
  } catch (error) {
    failures += 1;
    console.log(`  FAIL  ${label}\n        ${(error as Error).message.split("\n")[0]}`);
  }
}

/** Exact column names from Bible Sections 7.1, 7.2, 7.3 and 7.5. */
const EXPECTED_COLUMNS: Record<string, string[]> = {
  agent_identity: ["agent_id", "display_name", "owner_org", "created_at", "wallet_address", "status"],
  mandate: [
    "mandate_id", "agent_id", "version", "effective_from", "effective_to", "status",
    "scope", "controls", "default_disposition_on_breach", "created_by", "approved_by",
  ],
  proposed_action: ["action_id", "agent_id", "action_type", "proposed_at", "payload"],
  audit_log: [
    "audit_id", "action_id", "agent_id", "mandate_id", "mandate_version", "disposition",
    "reason", "rule_triggered", "evaluated_at", "human_review", "settlement",
  ],
};

async function verifyColumns(): Promise<void> {
  const { rows } = await getPool().query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ANY($1)`,
    [Object.keys(EXPECTED_COLUMNS)],
  );

  for (const [table, expected] of Object.entries(EXPECTED_COLUMNS)) {
    const actual = rows.filter((r) => r.table_name === table).map((r) => r.column_name);
    check(`${table} has exactly the Bible Section 7 columns`, () => {
      deepStrictEqual([...actual].sort(), [...expected].sort());
    });
  }
}

async function verifyRoundTrip(): Promise<void> {
  const agent = await getAgentIdentity(SEED_AGENT.agent_id);
  check("agent_identity round-trips with zero shape loss", () => {
    if (!agent) throw new Error(`${SEED_AGENT.agent_id} not found — run pnpm db:seed first`);
    // wallet_address is intentionally overwritten by the seed CLI from EVM_PRIVATE_KEY.
    deepStrictEqual({ ...agent, wallet_address: "" }, { ...SEED_AGENT, wallet_address: "" });
  });

  const mandate = await getMandate(SEED_MANDATE.mandate_id, SEED_MANDATE.version);
  check("mandate round-trips with zero shape loss (deep equality)", () => {
    if (!mandate) throw new Error(`${SEED_MANDATE.mandate_id} not found — run pnpm db:seed first`);
    deepStrictEqual(mandate, SEED_MANDATE);
  });
}

/**
 * Inserts a throwaway agent with two bounded mandate versions, confirms the correct
 * version is returned at three instants, then removes them.
 */
async function verifyEffectiveRanges(): Promise<void> {
  const agentId = "agent_verify_tmp";
  const mandateId = "mandate_verify_tmp";

  const base: Omit<Mandate, "version" | "effective_from" | "effective_to" | "status"> = {
    mandate_id: mandateId,
    agent_id: agentId,
    scope: SEED_MANDATE.scope,
    controls: SEED_MANDATE.controls,
    default_disposition_on_breach: SEED_MANDATE.default_disposition_on_breach,
    created_by: SEED_MANDATE.created_by,
    approved_by: SEED_MANDATE.approved_by,
  };

  try {
    await insertAgentIdentity({
      agent_id: agentId,
      display_name: "Verification Temp Agent",
      owner_org: "acme_corp",
      created_at: "2026-01-01T00:00:00.000Z",
      wallet_address: "0x0000000000000000000000000000000000000000",
      status: "active",
    });

    // v1 in force for January only; v2 from February, open-ended.
    await insertMandate({
      ...base,
      version: 1,
      effective_from: "2026-01-01T00:00:00.000Z",
      effective_to: "2026-02-01T00:00:00.000Z",
      status: "active",
    });
    await insertMandate({
      ...base,
      version: 2,
      effective_from: "2026-02-01T00:00:00.000Z",
      effective_to: null,
      status: "active",
    });

    const before = await getActiveMandate(agentId, "2025-12-31T00:00:00.000Z");
    check("no mandate active before effective_from", () => {
      deepStrictEqual(before, null);
    });

    const during = await getActiveMandate(agentId, "2026-01-15T00:00:00.000Z");
    check("version 1 active inside its effective range", () => {
      deepStrictEqual(during?.version, 1);
    });

    const after = await getActiveMandate(agentId, "2026-06-01T00:00:00.000Z");
    check("version 2 active after version 1's effective_to", () => {
      deepStrictEqual(after?.version, 2);
    });

    const atBoundary = await getActiveMandate(agentId, "2026-02-01T00:00:00.000Z");
    check("effective_to is exclusive and effective_from inclusive at the boundary", () => {
      deepStrictEqual(atBoundary?.version, 2);
    });
  } finally {
    await getPool().query("DELETE FROM mandate WHERE mandate_id = $1", [mandateId]);
    await getPool().query("DELETE FROM agent_identity WHERE agent_id = $1", [agentId]);
  }
}

/**
 * Feeds the mandate AS STORED IN POSTGRES to the real engine and checks the three
 * Bible Section 9 demo outcomes. Catches drift between the seed and the engine.
 */
async function verifyDemoScenarios(): Promise<void> {
  const mandate = await getMandate(SEED_MANDATE.mandate_id, SEED_MANDATE.version);
  if (!mandate) {
    check("demo scenarios run against the stored mandate", () => {
      throw new Error(`${SEED_MANDATE.mandate_id} not found — run npm run db:seed first`);
    });
    return;
  }

  // A Friday at 14:32 UTC, inside every seeded window.
  const proposedAt = "2026-08-07T14:32:00.000Z";
  const noPriorActivity = { rolling_total_24h: 0, hourly_tx_count: 0 };

  const proposal = (counterparty: string, amount: number): ProposedAction => ({
    action_id: "action_verify_tmp",
    agent_id: SEED_MANDATE.agent_id,
    action_type: "payment",
    proposed_at: proposedAt,
    payload: {
      counterparty,
      amount,
      currency: "USDC",
      purpose: "service_fulfillment",
      reference: "invoice_884",
    },
  });

  const scenarios: Array<[string, ProposedAction, string, string | null]> = [
    ["scenario 1 — clean payment to merchant_xyz", proposal("merchant_xyz", 0.5), "ALLOW", null],
    [
      "scenario 2 — cap breach at merchant_abc",
      proposal("merchant_abc", 5.0),
      "DENY",
      "spend_caps.per_transaction_max",
    ],
    [
      "scenario 3 — unknown counterparty merchant_new",
      proposal("merchant_new", 0.75),
      "ESCALATE",
      "counterparty_policy",
    ],
  ];

  for (const [label, proposedAction, expectedDisposition, expectedRule] of scenarios) {
    const result = evaluate(proposedAction, mandate, noPriorActivity);
    check(`${label} resolves to ${expectedDisposition}`, () => {
      deepStrictEqual(
        { disposition: result.disposition, rule: result.rule },
        { disposition: expectedDisposition, rule: expectedRule },
      );
    });
  }
}

function warnOnWeekend(): void {
  const today = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date().getUTCDay()]!;
  if (!SEED_MANDATE.controls.time_window.allowed_days.includes(today as never)) {
    console.log(
      `\n  WARNING  Today is ${today} (UTC), which is not in the seed mandate's\n` +
        `           allowed_days [${SEED_MANDATE.controls.time_window.allowed_days.join(", ")}].\n` +
        `           Demo scenario 1 will resolve to DENY on rule 'time_window', not ALLOW.\n` +
        `           This is the seeded Bible Section 7.2 value behaving correctly, not a bug.\n` +
        `           See Memory.md blocker B5 — Stage 2 judging is Aug 21-23, which spans a weekend.`,
    );
  }
}

async function main(): Promise<void> {
  console.log("\nPhase 2/3 verification — schema mirrors Bible Section 7, engine agrees with it\n");
  await verifyColumns();
  await verifyRoundTrip();
  await verifyEffectiveRanges();
  await verifyDemoScenarios();
  warnOnWeekend();

  if (failures > 0) {
    console.log(`\n${failures} check(s) failed.\n`);
    process.exitCode = 1;
    return;
  }
  console.log(
    "\nAll checks passed. Phase 2 Definition of Done met, and the stored mandate\n" +
      "drives the three Bible Section 9 demo outcomes through the real engine.\n",
  );
}

try {
  await main();
} catch (error) {
  console.error(`\n  ERROR ${(error as Error).message}\n`);
  process.exitCode = 1;
} finally {
  await closePool();
}

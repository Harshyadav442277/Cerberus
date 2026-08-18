/**
 * Phase 7 — Bible Section 9 demo script.
 *
 * Runs the three scenarios in order. ESCALATE waits for an authenticated dashboard
 * decision or the separate trusted reviewer:auto process. Asserts dispositions, rule
 * paths, and the interception constraint.
 *
 * Prefer: npm run demo:script
 */
import { getAnchor } from "@safr/audit-log";
import { loadEvaluationContext } from "@safr/controls-repository";
import { closePool, getAuditLogRecord, resetDemoState } from "@safr/db";
import { createAuditLog } from "../audit.js";
import { createDbEscalationPort } from "../escalations.js";
import { SCENARIOS, createIntentGenerator } from "../intent-generator.js";
import { runAction, type Outcome } from "../orchestrator.js";
import { createAuthorizationPort, createSettlementPort } from "../settlement/index.js";
import { agentEnv, loadAgentProcessEnv } from "../env.js";

loadAgentProcessEnv();

const AGENT_ID = "agent_treasury_01";
const ORDER = ["clean", "cap_breach", "new_counterparty"] as const;

const args = process.argv.slice(2);
const thrice = args.includes("--thrice");
const noReset = args.includes("--no-reset") && !thrice;

interface Expectation {
  disposition: "ALLOW" | "DENY" | "ESCALATE";
  rule: string | null;
  x402: boolean;
  humanDecision?: "approved" | "denied";
}

const EXPECT: Record<(typeof ORDER)[number], Expectation> = {
  clean: { disposition: "ALLOW", rule: null, x402: true },
  cap_breach: {
    disposition: "DENY",
    rule: "spend_caps.per_transaction_max",
    x402: false,
  },
  new_counterparty: {
    disposition: "ESCALATE",
    rule: "counterparty_policy",
    x402: true,
    humanDecision: "approved",
  },
};

function fail(message: string): never {
  console.error(`\n  FAIL  ${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
}

async function checkPrereqs(): Promise<void> {
  const merchant = agentEnv.merchantBaseUrl;
  try {
    const res = await fetch(`${merchant}/health`);
    if (!res.ok) fail(`merchant health ${res.status} at ${merchant}`);
  } catch {
    fail(`merchant not reachable at ${merchant} — run npm run merchant`);
  }
}

function assertOutcome(key: (typeof ORDER)[number], outcome: Outcome): void {
  const expect = EXPECT[key];
  const d = outcome.disposition;

  if (!d) fail(`${key}: missing disposition`);
  if (d.disposition !== expect.disposition) {
    fail(`${key}: expected ${expect.disposition}, got ${d.disposition}`);
  }
  if (d.rule !== expect.rule) {
    fail(`${key}: expected rule ${JSON.stringify(expect.rule)}, got ${JSON.stringify(d.rule)}`);
  }
  if (outcome.settlementAttempted !== expect.x402) {
    fail(`${key}: x402 attempted=${outcome.settlementAttempted}, expected ${expect.x402}`);
  }
  if (expect.humanDecision) {
    if (outcome.humanReview?.decision !== expect.humanDecision) {
      fail(
        `${key}: human_review.decision expected ${expect.humanDecision}, got ${outcome.humanReview?.decision}`,
      );
    }
  }
  if (key === "cap_breach" && outcome.settlement !== null) {
    fail(`${key}: DENY must leave settlement null`);
  }
}

async function runOnce(runLabel: string): Promise<void> {
  console.log(`\n═══ ${runLabel} ═══`);
  if (!noReset) {
    const reset = await resetDemoState();
    console.log(`  reset     ${reset.agentId} / ${reset.mandateId} (audit log empty)`);
  }
  await checkPrereqs();

  const auditLog = createAuditLog();
  const generator = createIntentGenerator();
  const escalations = createDbEscalationPort();

  const outcomes: Outcome[] = [];
  const started = Date.now();

  for (const key of ORDER) {
    const scenario = SCENARIOS[key]!;
    const action = await generator.propose(scenario, AGENT_ID);

    console.log(`\n${scenario.name}`);
    console.log(
      `  proposes  ${action.payload.amount} ${action.payload.currency} → ${action.payload.counterparty}`,
    );

    if (key === "new_counterparty") {
      console.log(`  waiting   authenticated reviewer decision (action ${action.action_id})`);
    }

    const outcome = await runAction(action, {
      controls: { loadEvaluationContext },
      audit: auditLog,
      escalations,
      authorization: createAuthorizationPort,
      settlement: createSettlementPort,
    });

    const rule = outcome.disposition?.rule ?? "(none)";
    console.log(`  result    ${outcome.disposition?.disposition}  rule=${rule}`);
    console.log(
      `  x402      ${outcome.settlementAttempted ? "reached" : "never constructed"}`,
    );
    if (outcome.humanReview) {
      console.log(
        `  review    ${outcome.humanReview.decision} by ${outcome.humanReview.reviewer_id}`,
      );
    }
    if (outcome.settlement?.tx_hash) {
      console.log(`  settle    ${outcome.settlement.tx_hash}`);
    } else if (outcome.settlement) {
      console.log(`  settle    ${outcome.settlement.status} (B1: fund wallet for a real hash)`);
    }
    if (outcome.audit) console.log(`  audit     ${outcome.audit.audit_id}`);

    assertOutcome(key, outcome);

    if (!outcome.audit) fail(`${key}: no audit record`);
    const stored = await getAuditLogRecord(outcome.audit.audit_id);
    if (!stored) fail(`${key}: audit row missing from Postgres`);
    if (stored.disposition !== EXPECT[key].disposition) {
      fail(`${key}: stored disposition drifted`);
    }
    if (key === "new_counterparty") {
      if (!stored.human_review) fail(`${key}: human_review not persisted`);
      if (stored.human_review.decision !== "approved") {
        fail(`${key}: stored human_review is not approved`);
      }
    }
    if (key === "cap_breach" && stored.rule_triggered !== "spend_caps.per_transaction_max") {
      fail(`${key}: stored rule_triggered wrong`);
    }

    // Anchoring is fire-and-forget; wait for the pending row before asserting it.
    await auditLog.anchors.drain();
    const anchor = await getAnchor(outcome.audit.audit_id);
    if (!anchor?.record_hash) fail(`${key}: missing anchor digest`);

    outcomes.push(outcome);
  }
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const settled = outcomes.filter((o) => o.settlement?.status === "settled").length;

  console.log(`\n  Run complete in ${elapsed}s`);
  console.log(`  dispositions  ALLOW → DENY → ESCALATE(approved)  ✓`);
  console.log(`  interception  DENY never reached x402           ✓`);
  console.log(`  human_review  persisted on scenario 3           ✓`);
  console.log(
    `  settlements   ${settled}/2 real hashes` +
      (settled < 2 ? "  (B1 blocks live settlement until wallet is funded)" : "  ✓"),
  );
}

export async function main(): Promise<void> {
  console.log("\nCERBERUS — SAFR Runtime demo (Bible Section 9)");
  console.log("Mode: authenticated reviewer approval required for scenario 3");

  const runs = thrice ? 3 : 1;
  for (let i = 1; i <= runs; i++) {
    await runOnce(thrice ? `Run ${i} of 3` : "Demo run");
  }

  if (thrice) {
    console.log("\n  Three consecutive clean runs succeeded.\n");
  } else {
    console.log("\n  Demo script OK. For DoD: npm run demo:script -- --thrice\n");
  }
}

if (import.meta.filename === process.argv[1]) {
  try {
    await main();
  } catch (error) {
    if (process.exitCode !== 1) {
      console.error(`\n  ERROR ${(error as Error).message}\n`);
      process.exitCode = 1;
    }
  } finally {
    await closePool();
  }
}

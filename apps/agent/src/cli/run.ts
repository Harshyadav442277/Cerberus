/**
 * Phase 4 end-to-end run: agent proposes, engine decides, settlement happens only if
 * the decision permits it.
 *
 * Usage:
 *   npm run demo                 all three Bible Section 9 scenarios
 *   npm run demo -- clean        one scenario: clean | cap_breach | new_counterparty
 *   npm run demo -- --deny-escalation   reviewer rejects instead of approving
 */
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { loadEvaluationContext } from "@safr/controls-repository";
import { closePool } from "@safr/db";
import { createAuditPort } from "../audit.js";
import { createAutoEscalationPort } from "../escalations.js";
import { SCENARIOS, createIntentGenerator, type Scenario } from "../intent-generator.js";
import { runAction, type Outcome } from "../orchestrator.js";
import { createSettlementPort } from "../settlement/index.js";

loadEnv({ path: resolve(import.meta.dirname, "../../../../.env"), quiet: true });

const AGENT_ID = "agent_treasury_01";

const args = process.argv.slice(2);
const denyEscalation = args.includes("--deny-escalation");
const selected = args.filter((arg) => !arg.startsWith("--"));

function describe(outcome: Outcome): string {
  const disposition = outcome.disposition;
  const lines: string[] = [];

  if (disposition) {
    const rule = disposition.rule ?? "(none — clean pass)";
    lines.push(`  disposition   ${disposition.disposition}`);
    lines.push(`  reason        ${disposition.reason}`);
    lines.push(`  rule          ${rule}`);
  }
  if (outcome.humanReview) {
    lines.push(`  human review  ${outcome.humanReview.decision} by ${outcome.humanReview.reviewer_id}`);
  }
  lines.push(`  x402 reached  ${outcome.settlementAttempted ? "yes" : "NO — never constructed"}`);

  if (outcome.settlement?.tx_hash) {
    lines.push(`  settlement    ${outcome.settlement.status}  ${outcome.settlement.tx_hash}`);
    lines.push(`  explorer      https://sepolia.basescan.org/tx/${outcome.settlement.tx_hash}`);
  } else if (outcome.settlement) {
    lines.push(`  settlement    ${outcome.settlement.status}`);
  }
  if (outcome.audit) lines.push(`  audit_id      ${outcome.audit.audit_id}`);

  return lines.join("\n");
}

async function runScenario(key: string, scenario: Scenario): Promise<Outcome> {
  const generator = createIntentGenerator();
  const action = await generator.propose(scenario, AGENT_ID);

  console.log(`\n${scenario.name}   [${key}]`);
  console.log(
    `  proposes      ${action.payload.amount} ${action.payload.currency} ` +
      `to ${action.payload.counterparty}  (${action.payload.reference}, via ${generator.mode})`,
  );

  const outcome = await runAction(action, {
    controls: { loadEvaluationContext },
    audit: createAuditPort(),
    escalations: createAutoEscalationPort(denyEscalation ? "denied" : "approved"),
    // A factory, so on DENY the settlement module is never even constructed.
    settlement: createSettlementPort,
  });

  console.log(describe(outcome));
  return outcome;
}

async function main(): Promise<void> {
  const keys = selected.length > 0 ? selected : Object.keys(SCENARIOS);

  for (const key of keys) {
    const scenario = SCENARIOS[key];
    if (!scenario) {
      console.error(`Unknown scenario '${key}'. Available: ${Object.keys(SCENARIOS).join(", ")}`);
      process.exitCode = 1;
      return;
    }
    await runScenario(key, scenario);
  }

  console.log(
    "\nNote: a failed settlement on the ALLOW path is expected until the payer wallet is\n" +
      "funded (Memory.md blocker B1). The disposition path above is unaffected by it.\n",
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

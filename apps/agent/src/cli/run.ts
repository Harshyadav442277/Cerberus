/**
 * End-to-end run: agent proposes, engine decides, settlement happens only if the
 * decision permits it, and every record is anchored once it reaches its terminal state.
 *
 * Usage:
 *   npm run demo                 all three Bible Section 9 scenarios
 *   npm run demo -- clean        one scenario: clean | cap_breach | new_counterparty
 *   npm run demo -- new_counterparty
 *       wait for Approve/Deny from the authenticated reviewer control plane
 */
import { getAnchor } from "@safr/audit-log";
import { loadEvaluationContext } from "@safr/controls-repository";
import { closePool } from "@safr/db";
import { createAuditLog } from "../audit.js";
import { createDbEscalationPort } from "../escalations.js";
import { SCENARIOS, createIntentGenerator, type Scenario } from "../intent-generator.js";
import { runAction, type Outcome } from "../orchestrator.js";
import { createAuthorizationPort, createSettlementPort } from "../settlement/index.js";
import { loadAgentProcessEnv } from "../env.js";

loadAgentProcessEnv({ requireDatabase: true });

const AGENT_ID = "agent_treasury_01";

const args = process.argv.slice(2);
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

// One audit log for the whole run, so all anchors share a single queue to drain.
const auditLog = createAuditLog();

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
    audit: auditLog,
    escalations: createDbEscalationPort(),
    authorization: createAuthorizationPort,
    // A factory, so on DENY the settlement module is never even constructed.
    settlement: createSettlementPort,
  });

  console.log(describe(outcome));
  return outcome;
}

/**
 * Reports each record's anchor after the run.
 *
 * Printed separately from the scenario output on purpose: anchoring happens after the
 * disposition has already been returned, which is exactly the property Architecture
 * 6.1 requires. The digests below are present whether or not the chain was reachable.
 */
async function reportAnchors(outcomes: Outcome[]): Promise<void> {
  await auditLog.anchors.drain();

  console.log("\nAudit anchors");
  for (const outcome of outcomes) {
    if (!outcome.audit) continue;
    const anchor = await getAnchor(outcome.audit.audit_id);
    if (!anchor) {
      console.log(`  ${outcome.audit.audit_id}  no anchor row`);
      continue;
    }
    const onChain =
      anchor.status === "anchored" ? anchor.anchor_tx_hash : `not on chain (${anchor.status})`;
    console.log(`  ${anchor.audit_id}  ${anchor.record_hash.slice(0, 18)}…  ${onChain}`);
  }
  console.log("\n  Verify with: npm run audit:verify");
}

async function main(): Promise<void> {
  const keys = selected.length > 0 ? selected : Object.keys(SCENARIOS);
  const outcomes: Outcome[] = [];

  for (const key of keys) {
    const scenario = SCENARIOS[key];
    if (!scenario) {
      console.error(`Unknown scenario '${key}'. Available: ${Object.keys(SCENARIOS).join(", ")}`);
      process.exitCode = 1;
      return;
    }
    outcomes.push(await runScenario(key, scenario));
  }

  await reportAnchors(outcomes);

  console.log(
    "\nNote: a failed settlement on the ALLOW path, and anchors that are not yet on chain,\n" +
      "are both expected until the payer wallet is funded (Memory.md blocker B1). Neither\n" +
      "affects the disposition path above.\n",
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

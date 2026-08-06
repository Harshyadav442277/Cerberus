/**
 * Seeds the demo agent identity and mandate_001 version 1.
 *
 * Run: pnpm db:seed
 */
import { privateKeyToAccount } from "viem/accounts";
import { insertAgentIdentity, insertMandate } from "../repository.js";
import { SEED_AGENT, SEED_MANDATE } from "../seed-data.js";
import { closePool } from "../pool.js";

function payerAddress(): string | null {
  const key = process.env["EVM_PRIVATE_KEY"]?.trim();
  if (!key) return null;
  try {
    return privateKeyToAccount(key as `0x${string}`).address;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const address = payerAddress();
  const agent = address ? { ...SEED_AGENT, wallet_address: address } : SEED_AGENT;

  await insertAgentIdentity(agent);
  console.log(`\n  seeded agent    ${agent.agent_id} (${agent.wallet_address})`);
  if (!address) {
    console.log("                  EVM_PRIVATE_KEY not set — wallet_address left as zero address");
  }

  await insertMandate(SEED_MANDATE);
  const { controls } = SEED_MANDATE;
  console.log(`  seeded mandate  ${SEED_MANDATE.mandate_id} v${SEED_MANDATE.version}`);
  console.log(`                  per_transaction_max      ${controls.spend_caps.per_transaction_max} USDC`);
  console.log(`                  rolling 24h max_total    ${controls.spend_caps.rolling_window.max_total} USDC`);
  console.log(`                  allowlist                ${controls.counterparty_policy.allowlist.join(", ")}`);
  console.log(`                  unknown counterparty     ${controls.counterparty_policy.unknown_counterparty_disposition}`);
  console.log(`                  allowed_days             ${controls.time_window.allowed_days.join(", ")}`);
  console.log(`                  max_transactions_per_hour ${controls.velocity.max_transactions_per_hour}\n`);
}

try {
  await main();
} catch (error) {
  console.error(`\n  ERROR ${(error as Error).message}\n`);
  process.exitCode = 1;
} finally {
  await closePool();
}

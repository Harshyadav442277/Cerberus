/**
 * PHASE 1 — bare x402 testnet payment, zero governance logic.
 *
 * Bible Section 10, step 1: prove the payment rail works in isolation before any
 * governance logic is added on top of it. There is deliberately no Disposition
 * Engine, no mandate, no audit log and no database in this path. Those arrive in
 * Phases 3-5, at which point the agent's orchestrator — not this script — owns
 * the call into the payer.
 *
 * Definition of Done: this prints a settlement transaction hash that is
 * independently verifiable on the Base Sepolia block explorer.
 *
 * Run: pnpm phase1
 */
import { createX402Payer } from "../src/pay.js";

const AMOUNT_USDC = 0.01;
const COUNTERPARTY = "merchant_xyz";

async function main(): Promise<void> {
  console.log("\nPhase 1 — bare x402 payment (no governance logic)\n");

  const payer = createX402Payer();
  console.log(`  payer         ${payer.address}`);
  console.log(`  counterparty  ${COUNTERPARTY}`);
  console.log(`  amount        ${AMOUNT_USDC} USDC`);
  console.log("\n  firing payment...\n");

  const started = Date.now();
  const settlement = await payer.pay({
    counterparty: COUNTERPARTY,
    amount: AMOUNT_USDC,
    reference: "phase1_smoke_test",
  });
  const elapsed = Date.now() - started;

  if (settlement.status === "settled" && settlement.tx_hash) {
    console.log(`  SETTLED in ${elapsed}ms`);
    console.log(`  tx_hash   ${settlement.tx_hash}`);
    console.log(`  explorer  https://sepolia.basescan.org/tx/${settlement.tx_hash}`);
    console.log(`\n  Phase 1 Definition of Done met: verify the hash above on the explorer.\n`);
    return;
  }

  console.error(`  FAILED after ${elapsed}ms`);
  console.error(`  reason    ${settlement.error ?? "unknown"}`);
  console.error(`\n  Run 'pnpm phase1:preflight' to identify which prerequisite is missing.\n`);
  process.exit(1);
}

void main();

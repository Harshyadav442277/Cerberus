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
import { fetchX402Challenge, validateX402Challenge } from "../src/challenge.js";
import { requireEnv } from "../src/env.js";
import "./load-executor-env.js";

const AMOUNT_USDC = 0.01;
const COUNTERPARTY = "merchant_xyz";

async function main(): Promise<void> {
  console.log("\nPhase 1 — bare x402 payment (no governance logic)\n");

  const env = requireEnv();
  const request = {
    counterparty: COUNTERPARTY,
    amount: AMOUNT_USDC,
    reference: "phase1_smoke_test",
  };
  const live = await fetchX402Challenge(request, env.merchantBaseUrl);
  const offered = live.paymentRequired.accepts.find(
    (candidate) => candidate.scheme === "exact" && candidate.network === env.network,
  );
  if (!offered || live.paymentRequired.x402Version !== 2) {
    throw new Error("merchant did not offer x402 v2 exact on the configured network");
  }
  const challenge = validateX402Challenge(live, {
    x402Version: 2,
    scheme: "exact",
    network: offered.network,
    asset: offered.asset,
    amount: offered.amount,
    payTo: offered.payTo,
    resourceUrl: live.requestUrl,
    eip712: {
      name: String(offered.extra["name"] ?? ""),
      version: String(offered.extra["version"] ?? ""),
      assetTransferMethod: "eip3009",
    },
  });
  const payer = createX402Payer(env);
  console.log(`  payer         ${payer.address}`);
  console.log(`  counterparty  ${COUNTERPARTY}`);
  console.log(`  amount        ${AMOUNT_USDC} USDC`);
  console.log("\n  firing payment...\n");

  const started = Date.now();
  const prepared = await payer.prepare(challenge);
  // Bare Phase-1 rail diagnostic has no Cerberus reservation by design. Production
  // executor submission supplies a real durable persistence callback here.
  const settlement = await prepared.submit(async () => true);
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

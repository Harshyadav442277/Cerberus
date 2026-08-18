import { closePool } from "@safr/db";
import { createEip3009ChainReader } from "@safr/x402-client";
import { dbReconciliationStore } from "./db-context.js";
import { reconcileOne } from "./reconciliation.js";
import { configureReconcilerDatabase, reconcilerEnv } from "./reconciler-env.js";

configureReconcilerDatabase();

const once = process.argv.includes("--once");
const chain = createEip3009ChainReader(reconcilerEnv.rpcUrl);

async function run(): Promise<void> {
  console.log("\n  CERBERUS reconciliation worker");
  console.log("  signer        none");
  console.log("  rail          Base Sepolia USDC / EIP-3009\n");
  do {
    const result = await reconcileOne({ store: dbReconciliationStore, chain });
    if (result.outcome !== "idle") {
      console.log(`  ${result.reservationId}  ${result.outcome}`);
    }
    if (once) break;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, result.outcome === "idle" ? 5_000 : 250));
  } while (true);
}

try {
  await run();
} catch (error) {
  console.error(`\n  reconciliation error: ${(error as Error).message}\n`);
  process.exitCode = 1;
} finally {
  await closePool();
}

/**
 * Resets transactional demo state to a known seed, without touching schema.
 *
 * Run: npm run demo:reset
 */
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { closePool, getPool } from "../pool.js";
import { resetDemoState } from "../reset-demo.js";

const publicEnv: Record<string, string> = {};
loadEnv({
  path: resolve(import.meta.dirname, "../../../../.env"),
  quiet: true,
  processEnv: publicEnv,
});
if (publicEnv["EXECUTOR_WALLET_ADDRESS"]) {
  process.env.EXECUTOR_WALLET_ADDRESS = publicEnv["EXECUTOR_WALLET_ADDRESS"];
}

async function main(): Promise<void> {
  const { agentId, mandateId } = await resetDemoState();
  const { rows } = await getPool().query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM audit_log`,
  );

  console.log(`\n  Demo state reset`);
  console.log(`  agent     ${agentId}`);
  console.log(`  mandate   ${mandateId}`);
  console.log(`  audit_log ${rows[0]?.n ?? "0"} rows (expected 0)\n`);
}

try {
  await main();
} catch (error) {
  console.error(`\n  ERROR ${(error as Error).message}\n`);
  process.exitCode = 1;
} finally {
  await closePool();
}

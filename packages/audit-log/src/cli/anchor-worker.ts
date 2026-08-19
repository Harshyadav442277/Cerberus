/**
 * The trusted anchor worker.
 *
 * Run: npm run anchor
 *
 * This is the only process that holds AUDIT_ANCHOR_PRIVATE_KEY and the only one that
 * may write `audit_anchor`. It drains the `audit_finalization` outbox that trusted
 * terminal finalizers (the executor and the reconciler) and the agent write into,
 * re-reads each named record from Postgres, computes the digest itself, and anchors
 * it on Base Sepolia.
 *
 * It holds no payment key, no Execution Authorization key, and no reviewer
 * credential, and its database role cannot change financial truth.
 *
 * Safe to run more than one: claims are leased with FOR UPDATE SKIP LOCKED and every
 * terminal write is fenced on the lease token.
 */
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { closePool } from "@safr/db";
import { createAnchorClient, type AnchorConfig } from "../anchor.js";
import { finalizeOne } from "../finalizer.js";

const ROOT = resolve(import.meta.dirname, "../../../..");

function parse(path: string): Record<string, string> {
  const values: Record<string, string> = {};
  loadDotenv({ path, quiet: true, processEnv: values });
  return values;
}

const anchorEnv = parse(resolve(ROOT, ".env.anchor"));
const root = parse(resolve(ROOT, ".env"));

// The anchor worker must never hold spending authority, even if an operator exported
// a legacy variable into this shell before launching it.
delete process.env.EVM_PRIVATE_KEY;
delete process.env.EXECUTOR_EVM_PRIVATE_KEY;
delete process.env.EXECUTION_AUTH_PRIVATE_KEY;
delete process.env.REVIEWER_API_TOKEN;

function value(name: string, fallback = ""): string {
  return process.env[name]?.trim() || anchorEnv[name]?.trim() || root[name]?.trim() || fallback;
}

const databaseUrl = value("ANCHOR_DATABASE_URL") || value("DATABASE_URL");
if (!databaseUrl) {
  console.error("\n  ERROR ANCHOR_DATABASE_URL is required by the anchor worker\n");
  process.exit(1);
}
process.env.DATABASE_URL = databaseUrl;
delete process.env.AGENT_DATABASE_URL;
delete process.env.CONTROL_PLANE_DATABASE_URL;
delete process.env.EXECUTOR_DATABASE_URL;

const privateKey = value("AUDIT_ANCHOR_PRIVATE_KEY");
const contractAddress = value("AUDIT_ANCHOR_ADDRESS");
const config: AnchorConfig | null =
  privateKey && contractAddress
    ? { privateKey, contractAddress, rpcUrl: value("EVM_RPC_URL", "https://sepolia.base.org") }
    : null;

const client = config === null ? null : createAnchorClient(config);
const once = process.argv.includes("--once");
const intervalMs = Number(value("ANCHOR_POLL_MS", "1000"));

console.log("\n  CERBERUS anchor worker");
console.log(`  anchoring     ${config === null ? "DISABLED (digests stored only)" : contractAddress}`);
console.log("  payment key   not present in this process");
console.log(`  mode          ${once ? "single drain" : "continuous"}\n`);

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
  });
}

async function tick(): Promise<boolean> {
  const result = await finalizeOne({ client });
  switch (result.outcome) {
    case "idle":
      return false;
    case "anchored":
      console.log(`  anchored   ${result.auditId}  ${result.recordHash.slice(0, 18)}…  ${result.txHash}`);
      return true;
    case "stored_only":
      console.log(`  digest     ${result.auditId}  ${result.recordHash.slice(0, 18)}…  (chain disabled)`);
      return true;
    case "missing_record":
      console.warn(`  waiting    ${result.auditId}  record not present yet`);
      return true;
    case "deferred":
      console.warn(`  deferred   ${result.auditId}  will retry`);
      return true;
    case "lost_lease":
      console.warn(`  lost lease ${result.auditId}  another worker owns it`);
      return true;
  }
}

try {
  if (once) {
    // Drain until idle, then exit. Used by the demo and by CI.
    for (let index = 0; index < 500; index += 1) {
      if (!(await tick())) break;
    }
  } else {
    while (!stopping) {
      const worked = await tick().catch((error: unknown) => {
        console.error(`  ERROR ${error instanceof Error ? error.message : String(error)}`);
        return false;
      });
      if (!worked) await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
} finally {
  await closePool();
}

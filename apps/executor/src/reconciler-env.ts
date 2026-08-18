import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";

function parse(path: string): Record<string, string> {
  const values: Record<string, string> = {};
  loadDotenv({ path, quiet: true, processEnv: values });
  return values;
}

const publicConfig = parse(resolve(import.meta.dirname, "../../../.env"));
const reconcilerConfig = parse(resolve(import.meta.dirname, "../../../.env.reconciler"));
delete publicConfig["DATABASE_URL"];

function value(name: string, fallback = ""): string {
  return process.env[name]?.trim() ||
    reconcilerConfig[name]?.trim() ||
    publicConfig[name]?.trim() ||
    fallback;
}

export const reconcilerEnv = {
  databaseUrl: value("RECONCILER_DATABASE_URL"),
  rpcUrl: value("EVM_RPC_URL", "https://sepolia.base.org"),
};

if (!reconcilerEnv.databaseUrl) {
  throw new Error("RECONCILER_DATABASE_URL is required by the reconciliation worker");
}

/** Installs a keyless executor-role login; this process never loads .env.executor. */
export function configureReconcilerDatabase(): void {
  delete process.env.AGENT_DATABASE_URL;
  delete process.env.CONTROL_PLANE_DATABASE_URL;
  delete process.env.EXECUTOR_DATABASE_URL;
  delete process.env.EXECUTOR_EVM_PRIVATE_KEY;
  process.env.DATABASE_URL = reconcilerEnv.databaseUrl;
}

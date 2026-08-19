import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";

function parse(path: string): Record<string, string> {
  const values: Record<string, string> = {};
  loadDotenv({ path, quiet: true, processEnv: values });
  return values;
}

// Deliberately do not parse the shared root file or either signer file. Even a
// legacy .env that still contains EVM_PRIVATE_KEY must never enter agent memory.
const agent = parse(resolve(import.meta.dirname, "../../../.env.agent"));

function optional(name: string, fallback = ""): string {
  return process.env[name]?.trim() || agent[name]?.trim() || fallback;
}

/** Copies only non-payment settings into the agent process. */
export function loadAgentProcessEnv(options: { requireDatabase?: boolean } = {}): void {
  // Fail closed even if an operator accidentally exports a legacy key before launch.
  delete process.env.EVM_PRIVATE_KEY;
  delete process.env.EXECUTOR_EVM_PRIVATE_KEY;
  delete process.env.EXECUTION_AUTH_PRIVATE_KEY;
  delete process.env.REVIEWER_API_TOKEN;
  delete process.env.REVIEWER_ID;
  delete process.env.REVIEWER_DASHBOARD_USERNAME;
  delete process.env.REVIEWER_DASHBOARD_PASSWORD;
  delete process.env.DATABASE_URL;
  delete process.env.CONTROL_PLANE_DATABASE_URL;
  delete process.env.EXECUTOR_DATABASE_URL;
  // The audit-anchor signer authors final audit proof. An agent that could load it
  // could manufacture its own evidence of having behaved, so the untrusted process
  // genuinely lacks the credential rather than merely declining to use it.
  delete process.env.AUDIT_ANCHOR_PRIVATE_KEY;
  delete process.env.ANCHOR_DATABASE_URL;

  const databaseUrl =
    process.env.AGENT_DATABASE_URL?.trim() || agent["AGENT_DATABASE_URL"]?.trim();
  if (!databaseUrl && options.requireDatabase) {
    throw new Error("AGENT_DATABASE_URL is required by the untrusted agent process");
  }
  if (databaseUrl) process.env.DATABASE_URL = databaseUrl;
  for (const name of [
    "ANTHROPIC_API_KEY",
    "AUDIT_ANCHOR_ADDRESS",
    "EVM_RPC_URL",
    "EXECUTOR_WALLET_ADDRESS",
  ] as const) {
    const found = optional(name);
    if (found) process.env[name] = found;
  }
  // AUDIT_ANCHOR_ADDRESS above is a public contract address, kept so the agent can
  // display anchor state. The signing key is deliberately not read here, is not
  // present in .env.agent.example, and is deleted above even if an operator exported
  // it before launch. Anchoring is performed by the trusted anchor worker.
}

export const agentEnv = {
  apiBaseUrl: optional("NEXT_PUBLIC_API_URL", "http://localhost:4050"),
  executorBaseUrl: optional("EXECUTOR_URL", "http://localhost:4060"),
  merchantBaseUrl: optional("MERCHANT_BASE_URL", "http://localhost:4021"),
};

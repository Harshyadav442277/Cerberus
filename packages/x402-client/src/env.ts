import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: resolve(import.meta.dirname, "../../../.env"), quiet: true });

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : fallback;
}

export interface X402Env {
  /** Payer (agent) private key. Must hold Base Sepolia USDC. */
  privateKey: string;
  network: string;
  facilitatorUrl: string;
  rpcUrl: string;
  merchantBaseUrl: string;
}

/** Returns null rather than throwing, so preflight can report what is missing. */
export function readEnv(): { env: X402Env | null; missing: string[] } {
  const missing: string[] = [];
  const privateKey = process.env["EVM_PRIVATE_KEY"]?.trim() ?? "";
  if (privateKey === "") missing.push("EVM_PRIVATE_KEY");

  const config: X402Env = {
    privateKey,
    network: optional("X402_NETWORK", "eip155:84532"),
    facilitatorUrl: optional("X402_FACILITATOR_URL", "https://x402.org/facilitator"),
    rpcUrl: optional("EVM_RPC_URL", "https://sepolia.base.org"),
    merchantBaseUrl: optional("MERCHANT_BASE_URL", "http://localhost:4021"),
  };

  return { env: missing.length === 0 ? config : null, missing };
}

export function requireEnv(): X402Env {
  const { env, missing } = readEnv();
  if (!env) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(", ")}. ` +
        `Copy .env.example to .env at the repo root and fill it in.`,
    );
  }
  return env;
}

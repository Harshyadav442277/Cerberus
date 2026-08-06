import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: resolve(import.meta.dirname, "../../../.env"), quiet: true });

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env at the repo root and fill it in.`,
    );
  }
  return value.trim();
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : fallback;
}

export const env = {
  /** Merchant's receiving address. Does not need funding. */
  payTo: required("EVM_ADDRESS"),
  network: optional("X402_NETWORK", "eip155:84532"),
  facilitatorUrl: optional("X402_FACILITATOR_URL", "https://x402.org/facilitator"),
  port: Number(optional("MERCHANT_PORT", "4021")),
};

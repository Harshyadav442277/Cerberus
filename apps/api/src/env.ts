import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";

function parse(path: string): Record<string, string> {
  const values: Record<string, string> = {};
  loadDotenv({ path, quiet: true, processEnv: values });
  return values;
}

const root = parse(resolve(import.meta.dirname, "../../../.env"));
const authorizer = parse(resolve(import.meta.dirname, "../../../.env.authorizer"));

// This control-plane process may issue authorizations, but it must never hold the
// payment key itself—even if an operator accidentally exports a legacy variable.
delete process.env.EVM_PRIVATE_KEY;
delete process.env.EXECUTOR_EVM_PRIVATE_KEY;

function optional(name: string, fallback: string): string {
  return process.env[name]?.trim() || root[name]?.trim() || fallback;
}

export const apiEnv = {
  port: Number(optional("API_PORT", "4050")),
  executionAuthPrivateKey:
    process.env.EXECUTION_AUTH_PRIVATE_KEY?.trim() ||
    authorizer["EXECUTION_AUTH_PRIVATE_KEY"]?.trim() ||
    "",
  merchantBaseUrl: optional("MERCHANT_BASE_URL", "http://localhost:4021"),
  payTo: optional("EVM_ADDRESS", ""),
  network: optional("X402_NETWORK", "eip155:84532"),
  // Reviewer authority is loaded only from the trusted API environment. In
  // particular, never fall back to the shared root .env read by agent-side packages.
  reviewerApiToken:
    process.env.REVIEWER_API_TOKEN?.trim() || authorizer["REVIEWER_API_TOKEN"]?.trim() || "",
  reviewerId:
    process.env.REVIEWER_ID?.trim() ||
    authorizer["REVIEWER_ID"]?.trim() ||
    "compliance_officer_01",
};

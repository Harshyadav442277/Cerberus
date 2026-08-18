import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";

const reviewer: Record<string, string> = {};
loadDotenv({
  path: resolve(import.meta.dirname, "../../../.env.reviewer"),
  quiet: true,
  processEnv: reviewer,
});

// This process grants review authority, but it has no payment or authorization key.
delete process.env.EVM_PRIVATE_KEY;
delete process.env.EXECUTOR_EVM_PRIVATE_KEY;
delete process.env.EXECUTION_AUTH_PRIVATE_KEY;

function optional(name: string, fallback = ""): string {
  return process.env[name]?.trim() || reviewer[name]?.trim() || fallback;
}

export const reviewerEnv = {
  apiBaseUrl: optional("CERBERUS_API_URL", "http://localhost:4050"),
  token: optional("REVIEWER_API_TOKEN"),
};

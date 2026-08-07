import { Router } from "express";
import { getPool } from "@safr/db";

export const healthRouter = Router();

/**
 * GET /health — sidebar status dots (Design §4).
 *
 * Reports database reachability. Network / facilitator dots are filled from env so
 * the chrome can show "Base Sepolia" without an on-chain round trip on every poll.
 */
healthRouter.get("/", async (_req, res) => {
  let database: "up" | "down" = "down";
  try {
    await getPool().query("SELECT 1");
    database = "up";
  } catch {
    database = "down";
  }

  res.json({
    ok: database === "up",
    database,
    network: process.env.X402_NETWORK ?? "eip155:84532",
    network_label: "Base Sepolia",
    facilitator: process.env.X402_FACILITATOR_URL ?? "https://x402.org/facilitator",
    audit_anchor_configured: Boolean(process.env.AUDIT_ANCHOR_ADDRESS),
    at: new Date().toISOString(),
  });
});

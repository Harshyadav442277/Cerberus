import { strictEqual } from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import express from "express";

const TOKEN = "dashboard-read-test-token-at-least-32-bytes";
let baseUrl = "";
let closeServer: (() => Promise<void>) | undefined;

before(async () => {
  // These routers build their middleware from apiEnv at import time. Configure a
  // deterministic credential before importing them; unauthorized requests stop at
  // that middleware and never open a database connection.
  process.env.REVIEWER_API_TOKEN = TOKEN;
  const [{ auditRouter }, { agentsRouter, mandatesRouter }] = await Promise.all([
    import("../routes/audit.js"),
    import("../routes/mandates.js"),
  ]);

  const app = express();
  app.use("/audit", auditRouter);
  app.use("/mandates", mandatesRouter);
  app.use("/agents", agentsRouter);

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  closeServer = () =>
    new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
});

after(async () => {
  await closeServer?.();
});

describe("sensitive control-plane read authentication", () => {
  it("protects every sensitive dashboard read before database access", async () => {
    const paths = [
      "/audit",
      "/audit/stream",
      "/audit/audit_guessed",
      "/mandates/active",
      "/agents/agent_treasury_01",
    ];

    for (const path of paths) {
      const missing = await fetch(`${baseUrl}${path}`);
      strictEqual(missing.status, 401, `${path} must reject a missing credential`);
      strictEqual(
        (await missing.json() as { error?: string }).error,
        "reviewer_auth_required",
      );

      const forged = await fetch(`${baseUrl}${path}`, {
        headers: { authorization: "Bearer attacker-controlled-token-that-is-long-enough" },
      });
      strictEqual(forged.status, 403, `${path} must reject a forged credential`);
      strictEqual(
        (await forged.json() as { error?: string }).error,
        "reviewer_auth_invalid",
      );
    }
  });
});

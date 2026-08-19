import { strictEqual } from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import cors from "cors";
import express from "express";
import { createCorsOptions } from "../cors-policy.js";
import { createExecutionAuthorizationsRouter } from "../routes/execution-authorizations.js";

const TOKEN = "execution-service-test-token-at-least-32-bytes";
let issueCalls = 0;
let baseUrl = "";
let closeServer: (() => Promise<void>) | undefined;

before(async () => {
  const app = express();
  app.use(cors(createCorsOptions(["http://localhost:3000"])));
  app.use(express.json());
  app.use(
    "/execution-authorizations",
    createExecutionAuthorizationsRouter({
      token: TOKEN,
      issuer: {
        async issue() {
          issueCalls += 1;
          return { authorization: { authorizationId: "auth_test" } } as never;
        },
      },
    }),
  );

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  closeServer = () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

after(async () => {
  await closeServer?.();
});

async function post(headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${baseUrl}/execution-authorizations`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ audit_id: "audit_test" }),
  });
}

describe("execution capability route authentication and CORS", () => {
  it("rejects an unauthenticated evil-origin request before issuance", async () => {
    const response = await post({ origin: "https://evil.example" });

    strictEqual(response.status, 401);
    strictEqual(response.headers.get("access-control-allow-origin"), null);
    strictEqual((await response.json() as { error: string }).error, "execution_auth_required");
    strictEqual(issueCalls, 0);
  });

  it("rejects a forged bearer token before issuance", async () => {
    const response = await post({
      authorization: "Bearer attacker-controlled-token-that-is-long-enough",
      origin: "https://evil.example",
    });

    strictEqual(response.status, 403);
    strictEqual(response.headers.get("access-control-allow-origin"), null);
    strictEqual((await response.json() as { error: string }).error, "execution_auth_invalid");
    strictEqual(issueCalls, 0);
  });

  it("accepts the configured service credential", async () => {
    const response = await post({ authorization: `Bearer ${TOKEN}` });

    strictEqual(response.status, 201);
    strictEqual((await response.json() as { authorization: { authorizationId: string } })
      .authorization.authorizationId, "auth_test");
    strictEqual(issueCalls, 1);
  });

  it("allows only the configured dashboard browser origin", async () => {
    const response = await post({
      authorization: `Bearer ${TOKEN}`,
      origin: "http://localhost:3000",
    });

    strictEqual(response.status, 201);
    strictEqual(response.headers.get("access-control-allow-origin"), "http://localhost:3000");
    strictEqual(issueCalls, 2);
  });
});

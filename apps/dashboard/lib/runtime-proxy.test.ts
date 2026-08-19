import { strictEqual } from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createRuntimeReadHandler } from "./runtime-route";

const original = {
  token: process.env.REVIEWER_API_TOKEN,
  username: process.env.REVIEWER_DASHBOARD_USERNAME,
  password: process.env.REVIEWER_DASHBOARD_PASSWORD,
};

afterEach(() => {
  for (const [name, value] of Object.entries({
    REVIEWER_API_TOKEN: original.token,
    REVIEWER_DASHBOARD_USERNAME: original.username,
    REVIEWER_DASHBOARD_PASSWORD: original.password,
  })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function configure(): string {
  process.env.REVIEWER_API_TOKEN = "dashboard-upstream-token-at-least-32-bytes";
  process.env.REVIEWER_DASHBOARD_USERNAME = "reviewer";
  process.env.REVIEWER_DASHBOARD_PASSWORD = "dashboard-password-at-least-16";
  return `Basic ${Buffer.from("reviewer:dashboard-password-at-least-16").toString("base64")}`;
}

describe("authenticated dashboard runtime proxy", () => {
  it("does not expose its upstream credential to an unauthenticated browser", async () => {
    configure();
    let calls = 0;
    const handler = createRuntimeReadHandler(async () => {
      calls += 1;
      return new Response("unreachable");
    });

    const response = await handler(
      new Request("http://dashboard.test/api/runtime/audit"),
      { params: Promise.resolve({ path: ["audit"] }) },
    );

    strictEqual(response.status, 401);
    strictEqual(calls, 0);
  });

  it("replaces dashboard Basic auth with the server-only upstream bearer token", async () => {
    const basic = configure();
    let upstreamAuthorization: string | null = null;
    let upstreamUrl = "";
    const handler = createRuntimeReadHandler(async (input, init) => {
      upstreamUrl = String(input);
      upstreamAuthorization = new Headers(init?.headers).get("authorization");
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const response = await handler(
      new Request("http://dashboard.test/api/runtime/audit?limit=5", {
        headers: { authorization: basic },
      }),
      { params: Promise.resolve({ path: ["audit"] }) },
    );

    strictEqual(response.status, 200);
    strictEqual(upstreamAuthorization, "Bearer dashboard-upstream-token-at-least-32-bytes");
    strictEqual(upstreamUrl.endsWith("/audit?limit=5"), true);
  });

  it("refuses to proxy arbitrary control-plane paths", async () => {
    const basic = configure();
    let calls = 0;
    const handler = createRuntimeReadHandler(async () => {
      calls += 1;
      return new Response("unreachable");
    });

    const response = await handler(
      new Request("http://dashboard.test/api/runtime/execution-authorizations", {
        headers: { authorization: basic },
      }),
      { params: Promise.resolve({ path: ["execution-authorizations"] }) },
    );

    strictEqual(response.status, 404);
    strictEqual(calls, 0);
  });
});

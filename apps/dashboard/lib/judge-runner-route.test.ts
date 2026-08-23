import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  createJudgeRunStatusHandler,
  createResetJudgeRunsHandler,
  createStartJudgeRunHandler,
} from "./judge-runner-route";

const original = {
  runner: process.env.JUDGE_RUNNER_API_TOKEN,
  reviewer: process.env.REVIEWER_API_TOKEN,
  user: process.env.REVIEWER_DASHBOARD_USERNAME,
  password: process.env.REVIEWER_DASHBOARD_PASSWORD,
};

afterEach(() => {
  for (const [name, value] of Object.entries({
    JUDGE_RUNNER_API_TOKEN: original.runner,
    REVIEWER_API_TOKEN: original.reviewer,
    REVIEWER_DASHBOARD_USERNAME: original.user,
    REVIEWER_DASHBOARD_PASSWORD: original.password,
  })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function configure() {
  process.env.JUDGE_RUNNER_API_TOKEN = "judge-runner-token-at-least-32-characters";
  process.env.REVIEWER_API_TOKEN = "reviewer-api-token-at-least-32-characters";
  process.env.REVIEWER_DASHBOARD_USERNAME = "reviewer";
  process.env.REVIEWER_DASHBOARD_PASSWORD = "dashboard-password-at-least-16";
  return `Basic ${Buffer.from("reviewer:dashboard-password-at-least-16").toString("base64")}`;
}

function resetRequest(body?: string) {
  const headers: Record<string, string> = { authorization: configure() };
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request("http://dashboard.test/api/judge/reset", {
    method: "POST",
    headers,
    body,
  });
}

function request(body?: string) {
  const headers: Record<string, string> = { authorization: configure() };
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request("http://dashboard.test/api/judge/runs/allow-valid-payment", {
    method: "POST",
    headers,
    body,
  });
}

const validRun = {
  run_id: "run_11111111-1111-4111-8111-111111111111",
  scenario: "allow-valid-payment",
  status: "RUNNING",
  started_at: "2026-08-22T00:00:00.000Z",
  finished_at: null,
  action: {
    action_id: "action_fixed",
    agent_id: "agent_treasury_01",
    action_type: "payment",
    proposed_at: "2026-08-22T00:00:00.000Z",
    payload: {
      amount: 0.5,
      counterparty: "merchant_xyz",
      currency: "USDC",
      purpose: "service_fulfillment",
      reference: "invoice_884",
    },
  },
  outcome: null,
  error: null,
};

describe("Judge Console fixed-scenario boundary", () => {
  it("rejects financial fields supplied by the browser", async () => {
    let upstreamCalls = 0;
    const handler = createStartJudgeRunHandler(async () => {
      upstreamCalls += 1;
      return Response.json(validRun);
    });
    const response = await handler(
      request(JSON.stringify({ amount: 99, counterparty: "attacker" })),
      { params: Promise.resolve({ scenario: "allow-valid-payment" }) },
    );
    assert.equal(response.status, 400);
    assert.equal(upstreamCalls, 0);
  });

  it("rejects every scenario outside the finals allowlist", async () => {
    let upstreamCalls = 0;
    const handler = createStartJudgeRunHandler(async () => {
      upstreamCalls += 1;
      return Response.json(validRun);
    });
    const response = await handler(request(), {
      params: Promise.resolve({ scenario: "arbitrary_payment" }),
    });
    assert.equal(response.status, 404);
    assert.equal(upstreamCalls, 0);
  });

  it("adds only the server-side runner credential and forwards no body", async () => {
    const calls: {
      url: string;
      authorization: string;
      method: string;
      body: BodyInit | null | undefined;
    }[] = [];
    const handler = createStartJudgeRunHandler(async (url, init) => {
      calls.push({
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization") ?? "",
        method: init?.method ?? "GET",
        body: init?.body,
      });
      if (String(url).includes("/audit?")) return Response.json({ items: [] });
      return Response.json(validRun, { status: 202 });
    });
    const response = await handler(request(), {
      params: Promise.resolve({ scenario: "allow-valid-payment" }),
    });
    assert.equal(response.status, 202);
    assert.deepEqual(calls, [
      {
        url: "http://localhost:4050/audit?limit=500",
        authorization: "Bearer reviewer-api-token-at-least-32-characters",
        method: "GET",
        body: undefined,
      },
      {
        url: "http://localhost:4070/runs/allow-valid-payment",
        authorization: "Bearer judge-runner-token-at-least-32-characters",
        method: "POST",
        body: undefined,
      },
    ]);
  });

  it("preserves the runner's one-active-run conflict", async () => {
    const handler = createStartJudgeRunHandler(async (url) =>
      String(url).includes("/audit?")
        ? Response.json({ items: [] })
        : Response.json({ error: "RUN_ALREADY_ACTIVE" }, { status: 409 }),
    );
    const response = await handler(request(), {
      params: Promise.resolve({ scenario: "allow-valid-payment" }),
    });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: "RUN_ALREADY_ACTIVE" });
  });

  it("surfaces volatile runner-state loss without inferring failure", async () => {
    const handler = createJudgeRunStatusHandler(async () =>
      Response.json({ error: "run_state_unavailable" }, { status: 404 }),
    );
    const response = await handler(
      new Request(
        "http://dashboard.test/api/judge/run-status/run_11111111-1111-4111-8111-111111111111",
        { headers: { authorization: configure() } },
      ),
      { params: Promise.resolve({ runId: "run_11111111-1111-4111-8111-111111111111" }) },
    );
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: "run_state_unavailable" });
  });
});

describe("Judge Console durable pre-start guard", () => {
  for (const status of ["OUTCOME_UNKNOWN", "RECONCILING"] as const) {
    it(`blocks a fresh presenter when durable execution is ${status}`, async () => {
      let presenterCalls = 0;
      const handler = createStartJudgeRunHandler(async (url) => {
        if (String(url).includes("/audit?")) {
          return Response.json({
            items: [
              {
                action: { agent_id: "agent_treasury_01" },
                record: { disposition: "ALLOW", human_review: null },
                execution: { status },
              },
            ],
          });
        }
        presenterCalls += 1;
        return Response.json(validRun, { status: 202 });
      });

      const response = await handler(request(), {
        params: Promise.resolve({ scenario: "allow-valid-payment" }),
      });
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), { error: "RUN_ALREADY_ACTIVE" });
      assert.equal(presenterCalls, 0, "no presenter POST or new action may occur");
    });
  }

  it("blocks a fresh presenter while an ESCALATE review is pending", async () => {
    let presenterCalls = 0;
    const handler = createStartJudgeRunHandler(async (url) => {
      if (String(url).includes("/audit?")) {
        return Response.json({
          items: [
            {
              action: { agent_id: "agent_treasury_01" },
              record: { disposition: "ESCALATE", human_review: null },
              execution: null,
            },
          ],
        });
      }
      presenterCalls += 1;
      return Response.json(validRun, { status: 202 });
    });

    const response = await handler(request(), {
      params: Promise.resolve({ scenario: "allow-valid-payment" }),
    });
    assert.equal(response.status, 409);
    assert.equal(presenterCalls, 0, "no presenter POST or new action may occur");
  });

  for (const status of ["FAILED", "SETTLED"] as const) {
    it(`allows the presenter start path after durable ${status}`, async () => {
      let presenterCalls = 0;
      const handler = createStartJudgeRunHandler(async (url) => {
        if (String(url).includes("/audit?")) {
          return Response.json({
            items: [
              {
                action: { agent_id: "agent_treasury_01" },
                record: { disposition: "ALLOW", human_review: null },
                execution: { status },
              },
            ],
          });
        }
        presenterCalls += 1;
        return Response.json(validRun, { status: 202 });
      });

      const response = await handler(request(), {
        params: Promise.resolve({ scenario: "allow-valid-payment" }),
      });
      assert.equal(response.status, 202);
      assert.equal(presenterCalls, 1);
    });
  }

  it("fails closed on an unavailable durable audit read", async () => {
    let presenterCalls = 0;
    const handler = createStartJudgeRunHandler(async (url) => {
      if (String(url).includes("/audit?")) {
        return Response.json({ error: "unavailable" }, { status: 503 });
      }
      presenterCalls += 1;
      return Response.json(validRun, { status: 202 });
    });

    const response = await handler(request(), {
      params: Promise.resolve({ scenario: "allow-valid-payment" }),
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "live_execution_unavailable" });
    assert.equal(presenterCalls, 0);
  });

  it("fails closed on a malformed durable audit response", async () => {
    let presenterCalls = 0;
    const handler = createStartJudgeRunHandler(async (url) => {
      if (String(url).includes("/audit?")) {
        return Response.json({ items: [{ malformed: true }] });
      }
      presenterCalls += 1;
      return Response.json(validRun, { status: 202 });
    });

    const response = await handler(request(), {
      params: Promise.resolve({ scenario: "allow-valid-payment" }),
    });
    assert.equal(response.status, 503);
    assert.equal(presenterCalls, 0);
  });
});

describe("Judge Console presentation reset", () => {
  it("rejects a browser reset body before any upstream call", async () => {
    let upstreamCalls = 0;
    const handler = createResetJudgeRunsHandler(async () => {
      upstreamCalls += 1;
      return Response.json({ status: "RESET", retired: 0 });
    });
    const response = await handler(resetRequest(JSON.stringify({ actionId: "action_bad" })));
    assert.equal(response.status, 400);
    assert.equal(upstreamCalls, 0);
  });

  it("refuses reset when durable audit truth shows an active run", async () => {
    let presenterCalls = 0;
    const handler = createResetJudgeRunsHandler(async (url) => {
      if (String(url).includes("/audit?")) {
        return Response.json({
          items: [
            {
              action: { agent_id: "agent_treasury_01" },
              record: { disposition: "ALLOW", human_review: null },
              execution: { status: "OUTCOME_UNKNOWN" },
            },
          ],
        });
      }
      presenterCalls += 1;
      return Response.json({ status: "RESET", retired: 1 });
    });
    const response = await handler(resetRequest());
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: "RUN_ALREADY_ACTIVE" });
    assert.equal(presenterCalls, 0);
  });

  it("uses separate server credentials for the audit proof and presenter reset", async () => {
    const calls: { url: string; authorization: string; method: string }[] = [];
    const handler = createResetJudgeRunsHandler(async (url, init) => {
      calls.push({
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization") ?? "",
        method: init?.method ?? "GET",
      });
      return String(url).includes("/audit?")
        ? Response.json({
            items: [
              {
                action: { agent_id: "agent_once" },
                record: { disposition: "ALLOW", human_review: null },
                execution: { status: "RESERVED" },
              },
            ],
          })
        : Response.json({ status: "RESET", retired: 2 });
    });
    const response = await handler(resetRequest());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "RESET", retired: 2 });
    assert.deepEqual(calls, [
      {
        url: "http://localhost:4050/audit?limit=500",
        authorization: "Bearer reviewer-api-token-at-least-32-characters",
        method: "GET",
      },
      {
        url: "http://localhost:4070/runs/reset",
        authorization: "Bearer judge-runner-token-at-least-32-characters",
        method: "POST",
      },
    ]);
  });

  it("fails closed when the durable audit read is unavailable", async () => {
    let presenterCalls = 0;
    const handler = createResetJudgeRunsHandler(async (url) => {
      if (String(url).includes("/audit?")) {
        return Response.json({ error: "unavailable" }, { status: 503 });
      }
      presenterCalls += 1;
      return Response.json({ status: "RESET", retired: 1 });
    });
    const response = await handler(resetRequest());
    assert.equal(response.status, 503);
    assert.equal(presenterCalls, 0);
  });
});

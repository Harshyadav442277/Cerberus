import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  createJudgeRunStatusHandler,
  createStartJudgeRunHandler,
} from "./judge-runner-route";

const original = {
  runner: process.env.JUDGE_RUNNER_API_TOKEN,
  user: process.env.REVIEWER_DASHBOARD_USERNAME,
  password: process.env.REVIEWER_DASHBOARD_PASSWORD,
};

afterEach(() => {
  for (const [name, value] of Object.entries({
    JUDGE_RUNNER_API_TOKEN: original.runner,
    REVIEWER_DASHBOARD_USERNAME: original.user,
    REVIEWER_DASHBOARD_PASSWORD: original.password,
  })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function configure() {
  process.env.JUDGE_RUNNER_API_TOKEN = "judge-runner-token-at-least-32-characters";
  process.env.REVIEWER_DASHBOARD_USERNAME = "reviewer";
  process.env.REVIEWER_DASHBOARD_PASSWORD = "dashboard-password-at-least-16";
  return `Basic ${Buffer.from("reviewer:dashboard-password-at-least-16").toString("base64")}`;
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
    let upstreamAuthorization = "";
    let upstreamBody: BodyInit | null | undefined;
    const handler = createStartJudgeRunHandler(async (_url, init) => {
      upstreamAuthorization = new Headers(init?.headers).get("authorization") ?? "";
      upstreamBody = init?.body;
      return Response.json(validRun, { status: 202 });
    });
    const response = await handler(request(), {
      params: Promise.resolve({ scenario: "allow-valid-payment" }),
    });
    assert.equal(response.status, 202);
    assert.equal(upstreamAuthorization, "Bearer judge-runner-token-at-least-32-characters");
    assert.equal(upstreamBody, undefined);
  });

  it("preserves the runner's one-active-run conflict", async () => {
    const handler = createStartJudgeRunHandler(async () =>
      Response.json({ error: "RUN_ALREADY_ACTIVE" }, { status: 409 }),
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

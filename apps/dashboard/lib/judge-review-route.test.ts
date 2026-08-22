import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createJudgeReviewHandler } from "./judge-review-route";

const original = {
  reviewer: process.env.REVIEWER_API_TOKEN,
  user: process.env.REVIEWER_DASHBOARD_USERNAME,
  password: process.env.REVIEWER_DASHBOARD_PASSWORD,
};

afterEach(() => {
  for (const [name, value] of Object.entries({
    REVIEWER_API_TOKEN: original.reviewer,
    REVIEWER_DASHBOARD_USERNAME: original.user,
    REVIEWER_DASHBOARD_PASSWORD: original.password,
  })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function configure() {
  process.env.REVIEWER_API_TOKEN = "reviewer-server-token-at-least-32-characters";
  process.env.REVIEWER_DASHBOARD_USERNAME = "reviewer";
  process.env.REVIEWER_DASHBOARD_PASSWORD = "dashboard-password-at-least-16";
  return `Basic ${Buffer.from("reviewer:dashboard-password-at-least-16").toString("base64")}`;
}

function request(body?: string) {
  return new Request("http://dashboard.test/api/judge/review/action_1234abcd/approved", {
    method: "POST",
    headers: { authorization: configure() },
    body,
  });
}

const pending = {
  record: { disposition: "ESCALATE", mandate_version: 4 },
  action: {
    action_id: "action_1234abcd",
    action_type: "payment",
    payload: {
      amount: 0.75,
      counterparty: "merchant_new",
      currency: "USDC",
      purpose: "service_fulfillment",
      reference: "invoice_886",
    },
  },
};

describe("Judge Console fixed reviewer flow", () => {
  it("constructs the reviewer payload server-side", async () => {
    let calls = 0;
    let decisionBody = "";
    const handler = createJudgeReviewHandler(async (_url, init) => {
      calls += 1;
      if (calls === 1) return Response.json({ items: [pending] });
      decisionBody = String(init?.body);
      return Response.json({ ok: true });
    });
    const response = await handler(request(), {
      params: Promise.resolve({ actionId: "action_1234abcd", decision: "approved" }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(decisionBody), {
      decision: "approved",
      note: "Cerberus finals fixed-scenario review",
      mandate_version: 4,
    });
  });

  it("rejects arbitrary browser reviewer bodies", async () => {
    let calls = 0;
    const handler = createJudgeReviewHandler(async () => {
      calls += 1;
      return Response.json({ items: [pending] });
    });
    const response = await handler(request(JSON.stringify({ mandate_version: 99 })), {
      params: Promise.resolve({ actionId: "action_1234abcd", decision: "approved" }),
    });
    assert.equal(response.status, 400);
    assert.equal(calls, 0);
  });

  it("refuses a pending escalation that is not the exact finals fixture", async () => {
    const altered = structuredClone(pending);
    altered.action.payload.amount = 9;
    const handler = createJudgeReviewHandler(async () => Response.json({ items: [altered] }));
    const response = await handler(request(), {
      params: Promise.resolve({ actionId: "action_1234abcd", decision: "approved" }),
    });
    assert.equal(response.status, 409);
  });
});

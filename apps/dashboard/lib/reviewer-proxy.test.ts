import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createDecisionHandler } from "./reviewer-route.js";

const originalToken = process.env.REVIEWER_API_TOKEN;
const originalDashboardUser = process.env.REVIEWER_DASHBOARD_USERNAME;
const originalDashboardPassword = process.env.REVIEWER_DASHBOARD_PASSWORD;

afterEach(() => {
  if (originalToken === undefined) delete process.env.REVIEWER_API_TOKEN;
  else process.env.REVIEWER_API_TOKEN = originalToken;
  if (originalDashboardUser === undefined) delete process.env.REVIEWER_DASHBOARD_USERNAME;
  else process.env.REVIEWER_DASHBOARD_USERNAME = originalDashboardUser;
  if (originalDashboardPassword === undefined) delete process.env.REVIEWER_DASHBOARD_PASSWORD;
  else process.env.REVIEWER_DASHBOARD_PASSWORD = originalDashboardPassword;
});

function browserRequest(body: Record<string, unknown>, basicAuth?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (basicAuth) headers.authorization = `Basic ${btoa(basicAuth)}`;
  return new Request("http://localhost:3000/api/escalations/action_1/decision", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("dashboard reviewer proxy", () => {
  it("fails closed without a server-side credential", async () => {
    delete process.env.REVIEWER_API_TOKEN;
    delete process.env.REVIEWER_DASHBOARD_PASSWORD;
    let upstreamCalls = 0;
    const post = createDecisionHandler(async () => {
      upstreamCalls += 1;
      return new Response();
    });

    const response = await post(browserRequest({ decision: "approved" }), {
      params: Promise.resolve({ actionId: "action_1" }),
    });
    assert.equal(response.status, 503);
    assert.equal(upstreamCalls, 0);
  });

  it("refuses an agent-style call to the trusted dashboard proxy", async () => {
    process.env.REVIEWER_API_TOKEN = "dashboard-server-only-reviewer-token";
    process.env.REVIEWER_DASHBOARD_USERNAME = "reviewer";
    process.env.REVIEWER_DASHBOARD_PASSWORD = "human-reviewer-password";
    let upstreamCalls = 0;
    const post = createDecisionHandler(async () => {
      upstreamCalls += 1;
      return new Response();
    });

    const response = await post(browserRequest({ decision: "approved" }), {
      params: Promise.resolve({ actionId: "action_1" }),
    });
    assert.equal(response.status, 401);
    assert.equal(upstreamCalls, 0);
  });

  it("adds the credential server-side and never forwards forged reviewer identity", async () => {
    process.env.REVIEWER_API_TOKEN = "dashboard-server-only-reviewer-token";
    process.env.REVIEWER_DASHBOARD_USERNAME = "reviewer";
    process.env.REVIEWER_DASHBOARD_PASSWORD = "human-reviewer-password";
    let forwarded: RequestInit | undefined;
    const post = createDecisionHandler(async (_input, init) => {
      forwarded = init;
      return Response.json({ ok: true });
    });

    const response = await post(
      browserRequest({
        decision: "approved",
        reviewer_id: "forged_browser_identity",
        note: "verified",
        mandate_version: 4,
      }, "reviewer:human-reviewer-password"),
      { params: Promise.resolve({ actionId: "action_1" }) },
    );

    assert.equal(response.status, 200);
    const headers = new Headers(forwarded?.headers);
    assert.equal(headers.get("authorization"), "Bearer dashboard-server-only-reviewer-token");
    const body = JSON.parse(String(forwarded?.body)) as Record<string, unknown>;
    assert.equal(body.decision, "approved");
    assert.equal(body.mandate_version, 4);
    assert.equal("reviewer_id" in body, false);
  });
});

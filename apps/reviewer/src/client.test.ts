import { strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import { createReviewerApiClient } from "./client.js";

const TOKEN = "reviewer-client-test-token-at-least-32-bytes";

describe("scripted reviewer API client", () => {
  it("authenticates both the pending read and decision write", async () => {
    const seen: Array<{ url: string; authorization: string | null; method: string }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      const url = String(input);
      seen.push({
        url,
        authorization: headers.get("authorization"),
        method: init?.method ?? "GET",
      });
      return new Response(
        url.endsWith("/escalations")
          ? JSON.stringify({
              items: [{ action: { action_id: "action_1" }, record: { mandate_version: 1 } }],
            })
          : JSON.stringify({ ok: true }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const api = createReviewerApiClient({
      apiBaseUrl: "http://control-plane.test",
      token: TOKEN,
      fetchImpl,
    });

    const [item] = await api.pending();
    await api.decide(item!, "approved", "reviewed");

    strictEqual(seen.length, 2);
    strictEqual(seen[0]?.authorization, `Bearer ${TOKEN}`);
    strictEqual(seen[0]?.method, "GET");
    strictEqual(seen[1]?.authorization, `Bearer ${TOKEN}`);
    strictEqual(seen[1]?.method, "POST");
  });
});

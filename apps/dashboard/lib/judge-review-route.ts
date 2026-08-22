import { NextResponse } from "next/server";
import {
  authenticateReviewerDashboard,
  reviewerLoginRequired,
} from "./reviewer-dashboard-auth";

const CONTROL_PLANE_API =
  process.env.CERBERUS_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:4050";

function isFixedEscalation(item: unknown, actionId: string): item is {
  record: { mandate_version: number };
  action: { action_id: string };
} {
  if (!item || typeof item !== "object") return false;
  const candidate = item as {
    record?: { disposition?: string; mandate_version?: number };
    action?: {
      action_id?: string;
      action_type?: string;
      payload?: {
        amount?: number;
        counterparty?: string;
        currency?: string;
        purpose?: string;
        reference?: string;
      };
    };
  };
  const payload = candidate.action?.payload;
  return (
    candidate.action?.action_id === actionId &&
    candidate.action.action_type === "payment" &&
    candidate.record?.disposition === "ESCALATE" &&
    typeof candidate.record.mandate_version === "number" &&
    payload?.amount === 0.75 &&
    payload.counterparty === "merchant_new" &&
    payload.currency === "USDC" &&
    payload.purpose === "service_fulfillment" &&
    payload.reference === "invoice_886"
  );
}

export function createJudgeReviewHandler(fetcher: typeof fetch = fetch) {
  return async function judgeReview(
    request: Request,
    context: { params: Promise<{ actionId: string; decision: string }> },
  ): Promise<Response> {
    const dashboardAuth = authenticateReviewerDashboard(request);
    if (!dashboardAuth.configured) {
      return NextResponse.json({ error: "judge_auth_unconfigured" }, { status: 503 });
    }
    if (!dashboardAuth.authorized) return reviewerLoginRequired();
    const { actionId, decision } = await context.params;
    if (!/^action_[0-9a-f]{8}$/i.test(actionId)) {
      return NextResponse.json({ error: "action_not_allowed" }, { status: 404 });
    }
    if (decision !== "approved" && decision !== "denied") {
      return NextResponse.json({ error: "decision_not_allowed" }, { status: 404 });
    }
    if ((await request.text()).length > 0) {
      return NextResponse.json({ error: "review_body_not_allowed" }, { status: 400 });
    }
    const token = process.env.REVIEWER_API_TOKEN?.trim() || "";
    if (token.length < 32) {
      return NextResponse.json({ error: "reviewer_auth_unconfigured" }, { status: 503 });
    }
    const headers = { authorization: `Bearer ${token}` };

    try {
      const pendingResponse = await fetcher(`${CONTROL_PLANE_API}/escalations`, {
        headers,
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      });
      const pending = (await pendingResponse.json().catch(() => null)) as
        | { items?: unknown[] }
        | null;
      const item = pending?.items?.find((entry) => isFixedEscalation(entry, actionId));
      if (!pendingResponse.ok || !item || !isFixedEscalation(item, actionId)) {
        return NextResponse.json({ error: "fixed_escalation_not_pending" }, { status: 409 });
      }

      const upstream = await fetcher(
        `${CONTROL_PLANE_API}/escalations/${encodeURIComponent(actionId)}/decision`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({
            decision,
            note: "Cerberus finals fixed-scenario review",
            mandate_version: item.record.mandate_version,
          }),
          cache: "no-store",
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!upstream.ok) {
        return NextResponse.json({ error: "review_decision_unavailable" }, { status: 502 });
      }
      return NextResponse.json({ ok: true, decision });
    } catch {
      return NextResponse.json({ error: "review_decision_unavailable" }, { status: 503 });
    }
  };
}

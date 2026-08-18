import { NextResponse } from "next/server";
import {
  authenticateReviewerDashboard,
  reviewerLoginRequired,
} from "./reviewer-dashboard-auth";

const CONTROL_PLANE_API =
  process.env.CERBERUS_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:4050";

interface RouteContext {
  params: Promise<{ actionId: string }>;
}

/** Creates the server-only proxy handler, with an injectable fetch for unit tests. */
export function createDecisionHandler(fetcher: typeof fetch = fetch) {
  return async function handleDecision(request: Request, context: RouteContext) {
    const dashboardAuth = authenticateReviewerDashboard(request);
    if (!dashboardAuth.configured) {
      return NextResponse.json(
        { error: "reviewer_dashboard_auth_unconfigured" },
        { status: 503 },
      );
    }
    if (!dashboardAuth.authorized) return reviewerLoginRequired();

    const reviewerToken = process.env.REVIEWER_API_TOKEN?.trim();
    if (!reviewerToken || reviewerToken.length < 32) {
      return NextResponse.json({ error: "reviewer_auth_unconfigured" }, { status: 503 });
    }

    const { actionId } = await context.params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || (body.decision !== "approved" && body.decision !== "denied")) {
      return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }

    // Construct a new body explicitly. In particular, never forward reviewer_id from
    // an untrusted browser payload.
    const trustedBody = {
      decision: body.decision,
      note: typeof body.note === "string" ? body.note : undefined,
      mandate_version:
        typeof body.mandate_version === "number" ? body.mandate_version : undefined,
    };

    const upstream = await fetcher(
      `${CONTROL_PLANE_API}/escalations/${encodeURIComponent(actionId)}/decision`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${reviewerToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(trustedBody),
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      },
    );

    const responseBody = await upstream.json().catch(() => ({ error: "invalid_api_response" }));
    return NextResponse.json(responseBody, { status: upstream.status });
  };
}

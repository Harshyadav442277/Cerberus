import { NextResponse } from "next/server";
import {
  authenticateReviewerDashboard,
  reviewerLoginRequired,
} from "./reviewer-dashboard-auth";

const CONTROL_PLANE_API =
  process.env.CERBERUS_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:4050";

/**
 * Server-side proxy for the pending-escalation list — Remediation 6D.
 *
 * `GET /escalations` on the control plane is reviewer-authenticated, because a
 * pending escalation names a counterparty, an amount, and an agent waiting to spend.
 * The reviewer bearer token is a server-only secret, so the browser talks to this
 * route and this route talks to the control plane. The token never reaches client
 * JavaScript, and the merchant never sees it.
 *
 * The dashboard's own reviewer login is checked first, so this proxy cannot be used
 * as an unauthenticated bypass of the credential it holds.
 */
export function createEscalationsHandler(fetcher: typeof fetch = fetch) {
  return async function handleEscalations(request: Request) {
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

    const upstream = await fetcher(`${CONTROL_PLANE_API}/escalations`, {
      headers: { authorization: `Bearer ${reviewerToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });

    const body = await upstream.json().catch(() => ({ error: "invalid_api_response" }));
    return NextResponse.json(body, { status: upstream.status });
  };
}

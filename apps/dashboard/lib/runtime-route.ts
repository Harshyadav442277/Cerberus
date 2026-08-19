import { NextResponse } from "next/server";
import {
  authenticateReviewerDashboard,
  reviewerLoginRequired,
} from "./reviewer-dashboard-auth";

const CONTROL_PLANE_API =
  process.env.CERBERUS_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:4050";

function allowedPath(parts: readonly string[]): boolean {
  // The sidebar polls health from the browser every five seconds. It is a read-only
  // status route with no payment or policy data; without it the status dots can only
  // ever render the failure state.
  if (parts.length === 1 && parts[0] === "health") return true;
  if (parts.length === 1 && parts[0] === "audit") return true;
  if (parts[0] === "audit" && parts.length === 2 && parts[1]) return true;
  if (parts[0] === "mandates" && parts[1] === "active" && parts.length === 2) return true;
  return parts[0] === "agents" && parts.length === 2 && Boolean(parts[1]);
}

/** Server-only read proxy for runtime data used by authenticated dashboard pages. */
export function createRuntimeReadHandler(fetcher: typeof fetch = fetch) {
  return async function handleRuntimeRead(
    request: Request,
    context: { params: Promise<{ path: string[] }> },
  ): Promise<Response> {
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

    const { path } = await context.params;
    if (!allowedPath(path)) {
      return NextResponse.json({ error: "runtime_path_not_allowed" }, { status: 404 });
    }

    const incoming = new URL(request.url);
    const upstreamUrl = new URL(`${CONTROL_PLANE_API}/${path.map(encodeURIComponent).join("/")}`);
    upstreamUrl.search = incoming.search;
    const upstream = await fetcher(upstreamUrl, {
      headers: { authorization: `Bearer ${reviewerToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(path[0] === "audit" && path[1] === "stream" ? 0x7fffffff : 10_000),
    });

    const headers = new Headers();
    for (const name of ["content-type", "cache-control"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  };
}

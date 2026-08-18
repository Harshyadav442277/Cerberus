import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  authenticateReviewerDashboard,
  reviewerLoginRequired,
} from "./lib/reviewer-dashboard-auth";

export function middleware(request: NextRequest): Response {
  const auth = authenticateReviewerDashboard(request);
  if (!auth.configured) {
    return NextResponse.json({ error: "reviewer_dashboard_auth_unconfigured" }, { status: 503 });
  }
  if (!auth.authorized) return reviewerLoginRequired();
  return NextResponse.next();
}

export const config = {
  matcher: ["/escalations/:path*", "/api/escalations/:path*"],
};

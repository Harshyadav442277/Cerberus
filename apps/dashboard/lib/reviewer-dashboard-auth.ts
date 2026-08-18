export interface DashboardAuthResult {
  configured: boolean;
  authorized: boolean;
}

/**
 * Minimal local reviewer login boundary. HTTP Basic lets the browser retain the
 * credential without placing it in client JavaScript; the API bearer token remains a
 * separate server-only secret.
 */
export function authenticateReviewerDashboard(request: Request): DashboardAuthResult {
  const configuredUser = process.env.REVIEWER_DASHBOARD_USERNAME?.trim() || "reviewer";
  const configuredPassword = process.env.REVIEWER_DASHBOARD_PASSWORD ?? "";
  if (configuredPassword.length < 16) return { configured: false, authorized: false };

  const header = request.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return { configured: true, authorized: false };

  try {
    const decoded = atob(header.slice("Basic ".length));
    const separator = decoded.indexOf(":");
    if (separator < 0) return { configured: true, authorized: false };
    const username = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);
    return {
      configured: true,
      authorized: username === configuredUser && password === configuredPassword,
    };
  } catch {
    return { configured: true, authorized: false };
  }
}

export function reviewerLoginRequired(): Response {
  return new Response("Reviewer authentication required", {
    status: 401,
    headers: {
      "cache-control": "no-store",
      "www-authenticate": 'Basic realm="Cerberus Reviewer", charset="UTF-8"',
    },
  });
}

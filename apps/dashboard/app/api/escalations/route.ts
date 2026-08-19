import { createEscalationsHandler } from "@/lib/escalations-route";

/**
 * GET /api/escalations — server-side reviewer-authenticated proxy.
 *
 * The browser calls this; this calls the control plane with the reviewer token. The
 * token stays on the server.
 */
export const GET = createEscalationsHandler();

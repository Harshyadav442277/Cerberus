import { createDecisionHandler } from "@/lib/reviewer-route";

/**
 * Server-only reviewer boundary. The browser sends the decision here; only this Next
 * process adds the credential used by the control-plane API.
 */
export const POST = createDecisionHandler();

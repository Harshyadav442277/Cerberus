/**
 * Is this reviewer allowed to decide this escalation right now?
 *
 * Extracted from the route as a pure function because it is the interesting half of
 * the Phase 3 human-approval story, and a security rule that can only be exercised by
 * standing up an HTTP server tends not to get exercised.
 *
 * The scenario it exists for:
 *
 *   12:00  agent proposes a payment to NEWCO
 *   12:01  Cerberus escalates it under mandate v17
 *   12:02  reviewer opens the page
 *   12:03  an administrator publishes v18, removing NEWCO
 *   12:04  reviewer clicks Approve on the page from 12:02
 *
 * Treating that click as approval would grant authority under rules nobody reviewed.
 * A human in the path has to make the system safer, not launder a stale decision.
 */
export type ApprovalRequestVerdict =
  | { ok: true; mandateId: string; mandateVersion: number }
  | { ok: false; error: "mandate_revoked" }
  | { ok: false; error: "stale_approval"; reviewedVersion: number; currentVersion: number };

export function assessApprovalRequest(input: {
  /** The escalated audit record: which authority the escalation was raised under. */
  record: { mandate_id: string; mandate_version: number };
  /** The mandate in force at click time, or null if none is. */
  current: { mandate_id: string; version: number } | null;
  /** The version the reviewer's page rendered, when the client reports it. */
  clientMandateVersion?: number | undefined;
}): ApprovalRequestVerdict {
  const { record, current, clientMandateVersion } = input;

  // No authority in force at all. There is nothing to approve under.
  if (!current) return { ok: false, error: "mandate_revoked" };

  // The escalation was decided under a version that is no longer current.
  if (current.mandate_id !== record.mandate_id || current.version !== record.mandate_version) {
    return {
      ok: false,
      error: "stale_approval",
      reviewedVersion: record.mandate_version,
      currentVersion: current.version,
    };
  }

  // Belt and braces: the client reports which version its page rendered. A page opened
  // before a mandate change reports the old number even when the audit row agrees.
  if (clientMandateVersion !== undefined && clientMandateVersion !== current.version) {
    return {
      ok: false,
      error: "stale_approval",
      reviewedVersion: clientMandateVersion,
      currentVersion: current.version,
    };
  }

  return { ok: true, mandateId: current.mandate_id, mandateVersion: current.version };
}

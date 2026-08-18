import {
  beginSubmission,
  claimReconciliation,
  consumeAuthorization,
  deferReconciliation,
  getActiveMandate,
  getAuditLogRecord,
  getHumanApproval,
  getLiveReservationForAudit,
  getProposedAction,
  markFailed,
  markOutcomeUnknown,
  markReconciledFailed,
  markReconciledSettled,
  markSettled,
  recordPaymentAttempt,
} from "@safr/db";
import type { AuthorizationUseStore } from "@safr/execution-authorization";
import {
  ExecutionRefusedError,
  type ExecutionContextPort,
  type ExecutionReservationPort,
} from "./execution.js";
import type { ReconciliationStore } from "./reconciliation.js";

export const dbExecutionContext: ExecutionContextPort = {
  async resolve(auditId) {
    const audit = await getAuditLogRecord(auditId);
    if (!audit) throw new ExecutionRefusedError("AUDIT_NOT_FOUND");
    const action = await getProposedAction(audit.action_id);
    if (!action) throw new ExecutionRefusedError("ACTION_NOT_FOUND");
    // Financial state is read here, from the database, rather than accepted from the
    // caller. A compromised agent cannot hand the executor a reservation.
    const reservation = await getLiveReservationForAudit(auditId);
    // Resolved at execution time, not at issuance time. This is the current-authority
    // half of the question; the audit record answers the historical half.
    const active = await getActiveMandate(audit.agent_id, new Date().toISOString());
    const currentMandate = active
      ? { mandate_id: active.mandate_id, version: active.version }
      : null;
    const approval = await getHumanApproval(auditId);
    return { audit, action, reservation, currentMandate, approval };
  },
};

export const dbReservations: ExecutionReservationPort = {
  beginSubmission,
  recordPaymentAttempt,
  markSettled,
  markFailed,
  markOutcomeUnknown,
};

/**
 * Durable one-shot consumption, shared by every executor process.
 *
 * Phase 1 used a Set in this process. That could not survive a restart and a second
 * executor could not see it, so the guarantee was only as strong as one process's
 * uptime. This is a compare-and-set on a row.
 */
export const dbAuthorizationUseStore: AuthorizationUseStore = {
  consume: (authorizationId, nonce) => consumeAuthorization(authorizationId, nonce),
};

export const dbReconciliationStore: ReconciliationStore = {
  claim: claimReconciliation,
  settle: markReconciledSettled,
  fail: markReconciledFailed,
  defer: deferReconciliation,
};

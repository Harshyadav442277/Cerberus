import {
  beginSubmission,
  claimReconciliation,
  consumeAuthorization,
  deferReconciliation,
  getActiveMandate,
  getAgentIdentity,
  getAuditLogRecord,
  getHumanApproval,
  getLiveReservationForAudit,
  getProposedAction,
  getReservation,
  markFailed,
  markOutcomeUnknown,
  markReconciledFailed,
  markReconciledSettled,
  recordPaymentAttempt,
  terminalizeSettlement,
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
    // Read here, by the process holding the payment key, on every resolve — including
    // the post-402 fresh recheck. The control plane's earlier verdict is not reused.
    const agent = await getAgentIdentity(audit.agent_id);
    return {
      audit,
      action,
      reservation,
      currentMandate,
      approval,
      agentStatus: agent?.status ?? null,
    };
  },
};

export const dbReservations: ExecutionReservationPort = {
  beginSubmission,
  recordPaymentAttempt,
  // One trusted terminalization path, shared with the reconciler. The executor no
  // longer settles the reservation and leaves audit truth to an agent callback.
  async finalizeSettled(reservationId, settlementTx) {
    const result = await terminalizeSettlement({
      reservationId,
      outcome: "settled",
      settlementTx,
      from: "SUBMITTING",
    });
    return result.won;
  },
  readReservation: getReservation,
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

/**
 * Reconciliation shares the executor's terminalization path rather than keeping its
 * own near-copy of it. Remediation 4B: one trusted abstraction, so the direct and
 * reconciled routes cannot drift into subtly different terminal states.
 */
export const dbReconciliationStore: ReconciliationStore = {
  claim: claimReconciliation,
  async settle(reservationId, reconciliationToken, transactionHash, at) {
    const result = await terminalizeSettlement({
      reservationId,
      outcome: "settled",
      settlementTx: transactionHash,
      reconciliationToken,
      from: "RECONCILING",
      at,
    });
    return result.won;
  },
  async fail(reservationId, reconciliationToken, reason, at) {
    const result = await terminalizeSettlement({
      reservationId,
      outcome: "failed",
      reconciliationToken,
      from: "RECONCILING",
      reason,
      at,
    });
    return result.won;
  },
  defer: deferReconciliation,
};

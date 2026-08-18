import {
  beginSubmission,
  getAuditLogRecord,
  getLiveReservationForAudit,
  getProposedAction,
  markFailed,
  markOutcomeUnknown,
  markSettled,
} from "@safr/db";
import {
  ExecutionRefusedError,
  type ExecutionContextPort,
  type ExecutionReservationPort,
} from "./execution.js";

export const dbExecutionContext: ExecutionContextPort = {
  async resolve(auditId) {
    const audit = await getAuditLogRecord(auditId);
    if (!audit) throw new ExecutionRefusedError("AUDIT_NOT_FOUND");
    const action = await getProposedAction(audit.action_id);
    if (!action) throw new ExecutionRefusedError("ACTION_NOT_FOUND");
    // Financial state is read here, from the database, rather than accepted from the
    // caller. A compromised agent cannot hand the executor a reservation.
    const reservation = await getLiveReservationForAudit(auditId);
    return { audit, action, reservation };
  },
};

export const dbReservations: ExecutionReservationPort = {
  beginSubmission,
  markSettled,
  markFailed,
  markOutcomeUnknown,
};

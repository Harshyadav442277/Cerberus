import { getAuditLogRecord, getProposedAction } from "@safr/db";
import { ExecutionRefusedError, type ExecutionContextPort } from "./execution.js";

export const dbExecutionContext: ExecutionContextPort = {
  async resolve(auditId) {
    const audit = await getAuditLogRecord(auditId);
    if (!audit) throw new ExecutionRefusedError("AUDIT_NOT_FOUND");
    const action = await getProposedAction(audit.action_id);
    if (!action) throw new ExecutionRefusedError("ACTION_NOT_FOUND");
    return { audit, action };
  },
};

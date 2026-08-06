import { randomUUID } from "node:crypto";
import type {
  AuditLogRecord,
  Disposition,
  HumanReview,
  Mandate,
  ProposedAction,
  Settlement,
} from "@safr/core";
import {
  insertAuditLogRecord,
  insertProposedAction,
  updateAuditHumanReview,
  updateAuditSettlement,
} from "@safr/db";
import type { AuditPort } from "./ports.js";

/**
 * Postgres-backed audit writes.
 *
 * Phase 5 adds the on-chain anchor and the dashboard event stream on top of this in
 * `packages/audit-log`; the record shape written here is already the final Bible
 * Section 7.5 shape, so that work adds to this rather than reworking it.
 */
export function createAuditPort(): AuditPort {
  return {
    async record(
      action: ProposedAction,
      mandate: Mandate,
      disposition: Disposition,
    ): Promise<AuditLogRecord> {
      // The proposed action is stored whatever the outcome — a DENY is only auditable
      // if what was attempted is on record alongside the refusal.
      await insertProposedAction(action);

      const record: AuditLogRecord = {
        audit_id: `audit_${randomUUID().slice(0, 8)}`,
        action_id: action.action_id,
        agent_id: action.agent_id,
        mandate_id: mandate.mandate_id,
        // Copied at decision time so a later mandate edit cannot retroactively
        // change the record of a past decision (Bible Section 7.2).
        mandate_version: mandate.version,
        disposition: disposition.disposition,
        reason: disposition.reason,
        rule_triggered: disposition.rule,
        evaluated_at: new Date().toISOString(),
        human_review: null,
        settlement: null,
      };

      await insertAuditLogRecord(record);
      return record;
    },

    async recordHumanReview(auditId: string, review: HumanReview): Promise<void> {
      await updateAuditHumanReview(auditId, review);
    },

    async recordSettlement(auditId: string, settlement: Settlement): Promise<void> {
      await updateAuditSettlement(auditId, settlement);
    },
  };
}

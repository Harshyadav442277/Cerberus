import { randomUUID } from "node:crypto";
import type { AuditLogRecord, Disposition, Mandate, ProposedAction } from "@safr/core";
import {
  enqueueAuditFinalization,
  insertAuditLogRecord,
  insertProposedAction,
} from "@safr/db";

/**
 * The audit write path.
 *
 * One record per disposition, written whatever the outcome — a decision NOT to pay is
 * exactly as auditable as a decision to pay, and the DENY record is the one that
 * demonstrates the system actually did something.
 */
export interface AuditLog {
  record(
    action: ProposedAction,
    mandate: Mandate,
    disposition: Disposition,
  ): Promise<AuditLogRecord>;
  /**
   * Requests that this record be anchored once it has reached its terminal state.
   *
   * This is a REQUEST, not an anchoring. Remediation 3: the untrusted agent no
   * longer computes the digest, no longer holds the anchor signer, and has no
   * database privilege to write `audit_anchor` at all. All it can do is name a row
   * it was already allowed to write and ask for it to be finalized; the trusted
   * anchor worker re-reads that row from Postgres, computes the digest itself, and
   * authors the proof. A hostile agent therefore cannot choose what gets anchored,
   * cannot forge a digest, and cannot mark anything anchored.
   *
   * Deliberately separate from `record()`. A record is mutated after creation —
   * `human_review` on an escalation, `settlement` once a payment resolves — so
   * anchoring at creation would anchor a digest the stored record no longer matches.
   *
   * Must never throw: anchoring cannot be allowed to affect a disposition
   * (Architecture 6.1).
   */
  finalize(auditId: string): Promise<void>;
}

export interface AuditLogOptions {
  now?: () => string;
  newAuditId?: () => string;
  /** Injectable so the agent suite can assert enqueueing without a database. */
  enqueue?: (auditId: string) => Promise<void>;
}

/**
 * Builds the untrusted agent's audit writer.
 *
 * Note what is absent: no anchor client, no signer, no digest computation, and no
 * settlement write. This process reads no chain credential and holds no authority
 * over final audit state.
 */
export function createAuditLog(options: AuditLogOptions = {}): AuditLog {
  const now = options.now ?? (() => new Date().toISOString());
  const newAuditId = options.newAuditId ?? (() => `audit_${randomUUID().slice(0, 8)}`);
  const enqueue = options.enqueue ?? enqueueAuditFinalization;

  return {
    async record(action, mandate, disposition): Promise<AuditLogRecord> {
      // The attempt is stored alongside the refusal, so a DENY is auditable.
      await insertProposedAction(action);

      const record: AuditLogRecord = {
        audit_id: newAuditId(),
        action_id: action.action_id,
        agent_id: action.agent_id,
        mandate_id: mandate.mandate_id,
        // Copied at decision time so a later mandate edit cannot retroactively
        // change the record of a past decision (Bible Section 7.2).
        mandate_version: mandate.version,
        disposition: disposition.disposition,
        reason: disposition.reason,
        rule_triggered: disposition.rule,
        evaluated_at: now(),
        human_review: null,
        settlement: null,
      };

      await insertAuditLogRecord(record);
      return record;
    },

    async finalize(auditId): Promise<void> {
      // One durable row saying "this record is terminal, please anchor it". The
      // trusted worker does everything else. Swallowing the error keeps Architecture
      // 6.1's promise that anchoring can never fail a disposition; the record itself
      // is already committed, and an un-enqueued record is re-enqueued by the
      // sweeper rather than lost.
      await enqueue(auditId).catch((error: unknown) => {
        console.warn(
          `  [anchor] ${auditId} not enqueued — ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    },
  };
}

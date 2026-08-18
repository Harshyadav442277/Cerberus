import { randomUUID } from "node:crypto";
import type {
  AuditLogRecord,
  Disposition,
  Mandate,
  ProposedAction,
  Settlement,
} from "@safr/core";
import {
  getAuditLogRecord,
  insertAuditLogRecord,
  insertProposedAction,
  updateAuditSettlement,
} from "@safr/db";
import { createAnchorClient, readAnchorConfig } from "./anchor.js";
import { createAnchorQueue, type AnchorQueue } from "./queue.js";

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
  recordSettlement(auditId: string, settlement: Settlement): Promise<void>;
  /**
   * Anchors the record once it has reached its terminal state.
   *
   * Deliberately separate from `record()`. A record is mutated after creation —
   * `human_review` on an escalation, `settlement` once a payment resolves — so
   * anchoring at creation would anchor a digest that the stored record no longer
   * matches, and re-hashing it later would fail to reproduce the anchored value.
   * Anchoring the terminal state keeps "re-hash the stored record and compare" true,
   * which is the entire point of the anchor.
   *
   * The record is re-read from Postgres and hashed as stored, rather than hashed from
   * an in-memory copy, so the digest is over exactly the bytes a verifier will see.
   */
  finalize(auditId: string): Promise<`0x${string}` | null>;
  /** Exposed so the demo CLI can wait for anchors before printing results. */
  anchors: AnchorQueue;
}

export interface AuditLogOptions {
  anchors?: AnchorQueue;
  now?: () => string;
  newAuditId?: () => string;
}

/**
 * Builds the audit log, wiring anchoring from the environment.
 *
 * If `AUDIT_ANCHOR_ADDRESS` and `AUDIT_ANCHOR_PRIVATE_KEY` are absent the queue still computes
 * and stores digests — it just skips the chain. Records are never lost because
 * anchoring is unavailable.
 */
export function createAuditLog(options: AuditLogOptions = {}): AuditLog {
  const now = options.now ?? (() => new Date().toISOString());
  const newAuditId = options.newAuditId ?? (() => `audit_${randomUUID().slice(0, 8)}`);

  const anchors =
    options.anchors ??
    createAnchorQueue({
      client: (() => {
        const config = readAnchorConfig();
        return config === null ? null : createAnchorClient(config);
      })(),
      onError(auditId, error) {
        // Logged, never thrown: this must not reach the disposition path.
        console.warn(`  [anchor] ${auditId} not anchored — ${error.message}`);
      },
    });

  return {
    anchors,

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

    async recordSettlement(auditId, settlement): Promise<void> {
      await updateAuditSettlement(auditId, settlement);
    },

    async finalize(auditId): Promise<`0x${string}` | null> {
      const stored = await getAuditLogRecord(auditId);
      if (stored === null) return null;
      // Fire-and-forget by design: does not await the chain and cannot throw.
      return anchors.enqueue(stored);
    },
  };
}

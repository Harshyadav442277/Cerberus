import { z } from "zod";
import { DispositionValueSchema } from "./disposition.js";

/**
 * Bible Section 7.5 — Audit Log record.
 *
 * Bible Section 7.5: "Every field a compliance officer would want to see is already
 * in this record — the dashboard's drill-down view should be a near-direct render of
 * this object, not a redesign of it."
 *
 * Field names are frozen. See Rules.md R4. The on-chain anchor hash from Phase 5 is
 * deliberately NOT a field here: Architecture.md 6.1 stores it "alongside the
 * record", which is a separate table, so this schema stays exactly as the Bible
 * defines it.
 */

export const HumanReviewSchema = z.object({
  reviewer_id: z.string().min(1),
  decision: z.enum(["approved", "denied"]),
  decided_at: z.string().datetime(),
  note: z.string(),
});

export const SettlementSchema = z.object({
  status: z.enum(["settled", "failed"]),
  tx_hash: z.string().nullable(),
  rail: z.literal("x402"),
  settled_at: z.string().datetime().nullable(),
});

export const AuditLogRecordSchema = z.object({
  audit_id: z.string().min(1),
  action_id: z.string().min(1),
  agent_id: z.string().min(1),
  mandate_id: z.string().min(1),
  mandate_version: z.number().int().positive(),
  disposition: DispositionValueSchema,
  reason: z.string().min(1),
  rule_triggered: z.string().nullable(),
  evaluated_at: z.string().datetime(),
  human_review: HumanReviewSchema.nullable(),
  settlement: SettlementSchema.nullable(),
});

export type AuditLogRecord = z.infer<typeof AuditLogRecordSchema>;
export type HumanReview = z.infer<typeof HumanReviewSchema>;
export type Settlement = z.infer<typeof SettlementSchema>;

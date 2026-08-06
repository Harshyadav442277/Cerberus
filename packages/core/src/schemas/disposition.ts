import { z } from "zod";

/**
 * SAFR dispositions.
 *
 * ALLOW / DENY / ESCALATE are the three used by the demo script (Bible Section 9)
 * and the evaluation order (Bible Section 7.4).
 *
 * OBSERVE is the fourth, lower-stakes mode described in Bible Section 4 (log
 * without gating). It is supported here and in the engine's return type, but no
 * rule in the seed mandate emits it and it does not appear in the demo. See
 * PRD.md 4.3 — this was a deliberate, confirmed decision, not an oversight.
 */
export const DispositionValueSchema = z.enum(["ALLOW", "DENY", "ESCALATE", "OBSERVE"]);
export type DispositionValue = z.infer<typeof DispositionValueSchema>;

/**
 * The result of `evaluate()`.
 *
 * `rule` is ALWAYS populated on a triggered path, and explicitly null only for the
 * clean ALLOW. Bible Section 7.4 calls this out as a corrected bug that must not be
 * reintroduced: leaving it unset silently produces null in `audit_log.rule_triggered`.
 */
export const DispositionSchema = z.object({
  disposition: DispositionValueSchema,
  reason: z.string().min(1),
  rule: z.string().min(1).nullable(),
});
export type Disposition = z.infer<typeof DispositionSchema>;

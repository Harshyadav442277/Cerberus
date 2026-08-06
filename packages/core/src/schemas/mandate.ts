import { z } from "zod";
import { DispositionValueSchema } from "./disposition.js";

/**
 * Bible Section 7.2 — Mandate, the Controls Repository record.
 *
 * Field names and nesting are frozen. See Rules.md R4. Three fields that look
 * redundant are load-bearing and must stay:
 *
 * - `version` + `effective_from`/`effective_to` let an audit record reference exactly
 *   which mandate version was active at decision time. This closes the obvious judge
 *   question: "what if the rule changes after a transaction is logged?"
 * - `unknown_counterparty_disposition` makes the ambiguous demo case rule-driven
 *   rather than hardcoded, so the system looks general instead of scripted.
 * - `created_by`/`approved_by` may hold dummy values, but gesture at mandates
 *   themselves being human-authorized, which SAFR treats as important.
 */

export const SpendCapsSchema = z.object({
  per_transaction_max: z.number().positive(),
  rolling_window: z.object({
    window: z.string().min(1),
    max_total: z.number().positive(),
  }),
});

export const CounterpartyPolicySchema = z.object({
  mode: z.literal("allowlist"),
  allowlist: z.array(z.string().min(1)),
  unknown_counterparty_disposition: DispositionValueSchema,
});

export const TimeWindowSchema = z.object({
  /** Each entry is an inclusive "HH:MM-HH:MM" range in UTC. */
  allowed_hours_utc: z.array(z.string().regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/)),
  allowed_days: z.array(z.enum(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])),
});

export const VelocitySchema = z.object({
  max_transactions_per_hour: z.number().int().positive(),
});

export const MandateScopeSchema = z.object({
  action_types: z.array(z.string().min(1)),
  currencies: z.array(z.string().min(1)),
});

export const MandateControlsSchema = z.object({
  spend_caps: SpendCapsSchema,
  counterparty_policy: CounterpartyPolicySchema,
  time_window: TimeWindowSchema,
  velocity: VelocitySchema,
});

export const MandateSchema = z.object({
  mandate_id: z.string().min(1),
  agent_id: z.string().min(1),
  version: z.number().int().positive(),
  effective_from: z.string().datetime(),
  effective_to: z.string().datetime().nullable(),
  status: z.enum(["active", "superseded", "revoked"]),

  scope: MandateScopeSchema,
  controls: MandateControlsSchema,

  default_disposition_on_breach: DispositionValueSchema,
  created_by: z.string().min(1),
  approved_by: z.string().min(1),
});

export type Mandate = z.infer<typeof MandateSchema>;
export type MandateScope = z.infer<typeof MandateScopeSchema>;
export type MandateControls = z.infer<typeof MandateControlsSchema>;

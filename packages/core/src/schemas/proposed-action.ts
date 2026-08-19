import { z } from "zod";

/**
 * Bible Section 7.3 — Proposed Action.
 *
 * What the agent proposes. Produced by the LLM-driven intent generator in Phase 4,
 * and the sole input the Disposition Engine evaluates against a mandate.
 *
 * Field names are frozen. See Rules.md R4. Note that `amount`, `currency` and
 * `counterparty` live inside `payload` — the engine reads them from there, even
 * though Bible Section 7.4's pseudocode writes them as `proposed_action.amount`
 * shorthand.
 */
export const ProposedActionPayloadSchema = z.object({
  counterparty: z.string().min(1),
  // `.finite()` matters: z.number().positive() accepts Infinity, because Infinity is
  // a number and is greater than zero. The spend-cap checks deny it (Infinity exceeds
  // every finite ceiling), so it was never spendable -- but an amount that cannot be
  // represented has no business parsing as a valid proposal in the first place, and
  // relying on a downstream check to catch it makes the safety accidental.
  amount: z
    .number()
    .finite()
    .min(0.000001, "amount must be at least one USDC atomic unit")
    .refine(
      (value) =>
        Number(value.toFixed(6)) === value &&
        Number.isSafeInteger(Math.round(value * 1_000_000)),
      "amount must be exactly representable with at most 6 decimal places",
    ),
  currency: z.string().min(1),
  purpose: z.string().min(1),
  reference: z.string().min(1),
});

export const ProposedActionSchema = z.object({
  action_id: z.string().min(1),
  agent_id: z.string().min(1),
  action_type: z.string().min(1),
  proposed_at: z.string().datetime(),
  payload: ProposedActionPayloadSchema,
});

export type ProposedAction = z.infer<typeof ProposedActionSchema>;
export type ProposedActionPayload = z.infer<typeof ProposedActionPayloadSchema>;

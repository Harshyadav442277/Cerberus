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
  amount: z.number().positive(),
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

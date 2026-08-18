import { z } from "zod";

/** Shared so the route and its unit test agree on the request shape. */
export const DecisionBodySchema = z.object({
  decision: z.enum(["approved", "denied"]),
  note: z.string().default("Verified merchant_new via out-of-band call"),
  /**
   * The mandate version the reviewer's page was rendered under.
   *
   * Optional so an older client still works, but when present it is checked against
   * the mandate in force at click time. This is what turns "the page was stale" from
   * an invisible race into an explicit refusal.
   */
  mandate_version: z.number().int().positive().optional(),
});

import { z } from "zod";

/** Shared so the route and its unit test agree on the request shape. */
export const DecisionBodySchema = z.object({
  decision: z.enum(["approved", "denied"]),
  reviewer_id: z.string().min(1).default("compliance_officer_01"),
  note: z.string().default("Verified merchant_new via out-of-band call"),
});

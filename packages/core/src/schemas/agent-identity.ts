import { z } from "zod";

/**
 * Bible Section 7.1 — Agent Identity.
 *
 * Deliberately minimal: just enough to bind an agent to a mandate. This is NOT an
 * ERC-8004 identity implementation (Bible Section 7.1, PRD 4.2).
 *
 * Field names are frozen. See Rules.md R4.
 */
export const AgentIdentitySchema = z.object({
  agent_id: z.string().min(1),
  display_name: z.string().min(1),
  owner_org: z.string().min(1),
  created_at: z.string().datetime(),
  wallet_address: z.string().min(1),
  status: z.enum(["active", "suspended"]),
});

export type AgentIdentity = z.infer<typeof AgentIdentitySchema>;

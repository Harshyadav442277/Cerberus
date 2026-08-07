import { createAuditLog } from "@safr/audit-log";
import type { AuditPort } from "./ports.js";

/**
 * The agent's audit adapter.
 *
 * Phase 4 wrote Section 7.5 records directly through `@safr/db`. Phase 5 moved that
 * into `@safr/audit-log`, which adds the on-chain anchor and re-reads the record from
 * Postgres before hashing it. The record shape did not change, so this is a
 * re-pointing rather than a rewrite.
 */
export function createAuditPort(): AuditPort {
  return createAuditLog();
}

export { createAuditLog };

import type { Mandate } from "@safr/core";
import type { Counters } from "@safr/disposition-engine";
import { getActiveMandate as getActiveMandateRow } from "@safr/db";
import { getCounters } from "./counters.js";

export { getCounters, getHourlyTxCount, getRollingTotal } from "./counters.js";

/**
 * The mandate version in force for an agent at a given instant.
 *
 * Thin wrapper over the data-access query in @safr/db so callers depend on the
 * Controls Repository concept rather than on the database module directly.
 */
export async function getActiveMandate(agentId: string, at: string): Promise<Mandate | null> {
  return getActiveMandateRow(agentId, at);
}

export interface EvaluationContext {
  mandate: Mandate | null;
  counters: Counters;
}

/**
 * Convenience read for the orchestrator: the mandate plus the counters it needs,
 * both resolved at the action's `proposed_at`.
 */
export async function loadEvaluationContext(
  agentId: string,
  at: string,
): Promise<EvaluationContext> {
  const [mandate, counters] = await Promise.all([
    getActiveMandate(agentId, at),
    getCounters(agentId, at),
  ]);
  return { mandate, counters };
}

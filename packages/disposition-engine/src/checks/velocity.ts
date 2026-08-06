import type { Check } from "../types.js";

/**
 * Bible Section 7.4, check 5 — velocity.
 *
 * Judgment-based, and deliberately leans ESCALATE rather than DENY: an unusually
 * fast burst of otherwise in-policy payments is ambiguous, not an unambiguous
 * violation. This is the distinction between a clear breach and an ambiguous case
 * that SAFR's own execute / escalate / reject framing is built around.
 *
 * Comparison is `>=` because the counter is transactions already recorded in the
 * window: at the cap, one more would exceed it.
 */
export const velocityCheck: Check = (_proposedAction, mandate, counters) => {
  if (counters.hourly_tx_count >= mandate.controls.velocity.max_transactions_per_hour) {
    return {
      disposition: "ESCALATE",
      reason: "velocity_threshold_exceeded",
      rule: "velocity.max_transactions_per_hour",
    };
  }
  return null;
};

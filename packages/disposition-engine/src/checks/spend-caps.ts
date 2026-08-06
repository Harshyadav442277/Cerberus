import type { Check } from "../types.js";

/**
 * Bible Section 7.4, check 2 — per-transaction cap.
 *
 * A hard boundary: an unambiguous violation, so it resolves to DENY rather than
 * ESCALATE. This ordering (hard boundaries before judgment-based checks) is a
 * deliberate part of the design story.
 */
export const perTransactionCapCheck: Check = (proposedAction, mandate) => {
  if (proposedAction.payload.amount > mandate.controls.spend_caps.per_transaction_max) {
    return {
      disposition: "DENY",
      reason: "per_transaction_cap_exceeded",
      rule: "spend_caps.per_transaction_max",
    };
  }
  return null;
};

/**
 * Bible Section 7.4, check 2 continued — rolling window cap.
 *
 * The proposed amount is added to spend already recorded in the window, so the cap
 * governs the total the agent would reach, not just what it has already spent.
 */
export const rollingWindowCapCheck: Check = (proposedAction, mandate, counters) => {
  const projectedTotal = counters.rolling_total_24h + proposedAction.payload.amount;
  if (projectedTotal > mandate.controls.spend_caps.rolling_window.max_total) {
    return {
      disposition: "DENY",
      reason: "rolling_window_cap_exceeded",
      rule: "spend_caps.rolling_window",
    };
  }
  return null;
};

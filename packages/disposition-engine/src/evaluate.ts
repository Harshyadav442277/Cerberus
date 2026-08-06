import type { Disposition, Mandate, ProposedAction } from "@safr/core";
import { counterpartyCheck } from "./checks/counterparty.js";
import { scopeActionTypeCheck, scopeCurrencyCheck } from "./checks/scope.js";
import { perTransactionCapCheck, rollingWindowCapCheck } from "./checks/spend-caps.js";
import { timeWindowCheck } from "./checks/time-window.js";
import { velocityCheck } from "./checks/velocity.js";
import type { Check, Counters } from "./types.js";

/**
 * The check order from Bible Section 7.4, implemented exactly.
 *
 * The ordering is itself part of the design: unambiguous hard-boundary violations
 * resolve to DENY before softer, judgment-based checks resolve to ESCALATE. Do not
 * reorder these for efficiency or elegance (Rules.md R5).
 */
const CHECKS: readonly Check[] = [
  scopeActionTypeCheck, //      1.  scope.action_types      -> DENY
  scopeCurrencyCheck, //        1b. scope.currencies        -> DENY
  perTransactionCapCheck, //    2.  per_transaction_max     -> DENY
  rollingWindowCapCheck, //     2.  rolling_window          -> DENY
  counterpartyCheck, //         3.  counterparty_policy     -> per mandate config
  timeWindowCheck, //           4.  time_window             -> DENY
  velocityCheck, //             5.  velocity                -> ESCALATE
];

/**
 * The SAFR runtime gate.
 *
 * A pure function: identical inputs always produce an identical Disposition. It
 * performs no I/O, reads no clock, and contains no randomness — `proposed_at` comes
 * from the action and counters are injected by the caller.
 *
 * It is rule-based only. There is no ML model, no scoring, no anomaly detection and
 * no LLM anywhere in this path (Bible Section 0.6, Rules.md R3). Explainability is
 * the entire value proposition, so every outcome carries a machine-readable `reason`
 * and the `rule` path that produced it.
 *
 * Called by the agent's own orchestration code BEFORE it constructs the x402 HTTP
 * request — never as a proxy in front of x402 traffic (Bible Section 6, Rules.md R6).
 */
export function evaluate(
  proposedAction: ProposedAction,
  mandate: Mandate,
  counters: Counters,
): Disposition {
  for (const check of CHECKS) {
    const disposition = check(proposedAction, mandate, counters);
    if (disposition !== null) return disposition;
  }

  // The only path where `rule` is null, per Bible Section 7.4.
  return { disposition: "ALLOW", reason: "within_mandate", rule: null };
}

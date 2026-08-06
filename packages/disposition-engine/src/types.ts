import type { Disposition, Mandate, ProposedAction } from "@safr/core";

/**
 * Counter state read from the controls repository and INJECTED into `evaluate()`.
 *
 * The engine never fetches these itself. That is what keeps `evaluate()` a pure
 * function of its arguments — exhaustively unit-testable and genuinely
 * deterministic, which is the Technical Quality claim (Architecture.md section 7).
 */
export interface Counters {
  /** Total settled spend for this agent in the trailing 24 hours. */
  rolling_total_24h: number;
  /** Settled transactions for this agent in the trailing hour. */
  hourly_tx_count: number;
}

/**
 * A single rule check. Returns a Disposition to stop evaluation, or null to fall
 * through to the next check in the Bible Section 7.4 order.
 */
export type Check = (
  proposedAction: ProposedAction,
  mandate: Mandate,
  counters: Counters,
) => Disposition | null;

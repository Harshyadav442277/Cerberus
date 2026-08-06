/**
 * The ONLY place in the repository, outside the x402 package itself, that is allowed
 * to import `@safr/x402-client` (Rules R6, Bible Section 6, Architecture 2.2).
 *
 * An enforcement test in ../__tests__/interception.test.ts scans the whole repo and
 * fails if any other module imports it. Keeping the import surface to this one file
 * is what makes "the payment rail is unreachable before a disposition" a structural
 * property rather than a convention.
 */
import type { ProposedAction, Settlement } from "@safr/core";
import { createX402Payer, type X402Payer } from "@safr/x402-client";
import type { SettlementPort } from "../ports.js";

/**
 * Builds the real settlement port.
 *
 * Constructing the payer sets up a signer. It does NOT construct, and cannot
 * construct, an HTTP request — that happens only inside `pay`, which the orchestrator
 * reaches only on ALLOW or on an approved ESCALATE.
 */
export function createSettlementPort(payer: X402Payer = createX402Payer()): SettlementPort {
  return {
    async pay(action: ProposedAction): Promise<Settlement> {
      const result = await payer.pay({
        counterparty: action.payload.counterparty,
        amount: action.payload.amount,
        reference: action.payload.reference,
      });

      // SettlementResult carries an extra `error` field for operator output; the
      // Section 7.5 `settlement` object does not have one, so it is dropped here.
      return {
        status: result.status,
        tx_hash: result.tx_hash,
        rail: result.rail,
        settled_at: result.settled_at,
      };
    },
  };
}

/** Surfaces the failure reason for CLI output without widening the Section 7.5 shape. */
export async function payWithDiagnostics(
  payer: X402Payer,
  action: ProposedAction,
): Promise<{ settlement: Settlement; error?: string }> {
  const result = await payer.pay({
    counterparty: action.payload.counterparty,
    amount: action.payload.amount,
    reference: action.payload.reference,
  });
  return {
    settlement: {
      status: result.status,
      tx_hash: result.tx_hash,
      rail: result.rail,
      settled_at: result.settled_at,
    },
    ...(result.error === undefined ? {} : { error: result.error }),
  };
}

export { createX402Payer };
export type { X402Payer };

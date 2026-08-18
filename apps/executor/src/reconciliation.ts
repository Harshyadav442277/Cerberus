import type { PaymentReservation } from "@safr/db";
import {
  reconcileEip3009,
  type Eip3009ChainReader,
  type Eip3009ReconciliationResult,
} from "@safr/x402-client";

export interface ReconciliationStore {
  claim(options?: { at?: string; leaseSeconds?: number }): Promise<PaymentReservation | null>;
  settle(
    reservationId: string,
    token: string,
    transactionHash: string,
    at?: string,
  ): Promise<boolean>;
  fail(
    reservationId: string,
    token: string,
    reason: string,
    at?: string,
  ): Promise<boolean>;
  defer(
    reservationId: string,
    token: string,
    reconcileAfter: string,
    error: string | null,
    at?: string,
  ): Promise<boolean>;
}

export type ReconciliationRunResult =
  | { outcome: "idle" }
  | { outcome: "settled" | "failed" | "deferred" | "lost_lease"; reservationId: string };

function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.slice(0, 500);
}

function retryAt(nowMs: number, result?: Eip3009ReconciliationResult): string {
  const delay = result?.outcome === "pending" && result.reason === "authorization_still_live"
    ? 15_000
    : 30_000;
  return new Date(nowMs + delay).toISOString();
}

/** Claims and resolves at most one reservation. Safe to call from many processes. */
export async function reconcileOne(options: {
  store: ReconciliationStore;
  chain: Eip3009ChainReader;
  nowMs?: () => number;
}): Promise<ReconciliationRunResult> {
  const nowMs = options.nowMs?.() ?? Date.now();
  const at = new Date(nowMs).toISOString();
  const reservation = await options.store.claim({ at, leaseSeconds: 30 });
  if (!reservation) return { outcome: "idle" };
  const leaseToken = reservation.reconciliation_token;
  if (!leaseToken) throw new Error("claimed reconciliation has no fencing token");

  // A stale SUBMITTING row with no correlation is positively unpaid: submit() cannot
  // reach transport until recordPaymentAttempt has committed all correlation fields.
  if (
    !reservation.payment_payer ||
    !reservation.payment_pay_to ||
    !reservation.payment_nonce ||
    !reservation.payment_payload_hash ||
    !reservation.payment_valid_before ||
    !reservation.submission_block
  ) {
    const changed = await options.store.fail(
      reservation.reservation_id,
      leaseToken,
      "no persisted payment attempt; safe to retry",
      at,
    );
    return {
      outcome: changed ? "failed" : "lost_lease",
      reservationId: reservation.reservation_id,
    };
  }

  let result: Eip3009ReconciliationResult;
  try {
    result = await reconcileEip3009(
      {
        token: reservation.token,
        payer: reservation.payment_payer,
        nonce: reservation.payment_nonce,
        validBefore: reservation.payment_valid_before,
        submissionBlock: reservation.submission_block,
        payTo: reservation.payment_pay_to,
        amount: reservation.amount_atomic,
      },
      options.chain,
    );
  } catch (error) {
    const changed = await options.store.defer(
      reservation.reservation_id,
      leaseToken,
      retryAt(nowMs),
      `chain read failed: ${errorText(error)}`,
      at,
    );
    return {
      outcome: changed ? "deferred" : "lost_lease",
      reservationId: reservation.reservation_id,
    };
  }

  if (result.outcome === "settled") {
    const changed = await options.store.settle(
      reservation.reservation_id,
      leaseToken,
      result.transactionHash,
      at,
    );
    return {
      outcome: changed ? "settled" : "lost_lease",
      reservationId: reservation.reservation_id,
    };
  }
  if (result.outcome === "unpaid") {
    const changed = await options.store.fail(
      reservation.reservation_id,
      leaseToken,
      "EIP-3009 authorization expired unused; safe to retry",
      at,
    );
    return {
      outcome: changed ? "failed" : "lost_lease",
      reservationId: reservation.reservation_id,
    };
  }

  const changed = await options.store.defer(
    reservation.reservation_id,
    leaseToken,
    retryAt(nowMs, result),
    result.reason,
    at,
  );
  return {
    outcome: changed ? "deferred" : "lost_lease",
    reservationId: reservation.reservation_id,
  };
}

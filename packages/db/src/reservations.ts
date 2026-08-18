import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getPool } from "./pool.js";

/**
 * Phase 2 — atomic budget reservations.
 *
 * The financial invariant this module exists to hold, for every
 * (budget_key, currency) pair, at every instant:
 *
 *     settled spend + active reserved spend + requested amount
 *         <= mandate.controls.spend_caps.rolling_window.max_total
 *
 * Before Phase 2 the remaining budget was derived from audit rows that had already
 * SETTLED, so two concurrent proposals both observed the same headroom and both
 * passed the rolling-window check. Capacity is now COMMITTED at decision time under
 * a lock on the shared financial authority, and released only on evidence.
 *
 * Two rules govern everything below:
 *
 *  1. No database transaction is held open across x402 or chain settlement. The
 *     reservation commits first; the network call happens afterwards.
 *  2. Capacity is never freed by a guess. Only positively-known non-payment
 *     (FAILED) or a pre-broadcast TTL expiry releases it. An ambiguous network
 *     outcome holds its capacity until Phase 5 reconciles it.
 */

export type ReservationStatus =
  | "RESERVED"
  | "AUTHORIZED"
  | "SUBMITTING"
  | "SETTLED"
  | "FAILED"
  | "OUTCOME_UNKNOWN"
  | "EXPIRED";

/**
 * Statuses that occupy the idempotency slot for a proposal.
 *
 * FAILED and EXPIRED are absent on purpose: both are positive evidence that no money
 * moved, so a genuine retry may reserve again. SETTLED is present, so a proposal that
 * already paid can never take a second reservation.
 */
export const LIVE_RESERVATION_STATUSES: readonly ReservationStatus[] = [
  "RESERVED",
  "AUTHORIZED",
  "SUBMITTING",
  "SETTLED",
  "OUTCOME_UNKNOWN",
];

/** Pre-broadcast states. These, and only these, may be released by TTL. */
const PRE_BROADCAST_STATUSES: readonly ReservationStatus[] = ["RESERVED", "AUTHORIZED"];

export interface PaymentReservation {
  reservation_id: string;
  audit_id: string;
  action_id: string;
  agent_id: string;
  mandate_id: string;
  mandate_version: number;
  budget_key: string;
  currency: string;
  /** Exact decimal string. Never parsed to a JS float on the money path. */
  amount_decimal: string;
  amount_atomic: string;
  chain_id: number;
  token: string;
  status: ReservationStatus;
  authorization_id: string | null;
  settlement_tx: string | null;
  counts_at: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

const COLUMNS = `reservation_id, audit_id, action_id, agent_id, mandate_id, mandate_version,
  budget_key, currency, amount_decimal, amount_atomic, chain_id, token, status,
  authorization_id, settlement_tx, counts_at, expires_at, created_at, updated_at`;

function toReservation(row: Record<string, unknown>): PaymentReservation {
  return {
    ...(row as unknown as PaymentReservation),
    mandate_version: Number(row["mandate_version"]),
    chain_id: Number(row["chain_id"]),
  };
}

/**
 * The identity of the shared financial authority.
 *
 * Deliberately the mandate, not the agent. Two agents operating under one corporate
 * mandate draw down ONE budget, so locking per agent would let each of them observe
 * the full remaining balance and the invariant would not hold.
 */
export function budgetKeyForMandate(mandateId: string): string {
  return `mandate:${mandateId}`;
}

/** Parses the mandate's rolling window ("24h", "7d"). Unknown shapes are not guessed. */
export function windowHours(window: string): number {
  const match = /^(\d+)\s*([hd])$/i.exec(window.trim());
  if (!match) throw new Error(`unsupported rolling window: ${window}`);
  const value = Number(match[1]);
  return match[2]!.toLowerCase() === "d" ? value * 24 : value;
}

export interface ReserveBudgetInput {
  auditId: string;
  actionId: string;
  agentId: string;
  mandateId: string;
  mandateVersion: number;
  currency: string;
  /** Canonical decimal amount, as a string so it never round-trips through a float. */
  amountDecimal: string;
  amountAtomic: string;
  chainId: number;
  token: string;
  /** The mandate's rolling-window ceiling, as an exact decimal string. */
  maxTotal: string;
  rollingWindow: string;
  ttlSeconds?: number;
  /** Instant capacity is committed at. Injectable so tests are deterministic. */
  at?: string;
}

export type ReserveBudgetResult =
  | { outcome: "created"; reservation: PaymentReservation }
  /** An earlier identical proposal already holds the capacity. Not a second effect. */
  | { outcome: "existing"; reservation: PaymentReservation }
  | { outcome: "insufficient_budget"; committed: string; requested: string; limit: string };

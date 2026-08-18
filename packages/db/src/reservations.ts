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

/**
 * Committed spend for a budget authority, as one NUMERIC expression.
 *
 * Two sources are summed and neither is double counted:
 *
 *  - reservations, which are the Phase 2 source of truth; and
 *  - settled audit rows that have NO reservation, which are pre-Phase-2 history.
 *
 * A reservation holds capacity when it is SETTLED (money moved), SUBMITTING or
 * OUTCOME_UNKNOWN (money may have moved — never free these on a timer), or while it
 * is still inside its pre-broadcast TTL.
 */
const COMMITTED_SPEND_SQL = `
  WITH reserved AS (
    SELECT COALESCE(SUM(amount_decimal), 0) AS total
      FROM payment_reservation
     WHERE budget_key = $1
       AND currency   = $2
       AND counts_at  >  ($3::timestamptz - make_interval(hours => $4::int))
       AND counts_at  <= $3::timestamptz
       AND (
             status IN ('SETTLED', 'SUBMITTING', 'OUTCOME_UNKNOWN')
             OR (status IN ('RESERVED', 'AUTHORIZED') AND expires_at > $3::timestamptz)
           )
  ),
  legacy AS (
    SELECT COALESCE(SUM((pa.payload ->> 'amount')::numeric), 0) AS total
      FROM audit_log al
      JOIN proposed_action pa ON pa.action_id = al.action_id
      LEFT JOIN payment_reservation r ON r.audit_id = al.audit_id
     WHERE $1 = 'mandate:' || al.mandate_id
       AND pa.payload ->> 'currency' = $2
       AND al.settlement ->> 'status' = 'settled'
       AND r.reservation_id IS NULL
       AND al.evaluated_at >  ($3::timestamptz - make_interval(hours => $4::int))
       AND al.evaluated_at <= $3::timestamptz
  )
  SELECT (SELECT total FROM reserved) + (SELECT total FROM legacy) AS committed
`;

/**
 * Committed spend against a budget authority: the left-hand side of the invariant.
 *
 * Exposed so the concurrency tests can assert the invariant directly against the
 * database rather than against the application's own bookkeeping.
 */
export async function committedSpend(options: {
  mandateId: string;
  currency: string;
  rollingWindow: string;
  at?: string;
}): Promise<string> {
  const { rows } = await getPool().query<{ committed: string }>(
    `SELECT c.committed::text AS committed FROM (${COMMITTED_SPEND_SQL}) c`,
    [
      budgetKeyForMandate(options.mandateId),
      options.currency,
      options.at ?? new Date().toISOString(),
      windowHours(options.rollingWindow),
    ],
  );
  return rows[0]!.committed;
}

/** Releases pre-broadcast reservations whose TTL has passed. Never touches SUBMITTING. */
async function expireWithin(client: PoolClient, budgetKey: string, at: string): Promise<void> {
  await client.query(
    `UPDATE payment_reservation
        SET status = 'EXPIRED', updated_at = $2::timestamptz
      WHERE budget_key = $1
        AND status = ANY($3)
        AND expires_at <= $2::timestamptz`,
    [budgetKey, at, PRE_BROADCAST_STATUSES],
  );
}

async function findLive(
  client: PoolClient,
  auditId: string,
  actionId: string,
): Promise<PaymentReservation | null> {
  const { rows } = await client.query(
    `SELECT ${COLUMNS}
       FROM payment_reservation
      WHERE (audit_id = $1 OR action_id = $2)
        AND status = ANY($3)
      ORDER BY created_at ASC
      LIMIT 1`,
    [auditId, actionId, LIVE_RESERVATION_STATUSES],
  );
  return rows[0] ? toReservation(rows[0]) : null;
}

/**
 * Commits capacity for one proposal, atomically, against the shared budget.
 *
 *   BEGIN
 *     lock the budget authority        <- every competing request serialises here
 *     expire stale pre-broadcast holds
 *     return an existing live hold     <- idempotency: one proposal, one effect
 *     recompute settled + reserved
 *     capacity check                   <- all money arithmetic stays in NUMERIC
 *     INSERT the reservation
 *   COMMIT
 *
 * The transaction ends before any authorization is signed and long before x402 is
 * called, so no database transaction is ever open across a network round trip.
 */
export async function reserveBudget(input: ReserveBudgetInput): Promise<ReserveBudgetResult> {
  const at = input.at ?? new Date().toISOString();
  const ttlSeconds = input.ttlSeconds ?? 120;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > 3600) {
    throw new Error("reservation TTL must be between 1 and 3600 seconds");
  }
  const budgetKey = budgetKeyForMandate(input.mandateId);
  const hours = windowHours(input.rollingWindow);

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    // The whole point of Phase 2. Transaction-scoped, so it is released by COMMIT or
    // ROLLBACK — including when a connection dies — and it is taken on the mandate,
    // the real shared financial authority, rather than on the agent.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [budgetKey]);

    await expireWithin(client, budgetKey, at);

    const existing = await findLive(client, input.auditId, input.actionId);
    if (existing) {
      await client.query("COMMIT");
      return { outcome: "existing", reservation: existing };
    }

    const { rows } = await client.query<{
      committed: string;
      requested: string;
      ceiling: string;
      fits: boolean;
    }>(
      `SELECT c.committed::text AS committed,
              $5::numeric::text AS requested,
              $6::numeric::text AS ceiling,
              (c.committed + $5::numeric) <= $6::numeric AS fits
         FROM (${COMMITTED_SPEND_SQL}) c`,
      [budgetKey, input.currency, at, hours, input.amountDecimal, input.maxTotal],
    );
    const capacity = rows[0]!;
    if (!capacity.fits) {
      await client.query("COMMIT");
      return {
        outcome: "insufficient_budget",
        committed: capacity.committed,
        requested: capacity.requested,
        limit: capacity.ceiling,
      };
    }

    const inserted = await client.query(
      `INSERT INTO payment_reservation (
         reservation_id, audit_id, action_id, agent_id, mandate_id, mandate_version,
         budget_key, currency, amount_decimal, amount_atomic, chain_id, token,
         status, authorization_id, settlement_tx,
         counts_at, expires_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::numeric, $10::numeric, $11, $12,
               'RESERVED', NULL, NULL,
               $13::timestamptz, $13::timestamptz + make_interval(secs => $14::int),
               $13::timestamptz, $13::timestamptz)
       RETURNING ${COLUMNS}`,
      [
        `res_${randomUUID()}`,
        input.auditId,
        input.actionId,
        input.agentId,
        input.mandateId,
        input.mandateVersion,
        budgetKey,
        input.currency,
        input.amountDecimal,
        input.amountAtomic,
        input.chainId,
        input.token,
        at,
        ttlSeconds,
      ],
    );
    await client.query("COMMIT");
    return { outcome: "created", reservation: toReservation(inserted.rows[0]!) };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);

    // The partial unique indexes are an independent guard, for any caller that ever
    // reaches this table without taking the budget lock. Losing that race is not an
    // error — it means somebody else already holds the capacity for this proposal.
    if ((error as { code?: string }).code === "23505") {
      // Never let the recovery read mask the original failure.
      const winner = await findLive(client, input.auditId, input.actionId).catch(() => null);
      if (winner) return { outcome: "existing", reservation: winner };
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Binds the one and only Execution Authorization this reservation will ever back.
 *
 * RESERVED -> AUTHORIZED, compare-and-set. A second authorization request for the
 * same audit loses here and gets null, which is what stops
 * "same audit -> AUTH A + AUTH B -> both execute". The database, not process memory,
 * is the source of truth for whether a proposal is committed to execution.
 */
export async function bindAuthorization(
  reservationId: string,
  authorizationId: string,
  at = new Date().toISOString(),
): Promise<PaymentReservation | null> {
  const { rows } = await getPool().query(
    `UPDATE payment_reservation
        SET status = 'AUTHORIZED', authorization_id = $2, updated_at = $3::timestamptz
      WHERE reservation_id = $1
        AND status = 'RESERVED'
        AND authorization_id IS NULL
        AND expires_at > $3::timestamptz
      RETURNING ${COLUMNS}`,
    [reservationId, authorizationId, at],
  );
  return rows[0] ? toReservation(rows[0]) : null;
}

/**
 * The durable one-shot boundary, crossed immediately before the payment key is used.
 *
 * AUTHORIZED -> SUBMITTING, compare-and-set on BOTH the reservation and the exact
 * authorization bound to it. Survives executor restarts and holds across multiple
 * executor processes, which process-local state cannot.
 */
export async function beginSubmission(
  reservationId: string,
  authorizationId: string,
  at = new Date().toISOString(),
): Promise<PaymentReservation | null> {
  const { rows } = await getPool().query(
    `UPDATE payment_reservation
        SET status = 'SUBMITTING', updated_at = $3::timestamptz
      WHERE reservation_id = $1
        AND authorization_id = $2
        AND status = 'AUTHORIZED'
      RETURNING ${COLUMNS}`,
    [reservationId, authorizationId, at],
  );
  return rows[0] ? toReservation(rows[0]) : null;
}

/** Known success. Capacity converts from reserved to settled; the total is unchanged. */
export async function markSettled(
  reservationId: string,
  settlementTx: string | null,
  at = new Date().toISOString(),
): Promise<void> {
  await getPool().query(
    `UPDATE payment_reservation
        SET status = 'SETTLED', settlement_tx = $2, updated_at = $3::timestamptz
      WHERE reservation_id = $1 AND status = 'SUBMITTING'`,
    [reservationId, settlementTx, at],
  );
}

/**
 * Positively known non-payment. This is the ONLY outcome-driven release.
 *
 * Reachable only from a settlement result that explicitly reported failure — never
 * from a thrown exception, which carries no evidence either way.
 */
export async function markFailed(
  reservationId: string,
  at = new Date().toISOString(),
): Promise<void> {
  await getPool().query(
    `UPDATE payment_reservation
        SET status = 'FAILED', updated_at = $2::timestamptz
      WHERE reservation_id = $1 AND status = 'SUBMITTING'`,
    [reservationId, at],
  );
}

/**
 * Ambiguous outcome: the payment may have been broadcast and accepted.
 *
 * Capacity stays held and is NOT released by TTL. Phase 5 adds the reconciler that
 * resolves these against chain state; until then the safe reading is that the money
 * might be gone, so the budget stays spent.
 */
export async function markOutcomeUnknown(
  reservationId: string,
  at = new Date().toISOString(),
): Promise<void> {
  await getPool().query(
    `UPDATE payment_reservation
        SET status = 'OUTCOME_UNKNOWN', updated_at = $2::timestamptz
      WHERE reservation_id = $1 AND status = 'SUBMITTING'`,
    [reservationId, at],
  );
}

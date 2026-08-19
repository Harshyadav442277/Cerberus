import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getPool } from "./pool.js";

/**
 * Trusted terminal finalization — Remediation 4.
 *
 * Before this module, the direct settlement path looked like:
 *
 *     executor proves settlement on chain
 *       -> payment_reservation = SETTLED
 *       -> response returned to the agent
 *         -> AGENT writes audit_log.settlement
 *         -> AGENT finalizes the anchor
 *
 * The money was safe from duplicate execution, but financial truth and audit truth
 * were only consistent if the agent came back and said so. A crash, a dropped
 * connection, or simply a hostile agent choosing not to call left the reservation
 * SETTLED and the audit settlement NULL — a system that had moved money and could
 * not say so in its own audit log.
 *
 * Both halves are now written by whichever trusted process proved the outcome, in
 * ONE transaction, together with a durable request to anchor the result:
 *
 *     BEGIN
 *       payment_reservation -> terminal status (compare-and-set)
 *       audit_log.settlement -> the same chain-derived terminal result
 *       audit_finalization  -> INSERT pending outbox row
 *     COMMIT
 *
 * Nothing here depends on an agent callback, and nothing here can be reached by the
 * agent's database role.
 */

export type TerminalOutcome = "settled" | "failed";

export interface TerminalSettlementInput {
  reservationId: string;
  outcome: TerminalOutcome;
  /** Chain-derived transaction hash. Required for settled, absent for failed. */
  settlementTx?: string | null;
  /** Fencing token, when the caller is the reconciler holding a lease. */
  reconciliationToken?: string;
  /** Which reservation status this transition is permitted to move from. */
  from: "SUBMITTING" | "RECONCILING";
  reason?: string;
  at?: string;
}

export interface TerminalSettlementResult {
  /** False means this caller lost the compare-and-set. It must not report an outcome. */
  won: boolean;
  auditId: string | null;
  /** True when THIS transaction wrote the audit settlement rather than finding one. */
  auditWritten: boolean;
}

/** The Section 7.5 settlement value, derived from proven chain state only. */
function settlementJson(
  outcome: TerminalOutcome,
  settlementTx: string | null,
  at: string,
): string {
  return JSON.stringify(
    outcome === "settled"
      ? { status: "settled", tx_hash: settlementTx, rail: "x402", settled_at: at }
      : { status: "failed", tx_hash: null, rail: "x402", settled_at: null },
  );
}

/**
 * Records a durable request to anchor a record's terminal state.
 *
 * Idempotent by primary key: enqueuing twice is one row, so a retried finalizer and
 * a duplicate worker cannot produce two logical anchor jobs. Callers pass only an
 * audit_id — the worker re-reads the stored record and computes the digest itself,
 * which is what keeps this operation non-authoritative.
 */
export async function enqueueAuditFinalization(
  auditId: string,
  client?: PoolClient,
): Promise<void> {
  const runner = client ?? getPool();
  await runner.query(
    `INSERT INTO audit_finalization (audit_id) VALUES ($1)
     ON CONFLICT (audit_id) DO NOTHING`,
    [auditId],
  );
}

/**
 * Moves a reservation to its terminal state and writes the matching audit truth.
 *
 * Returns `won: false` rather than throwing when the compare-and-set matches no row.
 * A zero-row terminal UPDATE is never ignored: it means another process — the direct
 * executor, or a reconciliation worker whose lease this caller no longer holds —
 * already resolved this payment. Reporting an outcome after losing that race is
 * exactly how a stale worker overwrites fresh truth, so the caller is told it lost.
 */
export async function terminalizeSettlement(
  input: TerminalSettlementInput,
): Promise<TerminalSettlementResult> {
  const at = input.at ?? new Date().toISOString();
  const settlementTx = input.outcome === "settled" ? (input.settlementTx ?? null) : null;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    // The compare-and-set. The expected source status must still match and, when the
    // caller is a leased reconciliation worker, so must its fencing token. Both
    // statements below are literal rather than assembled, so what executes is what
    // can be read here.
    const status = input.outcome === "settled" ? "SETTLED" : "FAILED";
    const changed =
      input.reconciliationToken === undefined
        ? await client.query<{ audit_id: string }>(
            `UPDATE payment_reservation
                SET status = $4,
                    settlement_tx = COALESCE($2, settlement_tx),
                    reconcile_after = NULL,
                    reconciliation_token = NULL,
                    updated_at = $3::timestamptz
              WHERE reservation_id = $1 AND status = $5
              RETURNING audit_id`,
            [input.reservationId, settlementTx, at, status, input.from],
          )
        : await client.query<{ audit_id: string }>(
            `UPDATE payment_reservation
                SET status = $4,
                    settlement_tx = COALESCE($2, settlement_tx),
                    reconcile_after = NULL,
                    reconciliation_token = NULL,
                    reconciliation_error = $7,
                    updated_at = $3::timestamptz
              WHERE reservation_id = $1 AND status = $5
                AND reconciliation_token = $6
              RETURNING audit_id`,
            [
              input.reservationId,
              settlementTx,
              at,
              status,
              input.from,
              input.reconciliationToken,
              input.reason ?? null,
            ],
          );

    if (!changed.rows[0]) {
      await client.query("ROLLBACK");
      return { won: false, auditId: null, auditWritten: false };
    }
    const auditId = changed.rows[0].audit_id;

    // Audit truth, written from the same proven outcome in the same transaction.
    // `settlement IS NULL` keeps this a compare-and-set too: an audit that already
    // carries a terminal result is never rewritten by a later writer.
    const audit = await client.query(
      `UPDATE audit_log SET settlement = $2::jsonb
        WHERE audit_id = $1 AND settlement IS NULL`,
      [auditId, settlementJson(input.outcome, settlementTx, at)],
    );

    // The durable anchor request, committed atomically with the truth it describes.
    await enqueueAuditFinalization(auditId, client);

    await client.query("COMMIT");
    return { won: true, auditId, auditWritten: (audit.rowCount ?? 0) === 1 };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export interface AuditFinalizationRow {
  audit_id: string;
  status: "PENDING" | "ANCHORING" | "DONE" | "FAILED";
  attempts: number;
  lease_token: string | null;
  lease_expires_at: string | null;
  next_attempt_at: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

const FINALIZATION_COLUMNS = `audit_id, status, attempts, lease_token, lease_expires_at,
  next_attempt_at, last_error, created_at, updated_at`;

/**
 * Claims one outbox row under a lease, for exactly one worker.
 *
 * `FOR UPDATE SKIP LOCKED` is what makes duplicate workers safe: two workers started
 * at the same instant take different rows rather than both taking the first one. A
 * worker that crashes mid-anchor leaves its lease behind, and the row becomes
 * claimable again once `lease_expires_at` passes — which is what makes crash
 * recovery automatic rather than manual.
 */
export async function claimAuditFinalization(options: {
  at?: string;
  leaseSeconds?: number;
} = {}): Promise<AuditFinalizationRow | null> {
  const at = options.at ?? new Date().toISOString();
  const leaseSeconds = options.leaseSeconds ?? 30;
  const token = `fin_${randomUUID()}`;
  const { rows } = await getPool().query<AuditFinalizationRow>(
    `UPDATE audit_finalization
        SET status = 'ANCHORING',
            attempts = attempts + 1,
            lease_token = $2,
            lease_expires_at = $1::timestamptz + make_interval(secs => $3::int),
            updated_at = $1::timestamptz
      WHERE audit_id = (
        SELECT audit_id FROM audit_finalization
         WHERE next_attempt_at <= $1::timestamptz
           AND (
                 status = 'PENDING'
                 OR (status = 'ANCHORING' AND lease_expires_at <= $1::timestamptz)
               )
         ORDER BY next_attempt_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
      )
      RETURNING ${FINALIZATION_COLUMNS}`,
    [at, token, leaseSeconds],
  );
  return rows[0] ?? null;
}

/** Terminal success, fenced on the lease this worker still holds. */
export async function markFinalizationDone(
  auditId: string,
  leaseToken: string,
  at = new Date().toISOString(),
): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `UPDATE audit_finalization
        SET status = 'DONE', lease_token = NULL, lease_expires_at = NULL,
            last_error = NULL, updated_at = $3::timestamptz
      WHERE audit_id = $1 AND lease_token = $2`,
    [auditId, leaseToken, at],
  );
  return (rowCount ?? 0) === 1;
}

/** Returns the row to the queue after a failed attempt, with backoff. */
export async function deferFinalization(
  auditId: string,
  leaseToken: string,
  nextAttemptAt: string,
  error: string,
  at = new Date().toISOString(),
): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `UPDATE audit_finalization
        SET status = 'PENDING', lease_token = NULL, lease_expires_at = NULL,
            next_attempt_at = $3::timestamptz, last_error = $4, updated_at = $5::timestamptz
      WHERE audit_id = $1 AND lease_token = $2`,
    [auditId, leaseToken, nextAttemptAt, error.slice(0, 500), at],
  );
  return (rowCount ?? 0) === 1;
}

export async function getAuditFinalization(
  auditId: string,
): Promise<AuditFinalizationRow | null> {
  const { rows } = await getPool().query<AuditFinalizationRow>(
    `SELECT ${FINALIZATION_COLUMNS} FROM audit_finalization WHERE audit_id = $1`,
    [auditId],
  );
  return rows[0] ?? null;
}

export async function listAuditFinalizations(): Promise<AuditFinalizationRow[]> {
  const { rows } = await getPool().query<AuditFinalizationRow>(
    `SELECT ${FINALIZATION_COLUMNS} FROM audit_finalization ORDER BY created_at`,
  );
  return rows;
}

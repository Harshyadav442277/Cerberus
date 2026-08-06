import { getPool } from "@safr/db";

/** The anchor row stored alongside the Section 7.5 record (Architecture 6.1). */
export interface AuditAnchorRow {
  audit_id: string;
  record_hash: string;
  anchor_tx_hash: string | null;
  status: "pending" | "anchored" | "failed";
  created_at: string;
  anchored_at: string | null;
  error: string | null;
}

const ANCHOR_COLUMNS = `audit_id, record_hash, anchor_tx_hash, status, created_at, anchored_at, error`;

/** Records the digest immediately, before any network call is attempted. */
export async function insertPendingAnchor(
  auditId: string,
  recordHash: string,
  createdAt: string,
): Promise<void> {
  await getPool().query(
    `INSERT INTO audit_anchor (audit_id, record_hash, status, created_at)
     VALUES ($1, $2, 'pending', $3)
     ON CONFLICT (audit_id) DO UPDATE SET
       record_hash = EXCLUDED.record_hash,
       status      = 'pending',
       created_at  = EXCLUDED.created_at,
       error       = NULL`,
    [auditId, recordHash, createdAt],
  );
}

export async function markAnchored(
  auditId: string,
  anchorTxHash: string,
  anchoredAt: string,
): Promise<void> {
  await getPool().query(
    `UPDATE audit_anchor
        SET status = 'anchored', anchor_tx_hash = $2, anchored_at = $3, error = NULL
      WHERE audit_id = $1`,
    [auditId, anchorTxHash, anchoredAt],
  );
}

/**
 * A failed anchor is recorded, not thrown away.
 *
 * The record itself stays perfectly valid — only its on-chain proof is missing, and
 * the row says exactly why so it can be retried or explained.
 */
export async function markAnchorFailed(auditId: string, error: string): Promise<void> {
  await getPool().query(
    `UPDATE audit_anchor SET status = 'failed', error = $2 WHERE audit_id = $1`,
    [auditId, error.slice(0, 500)],
  );
}

export async function getAnchor(auditId: string): Promise<AuditAnchorRow | null> {
  const { rows } = await getPool().query<AuditAnchorRow>(
    `SELECT ${ANCHOR_COLUMNS} FROM audit_anchor WHERE audit_id = $1`,
    [auditId],
  );
  return rows[0] ?? null;
}

export async function listAnchorsByStatus(
  status: AuditAnchorRow["status"],
): Promise<AuditAnchorRow[]> {
  const { rows } = await getPool().query<AuditAnchorRow>(
    `SELECT ${ANCHOR_COLUMNS} FROM audit_anchor WHERE status = $1 ORDER BY created_at`,
    [status],
  );
  return rows;
}

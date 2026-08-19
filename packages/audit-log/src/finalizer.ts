import type { AuditLogRecord } from "@safr/core";
import {
  claimAuditFinalization,
  deferFinalization,
  getAuditLogRecord,
  markFinalizationDone,
  type AuditFinalizationRow,
} from "@safr/db";
import type { AnchorClient } from "./anchor.js";
import { auditRecordHash } from "./canonical.js";
import { insertPendingAnchor, markAnchorFailed, markAnchored } from "./repository.js";

/**
 * The trusted audit-finalization worker — Remediation 4C.
 *
 * This is the ONLY component that authors final audit proof. It holds the anchor
 * signer, which the untrusted agent process does not have and cannot load, and it
 * has no payment signing authority and no ability to change financial truth: its
 * database role grants SELECT on audit_log and writes to audit_anchor and the
 * outbox, and nothing else.
 *
 * The critical property is that it re-derives everything it anchors:
 *
 *     outbox row says only "audit_id"
 *       -> worker re-reads the stored record from Postgres
 *         -> worker computes keccak256(canonical_json(record)) itself
 *           -> worker writes the digest on chain
 *
 * A hostile agent can therefore ask for a record to be anchored, but cannot choose
 * WHAT is anchored. The digest always describes the row as actually stored.
 *
 * Crash safety comes from the lease, exactly as reconciliation does it: a worker that
 * dies mid-anchor leaves an ANCHORING row whose lease expires, and the next worker
 * reclaims it. Duplicate workers are safe because the claim uses FOR UPDATE SKIP
 * LOCKED and every terminal write is fenced on the lease token. Re-anchoring the same
 * digest is harmless by design — AuditAnchor is deliberately non-deduplicating and
 * anchoring the same record twice is valid.
 */

export type FinalizationRunResult =
  | { outcome: "idle" }
  | { outcome: "anchored"; auditId: string; recordHash: string; txHash: string }
  | { outcome: "stored_only"; auditId: string; recordHash: string }
  | { outcome: "deferred" | "lost_lease" | "missing_record"; auditId: string };

export interface FinalizationStore {
  claim(options?: { at?: string; leaseSeconds?: number }): Promise<AuditFinalizationRow | null>;
  done(auditId: string, leaseToken: string, at?: string): Promise<boolean>;
  defer(
    auditId: string,
    leaseToken: string,
    nextAttemptAt: string,
    error: string,
    at?: string,
  ): Promise<boolean>;
}

export const POSTGRES_FINALIZATION_STORE: FinalizationStore = {
  claim: claimAuditFinalization,
  done: markFinalizationDone,
  defer: deferFinalization,
};

export interface AnchorRecordStore {
  insertPendingAnchor(auditId: string, recordHash: string, createdAt: string): Promise<void>;
  markAnchored(auditId: string, anchorTxHash: string, anchoredAt: string): Promise<void>;
  markAnchorFailed(auditId: string, error: string): Promise<void>;
}

const POSTGRES_ANCHOR_STORE: AnchorRecordStore = {
  insertPendingAnchor,
  markAnchored,
  markAnchorFailed,
};

export interface FinalizeOneOptions {
  /** Null means anchoring is not configured: digests are stored, the chain is skipped. */
  client: AnchorClient | null;
  store?: FinalizationStore;
  anchors?: AnchorRecordStore;
  nowMs?: () => number;
  /** Backoff before a failed anchor is retried. */
  retryDelayMs?: number;
  /**
   * How the stored record is read back. Injectable so the worker's decisions can be
   * tested deterministically; the digest is always derived from whatever this
   * returns, never from the outbox row.
   */
  readRecord?: (auditId: string) => Promise<AuditLogRecord | null>;
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

/** Claims and finalizes at most one record. Safe to call from many processes. */
export async function finalizeOne(
  options: FinalizeOneOptions,
): Promise<FinalizationRunResult> {
  const store = options.store ?? POSTGRES_FINALIZATION_STORE;
  const anchors = options.anchors ?? POSTGRES_ANCHOR_STORE;
  const nowMs = options.nowMs?.() ?? Date.now();
  const at = new Date(nowMs).toISOString();
  const retryDelayMs = options.retryDelayMs ?? 30_000;

  const job = await store.claim({ at, leaseSeconds: 30 });
  if (!job) return { outcome: "idle" };
  const lease = job.lease_token;
  if (!lease) throw new Error("claimed finalization has no fencing token");

  // Re-read the record as stored. This is what makes the agent's enqueue
  // non-authoritative: whatever it asked for, the digest describes the real row.
  const record = await (options.readRecord ?? getAuditLogRecord)(job.audit_id);
  if (record === null) {
    await store.defer(job.audit_id, lease, new Date(nowMs + retryDelayMs).toISOString(),
      "audit record not found", at);
    return { outcome: "missing_record", auditId: job.audit_id };
  }

  const recordHash = auditRecordHash(record);

  // The digest is stored before any network call, so even a total RPC outage still
  // leaves a verifiable hash in Postgres. Idempotent on conflict.
  try {
    await anchors.insertPendingAnchor(job.audit_id, recordHash, at);
  } catch (error) {
    const changed = await store.defer(
      job.audit_id,
      lease,
      new Date(nowMs + retryDelayMs).toISOString(),
      `could not store digest: ${errorText(error)}`,
      at,
    );
    return { outcome: changed ? "deferred" : "lost_lease", auditId: job.audit_id };
  }

  if (options.client === null) {
    // Anchoring is not configured. The digest is durable, so this is a completed
    // job rather than a failure, and the row is not left circling the queue.
    const changed = await store.done(job.audit_id, lease, at);
    return changed
      ? { outcome: "stored_only", auditId: job.audit_id, recordHash }
      : { outcome: "lost_lease", auditId: job.audit_id };
  }

  let txHash: `0x${string}`;
  try {
    txHash = await options.client.anchor(recordHash);
  } catch (error) {
    await anchors.markAnchorFailed(job.audit_id, errorText(error)).catch(() => undefined);
    const changed = await store.defer(
      job.audit_id,
      lease,
      new Date(nowMs + retryDelayMs).toISOString(),
      errorText(error),
      at,
    );
    return { outcome: changed ? "deferred" : "lost_lease", auditId: job.audit_id };
  }

  await anchors.markAnchored(job.audit_id, txHash, at);
  // Fenced: a worker whose lease was reclaimed while it was anchoring does not get to
  // mark the job done. The anchor itself is already durable and re-anchoring is safe.
  const changed = await store.done(job.audit_id, lease, at);
  return changed
    ? { outcome: "anchored", auditId: job.audit_id, recordHash, txHash }
    : { outcome: "lost_lease", auditId: job.audit_id };
}

/** Drains the outbox until it is idle. Used by the demo CLI and the worker loop. */
export async function drainFinalizations(
  options: FinalizeOneOptions & { maxJobs?: number },
): Promise<FinalizationRunResult[]> {
  const maxJobs = options.maxJobs ?? 100;
  const results: FinalizationRunResult[] = [];
  for (let index = 0; index < maxJobs; index += 1) {
    const result = await finalizeOne(options);
    if (result.outcome === "idle") break;
    results.push(result);
    // A deferred job is scheduled into the future; continuing would spin on rows that
    // are not due yet, so stop and let the next tick pick them up.
    if (result.outcome === "deferred" || result.outcome === "missing_record") break;
  }
  return results;
}

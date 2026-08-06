import type { AuditLogRecord } from "@safr/core";
import type { AnchorClient } from "./anchor.js";
import { auditRecordHash } from "./canonical.js";
import { insertPendingAnchor, markAnchorFailed, markAnchored } from "./repository.js";

/**
 * Asynchronous, non-blocking anchoring.
 *
 * Architecture 6.1: "Anchoring is asynchronous and non-blocking — a slow or failed
 * anchor must never stall or fail a disposition." That is a hard requirement, so this
 * module is written so the failure path is the boring one:
 *
 *   - `enqueue()` never awaits the chain and never throws. It computes the digest,
 *     writes a `pending` row, and returns.
 *   - The network call happens on a detached promise whose rejection is caught and
 *     written to the row as `failed`.
 *   - If anchoring is not configured at all, the digest is still stored as `pending`,
 *     so records anchored later are not lost.
 *
 * The digest is computed synchronously and stored before any network call, so even a
 * total RPC outage still leaves a verifiable hash in Postgres.
 */

export interface AnchorQueue {
  /** Fire-and-forget. Returns the digest, never throws, never awaits the chain. */
  enqueue(record: AuditLogRecord): `0x${string}`;
  /** Test/CLI helper: resolves once in-flight anchors have settled. */
  drain(): Promise<void>;
  /** Anchors in flight right now. */
  inFlight(): number;
}

/** The persistence the queue needs, injected so the queue is testable without a database. */
export interface AnchorStore {
  insertPendingAnchor(auditId: string, recordHash: string, createdAt: string): Promise<void>;
  markAnchored(auditId: string, anchorTxHash: string, anchoredAt: string): Promise<void>;
  markAnchorFailed(auditId: string, error: string): Promise<void>;
}

const POSTGRES_STORE: AnchorStore = { insertPendingAnchor, markAnchored, markAnchorFailed };

export interface AnchorQueueOptions {
  /** Null disables the network step; digests are still computed and stored. */
  client: AnchorClient | null;
  store?: AnchorStore;
  onError?: (auditId: string, error: Error) => void;
  now?: () => string;
}

export function createAnchorQueue(options: AnchorQueueOptions): AnchorQueue {
  const now = options.now ?? (() => new Date().toISOString());
  const store = options.store ?? POSTGRES_STORE;
  const pending = new Set<Promise<void>>();

  function track(work: Promise<void>): void {
    const tracked = work.finally(() => pending.delete(tracked));
    pending.add(tracked);
  }

  async function persist(record: AuditLogRecord, recordHash: `0x${string}`): Promise<void> {
    try {
      await store.insertPendingAnchor(record.audit_id, recordHash, now());
    } catch (error) {
      options.onError?.(record.audit_id, error as Error);
      return;
    }

    if (options.client === null) return;

    try {
      const txHash = await options.client.anchor(recordHash);
      await store.markAnchored(record.audit_id, txHash, now());
    } catch (error) {
      const message = (error as Error).message;
      options.onError?.(record.audit_id, error as Error);
      // Best effort: if even recording the failure fails, swallow it. Nothing in
      // this path is permitted to surface into the disposition flow.
      await store.markAnchorFailed(record.audit_id, message).catch(() => undefined);
    }
  }

  return {
    enqueue(record: AuditLogRecord): `0x${string}` {
      const recordHash = auditRecordHash(record);
      track(persist(record, recordHash));
      return recordHash;
    },

    async drain(): Promise<void> {
      while (pending.size > 0) {
        await Promise.allSettled([...pending]);
      }
    },

    inFlight(): number {
      return pending.size;
    },
  };
}

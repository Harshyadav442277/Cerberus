import { ok, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuditLogRecord } from "@safr/core";
import { auditRecordHash } from "../canonical.js";
import { finalizeOne, type AnchorRecordStore, type FinalizationStore } from "../finalizer.js";
import type { AnchorClient } from "../anchor.js";

/**
 * The trusted anchor worker — Remediation 4C and the second half of Remediation 3.
 *
 * The property that matters most here is not throughput, it is that the worker
 * re-derives what it anchors. The outbox row an untrusted agent can write contains
 * one column: an audit_id. Everything anchored is computed by this worker from the
 * record as actually stored, so "please anchor this" can never become "anchor this
 * digest I made up".
 *
 * The database-level lease mechanics are proven against real PostgreSQL in
 * packages/db/src/__tests__/finalization.test.ts. These tests cover the worker's own
 * decision-making with injected stores, so failure modes like "the chain write threw"
 * can be exercised deterministically.
 */

const RECORD: AuditLogRecord = {
  audit_id: "audit_1",
  action_id: "action_1",
  agent_id: "agent_treasury_01",
  mandate_id: "mandate_001",
  mandate_version: 1,
  disposition: "ALLOW",
  reason: "within_mandate",
  rule_triggered: null,
  evaluated_at: "2026-08-18T10:00:00.100Z",
  human_review: null,
  settlement: null,
};

const TRUE_DIGEST = auditRecordHash(RECORD);
const TX = `0x${"ab".repeat(32)}` as const;

function job(overrides: Record<string, unknown> = {}) {
  return {
    audit_id: RECORD.audit_id,
    status: "ANCHORING" as const,
    attempts: 1,
    lease_token: "fin_lease_1",
    lease_expires_at: "2026-08-18T10:00:30.000Z",
    next_attempt_at: "2026-08-18T10:00:00.000Z",
    last_error: null,
    created_at: "2026-08-18T10:00:00.000Z",
    updated_at: "2026-08-18T10:00:00.000Z",
    ...overrides,
  };
}

function stores(options: { claim?: ReturnType<typeof job> | null; doneWins?: boolean } = {}) {
  const calls = {
    done: [] as string[],
    deferred: [] as Array<{ auditId: string; error: string }>,
    pending: [] as Array<{ auditId: string; hash: string }>,
    anchored: [] as Array<{ auditId: string; tx: string }>,
    failed: [] as string[],
  };
  let claimed = false;
  const finalization: FinalizationStore = {
    async claim() {
      if (claimed) return null;
      claimed = true;
      return options.claim === undefined ? job() : options.claim;
    },
    async done(auditId, leaseToken) {
      calls.done.push(`${auditId}:${leaseToken}`);
      return options.doneWins ?? true;
    },
    async defer(auditId, _leaseToken, _next, error) {
      calls.deferred.push({ auditId, error });
      return true;
    },
  };
  const anchors: AnchorRecordStore = {
    async insertPendingAnchor(auditId, recordHash) {
      calls.pending.push({ auditId, hash: recordHash });
    },
    async markAnchored(auditId, tx) {
      calls.anchored.push({ auditId, tx });
    },
    async markAnchorFailed(auditId) {
      calls.failed.push(auditId);
    },
  };
  return { calls, finalization, anchors };
}

function anchorClient(impl?: () => Promise<`0x${string}`>): AnchorClient {
  return { anchor: impl ?? (async () => TX) };
}

describe("trusted anchor worker", () => {
  it("recomputes the digest from the stored record rather than trusting the request", async () => {
    // The outbox row names a record. It does not, and cannot, carry a digest — so the
    // only hash that can reach the chain is the one this worker derives itself.
    const { calls, finalization, anchors } = stores();
    const result = await finalizeOne({
      client: anchorClient(),
      store: finalization,
      anchors,
      async readRecord() { return RECORD; },
    });

    strictEqual(result.outcome, "anchored");
    ok(result.outcome === "anchored");
    strictEqual(result.recordHash, TRUE_DIGEST, "the digest is derived, not supplied");
    strictEqual(calls.pending[0]?.hash, TRUE_DIGEST, "stored before any network call");
    strictEqual(calls.anchored[0]?.tx, TX);
    strictEqual(calls.done.length, 1, "the job is retired under its lease");
  });

  it("recovers and anchors a job left behind by a crashed worker", async () => {
    // A reclaimed job is indistinguishable to this worker from a fresh one, which is
    // exactly what makes crash recovery automatic: attempts is simply higher.
    const { calls, finalization, anchors } = stores({
      claim: job({ attempts: 3, lease_token: "fin_lease_2", last_error: "worker died" }),
    });
    const result = await finalizeOne({
      client: anchorClient(),
      store: finalization,
      anchors,
      async readRecord() { return RECORD; },
    });

    strictEqual(result.outcome, "anchored");
    strictEqual(calls.anchored.length, 1, "the recovered job is anchored");
    strictEqual(calls.done[0], `${RECORD.audit_id}:fin_lease_2`, "fenced on the CURRENT lease");
  });

  it("does not mark a job done when the chain write failed", async () => {
    // The dangerous failure is a worker that treats a failed anchor as finished: the
    // digest would never reach the chain and nothing would ever retry it.
    const { calls, finalization, anchors } = stores();
    const result = await finalizeOne({
      client: anchorClient(async () => {
        throw new Error("replacement transaction underpriced");
      }),
      store: finalization,
      anchors,
      async readRecord() { return RECORD; },
    });

    strictEqual(result.outcome, "deferred");
    strictEqual(calls.done.length, 0, "a failed anchor is never retired");
    strictEqual(calls.failed.length, 1, "the failure is recorded on the anchor row");
    ok(calls.deferred[0]?.error.includes("underpriced"), "the reason is kept for the retry");
    strictEqual(calls.pending[0]?.hash, TRUE_DIGEST, "the digest is durable even so");
  });

  it("stores the digest and completes when anchoring is not configured", async () => {
    // No signer available is a supported state: records keep a verifiable digest in
    // Postgres, and the job does not circle the queue forever pretending to retry.
    const { calls, finalization, anchors } = stores();
    const result = await finalizeOne({
      client: null,
      store: finalization,
      anchors,
      async readRecord() { return RECORD; },
    });

    strictEqual(result.outcome, "stored_only");
    strictEqual(calls.pending[0]?.hash, TRUE_DIGEST);
    strictEqual(calls.anchored.length, 0, "nothing was written to a chain");
    strictEqual(calls.done.length, 1);
  });

  it("reports idle when the outbox is empty", async () => {
    const { finalization, anchors } = stores({ claim: null });
    const result = await finalizeOne({
      client: anchorClient(),
      store: finalization,
      anchors,
      async readRecord() { return RECORD; },
    });
    strictEqual(result.outcome, "idle");
  });

  it("reports a lost lease instead of claiming the job was completed", async () => {
    const { finalization, anchors } = stores({ doneWins: false });
    const result = await finalizeOne({
      client: anchorClient(),
      store: finalization,
      anchors,
      async readRecord() { return RECORD; },
    });
    strictEqual(result.outcome, "lost_lease", "a fenced-out worker does not report success");
  });
});

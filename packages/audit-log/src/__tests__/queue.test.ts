import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AnchorClient } from "../anchor.js";
import { auditRecordHash } from "../canonical.js";
import { createAnchorQueue, type AnchorStore } from "../queue.js";
import { ALLOW_RECORD, DENY_RECORD } from "./fixtures.js";

interface StoreSpy extends AnchorStore {
  pending: Array<{ auditId: string; recordHash: string }>;
  anchored: Array<{ auditId: string; txHash: string }>;
  failed: Array<{ auditId: string; error: string }>;
}

function storeSpy(overrides: Partial<AnchorStore> = {}): StoreSpy {
  const spy: StoreSpy = {
    pending: [],
    anchored: [],
    failed: [],
    async insertPendingAnchor(auditId, recordHash) {
      spy.pending.push({ auditId, recordHash });
    },
    async markAnchored(auditId, txHash) {
      spy.anchored.push({ auditId, txHash });
    },
    async markAnchorFailed(auditId, error) {
      spy.failed.push({ auditId, error });
    },
    ...overrides,
  };
  return spy;
}

const OK_CLIENT: AnchorClient = {
  async anchor() {
    return "0xdeadbeef";
  },
};

const BROKEN_CLIENT: AnchorClient = {
  async anchor() {
    throw new Error("connect ECONNREFUSED 127.0.0.1:1 (deliberately broken RPC)");
  },
};

describe("anchor queue — the happy path", () => {
  it("anchors the digest of the record and records the tx hash", async () => {
    const store = storeSpy();
    const queue = createAnchorQueue({ client: OK_CLIENT, store });

    const digest = queue.enqueue(ALLOW_RECORD);
    await queue.drain();

    assert.equal(digest, auditRecordHash(ALLOW_RECORD));
    assert.deepEqual(store.pending, [{ auditId: "audit_00000001", recordHash: digest }]);
    assert.deepEqual(store.anchored, [{ auditId: "audit_00000001", txHash: "0xdeadbeef" }]);
    assert.deepEqual(store.failed, []);
  });

  it("stores the digest before attempting the network call", async () => {
    // Ordering matters: an RPC that hangs forever must still leave a verifiable
    // hash in Postgres.
    const order: string[] = [];
    const store = storeSpy({
      async insertPendingAnchor() {
        order.push("pending");
      },
      async markAnchored() {
        order.push("anchored");
      },
    });
    const queue = createAnchorQueue({
      client: {
        async anchor() {
          order.push("rpc");
          return "0xfeed";
        },
      },
      store,
    });

    queue.enqueue(ALLOW_RECORD);
    await queue.drain();

    assert.deepEqual(order, ["pending", "rpc", "anchored"]);
  });

  it("anchors DENY records too, not just settled ones", async () => {
    const store = storeSpy();
    const queue = createAnchorQueue({ client: OK_CLIENT, store });
    queue.enqueue(DENY_RECORD);
    await queue.drain();
    assert.equal(store.anchored.length, 1);
  });
});

describe("anchor queue — non-blocking guarantee (Architecture 6.1)", () => {
  it("returns before the chain call completes", async () => {
    // enqueue() must be synchronous from the caller's point of view. If it awaited
    // the chain, a slow RPC would stall the disposition path.
    //
    // The deferred is built before the queue so resolving it cannot race the
    // queue's own internals: enqueue() writes the pending row first, so anchor()
    // has not been called yet at the moment enqueue() returns.
    let release: (value: `0x${string}`) => void = () => undefined;
    const neverUntilReleased = new Promise<`0x${string}`>((resolve) => {
      release = resolve;
    });

    const store = storeSpy();
    const queue = createAnchorQueue({ store, client: { anchor: () => neverUntilReleased } });

    const digest = queue.enqueue(ALLOW_RECORD);

    assert.match(digest, /^0x[0-9a-f]{64}$/, "digest is available immediately");
    assert.equal(queue.inFlight(), 1, "anchor is still outstanding");
    assert.deepEqual(store.anchored, [], "nothing anchored while the chain is slow");

    release("0xlate");
    await queue.drain();

    assert.equal(queue.inFlight(), 0);
    assert.deepEqual(store.anchored, [{ auditId: "audit_00000001", txHash: "0xlate" }]);
  });

  it("does not throw when the anchor RPC is broken", async () => {
    // This is the DoD check: point the RPC at something invalid and confirm the
    // disposition path is unaffected.
    const store = storeSpy();
    const queue = createAnchorQueue({ client: BROKEN_CLIENT, store });

    assert.doesNotThrow(() => queue.enqueue(DENY_RECORD));
    await assert.doesNotReject(() => queue.drain());

    assert.equal(store.pending.length, 1, "digest still persisted");
    assert.equal(store.anchored.length, 0);
    assert.equal(store.failed.length, 1, "failure recorded, not swallowed silently");
    assert.match(store.failed[0]!.error, /ECONNREFUSED/);
  });

  it("does not reject when even the failure write fails", async () => {
    const queue = createAnchorQueue({
      client: BROKEN_CLIENT,
      store: storeSpy({
        async markAnchorFailed() {
          throw new Error("database also down");
        },
      }),
    });

    queue.enqueue(ALLOW_RECORD);
    await assert.doesNotReject(() => queue.drain());
  });

  it("does not reject when the database is unreachable entirely", async () => {
    const errors: Error[] = [];
    const store = storeSpy({
      async insertPendingAnchor() {
        throw new Error("no connection to Postgres");
      },
    });
    const queue = createAnchorQueue({
      client: OK_CLIENT,
      store,
      onError: (_auditId, error) => errors.push(error),
    });

    queue.enqueue(ALLOW_RECORD);
    await assert.doesNotReject(() => queue.drain());

    assert.deepEqual(store.anchored, [], "no chain call once persistence failed");
    assert.equal(errors.length, 1, "the failure is surfaced to the caller's logger");
    assert.match(errors[0]!.message, /no connection to Postgres/);
  });

  it("skips the chain but still stores digests when anchoring is unconfigured", async () => {
    // The state the project is in until the wallet is funded: records must not be
    // lost just because there is nothing to anchor to yet.
    const store = storeSpy();
    const queue = createAnchorQueue({ client: null, store });

    const digest = queue.enqueue(ALLOW_RECORD);
    await queue.drain();

    assert.equal(store.pending[0]?.recordHash, digest);
    assert.deepEqual(store.anchored, []);
    assert.deepEqual(store.failed, [], "unconfigured is not a failure");
  });

  it("tracks concurrent anchors independently", async () => {
    const store = storeSpy();
    const queue = createAnchorQueue({ client: OK_CLIENT, store });

    queue.enqueue(ALLOW_RECORD);
    queue.enqueue(DENY_RECORD);
    assert.equal(queue.inFlight(), 2);

    await queue.drain();
    assert.equal(queue.inFlight(), 0);
    assert.equal(store.anchored.length, 2);
  });
});

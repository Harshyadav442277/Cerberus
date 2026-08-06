import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AUDIT_ANCHOR_ABI } from "../abi.js";
import { compileAuditAnchor } from "../compile.js";

/**
 * The contract cannot be exercised on chain until the wallet holds gas (Memory.md
 * B1), so these tests verify everything that can be checked without a network: that
 * it compiles, that the deployable bytecode is real, and that the hand-written ABI
 * consumers rely on matches what the compiler actually produced.
 */
describe("AuditAnchor", () => {
  const compiled = compileAuditAnchor();

  it("compiles without errors", () => {
    assert.ok(compiled.abi.length > 0);
  });

  it("produces deployable bytecode", () => {
    assert.match(compiled.bytecode, /^0x[0-9a-f]+$/);
    assert.ok(compiled.bytecode.length > 2, "bytecode must not be empty");
  });

  it("compiles deterministically", () => {
    assert.equal(compileAuditAnchor().bytecode, compiled.bytecode);
  });

  it("matches the hand-written ABI that consumers import", () => {
    // Without this, abi.ts could silently drift from the Solidity and every anchor
    // call would revert at runtime.
    //
    // Compared structurally rather than textually: solc emits keys in its own order
    // and lists entries in its own order, neither of which is meaningful.
    const sortKeys = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(sortKeys);
      if (value !== null && typeof value === "object") {
        return Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([key, entry]) => [key, sortKeys(entry)]),
        );
      }
      return value;
    };

    const normalise = (abi: readonly unknown[]) =>
      (sortKeys(abi) as unknown[])
        .map((entry) => JSON.stringify(entry))
        .sort();

    assert.deepEqual(normalise(compiled.abi), normalise(AUDIT_ANCHOR_ABI));
  });

  it("exposes anchor(bytes32) as the write entry point", () => {
    const anchor = AUDIT_ANCHOR_ABI.find(
      (entry) => entry.type === "function" && entry.name === "anchor",
    );
    assert.ok(anchor, "anchor() must exist");
    assert.deepEqual(
      anchor.inputs.map((input) => input.type),
      ["bytes32"],
      "anchors take a 32-byte digest and nothing else — no audit content on chain",
    );
  });

  it("emits an indexed Anchored event so a digest can be looked up by hash", () => {
    const event = AUDIT_ANCHOR_ABI.find(
      (entry) => entry.type === "event" && entry.name === "Anchored",
    );
    assert.ok(event);
    const recordHash = event.inputs.find((input) => input.name === "recordHash");
    assert.equal(recordHash?.indexed, true);
  });
});

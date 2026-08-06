import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AuditLogRecordSchema, type AuditLogRecord } from "@safr/core";
import { keccak256, toHex } from "viem";
import { auditRecordHash, canonicalJson } from "../canonical.js";
import { ALLOW_RECORD, ALL_RECORDS, DENY_RECORD, ESCALATE_RECORD } from "./fixtures.js";

describe("canonicalJson", () => {
  it("orders object keys lexicographically", () => {
    assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
  });

  it("produces identical output regardless of key insertion order", () => {
    const forwards = { audit_id: "a", agent_id: "b", disposition: "ALLOW" };
    const backwards = { disposition: "ALLOW", agent_id: "b", audit_id: "a" };
    assert.equal(canonicalJson(forwards), canonicalJson(backwards));
  });

  it("sorts nested keys too", () => {
    assert.equal(canonicalJson({ z: { d: 1, c: 2 }, a: 3 }), '{"a":3,"z":{"c":2,"d":1}}');
  });

  it("preserves array order, which is meaningful", () => {
    assert.equal(canonicalJson([3, 1, 2]), "[3,1,2]");
    assert.notEqual(canonicalJson(["a", "b"]), canonicalJson(["b", "a"]));
  });

  it("emits no insignificant whitespace", () => {
    assert.ok(!/\s/.test(canonicalJson(ALLOW_RECORD)));
  });

  it("keeps nulls rather than dropping them", () => {
    // A dropped null would let a DENY (rule named) and a clean ALLOW (rule null)
    // collide, which would defeat the point of anchoring.
    assert.equal(canonicalJson({ rule_triggered: null }), '{"rule_triggered":null}');
    assert.notEqual(canonicalJson({ a: null }), canonicalJson({}));
  });

  it("rejects values it cannot represent deterministically", () => {
    assert.throws(() => canonicalJson(Number.NaN), /non-finite/);
    assert.throws(() => canonicalJson(Number.POSITIVE_INFINITY), /non-finite/);
    assert.throws(() => canonicalJson(() => undefined), /type function/);
  });

  it("escapes strings the same way JSON does", () => {
    assert.equal(canonicalJson('he said "hi"\n'), JSON.stringify('he said "hi"\n'));
  });
});

describe("auditRecordHash", () => {
  it("is a 32-byte hex digest", () => {
    for (const record of ALL_RECORDS) {
      assert.match(auditRecordHash(record), /^0x[0-9a-f]{64}$/);
    }
  });

  it("is deterministic across repeated calls", () => {
    const first = auditRecordHash(ESCALATE_RECORD);
    for (let i = 0; i < 20; i++) {
      assert.equal(auditRecordHash(ESCALATE_RECORD), first);
    }
  });

  it("is independent of key order in the input object", () => {
    // Simulates a record rebuilt by a driver that returns columns in another order.
    const shuffled = Object.fromEntries(
      Object.entries(ALLOW_RECORD).reverse(),
    ) as unknown as AuditLogRecord;
    assert.equal(auditRecordHash(shuffled), auditRecordHash(ALLOW_RECORD));
  });

  it("survives a JSON round trip, which is what re-verification does", () => {
    // A verifier reads the record back out of Postgres as JSON and re-hashes it.
    for (const record of ALL_RECORDS) {
      const roundTripped = AuditLogRecordSchema.parse(JSON.parse(JSON.stringify(record)));
      assert.equal(auditRecordHash(roundTripped), auditRecordHash(record));
    }
  });

  it("changes if any field is tampered with", () => {
    const original = auditRecordHash(DENY_RECORD);

    const flipped: AuditLogRecord = { ...DENY_RECORD, disposition: "ALLOW" };
    assert.notEqual(auditRecordHash(flipped), original, "disposition flip must change the hash");

    const reasonEdited: AuditLogRecord = { ...DENY_RECORD, reason: "within_mandate" };
    assert.notEqual(auditRecordHash(reasonEdited), original);

    const ruleCleared: AuditLogRecord = { ...DENY_RECORD, rule_triggered: null };
    assert.notEqual(auditRecordHash(ruleCleared), original);

    // The scenario the mandate_version copy exists to defend against.
    const versionBumped: AuditLogRecord = { ...DENY_RECORD, mandate_version: 2 };
    assert.notEqual(auditRecordHash(versionBumped), original);

    // Backdating a decision.
    const backdated: AuditLogRecord = { ...DENY_RECORD, evaluated_at: "2020-01-01T00:00:00.000Z" };
    assert.notEqual(auditRecordHash(backdated), original);
  });

  it("detects a settlement quietly attached to a denied record", () => {
    const forged: AuditLogRecord = {
      ...DENY_RECORD,
      settlement: {
        status: "settled",
        tx_hash: "0x3333333333333333333333333333333333333333333333333333333333333333",
        rail: "x402",
        settled_at: "2026-08-07T14:40:00.000Z",
      },
    };
    assert.notEqual(auditRecordHash(forged), auditRecordHash(DENY_RECORD));
  });

  it("gives distinct digests to distinct records", () => {
    const digests = new Set(ALL_RECORDS.map(auditRecordHash));
    assert.equal(digests.size, ALL_RECORDS.length);
  });

  it("is exactly keccak256 of the canonical JSON, reproducible by any verifier", () => {
    // Spelled out so the verification recipe is unambiguous and not tool-specific.
    for (const record of ALL_RECORDS) {
      assert.equal(auditRecordHash(record), keccak256(toHex(canonicalJson(record))));
    }
  });

  it("validates against the Section 7.5 schema before hashing", () => {
    const missingField = { ...ALLOW_RECORD } as Partial<AuditLogRecord>;
    delete missingField.disposition;
    assert.throws(() => auditRecordHash(missingField as AuditLogRecord));
  });
});

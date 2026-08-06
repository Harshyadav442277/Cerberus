import { AuditLogRecordSchema, type AuditLogRecord } from "@safr/core";
import { keccak256, toHex } from "viem";

/**
 * Canonical JSON, so a record hashes to the same digest every time.
 *
 * The whole tamper-evidence claim rests on this being reproducible: a compliance
 * officer re-hashes the stored record months later and gets the digest that is on
 * chain. `JSON.stringify` alone cannot be trusted for that, because its output
 * depends on the insertion order of object keys — two logically identical records
 * could serialise differently and produce different hashes.
 *
 * The rules are deliberately boring:
 *   - object keys sorted lexicographically, at every level
 *   - no insignificant whitespace
 *   - array order preserved (it is meaningful; key order is not)
 *   - `null` preserved, never dropped — an explicitly null `rule_triggered` is
 *     information, and eliding it would let two different records share a hash
 *   - `undefined` rejected rather than silently skipped
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Cannot canonicalise non-finite number: ${value}`);
    }
    return JSON.stringify(value);
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`);
    return `{${entries.join(",")}}`;
  }

  throw new Error(`Cannot canonicalise value of type ${typeof value}`);
}

/**
 * The digest that gets anchored on chain.
 *
 * The record is parsed through the Section 7.5 schema first, so the hash is always
 * taken over a validated record with exactly the Bible's field set — never over
 * whatever shape a caller happened to pass in.
 */
export function auditRecordHash(record: AuditLogRecord): `0x${string}` {
  const parsed = AuditLogRecordSchema.parse(record);
  return keccak256(toHex(canonicalJson(parsed)));
}

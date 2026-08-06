/**
 * Demonstrates tamper-evidence against the real database, then undoes itself.
 *
 * The claim "the audit log is immutable" is only interesting if editing a record is
 * actually detectable. This script proves it end to end: take a real stored record,
 * verify its digest, silently edit it the way someone covering their tracks would,
 * and show the digest no longer reproduces.
 *
 * The whole thing runs inside a transaction that is always rolled back, so the audit
 * log is byte-for-byte unchanged afterwards. The final re-check confirms that.
 *
 * Run: npm run audit:tamper-demo
 */
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { AuditLogRecordSchema, type AuditLogRecord } from "@safr/core";
import { closePool, getPool } from "@safr/db";
import { auditRecordHash } from "../canonical.js";

loadEnv({ path: resolve(import.meta.dirname, "../../../../.env"), quiet: true });

const AUDIT_COLUMNS = `audit_id, action_id, agent_id, mandate_id, mandate_version,
  disposition, reason, rule_triggered, evaluated_at, human_review, settlement`;

async function main(): Promise<void> {
  const client = await getPool().connect();

  try {
    // Pick a DENY: the record someone would have the strongest motive to rewrite.
    const { rows: candidates } = await client.query<{ audit_id: string; record_hash: string }>(
      `SELECT a.audit_id, a.record_hash
         FROM audit_anchor a
         JOIN audit_log l ON l.audit_id = a.audit_id
        WHERE l.disposition = 'DENY'
        ORDER BY a.created_at DESC
        LIMIT 1`,
    );

    const target = candidates[0];
    if (!target) {
      console.log("\n  No anchored DENY record found. Run `npm run demo` first.\n");
      return;
    }

    const read = async (): Promise<AuditLogRecord> => {
      const { rows } = await client.query(
        `SELECT ${AUDIT_COLUMNS} FROM audit_log WHERE audit_id = $1`,
        [target.audit_id],
      );
      return AuditLogRecordSchema.parse(rows[0]);
    };

    console.log(`\n  Target record   ${target.audit_id}`);
    console.log(`  Anchored digest ${target.record_hash}\n`);

    const before = await read();
    const beforeHash = auditRecordHash(before);
    console.log(`  1. As stored     ${before.disposition} / ${before.rule_triggered}`);
    console.log(`     recomputed    ${beforeHash}`);
    console.log(`     ${beforeHash === target.record_hash ? "MATCHES the anchor" : "MISMATCH"}\n`);

    await client.query("BEGIN");

    // The edit an insider would make: turn a refusal into an approval.
    await client.query(
      `UPDATE audit_log
          SET disposition = 'ALLOW', reason = 'within_mandate', rule_triggered = NULL
        WHERE audit_id = $1`,
      [target.audit_id],
    );

    const after = await read();
    const afterHash = auditRecordHash(after);
    console.log(`  2. After tamper  ${after.disposition} / ${after.rule_triggered}`);
    console.log(`     recomputed    ${afterHash}`);
    console.log(`     ${afterHash === target.record_hash ? "MATCHES (BAD)" : "MISMATCH — tampering detected"}\n`);

    if (afterHash === target.record_hash) {
      throw new Error("Tampering was NOT detected. The anchor is not doing its job.");
    }

    await client.query("ROLLBACK");

    const restored = await read();
    const restoredHash = auditRecordHash(restored);
    console.log(`  3. After rollback ${restored.disposition} / ${restored.rule_triggered}`);
    console.log(`     recomputed    ${restoredHash}`);
    console.log(`     ${restoredHash === target.record_hash ? "MATCHES the anchor again" : "MISMATCH"}\n`);

    if (restoredHash !== target.record_hash) {
      throw new Error("Rollback failed — the audit log was left modified.");
    }

    console.log("  Any edit to a stored record breaks its digest. Nothing was left changed.\n");
  } finally {
    client.release();
  }
}

try {
  await main();
} catch (error) {
  console.error(`\n  ERROR ${(error as Error).message}\n`);
  process.exitCode = 1;
} finally {
  await closePool();
}

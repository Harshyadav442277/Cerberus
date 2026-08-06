/**
 * Re-verifies every anchored audit record against its stored digest.
 *
 * This is the tamper-evidence demonstration in executable form, and it is the
 * Phase 5 DoD check: read each record back out of Postgres, hash it again, and
 * confirm the result reproduces the digest that was anchored. If anyone edited a
 * record after the fact, its hash no longer matches and this reports MISMATCH.
 *
 * Run: npm run audit:verify
 */
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { getAuditLogRecord, closePool, getPool } from "@safr/db";
import { auditRecordHash } from "../canonical.js";
import type { AuditAnchorRow } from "../repository.js";

loadEnv({ path: resolve(import.meta.dirname, "../../../../.env"), quiet: true });

let failures = 0;

function report(status: "OK" | "MISMATCH" | "WARN", auditId: string, detail: string): void {
  if (status === "MISMATCH") failures++;
  const label = status.padEnd(8);
  console.log(`  ${label} ${auditId.padEnd(20)} ${detail}`);
}

async function main(): Promise<void> {
  const { rows: anchors } = await getPool().query<AuditAnchorRow>(
    `SELECT audit_id, record_hash, anchor_tx_hash, status, created_at, anchored_at, error
       FROM audit_anchor ORDER BY created_at`,
  );

  console.log(`\n  Verifying ${anchors.length} anchored record(s)\n`);

  if (anchors.length === 0) {
    console.log("  Nothing to verify. Run `npm run demo` first.\n");
    return;
  }

  for (const anchor of anchors) {
    const record = await getAuditLogRecord(anchor.audit_id);

    if (record === null) {
      // An anchor without a record means a record was deleted — exactly the kind
      // of tampering the anchor exists to expose.
      report("MISMATCH", anchor.audit_id, "anchored record no longer exists in audit_log");
      continue;
    }

    const recomputed = auditRecordHash(record);

    if (recomputed !== anchor.record_hash) {
      report("MISMATCH", anchor.audit_id, `stored ${anchor.record_hash} != recomputed ${recomputed}`);
      continue;
    }

    if (anchor.status === "anchored" && anchor.anchor_tx_hash) {
      report("OK", anchor.audit_id, `${recomputed.slice(0, 18)}… on chain ${anchor.anchor_tx_hash}`);
    } else if (anchor.status === "failed") {
      report("WARN", anchor.audit_id, `hash verified; not on chain — ${anchor.error ?? "unknown"}`);
    } else {
      report("WARN", anchor.audit_id, `hash verified; anchoring ${anchor.status}`);
    }
  }

  const onChain = anchors.filter((a) => a.status === "anchored").length;
  console.log(`\n  ${anchors.length - failures}/${anchors.length} records reproduce their digest`);
  console.log(`  ${onChain}/${anchors.length} anchored on Base Sepolia`);

  if (failures > 0) {
    console.log(`\n  ${failures} record(s) FAILED verification — audit log has been tampered with\n`);
    process.exitCode = 1;
  } else {
    console.log("\n  No tampering detected.\n");
  }
}

try {
  await main();
} finally {
  await closePool();
}

/**
 * Re-verifies every anchored audit record against Base Sepolia.
 *
 * Run: npm run audit:verify
 *
 * This does not trust the database about whether a record is on chain. For each
 * anchored row it recomputes the digest from the stored record, fetches the anchor
 * transaction's receipt from the RPC, checks the transaction succeeded and was sent
 * to the expected AuditAnchor contract, decodes the Anchored event, and requires the
 * digest read FROM THE CHAIN to equal both the recomputed digest and the one the
 * database recorded.
 *
 * Exit codes:
 *   0  every anchored record was proven on chain
 *   1  at least one record MISMATCHED, or could not be verified
 *
 * An RPC that cannot answer produces UNVERIFIED and a non-zero exit — never a pass.
 */
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { closePool, getAuditLogRecord, getPool } from "@safr/db";
import type { AuditAnchorRow } from "../repository.js";
import {
  createAnchorChainReader,
  verifyAnchorOnChain,
  type AnchorVerification,
} from "../verify-chain.js";

loadEnv({ path: resolve(import.meta.dirname, "../../../../.env"), quiet: true });

const BASE_SEPOLIA_CHAIN_ID = 84532;
const contractAddress = process.env.AUDIT_ANCHOR_ADDRESS?.trim() ?? "";
const rpcUrl = process.env.EVM_RPC_URL?.trim() || "https://sepolia.base.org";
const minConfirmations = BigInt(process.env.AUDIT_MIN_CONFIRMATIONS?.trim() || "0");

let mismatches = 0;
let unverified = 0;
let verified = 0;
let shallow = 0;

function report(result: AnchorVerification): void {
  if (result.status === "verified") {
    verified += 1;
    const depth = `${result.confirmations} conf`;
    const flag = result.belowConfirmationThreshold ? "  BELOW THRESHOLD" : "";
    console.log(
      `  VERIFIED ${result.auditId.padEnd(20)} ${result.digest.slice(0, 18)}…  ${result.txHash}  ${depth}${flag}`,
    );
    if (result.belowConfirmationThreshold) shallow += 1;
    return;
  }
  if (result.status === "mismatch") {
    mismatches += 1;
    console.log(`  MISMATCH ${result.auditId.padEnd(20)} ${result.reason} — ${result.detail}`);
    return;
  }
  unverified += 1;
  console.log(`  UNVERIF. ${result.auditId.padEnd(20)} ${result.reason} — ${result.detail}`);
}

async function main(): Promise<void> {
  const { rows: anchors } = await getPool().query<AuditAnchorRow>(
    `SELECT audit_id, record_hash, anchor_tx_hash, status, created_at, anchored_at, error
       FROM audit_anchor ORDER BY created_at`,
  );

  console.log(`\n  Verifying ${anchors.length} anchored record(s) against Base Sepolia`);
  console.log(`  contract  ${contractAddress || "(AUDIT_ANCHOR_ADDRESS not set)"}`);
  console.log(`  rpc       ${rpcUrl}\n`);

  if (anchors.length === 0) {
    console.log("  Nothing to verify. Run `npm run demo` first.\n");
    return;
  }

  if (!contractAddress) {
    // Without the contract address there is no way to tell a real anchor from a
    // transaction that merely exists, so this refuses rather than degrading to the
    // old database-only check.
    console.log("  AUDIT_ANCHOR_ADDRESS is not set — on-chain verification is impossible.\n");
    process.exitCode = 1;
    return;
  }

  const chain = createAnchorChainReader(rpcUrl);
  for (const anchor of anchors) {
    const record = await getAuditLogRecord(anchor.audit_id);
    report(
      await verifyAnchorOnChain(record, anchor, {
        contractAddress,
        expectedChainId: BASE_SEPOLIA_CHAIN_ID,
        chain,
        minConfirmations,
      }),
    );
  }

  console.log(`\n  ${verified}/${anchors.length} proven on chain`);
  if (unverified > 0) console.log(`  ${unverified} could not be verified`);
  if (mismatches > 0) console.log(`  ${mismatches} MISMATCHED`);
  if (shallow > 0) {
    console.log(`  ${shallow} below the ${minConfirmations}-confirmation threshold`);
  }

  if (mismatches > 0) {
    console.log(`\n  ${mismatches} record(s) FAILED verification — the audit log does not match the chain\n`);
    process.exitCode = 1;
  } else if (unverified > 0) {
    console.log("\n  Not all records could be proven. UNVERIFIED is not a pass.\n");
    process.exitCode = 1;
  } else {
    console.log("\n  Every anchored record is proven by its own on-chain transaction.\n");
  }
}

try {
  await main();
} finally {
  await closePool();
}

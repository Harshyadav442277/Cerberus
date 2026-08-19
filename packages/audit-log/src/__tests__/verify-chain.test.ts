import { ok, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuditLogRecord } from "@safr/core";
import { encodeAbiParameters, encodeEventTopics, parseAbiParameters } from "viem";
import { AUDIT_ANCHOR_ABI } from "@safr/contracts";
import { auditRecordHash } from "../canonical.js";
import type { AuditAnchorRow } from "../repository.js";
import {
  verifyAnchorOnChain,
  type AnchorChainReader,
  type AnchorTransactionReceipt,
} from "../verify-chain.js";

/**
 * Attack C — a fake on-chain anchor must not pass verification.
 *
 * The verifier this suite guards replaced one that re-hashed the stored record and
 * then printed "on chain <tx>" purely because `audit_anchor.status` said so. Every
 * value in that comparison came from the same database, so anyone who could write
 * that table could satisfy it completely.
 *
 * Each test below constructs a database that LOOKS correct and a chain that does not
 * agree with it. Verification must fail every time. The chain adapter is injected, so
 * these are deterministic and need no RPC, no signer and no network.
 */

const CONTRACT = "0x1111111111111111111111111111111111111111";
const OTHER_CONTRACT = "0x2222222222222222222222222222222222222222";
const CHAIN_ID = 84532;
const TX = `0x${"ab".repeat(32)}`;

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

/** A real Anchored log, encoded exactly as the contract would emit it. */
function anchoredLog(digest: string, address = CONTRACT) {
  const topics = encodeEventTopics({
    abi: AUDIT_ANCHOR_ABI,
    eventName: "Anchored",
    args: {
      recordHash: digest as `0x${string}`,
      submitter: "0x3333333333333333333333333333333333333333",
    },
  });
  return {
    address,
    topics: topics as unknown as string[],
    data: encodeAbiParameters(parseAbiParameters("uint256"), [1_800_000_000n]),
  };
}

function receipt(overrides: Partial<AnchorTransactionReceipt> = {}): AnchorTransactionReceipt {
  return {
    status: "success",
    to: CONTRACT,
    blockNumber: 1000n,
    logs: [anchoredLog(TRUE_DIGEST)],
    ...overrides,
  };
}

function chainReader(options: {
  receipt?: AnchorTransactionReceipt | null;
  chainId?: number;
  head?: bigint;
  throws?: Error;
} = {}): AnchorChainReader {
  return {
    async getChainId() {
      if (options.throws) throw options.throws;
      return options.chainId ?? CHAIN_ID;
    },
    async getTransactionReceipt() {
      if (options.throws) throw options.throws;
      return options.receipt === undefined ? receipt() : options.receipt;
    },
    async getBlockNumber() {
      if (options.throws) throw options.throws;
      return options.head ?? 1005n;
    },
  };
}

function anchor(overrides: Partial<AuditAnchorRow> = {}): AuditAnchorRow {
  return {
    audit_id: RECORD.audit_id,
    record_hash: TRUE_DIGEST,
    anchor_tx_hash: TX,
    status: "anchored",
    created_at: "2026-08-18T10:00:01.000Z",
    anchored_at: "2026-08-18T10:00:05.000Z",
    error: null,
    ...overrides,
  };
}

const OPTIONS = { contractAddress: CONTRACT, expectedChainId: CHAIN_ID };

describe("on-chain anchor verification", () => {
  it("verifies a record whose digest is genuinely on chain", async () => {
    const result = await verifyAnchorOnChain(RECORD, anchor(), {
      ...OPTIONS,
      chain: chainReader(),
    });
    strictEqual(result.status, "verified");
    ok(result.status === "verified");
    strictEqual(result.digest, TRUE_DIGEST);
    strictEqual(result.txHash, TX);
    strictEqual(result.confirmations, 6n, "depth is measured from the receipt's block");
  });

  it("detects a tampered audit record", async () => {
    // The classic tamper: edit the record after it was anchored. The stored digest is
    // untouched, so only recomputation exposes it.
    const tampered: AuditLogRecord = { ...RECORD, disposition: "ALLOW", reason: "edited_later" };
    const result = await verifyAnchorOnChain(tampered, anchor(), {
      ...OPTIONS,
      chain: chainReader(),
    });
    strictEqual(result.status, "mismatch");
    ok(result.status === "mismatch");
    strictEqual(result.reason, "RECORD_TAMPERED");
  });

  it("detects a deleted audit record", async () => {
    const result = await verifyAnchorOnChain(null, anchor(), { ...OPTIONS, chain: chainReader() });
    strictEqual(result.status, "mismatch");
    ok(result.status === "mismatch");
    strictEqual(result.reason, "RECORD_DELETED");
  });

  it("detects a database record_hash changed to match a tampered record", async () => {
    // The stronger attack: edit the record AND rewrite the stored digest so the two
    // agree. Only the chain can expose this, and it does.
    const tampered: AuditLogRecord = { ...RECORD, reason: "edited_later" };
    const consistentLie = anchor({ record_hash: auditRecordHash(tampered) });
    const result = await verifyAnchorOnChain(tampered, consistentLie, {
      ...OPTIONS,
      chain: chainReader(),
    });
    strictEqual(result.status, "mismatch");
    ok(result.status === "mismatch");
    strictEqual(result.reason, "DIGEST_NOT_ON_CHAIN", "the chain still holds the original digest");
  });

  it("detects an anchor_tx_hash swapped for an unrelated successful transaction", async () => {
    // A real, successful transaction to the real contract — but anchoring someone
    // else's digest.
    const unrelated = receipt({ logs: [anchoredLog(`0x${"cd".repeat(32)}`)] });
    const result = await verifyAnchorOnChain(RECORD, anchor(), {
      ...OPTIONS,
      chain: chainReader({ receipt: unrelated }),
    });
    strictEqual(result.status, "mismatch");
    ok(result.status === "mismatch");
    strictEqual(result.reason, "DIGEST_NOT_ON_CHAIN");
  });

  it("detects a transaction sent to the wrong contract", async () => {
    const wrongTarget = receipt({ to: OTHER_CONTRACT, logs: [anchoredLog(TRUE_DIGEST, OTHER_CONTRACT)] });
    const result = await verifyAnchorOnChain(RECORD, anchor(), {
      ...OPTIONS,
      chain: chainReader({ receipt: wrongTarget }),
    });
    strictEqual(result.status, "mismatch");
    ok(result.status === "mismatch");
    strictEqual(result.reason, "WRONG_CONTRACT");
  });

  it("ignores a look-alike Anchored event emitted by another address", async () => {
    // The transaction really did go to AuditAnchor, but the only correct-looking
    // event came from an unrelated contract in the same transaction.
    const spoofed = receipt({ logs: [anchoredLog(TRUE_DIGEST, OTHER_CONTRACT)] });
    const result = await verifyAnchorOnChain(RECORD, anchor(), {
      ...OPTIONS,
      chain: chainReader({ receipt: spoofed }),
    });
    strictEqual(result.status, "mismatch");
    ok(result.status === "mismatch");
    strictEqual(result.reason, "NO_ANCHOR_EVENT");
  });

  it("detects a failed transaction", async () => {
    const result = await verifyAnchorOnChain(RECORD, anchor(), {
      ...OPTIONS,
      chain: chainReader({ receipt: receipt({ status: "reverted" }) }),
    });
    strictEqual(result.status, "mismatch");
    ok(result.status === "mismatch");
    strictEqual(result.reason, "TRANSACTION_FAILED");
  });

  it("detects a nonexistent transaction", async () => {
    const result = await verifyAnchorOnChain(RECORD, anchor(), {
      ...OPTIONS,
      chain: chainReader({ receipt: null }),
    });
    strictEqual(result.status, "mismatch");
    ok(result.status === "mismatch");
    strictEqual(result.reason, "TRANSACTION_NOT_FOUND");
  });

  it("detects verification pointed at the wrong chain", async () => {
    const result = await verifyAnchorOnChain(RECORD, anchor(), {
      ...OPTIONS,
      chain: chainReader({ chainId: 1 }),
    });
    strictEqual(result.status, "mismatch");
    ok(result.status === "mismatch");
    strictEqual(result.reason, "WRONG_CHAIN");
  });

  it("reports RPC failure as UNVERIFIED rather than verified", async () => {
    // The most important negative result in this file. A verifier that treats "I
    // could not check" as "it is fine" is worse than no verifier, because it
    // manufactures confidence exactly when the evidence is missing.
    const result = await verifyAnchorOnChain(RECORD, anchor(), {
      ...OPTIONS,
      chain: chainReader({ throws: new Error("connect ECONNREFUSED") }),
    });
    strictEqual(result.status, "unverified");
    ok(result.status === "unverified");
    strictEqual(result.reason, "RPC_UNAVAILABLE");
  });

  it("reports a record that was never anchored as UNVERIFIED, not verified", async () => {
    const result = await verifyAnchorOnChain(RECORD, anchor({ status: "pending", anchor_tx_hash: null }), {
      ...OPTIONS,
      chain: chainReader(),
    });
    strictEqual(result.status, "unverified");
    ok(result.status === "unverified");
    strictEqual(result.reason, "NOT_ANCHORED");
  });

  it("reports a failed anchor as UNVERIFIED with its recorded reason", async () => {
    const result = await verifyAnchorOnChain(
      RECORD,
      anchor({ status: "failed", anchor_tx_hash: null, error: "insufficient funds" }),
      { ...OPTIONS, chain: chainReader() },
    );
    strictEqual(result.status, "unverified");
    ok(result.status === "unverified");
    ok(result.detail.includes("insufficient funds"));
  });

  it("flags an anchor shallower than the configured confirmation threshold", async () => {
    // Reported, not failed. The prototype proves exact successful inclusion; depth is
    // surfaced honestly so nobody reads inclusion as irreversibility.
    const result = await verifyAnchorOnChain(RECORD, anchor(), {
      ...OPTIONS,
      chain: chainReader({ head: 1001n }),
      minConfirmations: 12n,
    });
    strictEqual(result.status, "verified");
    ok(result.status === "verified");
    strictEqual(result.confirmations, 2n);
    strictEqual(result.belowConfirmationThreshold, true);
  });

  it("does not flag an anchor that meets the confirmation threshold", async () => {
    const result = await verifyAnchorOnChain(RECORD, anchor(), {
      ...OPTIONS,
      chain: chainReader({ head: 1020n }),
      minConfirmations: 12n,
    });
    strictEqual(result.status, "verified");
    ok(result.status === "verified");
    strictEqual(result.belowConfirmationThreshold, false);
  });
});

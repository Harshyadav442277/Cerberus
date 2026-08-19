import type { AuditLogRecord } from "@safr/core";
import { AUDIT_ANCHOR_ABI } from "@safr/contracts";
import {
  TransactionReceiptNotFoundError,
  createPublicClient,
  decodeEventLog,
  http,
  type Hex,
} from "viem";
import { baseSepolia } from "viem/chains";
import { auditRecordHash } from "./canonical.js";
import type { AuditAnchorRow } from "./repository.js";

/**
 * Independent on-chain verification of an audit anchor — Remediation 2.
 *
 * The previous verifier re-hashed the stored record, compared it against the digest
 * in `audit_anchor.record_hash`, and then printed "on chain <tx>" purely because the
 * same table said `status = 'anchored'`. Every value in that comparison came from one
 * database. An attacker who could write that table could therefore satisfy the
 * verifier completely, which makes it a checksum, not a proof.
 *
 * The chain is the thing that is supposed to be hard to rewrite, so the chain is what
 * gets read. The full proof chain is:
 *
 *     stored audit record
 *       -> canonical recomputed digest
 *
 *     anchor_tx_hash
 *       -> Base Sepolia RPC
 *         -> real transaction receipt (must exist, must have succeeded)
 *           -> emitted by the expected AuditAnchor contract
 *             -> carrying an Anchored event
 *               -> whose recordHash is read FROM THE CHAIN
 *
 * and then all three digests must be equal:
 *
 *     recomputed == database-recorded == chain-proven
 *
 * Anything else is a MISMATCH. An RPC that cannot answer produces UNVERIFIED — never
 * "verified", because not knowing is not the same as knowing it is fine.
 */

/** Read-only chain access. No signer: verification never needs one. */
export interface AnchorChainReader {
  /** The chain this reader is connected to. Guards against verifying the wrong chain. */
  getChainId(): Promise<number>;
  getTransactionReceipt(txHash: string): Promise<AnchorTransactionReceipt | null>;
  /** Latest block height, for the confirmation-depth report. */
  getBlockNumber(): Promise<bigint>;
}

export interface AnchorTransactionReceipt {
  status: "success" | "reverted";
  /** The contract the transaction was sent to. Null for contract creation. */
  to: string | null;
  blockNumber: bigint;
  logs: Array<{ address: string; topics: string[]; data: string }>;
}

export type AnchorVerification =
  | {
      status: "verified";
      auditId: string;
      digest: string;
      txHash: string;
      blockNumber: bigint;
      confirmations: bigint;
      /** True when the anchor is not yet as deep as the configured threshold. */
      belowConfirmationThreshold: boolean;
    }
  | { status: "mismatch"; auditId: string; reason: string; detail: string }
  /** The chain could not be consulted. Explicitly NOT a pass. */
  | { status: "unverified"; auditId: string; reason: string; detail: string };

export interface VerifyAnchorOptions {
  /** The AuditAnchor contract the digest must have been written to. */
  contractAddress: string;
  /** The chain the anchor is expected to live on. Base Sepolia is 84532. */
  expectedChainId: number;
  chain: AnchorChainReader;
  /** Anchors shallower than this are reported, not failed. Default 0. */
  minConfirmations?: bigint;
}

function sameAddress(left: string | null, right: string): boolean {
  return typeof left === "string" && left.toLowerCase() === right.toLowerCase();
}

function sameDigest(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

/**
 * Pulls the anchored digest out of a receipt's logs.
 *
 * Only logs emitted BY the expected contract are considered. Without that filter a
 * transaction could satisfy verification by emitting a look-alike event from an
 * unrelated address it happened to also touch.
 */
function anchoredDigests(
  receipt: AnchorTransactionReceipt,
  contractAddress: string,
): string[] {
  const digests: string[] = [];
  for (const log of receipt.logs) {
    if (!sameAddress(log.address, contractAddress)) continue;
    try {
      const decoded = decodeEventLog({
        abi: AUDIT_ANCHOR_ABI,
        topics: log.topics as [Hex, ...Hex[]],
        data: log.data as Hex,
      });
      if (decoded.eventName !== "Anchored") continue;
      const args = decoded.args as unknown as { recordHash?: string };
      if (typeof args.recordHash === "string") digests.push(args.recordHash);
    } catch {
      // Not an AuditAnchor event. Other logs in the same transaction are irrelevant.
    }
  }
  return digests;
}

/**
 * Verifies one anchored record end to end.
 *
 * `record` is the row as currently stored; `anchor` is its claimed anchor row. Both
 * come from the database and neither is trusted: the digest is recomputed from the
 * record, and the chain is asked what was actually written.
 */
export async function verifyAnchorOnChain(
  record: AuditLogRecord | null,
  anchor: AuditAnchorRow,
  options: VerifyAnchorOptions,
): Promise<AnchorVerification> {
  const auditId = anchor.audit_id;

  // 1. The record must still exist. An anchor for a deleted record is exactly the
  //    tampering the anchor exists to expose.
  if (record === null) {
    return {
      status: "mismatch",
      auditId,
      reason: "RECORD_DELETED",
      detail: "anchored record no longer exists in audit_log",
    };
  }

  // 2. The stored record must still reproduce the digest the database recorded.
  const recomputed = auditRecordHash(record);
  if (!sameDigest(recomputed, anchor.record_hash)) {
    return {
      status: "mismatch",
      auditId,
      reason: "RECORD_TAMPERED",
      detail: `recomputed ${recomputed} != stored ${anchor.record_hash}`,
    };
  }

  // 3. A record that never claimed to be on chain is not a failure — it is simply
  //    unproven, and says so.
  if (anchor.status !== "anchored" || !anchor.anchor_tx_hash) {
    return {
      status: "unverified",
      auditId,
      reason: "NOT_ANCHORED",
      detail: `digest verified locally; anchoring ${anchor.status}${anchor.error ? ` — ${anchor.error}` : ""}`,
    };
  }
  const txHash = anchor.anchor_tx_hash;

  // 4. Ask the chain. Any inability to answer is UNVERIFIED, never verified.
  let chainId: number;
  let receipt: AnchorTransactionReceipt | null;
  let head: bigint;
  try {
    chainId = await options.chain.getChainId();
    receipt = await options.chain.getTransactionReceipt(txHash);
    head = await options.chain.getBlockNumber();
  } catch (error) {
    return {
      status: "unverified",
      auditId,
      reason: "RPC_UNAVAILABLE",
      detail: `chain could not be consulted: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (chainId !== options.expectedChainId) {
    return {
      status: "mismatch",
      auditId,
      reason: "WRONG_CHAIN",
      detail: `verifier is connected to chain ${chainId}, expected ${options.expectedChainId}`,
    };
  }

  // 5. The transaction must actually exist. A plausible-looking hash proves nothing.
  if (receipt === null) {
    return {
      status: "mismatch",
      auditId,
      reason: "TRANSACTION_NOT_FOUND",
      detail: `no transaction ${txHash} on chain ${chainId}`,
    };
  }

  // 6. A reverted transaction anchored nothing.
  if (receipt.status !== "success") {
    return {
      status: "mismatch",
      auditId,
      reason: "TRANSACTION_FAILED",
      detail: `transaction ${txHash} did not succeed (${receipt.status})`,
    };
  }

  // 7. It must have gone to the AuditAnchor contract, not merely to some contract.
  if (!sameAddress(receipt.to, options.contractAddress)) {
    return {
      status: "mismatch",
      auditId,
      reason: "WRONG_CONTRACT",
      detail: `transaction targeted ${receipt.to ?? "contract creation"}, expected ${options.contractAddress}`,
    };
  }

  // 8. The digest is read from the chain, not from the database copy of it.
  const digests = anchoredDigests(receipt, options.contractAddress);
  if (digests.length === 0) {
    return {
      status: "mismatch",
      auditId,
      reason: "NO_ANCHOR_EVENT",
      detail: `transaction ${txHash} emitted no Anchored event from ${options.contractAddress}`,
    };
  }
  if (!digests.some((digest) => sameDigest(digest, recomputed))) {
    return {
      status: "mismatch",
      auditId,
      reason: "DIGEST_NOT_ON_CHAIN",
      detail: `chain anchored ${digests.join(", ")}; this record hashes to ${recomputed}`,
    };
  }

  // 9. Depth. Reported rather than enforced: see the note in the CLI about what this
  //    prototype does and does not claim about finality.
  const confirmations = head >= receipt.blockNumber ? head - receipt.blockNumber + 1n : 0n;
  const minConfirmations = options.minConfirmations ?? 0n;

  return {
    status: "verified",
    auditId,
    digest: recomputed,
    txHash,
    blockNumber: receipt.blockNumber,
    confirmations,
    belowConfirmationThreshold: confirmations < minConfirmations,
  };
}

/**
 * The production reader: Base Sepolia over JSON-RPC, read-only.
 *
 * Deliberately separate from the verification logic above so the unit tests can
 * inject a deterministic adapter and never touch the network. No signer is
 * constructed here, because verification is a read.
 */
export function createAnchorChainReader(rpcUrl: string): AnchorChainReader {
  const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
  return {
    async getChainId(): Promise<number> {
      return client.getChainId();
    },
    async getBlockNumber(): Promise<bigint> {
      return client.getBlockNumber();
    },
    async getTransactionReceipt(txHash: string): Promise<AnchorTransactionReceipt | null> {
      try {
        const receipt = await client.getTransactionReceipt({ hash: txHash as Hex });
        return {
          status: receipt.status,
          to: receipt.to,
          blockNumber: receipt.blockNumber,
          logs: receipt.logs.map((log) => ({
            address: log.address,
            topics: log.topics as unknown as string[],
            data: log.data,
          })),
        };
      } catch (error) {
        // viem throws for a hash it cannot find. That is "not found", which the
        // verifier treats as a mismatch — distinct from an RPC that is down, which
        // surfaces as a thrown error from getChainId/getBlockNumber above.
        if (error instanceof TransactionReceiptNotFoundError) return null;
        throw error;
      }
    },
  };
}

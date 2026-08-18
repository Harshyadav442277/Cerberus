import { deepStrictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import type { Address, Hex } from "viem";
import {
  reconcileEip3009,
  type Eip3009ChainReader,
  type Eip3009ReconciliationInput,
} from "../reconcile.js";

const INPUT: Eip3009ReconciliationInput = {
  token: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  payer: "0x4444444444444444444444444444444444444444",
  nonce: `0x${"55".repeat(32)}`,
  validBefore: "1800000300",
  submissionBlock: "12345678",
  payTo: "0x1111111111111111111111111111111111111111",
  amount: "500000",
};
const TX = `0x${"aa".repeat(32)}` as Hex;

function reader(options: {
  used?: boolean;
  timestamp?: bigint;
  transactions?: Hex[];
  exact?: boolean;
} = {}): Eip3009ChainReader {
  return {
    async latestTimestamp() {
      return options.timestamp ?? 1_800_000_000n;
    },
    async authorizationState(_token: Address, _payer: Address, _nonce: Hex) {
      return options.used ?? false;
    },
    async authorizationTransactions() {
      return options.transactions ?? [];
    },
    async hasExactSuccessfulTransfer() {
      return options.exact ?? false;
    },
  };
}

describe("EIP-3009 chain reconciliation", () => {
  it("proves settlement only from a used nonce and the exact successful transfer", async () => {
    deepStrictEqual(
      await reconcileEip3009(INPUT, reader({ used: true, transactions: [TX], exact: true })),
      { outcome: "settled", transactionHash: TX },
    );
  });

  it("proves safe non-payment only after an unused authorization expires on chain", async () => {
    deepStrictEqual(
      await reconcileEip3009(INPUT, reader({ used: false, timestamp: 1_800_000_300n })),
      { outcome: "unpaid", reason: "authorization_expired_unused" },
    );
  });

  it("keeps an unused but unexpired authorization pending", async () => {
    deepStrictEqual(
      await reconcileEip3009(INPUT, reader({ used: false, timestamp: 1_800_000_299n })),
      { outcome: "pending", reason: "authorization_still_live" },
    );
  });

  it("does not confuse nonce cancellation or mismatched transfer evidence with payment", async () => {
    deepStrictEqual(
      await reconcileEip3009(INPUT, reader({ used: true, transactions: [TX], exact: false })),
      { outcome: "pending", reason: "nonce_used_without_exact_transfer_evidence" },
    );
  });
});

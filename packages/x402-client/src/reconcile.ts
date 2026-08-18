import {
  createPublicClient,
  getAddress,
  http,
  parseAbi,
  parseAbiItem,
  type Address,
  type Hex,
} from "viem";
import { baseSepolia } from "viem/chains";

const AUTHORIZATION_STATE_ABI = parseAbi([
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
]);
const AUTHORIZATION_USED_EVENT = parseAbiItem(
  "event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)",
);
const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

export interface Eip3009ReconciliationInput {
  token: string;
  payer: string;
  nonce: string;
  validBefore: string;
  submissionBlock: string;
  payTo: string;
  amount: string;
}

export type Eip3009ReconciliationResult =
  | { outcome: "settled"; transactionHash: string }
  | { outcome: "unpaid"; reason: "authorization_expired_unused" }
  | {
      outcome: "pending";
      reason: "authorization_still_live" | "nonce_used_without_exact_transfer_evidence";
    };

/** Read-only chain surface, separated so reconciliation decisions are deterministic in tests. */
export interface Eip3009ChainReader {
  latestTimestamp(): Promise<bigint>;
  authorizationState(token: Address, payer: Address, nonce: Hex): Promise<boolean>;
  authorizationTransactions(
    token: Address,
    payer: Address,
    nonce: Hex,
    fromBlock: bigint,
  ): Promise<Hex[]>;
  hasExactSuccessfulTransfer(
    transactionHash: Hex,
    token: Address,
    payer: Address,
    payTo: Address,
    amount: bigint,
  ): Promise<boolean>;
}

/**
 * Resolves only evidence the EIP-3009 contract makes definitive.
 *
 * A false authorizationState before validBefore is not failure: a facilitator still
 * holds a live signed payload. A true state without the exact transfer is also not
 * success (the nonce may have been canceled). Both remain capacity-holding UNKNOWN.
 */
export async function reconcileEip3009(
  input: Eip3009ReconciliationInput,
  chain: Eip3009ChainReader,
): Promise<Eip3009ReconciliationResult> {
  const token = getAddress(input.token);
  const payer = getAddress(input.payer);
  const payTo = getAddress(input.payTo);
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.nonce)) throw new Error("invalid EIP-3009 nonce");
  if (!/^\d+$/.test(input.validBefore)) throw new Error("invalid EIP-3009 validBefore");
  if (!/^\d+$/.test(input.submissionBlock)) throw new Error("invalid submission block");
  if (!/^\d+$/.test(input.amount)) throw new Error("invalid atomic amount");
  const nonce = input.nonce as Hex;

  const used = await chain.authorizationState(token, payer, nonce);
  if (!used) {
    const latestTimestamp = await chain.latestTimestamp();
    if (latestTimestamp >= BigInt(input.validBefore)) {
      return { outcome: "unpaid", reason: "authorization_expired_unused" };
    }
    return { outcome: "pending", reason: "authorization_still_live" };
  }

  const transactions = await chain.authorizationTransactions(
    token,
    payer,
    nonce,
    BigInt(input.submissionBlock),
  );
  for (const transactionHash of transactions.toReversed()) {
    if (
      await chain.hasExactSuccessfulTransfer(
        transactionHash,
        token,
        payer,
        payTo,
        BigInt(input.amount),
      )
    ) {
      return { outcome: "settled", transactionHash };
    }
  }
  return { outcome: "pending", reason: "nonce_used_without_exact_transfer_evidence" };
}

/** Production Base Sepolia reader. It has no signer and cannot broadcast. */
export function createEip3009ChainReader(rpcUrl: string): Eip3009ChainReader {
  const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
  return {
    async latestTimestamp() {
      return (await client.getBlock({ blockTag: "latest" })).timestamp;
    },
    authorizationState: (token, payer, nonce) =>
      client.readContract({
        address: token,
        abi: AUTHORIZATION_STATE_ABI,
        functionName: "authorizationState",
        args: [payer, nonce],
      }),
    async authorizationTransactions(token, payer, nonce, fromBlock) {
      const logs = await client.getLogs({
        address: token,
        event: AUTHORIZATION_USED_EVENT,
        args: { authorizer: payer, nonce },
        fromBlock,
        toBlock: "latest",
      });
      return logs.map((log) => log.transactionHash);
    },
    async hasExactSuccessfulTransfer(transactionHash, token, payer, payTo, amount) {
      const receipt = await client.getTransactionReceipt({ hash: transactionHash });
      if (receipt.status !== "success") return false;
      const logs = await client.getLogs({
        address: token,
        event: TRANSFER_EVENT,
        args: { from: payer, to: payTo },
        fromBlock: receipt.blockNumber,
        toBlock: receipt.blockNumber,
      });
      return logs.some(
        (log) => log.transactionHash === transactionHash && log.args.value === amount,
      );
    },
  };
}

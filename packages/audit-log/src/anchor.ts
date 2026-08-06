import { AUDIT_ANCHOR_ABI } from "@safr/contracts";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

/**
 * Writes an audit record digest to the AuditAnchor contract on Base Sepolia.
 *
 * Everything here is allowed to fail. Anchoring is a durability nicety; the
 * disposition path is the demo-critical one, and Architecture 6.1 requires that a
 * slow or broken anchor never stall or fail a disposition. See queue.ts for how that
 * is enforced.
 */
export interface AnchorClient {
  anchor(recordHash: `0x${string}`): Promise<`0x${string}`>;
}

export interface AnchorConfig {
  privateKey: string;
  rpcUrl: string;
  contractAddress: string;
}

export function readAnchorConfig(env: NodeJS.ProcessEnv = process.env): AnchorConfig | null {
  const privateKey = env.EVM_PRIVATE_KEY;
  const contractAddress = env.AUDIT_ANCHOR_ADDRESS;
  // Both are required. Without them anchoring is simply disabled, which is a
  // supported state — records are still written, just not yet anchored.
  if (!privateKey || !contractAddress) return null;
  return {
    privateKey,
    contractAddress,
    rpcUrl: env.EVM_RPC_URL ?? "https://sepolia.base.org",
  };
}

export function createAnchorClient(config: AnchorConfig): AnchorClient {
  const account = privateKeyToAccount(config.privateKey as `0x${string}`);
  const transport = http(config.rpcUrl);
  const publicClient = createPublicClient({ chain: baseSepolia, transport });
  const walletClient = createWalletClient({ account, chain: baseSepolia, transport });

  return {
    async anchor(recordHash: `0x${string}`): Promise<`0x${string}`> {
      const hash = await walletClient.writeContract({
        address: config.contractAddress as `0x${string}`,
        abi: AUDIT_ANCHOR_ABI,
        functionName: "anchor",
        args: [recordHash],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`Anchor tx reverted: ${hash}`);
      return hash;
    },
  };
}

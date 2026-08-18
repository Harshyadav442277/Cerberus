/**
 * Deploys AuditAnchor to Base Sepolia.
 *
 * Requires the dedicated audit-anchor signer to hold a little Base Sepolia ETH for
 * gas. Once it succeeds, put the printed address in .env and .env.agent as
 * AUDIT_ANCHOR_ADDRESS.
 *
 * Run: npm run contracts:deploy
 */
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { createPublicClient, createWalletClient, formatEther, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { compileAuditAnchor } from "./compile.js";

loadEnv({ path: resolve(import.meta.dirname, "../../.env"), quiet: true });
loadEnv({
  path: resolve(import.meta.dirname, "../../.env.authorizer"),
  quiet: true,
  override: true,
});

const privateKey = process.env.AUDIT_ANCHOR_PRIVATE_KEY;
const rpcUrl = process.env.EVM_RPC_URL ?? "https://sepolia.base.org";

async function main(): Promise<void> {
  if (!privateKey) {
    throw new Error("AUDIT_ANCHOR_PRIVATE_KEY is not set — see .env.authorizer.example");
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain: baseSepolia, transport });
  const walletClient = createWalletClient({ account, chain: baseSepolia, transport });

  console.log(`\n  deployer   ${account.address}`);

  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`  balance    ${formatEther(balance)} ETH`);
  if (balance === 0n) {
    throw new Error(
      "Deployer has no Sepolia ETH for gas. Fund it, then retry (Memory.md blocker B1).",
    );
  }

  const { abi, bytecode } = compileAuditAnchor();
  console.log(`  bytecode   ${(bytecode.length - 2) / 2} bytes\n  deploying...`);

  const hash = await walletClient.deployContract({ abi: abi as never, bytecode, args: [] });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status !== "success" || !receipt.contractAddress) {
    throw new Error(`Deployment failed. Tx: ${hash}`);
  }

  console.log(`\n  deployed   ${receipt.contractAddress}`);
  console.log(`  tx         ${hash}`);
  console.log(`  explorer   https://sepolia.basescan.org/address/${receipt.contractAddress}`);
  console.log(
    `\n  Add this line to .env and .env.agent:\n    AUDIT_ANCHOR_ADDRESS=${receipt.contractAddress}\n`,
  );
}

try {
  await main();
} catch (error) {
  console.error(`\n  ERROR ${(error as Error).message}\n`);
  process.exitCode = 1;
}

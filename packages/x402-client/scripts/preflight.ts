/**
 * Phase 1 preflight. Verifies everything the bare x402 payment needs before
 * attempting it, so a failure points at the actual cause rather than surfacing as
 * an opaque payment error.
 *
 * Run: pnpm phase1:preflight
 */
import { createPublicClient, formatUnits, http } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { erc20Abi } from "viem";
import { readEnv } from "../src/env.js";

/** Circle's canonical USDC on Base Sepolia. */
const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
const USDC_DECIMALS = 6;

let failures = 0;

function pass(label: string, detail = ""): void {
  console.log(`  OK    ${label}${detail ? ` — ${detail}` : ""}`);
}

function fail(label: string, detail: string): void {
  failures += 1;
  console.log(`  FAIL  ${label} — ${detail}`);
}

async function main(): Promise<void> {
  console.log("\nPhase 1 preflight — bare x402 payment prerequisites\n");

  const { env, missing } = readEnv();
  if (!env) {
    fail("environment", `missing ${missing.join(", ")}`);
    console.log(
      "\n  Create .env at the repo root from .env.example and set EVM_PRIVATE_KEY\n" +
        "  (payer wallet) and EVM_ADDRESS (merchant payee).\n",
    );
    process.exit(1);
  }
  pass("environment", "required variables present");
  console.log(`        network      ${env.network}`);
  console.log(`        facilitator  ${env.facilitatorUrl}`);
  console.log(`        rpc          ${env.rpcUrl}`);

  let address: `0x${string}`;
  try {
    address = privateKeyToAccount(env.privateKey as `0x${string}`).address;
    pass("payer key", address);
  } catch (error) {
    fail("payer key", `EVM_PRIVATE_KEY is not a valid hex private key (${(error as Error).message})`);
    process.exit(1);
  }

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(env.rpcUrl),
  });

  try {
    const gas = await publicClient.getBalance({ address });
    if (gas === 0n) {
      fail("Sepolia ETH balance", "0 ETH — needed for gas on the Phase 5 audit anchor");
    } else {
      pass("Sepolia ETH balance", `${formatUnits(gas, 18)} ETH`);
    }
  } catch (error) {
    fail("Sepolia ETH balance", `RPC read failed: ${(error as Error).message}`);
  }

  try {
    const usdc = await publicClient.readContract({
      address: USDC_BASE_SEPOLIA,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address],
    });
    if (usdc === 0n) {
      fail(
        "Base Sepolia USDC balance",
        "0 USDC — fund the payer at https://faucet.circle.com (select Base Sepolia)",
      );
    } else {
      pass("Base Sepolia USDC balance", `${formatUnits(usdc, USDC_DECIMALS)} USDC`);
    }
  } catch (error) {
    fail("Base Sepolia USDC balance", `contract read failed: ${(error as Error).message}`);
  }

  try {
    const response = await fetch(`${env.merchantBaseUrl}/health`);
    if (response.ok) {
      pass("merchant server", `${env.merchantBaseUrl} reachable`);
    } else {
      fail("merchant server", `${env.merchantBaseUrl} returned HTTP ${response.status}`);
    }
  } catch {
    fail("merchant server", `${env.merchantBaseUrl} unreachable — start it with: pnpm merchant`);
  }

  try {
    const response = await fetch(`${env.facilitatorUrl}/supported`);
    if (response.ok) {
      pass("facilitator", "reachable");
    } else {
      fail("facilitator", `returned HTTP ${response.status}`);
    }
  } catch (error) {
    fail("facilitator", `unreachable: ${(error as Error).message}`);
  }

  if (failures > 0) {
    console.log(`\n${failures} check(s) failed. Phase 1 cannot settle until these pass.\n`);
    process.exit(1);
  }
  console.log("\nAll checks passed. Run: pnpm phase1\n");
}

void main();

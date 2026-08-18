import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import {
  BASE_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_USDC,
  isValidPrivateKey,
} from "@safr/execution-authorization";
import { getAddress, type Address, type Hex } from "viem";

function parse(path: string): Record<string, string> {
  const values: Record<string, string> = {};
  loadDotenv({ path, quiet: true, processEnv: values });
  return values;
}

const root = parse(resolve(import.meta.dirname, "../../../.env"));
const secret = parse(resolve(import.meta.dirname, "../../../.env.executor"));

function value(name: string, fallback = ""): string {
  return process.env[name]?.trim() || secret[name]?.trim() || root[name]?.trim() || fallback;
}

function required(name: string): string {
  const found = value(name);
  if (!found) throw new Error(`${name} is required by the isolated executor`);
  return found;
}

function chainId(network: string): number {
  const match = /^eip155:(\d+)$/.exec(network);
  if (!match) throw new Error(`invalid X402_NETWORK: ${network}`);
  return Number(match[1]);
}

const network = value("X402_NETWORK", "eip155:84532");
const parsedChainId = chainId(network);
if (parsedChainId !== BASE_SEPOLIA_CHAIN_ID) {
  throw new Error(`executor supports Base Sepolia only; received chain ${parsedChainId}`);
}

const privateKey = required("EXECUTOR_EVM_PRIVATE_KEY");
if (!isValidPrivateKey(privateKey)) {
  throw new Error("EXECUTOR_EVM_PRIVATE_KEY is not a valid secp256k1 private key");
}

const token = getAddress(value("X402_TOKEN_ADDRESS", BASE_SEPOLIA_USDC));
if (token !== getAddress(BASE_SEPOLIA_USDC)) {
  throw new Error(`executor supports canonical Base Sepolia USDC only; received ${token}`);
}

export const executorEnv = {
  port: Number(value("EXECUTOR_PORT", "4060")),
  expectedAuthorizer: getAddress(required("EXECUTION_AUTHORIZER_ADDRESS")) as Address,
  target: {
    chainId: parsedChainId,
    token,
    payTo: getAddress(required("EVM_ADDRESS")),
    merchantBaseUrl: value("MERCHANT_BASE_URL", "http://localhost:4021"),
  },
  x402: {
    privateKey: privateKey as Hex,
    network,
    facilitatorUrl: value("X402_FACILITATOR_URL", "https://x402.org/facilitator"),
    rpcUrl: value("EVM_RPC_URL", "https://sepolia.base.org"),
    merchantBaseUrl: value("MERCHANT_BASE_URL", "http://localhost:4021"),
  },
};

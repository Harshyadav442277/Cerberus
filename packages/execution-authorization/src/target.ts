import type { ProposedAction } from "@safr/core";
import { keccak256, stringToHex } from "viem";

export const BASE_SEPOLIA_CHAIN_ID = 84532;
export const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
export const USDC_DECIMALS = 6;

export interface ExecutionTarget {
  chainId: number;
  token: string;
  amount: string;
  payTo: string;
  resourceHash: `0x${string}`;
}

export interface TargetConfig {
  chainId: number;
  token: string;
  payTo: string;
  merchantBaseUrl: string;
}

/** Temporary Phase 1 binding; Phase 2 replaces it with a real reservation row. */
export function phase1ReservationId(auditId: string): string {
  return `phase1_unreserved:${auditId}`;
}

export function decimalToAtomicUnits(value: number, decimals = USDC_DECIMALS): string {
  if (!Number.isFinite(value) || value <= 0) throw new Error("payment amount must be positive");
  const text = value.toString();
  if (/e/i.test(text)) throw new Error("exponential payment amounts are not supported");
  const [whole = "0", fraction = ""] = text.split(".");
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(fraction) || fraction.length > decimals) {
    throw new Error(`payment amount exceeds ${decimals} decimal places`);
  }
  return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0"))).toString();
}

export function paymentResource(action: ProposedAction, merchantBaseUrl: string): string {
  const url = new URL(`${merchantBaseUrl.replace(/\/$/, "")}/pay/${action.payload.counterparty}`);
  url.searchParams.set("amount", String(action.payload.amount));
  if (action.payload.reference) url.searchParams.set("reference", action.payload.reference);
  return `GET ${url.toString()}`;
}

export function buildExecutionTarget(
  action: ProposedAction,
  config: TargetConfig,
): ExecutionTarget {
  return {
    chainId: config.chainId,
    token: config.token,
    amount: decimalToAtomicUnits(action.payload.amount),
    payTo: config.payTo,
    resourceHash: keccak256(stringToHex(paymentResource(action, config.merchantBaseUrl))),
  };
}

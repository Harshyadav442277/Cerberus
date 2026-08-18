/**
 * The only module in SAFR Runtime that talks to x402.
 *
 * Rules R6 / Bible Section 6: this must only ever be imported from
 * apps/agent/src/settlement/. The agent's orchestrator calls the Disposition
 * Engine first and only reaches this module on ALLOW, or on ESCALATE that a
 * human approved. Nothing here evaluates a mandate.
 */
import { x402Client, x402HTTPClient } from "@x402/core/client";
import type { SettleResponse } from "@x402/core/types";
import { wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import type { X402Env } from "./env.js";
import type { PaymentRequest } from "./challenge.js";

/**
 * Mirrors the `settlement` object of the Audit Log record (Bible Section 7.5) so the
 * audit write path in Phase 5 can store this directly without reshaping it.
 */
export interface SettlementResult {
  status: "settled" | "failed";
  tx_hash: string | null;
  rail: "x402";
  settled_at: string | null;
  /** Populated on failure only. Not part of the Section 7.5 schema. */
  error?: string;
}

export interface X402Payer {
  /** Address the payments are signed from. */
  address: string;
  pay(request: PaymentRequest): Promise<SettlementResult>;
}

function isSettleResponse(header: unknown): header is SettleResponse {
  return typeof header === "object" && header !== null && "transaction" in header;
}

/**
 * Builds a payer bound to a single signer. Constructed once and reused, so the
 * signer and scheme registration are not rebuilt per payment.
 */
export function createX402Payer(env: X402Env): X402Payer {
  const signer = privateKeyToAccount(env.privateKey as `0x${string}`);

  const client = new x402Client();
  registerExactEvmScheme(client, {
    signer,
    schemeOptions: { rpcUrl: env.rpcUrl },
  });

  const fetchWithPayment = wrapFetchWithPayment(fetch, client);
  const httpClient = new x402HTTPClient(client);

  return {
    address: signer.address,

    async pay(request: PaymentRequest): Promise<SettlementResult> {
      const url = new URL(`${env.merchantBaseUrl}/pay/${request.counterparty}`);
      url.searchParams.set("amount", String(request.amount));
      if (request.reference) url.searchParams.set("reference", request.reference);

      const response = await fetchWithPayment(url.toString(), { method: "GET" });
      const result = await httpClient.processResponse(response);

      if (result.paymentStatus === "settled" && isSettleResponse(result.header)) {
        return {
          status: "settled",
          tx_hash: result.header.transaction,
          rail: "x402",
          settled_at: new Date().toISOString(),
        };
      }

      return {
        status: "failed",
        tx_hash: null,
        rail: "x402",
        settled_at: null,
        error: describeFailure(result.paymentStatus, result.header, result.status),
      };
    },
  };
}

function describeFailure(
  paymentStatus: string,
  header: unknown,
  httpStatus: number,
): string {
  if (isSettleResponse(header) && (header.errorMessage || header.errorReason)) {
    return `${paymentStatus}: ${header.errorMessage ?? header.errorReason}`;
  }
  if (
    typeof header === "object" &&
    header !== null &&
    "error" in header &&
    typeof (header as { error?: unknown }).error === "string"
  ) {
    return `${paymentStatus}: ${(header as { error: string }).error}`;
  }
  return `${paymentStatus} (HTTP ${httpStatus})`;
}

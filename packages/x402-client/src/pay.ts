/**
 * The only module in SAFR Runtime that talks to x402.
 *
 * Rules R6 / Bible Section 6: this is imported only by the isolated executor and
 * standalone rail diagnostics. The untrusted agent never imports this package and
 * never receives the signer. Nothing here evaluates a mandate.
 */
import { x402Client, x402HTTPClient } from "@x402/core/client";
import type { SettleResponse } from "@x402/core/types";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import type { X402Env } from "./env.js";
import {
  isValidatedX402Challenge,
  type ValidatedX402Challenge,
} from "./challenge.js";

type Fetch = typeof fetch;
const defaultFetch: Fetch = (...args) => globalThis.fetch(...args);

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
  /** Signs and submits only the already-fetched, already-validated live challenge. */
  pay(challenge: ValidatedX402Challenge): Promise<SettlementResult>;
}

function isSettleResponse(header: unknown): header is SettleResponse {
  return typeof header === "object" && header !== null && "transaction" in header;
}

/**
 * Builds a payer bound to a single signer. The isolated executor deliberately calls
 * this factory only after validating the merchant's exact live challenge.
 */
export function createX402Payer(
  env: X402Env,
  fetchImpl: Fetch = defaultFetch,
): X402Payer {
  const signer = privateKeyToAccount(env.privateKey as `0x${string}`);

  const client = new x402Client();
  registerExactEvmScheme(client, {
    signer,
    schemeOptions: { rpcUrl: env.rpcUrl },
  });

  const httpClient = new x402HTTPClient(client);

  return {
    address: signer.address,

    async pay(challenge: ValidatedX402Challenge): Promise<SettlementResult> {
      if (!isValidatedX402Challenge(challenge)) {
        throw new Error("x402 challenge was not validated by Cerberus");
      }

      // Manual v2.21.0 flow: create a payload for the ONE pinned requirement and
      // submit it directly. The convenience wrapper is deliberately not used because
      // it would fetch a second, potentially different 402 before signing.
      const paymentPayload = await client.createPaymentPayload(challenge.paymentRequired);
      const headers = new Headers(httpClient.encodePaymentSignatureHeader(paymentPayload));
      headers.set("Access-Control-Expose-Headers", "PAYMENT-RESPONSE,X-PAYMENT-RESPONSE");
      const response = await fetchImpl(new Request(challenge.requestUrl, {
        method: challenge.method,
        headers,
      }));
      await httpClient.processPaymentResult(
        paymentPayload,
        (name) => response.headers.get(name),
        response.status,
      );
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

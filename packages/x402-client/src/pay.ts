/**
 * The only module in SAFR Runtime that talks to x402.
 *
 * Rules R6 / Bible Section 6: this is imported only by the isolated executor and
 * standalone rail diagnostics. The untrusted agent never imports this package and
 * never receives the signer. Nothing here evaluates a mandate.
 */
import { x402Client, x402HTTPClient } from "@x402/core/client";
import type { PaymentPayload, SettleResponse } from "@x402/core/types";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { createPublicClient, http, keccak256, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
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
  /** Signs but does not transmit the already-validated challenge. */
  prepare(challenge: ValidatedX402Challenge): Promise<PreparedX402Payment>;
}

export interface PaymentAttemptCorrelation {
  payer: string;
  payTo: string;
  nonce: string;
  payloadHash: string;
  validBefore: string;
  submissionBlock: string;
}

export class PaymentAttemptPersistenceError extends Error {
  constructor() {
    super("payment attempt correlation was not durably persisted");
    this.name = "PaymentAttemptPersistenceError";
  }
}

/**
 * A signed payment that still cannot touch transport by itself. `submit` first calls
 * the supplied durable-persistence boundary and refuses to send unless it commits.
 */
export interface PreparedX402Payment {
  readonly correlation: Readonly<PaymentAttemptCorrelation>;
  submit(
    persist: (correlation: Readonly<PaymentAttemptCorrelation>) => Promise<boolean>,
  ): Promise<SettlementResult>;
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
  blockNumber: () => Promise<bigint> = () =>
    createPublicClient({ chain: baseSepolia, transport: http(env.rpcUrl) }).getBlockNumber(),
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

    async prepare(challenge: ValidatedX402Challenge): Promise<PreparedX402Payment> {
      if (!isValidatedX402Challenge(challenge)) {
        throw new Error("x402 challenge was not validated by Cerberus");
      }

      // Manual v2.21.0 flow: create a payload for the ONE pinned requirement and
      // submit it directly. The convenience wrapper is deliberately not used because
      // it would fetch a second, potentially different 402 before signing.
      const paymentPayload = await client.createPaymentPayload(challenge.paymentRequired);
      const correlation = Object.freeze(paymentCorrelation(paymentPayload, await blockNumber()));
      let claimed = false;

      return {
        correlation,
        async submit(persist): Promise<SettlementResult> {
          if (claimed) throw new Error("prepared x402 payment is one-shot");
          claimed = true;
          if (!(await persist(correlation))) throw new PaymentAttemptPersistenceError();

          const headers = new Headers(httpClient.encodePaymentSignatureHeader(paymentPayload));
          headers.set("Access-Control-Expose-Headers", "PAYMENT-RESPONSE,X-PAYMENT-RESPONSE");
          // `redirect: "error"`, because these headers carry a live signed EIP-3009
          // authorization. The fetch specification strips only Authorization, Cookie
          // and Proxy-Authorization across a cross-origin redirect — a custom header
          // like PAYMENT-SIGNATURE is forwarded intact. Following a redirect would
          // therefore let the merchant hand Cerberus's signed payment authority to a
          // host nobody approved.
          //
          // The authorization binds its recipient, so a thief cannot redirect the
          // funds; but disclosing a live payload to an unapproved origin still
          // violates the exact-resource threat model, and lets a third party settle
          // on a timing of its choosing.
          //
          // This rejects AFTER the request reached the intended merchant, so the
          // caller correctly treats it as OUTCOME_UNKNOWN rather than non-payment.
          const response = await fetchImpl(new Request(challenge.requestUrl, {
            method: challenge.method,
            headers,
            redirect: "error",
          }));
          if (response.redirected || (response.status >= 300 && response.status < 400)) {
            throw new Error(
              "merchant redirected the paid request; signed payment authority was not forwarded",
            );
          }
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
    },
  };
}

function paymentCorrelation(
  paymentPayload: PaymentPayload,
  submissionBlock: bigint,
): PaymentAttemptCorrelation {
  const payload = paymentPayload.payload as {
    authorization?: {
      from?: unknown;
      to?: unknown;
      nonce?: unknown;
      validBefore?: unknown;
    };
  };
  const authorization = payload.authorization;
  if (
    typeof authorization?.from !== "string" ||
    typeof authorization.to !== "string" ||
    typeof authorization.nonce !== "string" ||
    typeof authorization.validBefore !== "string" ||
    !/^0x[0-9a-fA-F]{64}$/.test(authorization.nonce) ||
    !/^\d+$/.test(authorization.validBefore)
  ) {
    throw new Error("x402 exact EIP-3009 payload has no durable correlation identity");
  }
  return {
    payer: authorization.from,
    payTo: authorization.to,
    nonce: authorization.nonce,
    validBefore: authorization.validBefore,
    payloadHash: keccak256(stringToHex(JSON.stringify(paymentPayload))),
    submissionBlock: submissionBlock.toString(),
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

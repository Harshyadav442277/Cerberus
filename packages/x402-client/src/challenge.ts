import { x402Client, x402HTTPClient } from "@x402/core/client";
import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { getAddress } from "viem";

type Fetch = typeof fetch;
const defaultFetch: Fetch = (...args) => globalThis.fetch(...args);

export interface PaymentRequest {
  counterparty: string;
  /** Decimal amount, e.g. 0.5 for 0.50 USDC. */
  amount: number;
  reference?: string;
}

export interface X402Challenge {
  method: "GET";
  requestUrl: string;
  paymentRequired: PaymentRequired;
}

export interface ExpectedX402Challenge {
  x402Version: 2;
  scheme: "exact";
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  resourceUrl: string;
  eip712: { name: string; version: string; assetTransferMethod: "eip3009" };
}

const VALIDATED = Symbol("cerberus.validated-x402-challenge");

/** A live challenge narrowed to the one PaymentRequirements the signer may use. */
export interface ValidatedX402Challenge extends X402Challenge {
  readonly [VALIDATED]: true;
  paymentRequired: PaymentRequired & { accepts: [PaymentRequirements] };
}

export class X402ChallengeError extends Error {
  constructor(
    public readonly code:
      | "CHALLENGE_NOT_402"
      | "CHALLENGE_INVALID"
      | "CHALLENGE_TIMEOUT"
      /** The merchant tried to redirect the unsigned request to another resource. */
      | "CHALLENGE_REDIRECTED"
      | "VERSION_MISMATCH"
      | "RESOURCE_MISMATCH"
      | "SCHEME_MISMATCH"
      | "NETWORK_MISMATCH"
      | "TOKEN_MISMATCH"
      | "AMOUNT_MISMATCH"
      | "PAYEE_MISMATCH"
      | "EIP712_DOMAIN_MISMATCH"
      | "TRANSFER_METHOD_MISMATCH",
  ) {
    super(code);
    this.name = "X402ChallengeError";
  }
}

/** Builds the exact resource URL used by both the unsigned and paid requests. */
export function paymentRequestUrl(request: PaymentRequest, merchantBaseUrl: string): string {
  const url = new URL(`${merchantBaseUrl.replace(/\/$/, "")}/pay/${request.counterparty}`);
  url.searchParams.set("amount", String(request.amount));
  if (request.reference) url.searchParams.set("reference", request.reference);
  return url.toString();
}

/**
 * Fetches and parses the merchant's actual HTTP 402 without a signer or payment header.
 * `x402HTTPClient` is used only as the installed v2.21.0 transport parser here; its
 * underlying client has no registered payment scheme and no signer.
 */
export async function fetchX402Challenge(
  request: PaymentRequest,
  merchantBaseUrl: string,
  fetchImpl: Fetch = defaultFetch,
  timeoutMs = 10_000,
): Promise<X402Challenge> {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs >= 60_000) {
    throw new Error("challenge timeout must be between 1 and 59999 milliseconds");
  }
  const requestUrl = paymentRequestUrl(request, merchantBaseUrl);
  const signal = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    // `redirect: "error"` rather than the default "follow". The whole point of this
    // request is to learn the price of ONE exact resource at ONE approved merchant;
    // a redirect means the answer would come from somewhere else. Following it would
    // also hand this merchant the ability to point Cerberus at an arbitrary host.
    response = await fetchImpl(
      new Request(requestUrl, { method: "GET", signal, redirect: "error" }),
    );
  } catch (error) {
    if (signal.aborted) throw new X402ChallengeError("CHALLENGE_TIMEOUT");
    // fetch rejects a redirect under redirect:"error" with a TypeError, which is
    // indistinguishable from a transport failure by type alone. Both are refusals
    // and neither has signed anything, so classify by the response we never got.
    if (error instanceof TypeError) throw new X402ChallengeError("CHALLENGE_REDIRECTED");
    throw error;
  }
  // Belt and braces for a fetch implementation that reports rather than throws.
  if (response.redirected || (response.status >= 300 && response.status < 400)) {
    throw new X402ChallengeError("CHALLENGE_REDIRECTED");
  }
  if (response.status !== 402) throw new X402ChallengeError("CHALLENGE_NOT_402");

  let body: unknown;
  try {
    const text = await response.text();
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }

  try {
    const parser = new x402HTTPClient(new x402Client());
    const paymentRequired = parser.getPaymentRequiredResponse(
      (name) => response.headers.get(name),
      body,
    );
    return { method: "GET", requestUrl, paymentRequired };
  } catch {
    throw new X402ChallengeError("CHALLENGE_INVALID");
  }
}

function sameAddress(left: string, right: string): boolean {
  try {
    return getAddress(left) === getAddress(right);
  } catch {
    return false;
  }
}

function narrowed(
  requirements: PaymentRequirements[],
  predicate: (candidate: PaymentRequirements) => boolean,
  code: ConstructorParameters<typeof X402ChallengeError>[0],
): PaymentRequirements[] {
  const candidates = requirements.filter(predicate);
  if (candidates.length === 0) throw new X402ChallengeError(code);
  return candidates;
}

/**
 * Selects one exact live requirement and returns a pinned challenge containing only it.
 * The payer never sees any unvalidated alternative offered by the merchant.
 */
export function validateX402Challenge(
  challenge: X402Challenge,
  expected: ExpectedX402Challenge,
): ValidatedX402Challenge {
  const required = challenge.paymentRequired;
  if (required.x402Version !== expected.x402Version) {
    throw new X402ChallengeError("VERSION_MISMATCH");
  }
  if (required.resource.url !== expected.resourceUrl || challenge.requestUrl !== expected.resourceUrl) {
    throw new X402ChallengeError("RESOURCE_MISMATCH");
  }

  let candidates = [...required.accepts];
  candidates = narrowed(candidates, (candidate) => candidate.scheme === expected.scheme, "SCHEME_MISMATCH");
  candidates = narrowed(candidates, (candidate) => candidate.network === expected.network, "NETWORK_MISMATCH");
  candidates = narrowed(candidates, (candidate) => sameAddress(candidate.asset, expected.asset), "TOKEN_MISMATCH");
  candidates = narrowed(candidates, (candidate) => candidate.amount === expected.amount, "AMOUNT_MISMATCH");
  candidates = narrowed(candidates, (candidate) => sameAddress(candidate.payTo, expected.payTo), "PAYEE_MISMATCH");

  const selected = candidates[0]!;
  if (
    selected.extra["name"] !== expected.eip712.name ||
    selected.extra["version"] !== expected.eip712.version
  ) {
    throw new X402ChallengeError("EIP712_DOMAIN_MISMATCH");
  }
  const transferMethod = selected.extra["assetTransferMethod"] ?? "eip3009";
  if (transferMethod !== expected.eip712.assetTransferMethod) {
    throw new X402ChallengeError("TRANSFER_METHOD_MISMATCH");
  }

  const pinnedRequirement = Object.freeze({
    ...selected,
    extra: Object.freeze({ ...selected.extra }),
  }) as PaymentRequirements;
  const paymentRequired = Object.freeze({
    ...required,
    resource: Object.freeze({ ...required.resource }),
    accepts: Object.freeze([pinnedRequirement]) as unknown as [PaymentRequirements],
  }) as PaymentRequired & { accepts: [PaymentRequirements] };

  return Object.freeze({
    method: "GET" as const,
    requestUrl: challenge.requestUrl,
    paymentRequired,
    [VALIDATED]: true as const,
  });
}

export function isValidatedX402Challenge(
  challenge: X402Challenge,
): challenge is ValidatedX402Challenge {
  return (challenge as Partial<ValidatedX402Challenge>)[VALIDATED] === true;
}

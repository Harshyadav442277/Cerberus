import { ok, rejects, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import type { PaymentRequired } from "@x402/core/types";
import {
  X402ChallengeError,
  fetchX402Challenge,
  paymentRequestUrl,
  validateX402Challenge,
  type ExpectedX402Challenge,
  type X402Challenge,
} from "../challenge.js";
import { createX402Payer } from "../pay.js";

const PAY_TO = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const REQUEST = { counterparty: "merchant_xyz", amount: 0.5, reference: "invoice_1" };
const RESOURCE = paymentRequestUrl(REQUEST, "http://localhost:4021");

const REQUIRED: PaymentRequired = {
  x402Version: 2,
  error: "Payment required",
  resource: { url: RESOURCE, description: "fixture", mimeType: "application/json" },
  accepts: [{
    scheme: "exact",
    network: "eip155:84532",
    amount: "500000",
    asset: TOKEN,
    payTo: PAY_TO,
    maxTimeoutSeconds: 300,
    extra: { name: "USDC", version: "2" },
  }],
};

const EXPECTED: ExpectedX402Challenge = {
  x402Version: 2,
  scheme: "exact",
  network: "eip155:84532",
  amount: "500000",
  asset: TOKEN,
  payTo: PAY_TO,
  resourceUrl: RESOURCE,
  eip712: { name: "USDC", version: "2", assetTransferMethod: "eip3009" },
};

function challenge(paymentRequired: PaymentRequired = REQUIRED): X402Challenge {
  return { method: "GET", requestUrl: RESOURCE, paymentRequired };
}

function changed(update: Partial<PaymentRequired["accepts"][number]>): PaymentRequired {
  return {
    ...REQUIRED,
    accepts: [{ ...REQUIRED.accepts[0]!, ...update }],
  };
}

function testPayer(fetchImpl: typeof fetch) {
  return createX402Payer(
    {
      privateKey: `0x${"44".repeat(32)}`,
      network: "eip155:84532",
      facilitatorUrl: "https://x402.org/facilitator",
      rpcUrl: "https://sepolia.base.org",
      merchantBaseUrl: "http://localhost:4021",
    },
    fetchImpl,
    async () => 12_345_678n,
  );
}

async function rejectsWith(run: () => unknown, code: X402ChallengeError["code"]): Promise<void> {
  await rejects(
    async () => run(),
    (error) => error instanceof X402ChallengeError && error.code === code,
  );
}

describe("unsigned x402 v2.21.0 challenge parsing", () => {
  it("performs one unsigned GET and parses the PAYMENT-REQUIRED header", async () => {
    let requests = 0;
    const parsed = await fetchX402Challenge(REQUEST, "http://localhost:4021", async (input) => {
      requests += 1;
      const request = input instanceof Request ? input : new Request(input);
      strictEqual(request.url, RESOURCE);
      strictEqual(request.method, "GET");
      strictEqual(request.headers.has("PAYMENT-SIGNATURE"), false);
      strictEqual(request.headers.has("X-PAYMENT"), false);
      return new Response("{}", {
        status: 402,
        headers: { "PAYMENT-REQUIRED": encodePaymentRequiredHeader(REQUIRED) },
      });
    });

    strictEqual(requests, 1);
    strictEqual(parsed.paymentRequired.accepts[0]?.amount, "500000");
    strictEqual(parsed.paymentRequired.resource.url, RESOURCE);
  });

  it("rejects a non-402 response", async () => {
    await rejectsWith(
      () => fetchX402Challenge(REQUEST, "http://localhost:4021", async () => new Response("ok")),
      "CHALLENGE_NOT_402",
    );
  });

  it("times out a merchant that never answers without sending payment authority", async () => {
    await rejectsWith(
      () => fetchX402Challenge(
        REQUEST,
        "http://localhost:4021",
        async (input) => {
          const request = input instanceof Request ? input : new Request(input);
          strictEqual(request.headers.has("PAYMENT-SIGNATURE"), false);
          return new Promise<Response>((_resolve, reject) => {
            request.signal.addEventListener("abort", () => reject(request.signal.reason), {
              once: true,
            });
          });
        },
        5,
      ),
      "CHALLENGE_TIMEOUT",
    );
  });
});

describe("exact live challenge binding", () => {
  it("pins the one exact matching requirement even when a malicious offer is first", () => {
    const malicious = { ...REQUIRED.accepts[0]!, amount: "50000000" };
    const live = { ...REQUIRED, accepts: [malicious, REQUIRED.accepts[0]!] };
    const validated = validateX402Challenge(challenge(live), EXPECTED);
    strictEqual(validated.paymentRequired.accepts.length, 1);
    strictEqual(validated.paymentRequired.accepts[0].amount, "500000");
  });

  it("rejects a mutated atomic amount", () =>
    rejectsWith(() => validateX402Challenge(challenge(changed({ amount: "50000000" })), EXPECTED), "AMOUNT_MISMATCH"));

  it("rejects a mutated payee", () =>
    rejectsWith(() => validateX402Challenge(challenge(changed({ payTo: "0x2222222222222222222222222222222222222222" })), EXPECTED), "PAYEE_MISMATCH"));

  it("rejects a mutated token", () =>
    rejectsWith(() => validateX402Challenge(challenge(changed({ asset: "0x2222222222222222222222222222222222222222" })), EXPECTED), "TOKEN_MISMATCH"));

  it("rejects a mutated chain", () =>
    rejectsWith(() => validateX402Challenge(challenge(changed({ network: "eip155:8453" })), EXPECTED), "NETWORK_MISMATCH"));

  it("rejects a mutated resource", () => {
    const live = { ...REQUIRED, resource: { ...REQUIRED.resource, url: "http://localhost:4021/pay/attacker?amount=0.5" } };
    return rejectsWith(() => validateX402Challenge(challenge(live), EXPECTED), "RESOURCE_MISMATCH");
  });

  it("rejects a different payment scheme", () =>
    rejectsWith(() => validateX402Challenge(challenge(changed({ scheme: "upto" })), EXPECTED), "SCHEME_MISMATCH"));

  it("rejects a different x402 protocol version", () => {
    const live = { ...REQUIRED, x402Version: 1 } as unknown as PaymentRequired;
    return rejectsWith(() => validateX402Challenge(challenge(live), EXPECTED), "VERSION_MISMATCH");
  });

  it("rejects a mutated EIP-712 token identity", () =>
    rejectsWith(() => validateX402Challenge(challenge(changed({ extra: { name: "Fake USDC", version: "2" } })), EXPECTED), "EIP712_DOMAIN_MISMATCH"));

  it("rejects a transfer-method switch", () =>
    rejectsWith(() => validateX402Challenge(challenge(changed({ extra: { name: "USDC", version: "2", assetTransferMethod: "permit2" } })), EXPECTED), "TRANSFER_METHOD_MISMATCH"));
});

describe("paid retry uses only the pinned challenge", () => {
  it("constructs one signature and submits directly without fetching another 402", async () => {
    const validated = validateX402Challenge(challenge(), EXPECTED);
    let paidRequests = 0;
    let persisted = false;
    const payer = createX402Payer(
      {
        privateKey: `0x${"44".repeat(32)}`,
        network: "eip155:84532",
        facilitatorUrl: "https://x402.org/facilitator",
        rpcUrl: "https://sepolia.base.org",
        merchantBaseUrl: "http://localhost:4021",
      },
      async (input) => {
        strictEqual(persisted, true, "correlation commits before transport is reached");
        paidRequests += 1;
        const request = input instanceof Request ? input : new Request(input);
        strictEqual(request.url, RESOURCE);
        const encoded = request.headers.get("PAYMENT-SIGNATURE");
        strictEqual(typeof encoded, "string");
        const payload = decodePaymentSignatureHeader(encoded!);
        strictEqual(payload.accepted.amount, "500000");
        strictEqual(payload.accepted.payTo, PAY_TO);
        return new Response(JSON.stringify({ settled: true }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "PAYMENT-RESPONSE": encodePaymentResponseHeader({
              success: true,
              payer: "0x4444444444444444444444444444444444444444",
              transaction: "0xdeadbeef",
              network: "eip155:84532",
            }),
          },
        });
      },
      async () => 12_345_678n,
    );

    const prepared = await payer.prepare(validated);
    strictEqual(prepared.correlation.submissionBlock, "12345678");
    strictEqual(prepared.correlation.nonce.startsWith("0x"), true);
    const settlement = await prepared.submit(async () => {
      persisted = true;
      return true;
    });
    strictEqual(paidRequests, 1);
    strictEqual(settlement.status, "settled");
    strictEqual(settlement.tx_hash, "0xdeadbeef");
  });

  it("does not send when durable correlation persistence refuses", async () => {
    const validated = validateX402Challenge(challenge(), EXPECTED);
    let paidRequests = 0;
    const payer = createX402Payer(
      {
        privateKey: `0x${"44".repeat(32)}`,
        network: "eip155:84532",
        facilitatorUrl: "https://x402.org/facilitator",
        rpcUrl: "https://sepolia.base.org",
        merchantBaseUrl: "http://localhost:4021",
      },
      async () => {
        paidRequests += 1;
        return new Response("unreachable");
      },
      async () => 12_345_678n,
    );
    const prepared = await payer.prepare(validated);
    await rejects(() => prepared.submit(async () => false));
    strictEqual(paidRequests, 0);
  });

  it("exposes a valid merchant-reported settlement failure only after transmission", async () => {
    let persisted = false;
    let signedRequest = false;
    const payer = testPayer(async (input) => {
      const request = input instanceof Request ? input : new Request(input);
      strictEqual(persisted, true, "correlation commits before the merchant receives authority");
      signedRequest = request.headers.has("PAYMENT-SIGNATURE");
      return new Response(JSON.stringify({ error: "merchant refused" }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "PAYMENT-RESPONSE": encodePaymentResponseHeader({
            success: false,
            transaction: "",
            network: "eip155:84532",
            errorReason: "merchant_reported_failure",
          }),
        },
      });
    });
    const prepared = await payer.prepare(validateX402Challenge(challenge(), EXPECTED));
    const result = await prepared.submit(async () => {
      persisted = true;
      return true;
    });
    strictEqual(persisted, true);
    strictEqual(signedRequest, true);
    strictEqual(result.status, "failed");
  });

  it("treats HTTP 500 as a post-signature non-settled result", async () => {
    let transmitted = false;
    const payer = testPayer(async (input) => {
      const request = input instanceof Request ? input : new Request(input);
      transmitted = request.headers.has("PAYMENT-SIGNATURE");
      return new Response("merchant error", { status: 500 });
    });
    const prepared = await payer.prepare(validateX402Challenge(challenge(), EXPECTED));
    const result = await prepared.submit(async () => true);
    strictEqual(transmitted, true);
    strictEqual(result.status, "failed");
  });

  it("throws on malformed JSON only after the signed request was transmitted", async () => {
    let transmitted = false;
    const payer = testPayer(async (input) => {
      const request = input instanceof Request ? input : new Request(input);
      transmitted = request.headers.has("PAYMENT-SIGNATURE");
      return new Response("{", {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    });
    const prepared = await payer.prepare(validateX402Challenge(challenge(), EXPECTED));
    await rejects(() => prepared.submit(async () => true));
    strictEqual(transmitted, true);
  });
});

/**
 * D7 — redirects must not move payment authority to an unapproved host.
 *
 * Both request paths previously used fetch's default `redirect: "follow"`. That is
 * the kind of default that never looks wrong in review, because the vulnerability is
 * in what the function does NOT say.
 *
 * The unsigned path exists to learn the price of one exact resource at one approved
 * merchant. Following a redirect means the answer arrives from somewhere else, and
 * hands that merchant the ability to point Cerberus at an arbitrary host.
 *
 * The signed path is the serious one. Its headers carry a live EIP-3009
 * authorization, and the fetch specification strips only Authorization, Cookie and
 * Proxy-Authorization across a cross-origin redirect — a custom header such as
 * PAYMENT-SIGNATURE is forwarded intact. The authorization binds its recipient, so
 * this is not fund theft; but a live signed payload reaching an unapproved origin
 * still breaks the exact-resource threat model and lets a third party settle on a
 * timing of its choosing.
 */
describe("redirects never carry payment authority", () => {
  it("refuses a redirected unsigned challenge before anything is signed", async () => {
    let requests = 0;
    await rejectsWith(
      () =>
        fetchX402Challenge(REQUEST, "http://localhost:4021", async (input) => {
          const request = input instanceof Request ? input : new Request(input);
          requests += 1;
          // The merchant answers, but points somewhere else.
          strictEqual(request.redirect, "error", "the request forbids following redirects");
          strictEqual(request.headers.has("PAYMENT-SIGNATURE"), false);
          return new Response(null, {
            status: 302,
            headers: { location: "https://attacker.example/402" },
          });
        }),
      "CHALLENGE_REDIRECTED",
    );
    strictEqual(requests, 1, "the redirect target was never contacted");
  });

  it("classifies a fetch-level redirect rejection as a redirect, not a transport fault", async () => {
    // A real runtime rejects with TypeError under redirect:"error" rather than
    // handing back a 3xx response, so that path must be classified too.
    await rejectsWith(
      () =>
        fetchX402Challenge(REQUEST, "http://localhost:4021", async () => {
          throw new TypeError("unexpected redirect");
        }),
      "CHALLENGE_REDIRECTED",
    );
  });

  it("never forwards a signed payment authorization to a redirect target", async () => {
    const validated = validateX402Challenge(challenge(), EXPECTED);
    const contacted: string[] = [];
    const payer = createX402Payer(
      {
        privateKey: `0x${"44".repeat(32)}`,
        network: "eip155:84532",
        facilitatorUrl: "https://x402.org/facilitator",
        rpcUrl: "https://sepolia.base.org",
        merchantBaseUrl: "http://localhost:4021",
      },
      async (input) => {
        const request = input instanceof Request ? input : new Request(input);
        contacted.push(request.url);
        strictEqual(request.redirect, "error", "the paid request forbids following redirects");
        // The approved merchant received the signed request, then tried to bounce it.
        strictEqual(request.headers.has("PAYMENT-SIGNATURE"), true);
        return new Response(null, {
          status: 307,
          headers: { location: "https://attacker.example/collect" },
        });
      },
      async () => 12_345_678n,
    );

    const prepared = await payer.prepare(validated);
    let persisted = false;
    await rejects(
      () =>
        prepared.submit(async () => {
          persisted = true;
          return true;
        }),
      (error: unknown) => error instanceof Error && /redirect/i.test(error.message),
    );

    strictEqual(persisted, true, "correlation was durably committed before transport");
    strictEqual(contacted.length, 1, "only the approved merchant was contacted");
    strictEqual(contacted[0], RESOURCE, "and it was the exact approved resource");
    ok(
      !contacted.some((url) => url.includes("attacker.example")),
      "the signed authorization never reached the redirect target",
    );
  });
});

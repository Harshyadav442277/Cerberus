import { rejects, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProposedAction } from "@safr/core";
import { privateKeyToAccount } from "viem/accounts";
import {
  AuthorizationError,
  InMemoryAuthorizationUseStore,
  buildExecutionTarget,
  issueExecutionAuthorization,
  isValidPrivateKey,
  verifyAndConsumeExecutionAuthorization,
  type ExecutionTarget,
  type SignedExecutionAuthorization,
} from "../index.js";

const AUTH_KEY = `0x${"11".repeat(32)}` as const;
const FORGER_KEY = `0x${"22".repeat(32)}` as const;
const NOW = 1_800_000_000_000;

const ACTION: ProposedAction = {
  action_id: "action_phase1",
  agent_id: "agent_treasury_01",
  action_type: "payment",
  proposed_at: "2026-08-18T10:00:00.000Z",
  payload: {
    counterparty: "merchant_xyz",
    amount: 0.5,
    currency: "USDC",
    purpose: "service_fulfillment",
    reference: "invoice_phase1",
  },
};

const TARGET = buildExecutionTarget(ACTION, {
  chainId: 84532,
  token: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  payTo: "0x1111111111111111111111111111111111111111",
  merchantBaseUrl: "http://localhost:4021",
});

async function envelope(
  overrides: Partial<Parameters<typeof issueExecutionAuthorization>[0]> = {},
): Promise<SignedExecutionAuthorization> {
  return issueExecutionAuthorization({
    action: ACTION,
    mandateId: "mandate_001",
    mandateVersion: 1,
    reservationId: "phase1_unreserved:audit_1",
    target: TARGET,
    authorizerPrivateKey: AUTH_KEY,
    nowMs: NOW,
    ttlSeconds: 60,
    authorizationId: "auth_phase1",
    nonce: `0x${"33".repeat(32)}`,
    ...overrides,
  });
}

async function verify(
  signed: SignedExecutionAuthorization,
  options: {
    action?: ProposedAction;
    target?: ExecutionTarget;
    store?: InMemoryAuthorizationUseStore;
    nowMs?: number;
    mandateId?: string;
    mandateVersion?: number;
    reservationId?: string;
  } = {},
) {
  return verifyAndConsumeExecutionAuthorization({
    envelope: signed,
    action: options.action ?? ACTION,
    target: options.target ?? TARGET,
    expectedAuthorizer: privateKeyToAccount(AUTH_KEY).address,
    expectedMandateId: options.mandateId ?? "mandate_001",
    expectedMandateVersion: options.mandateVersion ?? 1,
    expectedReservationId: options.reservationId ?? "phase1_unreserved:audit_1",
    useStore: options.store ?? new InMemoryAuthorizationUseStore(),
    nowMs: options.nowMs ?? NOW,
  });
}

function expectCode(code: AuthorizationError["code"]): (error: unknown) => boolean {
  return (error) => error instanceof AuthorizationError && error.code === code;
}

describe("Execution Authorization fields", () => {
  it("rejects invalid secp256k1 private scalars without constructing a signer", () => {
    strictEqual(isValidPrivateKey(AUTH_KEY), true);
    strictEqual(isValidPrivateKey(`0x${"00".repeat(32)}`), false);
    strictEqual(
      isValidPrivateKey("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141"),
      false,
    );
    strictEqual(isValidPrivateKey("not-a-key"), false);
  });

  it("binds the proposal, mandate, reservation and exact payment target", async () => {
    const signed = await envelope();
    strictEqual(signed.authorization.proposalHash.length, 66);
    strictEqual(signed.authorization.mandateId, "mandate_001");
    strictEqual(signed.authorization.mandateVersion, 1);
    strictEqual(signed.authorization.reservationId, "phase1_unreserved:audit_1");
    strictEqual(signed.authorization.chainId, 84532);
    strictEqual(signed.authorization.token, "0x036CbD53842c5426634e7929541eC2318f3dCF7e");
    strictEqual(signed.authorization.amount, "500000");
    strictEqual(signed.authorization.payTo, TARGET.payTo);
    strictEqual(signed.authorization.resourceHash, TARGET.resourceHash);
    await verify(signed);
  });

  it("rejects a signature from an untrusted authorizer", async () => {
    const forged = await envelope({ authorizerPrivateKey: FORGER_KEY });
    await rejects(() => verify(forged), expectCode("FORGED_AUTHORIZATION"));
  });

  it("rejects at the exact expiry boundary", async () => {
    const signed = await envelope({ ttlSeconds: 60 });
    await rejects(() => verify(signed, { nowMs: NOW + 60_000 }), expectCode("AUTHORIZATION_EXPIRED"));
  });

  it("rejects a mutated proposal", async () => {
    const signed = await envelope();
    const mutated = { ...ACTION, payload: { ...ACTION.payload, counterparty: "merchant_new" } };
    await rejects(() => verify(signed, { action: mutated }), expectCode("PROPOSAL_MISMATCH"));
  });
});

describe("exact target validation before key use", () => {
  for (const [label, target, code] of [
    ["chain", { ...TARGET, chainId: 1 }, "CHAIN_MISMATCH"],
    ["token", { ...TARGET, token: "0x2222222222222222222222222222222222222222" }, "TOKEN_MISMATCH"],
    ["amount", { ...TARGET, amount: "5000000" }, "AMOUNT_MISMATCH"],
    ["payee", { ...TARGET, payTo: "0x3333333333333333333333333333333333333333" }, "PAYEE_MISMATCH"],
    ["resource", { ...TARGET, resourceHash: `0x${"44".repeat(32)}` as const }, "RESOURCE_MISMATCH"],
  ] as const) {
    it(`rejects mutated ${label}`, async () => {
      await rejects(async () => verify(await envelope(), { target }), expectCode(code));
    });
  }

  it("rejects a different mandate version", async () => {
    await rejects(
      async () => verify(await envelope(), { mandateVersion: 2 }),
      expectCode("MANDATE_MISMATCH"),
    );
  });

  it("rejects a different reservation", async () => {
    await rejects(
      async () => verify(await envelope(), { reservationId: "reservation_other" }),
      expectCode("RESERVATION_MISMATCH"),
    );
  });
});

describe("single-use authorization", () => {
  it("allows the first use and rejects replay", async () => {
    const signed = await envelope();
    const store = new InMemoryAuthorizationUseStore();
    await verify(signed, { store });
    await rejects(() => verify(signed, { store }), expectCode("AUTHORIZATION_REPLAY"));
  });

  it("allows only one of two concurrent consumers", async () => {
    const signed = await envelope();
    const store = new InMemoryAuthorizationUseStore();
    const results = await Promise.allSettled([verify(signed, { store }), verify(signed, { store })]);
    strictEqual(results.filter((result) => result.status === "fulfilled").length, 1);
    strictEqual(results.filter((result) => result.status === "rejected").length, 1);
  });
});

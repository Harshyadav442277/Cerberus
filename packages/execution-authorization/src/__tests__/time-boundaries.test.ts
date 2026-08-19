import { ok, rejects, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProposedAction } from "@safr/core";
import { privateKeyToAccount } from "viem/accounts";
import {
  AuthorizationError,
  InMemoryAuthorizationUseStore,
  buildExecutionTarget,
  consumeExecutionAuthorization,
  hashProposal,
  issueExecutionAuthorization,
  verifyExecutionAuthorization,
} from "../index.js";

/**
 * D6 — time boundaries, to the millisecond.
 *
 * Expiry checks are where off-by-one errors hide most comfortably, because both the
 * correct and the incorrect version pass every test written a whole second away from
 * the boundary. These pin each comparison at exactly -1ms, the boundary itself, and
 * +1ms, so the difference between `<` and `<=` cannot pass unnoticed.
 *
 * The convention proven here, consistently in both directions: expiry is EXCLUSIVE.
 * An authority is usable strictly before its expiry instant and unusable at it. When
 * the question is "may money move", the boundary instant resolves to no.
 *
 * The matching boundaries for human approval expiry live in the db package, next to
 * evaluateApprovalFreshness itself — @safr/db is deliberately not a dependency of
 * this package, and a test is not a reason to make it one.
 */

const AUTH_KEY = `0x${"11".repeat(32)}` as const;
const NOW = 1_800_000_000_000;
const TARGET = {
  chainId: 84532,
  token: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  payTo: "0x1111111111111111111111111111111111111111",
  merchantBaseUrl: "http://localhost:4021",
};

const ACTION: ProposedAction = {
  action_id: "action_1",
  agent_id: "agent_treasury_01",
  action_type: "payment",
  proposed_at: "2026-08-18T10:00:00.000Z",
  payload: {
    counterparty: "merchant_xyz",
    amount: 0.5,
    currency: "USDC",
    purpose: "service_fulfillment",
    reference: "invoice_1",
  },
};

const TTL_SECONDS = 60;
const EXPIRES_AT = NOW + TTL_SECONDS * 1000;

async function signed() {
  return issueExecutionAuthorization({
    action: ACTION,
    mandateId: "mandate_001",
    mandateVersion: 1,
    reservationId: "res_1",
    target: buildExecutionTarget(ACTION, TARGET),
    authorizerPrivateKey: AUTH_KEY,
    nowMs: NOW,
    authorizationId: "auth_1",
    nonce: `0x${"33".repeat(32)}`,
    ttlSeconds: TTL_SECONDS,
  });
}

function verify(envelope: Awaited<ReturnType<typeof signed>>, nowMs: number) {
  return verifyExecutionAuthorization({
    envelope,
    action: ACTION,
    target: buildExecutionTarget(ACTION, TARGET),
    expectedAuthorizer: privateKeyToAccount(AUTH_KEY).address,
    expectedMandateId: "mandate_001",
    expectedMandateVersion: 1,
    expectedReservationId: "res_1",
    nowMs,
  });
}

describe("time boundaries", () => {
  describe("execution authorization expiry", () => {
    it("is usable one millisecond before expiry", async () => {
      const envelope = await signed();
      const authorization = await verify(envelope, EXPIRES_AT - 1);
      strictEqual(authorization.authorizationId, "auth_1");
    });

    it("is refused at exactly the expiry instant", async () => {
      const envelope = await signed();
      await rejects(
        () => verify(envelope, EXPIRES_AT),
        (error) => error instanceof AuthorizationError && error.code === "AUTHORIZATION_EXPIRED",
      );
    });

    it("is refused one millisecond after expiry", async () => {
      const envelope = await signed();
      await rejects(
        () => verify(envelope, EXPIRES_AT + 1),
        (error) => error instanceof AuthorizationError && error.code === "AUTHORIZATION_EXPIRED",
      );
    });

    it("is usable at the instant it was issued", async () => {
      // The lower bound matters too: an authorization that is not yet valid at its own
      // issuance instant would be unusable for its entire life.
      const envelope = await signed();
      const authorization = await verify(envelope, NOW);
      strictEqual(authorization.authorizationId, "auth_1");
    });
  });

  describe("one-shot consumption is independent of the clock", () => {
    it("refuses a replay even one millisecond after a successful first use", async () => {
      // Expiry and single-use are separate guards. A capability that is still well
      // inside its TTL must not become reusable merely because time has barely moved.
      const store = new InMemoryAuthorizationUseStore();
      const envelope = await signed();

      const first = await verify(envelope, NOW + 1);
      await consumeExecutionAuthorization(first, store);

      const second = await verify(envelope, NOW + 2);
      await rejects(
        () => consumeExecutionAuthorization(second, store),
        (error) => error instanceof AuthorizationError && error.code === "AUTHORIZATION_REPLAY",
      );
    });
  });
});

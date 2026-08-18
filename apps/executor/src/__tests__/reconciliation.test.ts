import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import type { PaymentReservation } from "@safr/db";
import type { Eip3009ChainReader } from "@safr/x402-client";
import { reconcileOne, type ReconciliationStore } from "../reconciliation.js";

const NOW = 1_800_000_000_000;
const RESERVATION: PaymentReservation = {
  reservation_id: "res_unknown",
  audit_id: "audit_unknown",
  action_id: "action_unknown",
  agent_id: "agent_a",
  mandate_id: "m_1",
  mandate_version: 1,
  budget_key: "mandate:m_1",
  currency: "USDC",
  amount_decimal: "0.5",
  amount_atomic: "500000",
  chain_id: 84532,
  token: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  status: "RECONCILING",
  authorization_id: "auth_1",
  settlement_tx: null,
  payment_payer: "0x4444444444444444444444444444444444444444",
  payment_pay_to: "0x1111111111111111111111111111111111111111",
  payment_nonce: `0x${"55".repeat(32)}`,
  payment_payload_hash: `0x${"66".repeat(32)}`,
  payment_valid_before: "1800000300",
  submission_block: "12345678",
  reconcile_after: new Date(NOW + 30_000).toISOString(),
  reconciliation_attempts: 1,
  reconciliation_token: "recon_1",
  reconciliation_error: null,
  counts_at: new Date(NOW).toISOString(),
  expires_at: new Date(NOW + 120_000).toISOString(),
  created_at: new Date(NOW).toISOString(),
  updated_at: new Date(NOW).toISOString(),
};

function harness(
  reservation: PaymentReservation | null = RESERVATION,
  chainOptions: { used?: boolean; timestamp?: bigint; exact?: boolean; throws?: boolean } = {},
) {
  const calls: string[] = [];
  let claimed = false;
  const store: ReconciliationStore = {
    async claim() {
      if (claimed) return null;
      claimed = true;
      return reservation;
    },
    async settle(_id, token, tx) {
      calls.push(`settle:${token}:${tx}`);
      return token === reservation?.reconciliation_token;
    },
    async fail(_id, token, reason) {
      calls.push(`fail:${token}:${reason}`);
      return token === reservation?.reconciliation_token;
    },
    async defer(_id, token, _after, error) {
      calls.push(`defer:${token}:${error}`);
      return token === reservation?.reconciliation_token;
    },
  };
  const chain: Eip3009ChainReader = {
    async latestTimestamp() {
      if (chainOptions.throws) throw new Error("RPC unavailable");
      return chainOptions.timestamp ?? 1_800_000_000n;
    },
    async authorizationState() {
      if (chainOptions.throws) throw new Error("RPC unavailable");
      return chainOptions.used ?? false;
    },
    async authorizationTransactions() {
      return [`0x${"aa".repeat(32)}`];
    },
    async hasExactSuccessfulTransfer() {
      return chainOptions.exact ?? false;
    },
  };
  return { store, chain, calls };
}

describe("OUTCOME_UNKNOWN reconciliation worker", () => {
  it("recovers a settled payment after restart without constructing a second payment", async () => {
    const h = harness(RESERVATION, { used: true, exact: true });
    deepStrictEqual(
      await reconcileOne({ store: h.store, chain: h.chain, nowMs: () => NOW }),
      { outcome: "settled", reservationId: RESERVATION.reservation_id },
    );
    strictEqual(h.calls.length, 1);
    strictEqual(h.calls[0]?.startsWith("settle:recon_1:"), true);
  });

  it("releases only an authorization proven unused after chain expiry", async () => {
    const h = harness(RESERVATION, { used: false, timestamp: 1_800_000_300n });
    strictEqual(
      (await reconcileOne({ store: h.store, chain: h.chain, nowMs: () => NOW })).outcome,
      "failed",
    );
    strictEqual(h.calls[0]?.includes("safe to retry"), true);
  });

  it("keeps an unexpired authorization capacity-holding and schedules another read", async () => {
    const h = harness(RESERVATION, { used: false, timestamp: 1_800_000_299n });
    strictEqual(
      (await reconcileOne({ store: h.store, chain: h.chain, nowMs: () => NOW })).outcome,
      "deferred",
    );
    strictEqual(h.calls[0]?.includes("authorization_still_live"), true);
  });

  it("defers on RPC failure instead of guessing non-payment", async () => {
    const h = harness(RESERVATION, { throws: true });
    strictEqual(
      (await reconcileOne({ store: h.store, chain: h.chain, nowMs: () => NOW })).outcome,
      "deferred",
    );
    strictEqual(h.calls[0]?.includes("RPC unavailable"), true);
  });

  it("safely fails a pre-transport crash with no persisted attempt", async () => {
    const h = harness({
      ...RESERVATION,
      payment_payer: null,
      payment_pay_to: null,
      payment_nonce: null,
      payment_payload_hash: null,
      payment_valid_before: null,
      submission_block: null,
    });
    strictEqual(
      (await reconcileOne({ store: h.store, chain: h.chain, nowMs: () => NOW })).outcome,
      "failed",
    );
    strictEqual(h.calls[0]?.includes("no persisted payment attempt"), true);
  });
});

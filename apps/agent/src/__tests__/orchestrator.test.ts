/**
 * Phase 4 Definition of Done, part 1 — the gate behaves correctly.
 *
 * The central assertion is negative: on DENY the x402 client's `pay` is NEVER
 * invoked. Observing that a payment "failed" would not satisfy this, so the spy also
 * tracks whether the settlement port was ever even constructed.
 */
import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import { createEscalationRegistry } from "../escalations.js";
import { runAction } from "../orchestrator.js";
import {
  auditSpy,
  action,
  authorizationSpy,
  autoEscalation,
  controlsPort,
  settlementSpy,
} from "./harness.js";

describe("DENY — the payment is never constructed", () => {
  it("does not invoke pay(), and does not even construct the settlement port", async () => {
    const { factory, spy } = settlementSpy();
    const auth = authorizationSpy();
    const outcome = await runAction(action({ counterparty: "merchant_abc", amount: 5.0 }), {
      controls: controlsPort(),
      audit: auditSpy(),
      escalations: autoEscalation("approved"),
      authorization: auth.factory,
      settlement: factory,
    });

    strictEqual(outcome.status, "denied");
    strictEqual(outcome.disposition?.disposition, "DENY");
    strictEqual(outcome.disposition?.rule, "spend_caps.per_transaction_max");

    // The Definition of Done, stated three ways.
    strictEqual(spy.callCount, 0, "pay() must never be invoked on a DENY");
    strictEqual(spy.constructedCount, 0, "the settlement port must never be constructed");
    strictEqual(auth.constructedCount(), 0, "DENY must not construct an authorization client");
    strictEqual(outcome.settlementAttempted, false);
    strictEqual(outcome.settlement, null);
  });

  it("still writes an audit record for the refusal", async () => {
    const audit = auditSpy();
    const { factory } = settlementSpy();
    await runAction(action({ counterparty: "merchant_abc", amount: 5.0 }), {
      controls: controlsPort(),
      audit,
      escalations: autoEscalation("approved"),
      authorization: authorizationSpy().factory,
      settlement: factory,
    });

    strictEqual(audit.records.length, 1);
    strictEqual(audit.records[0]?.disposition, "DENY");
    strictEqual(audit.records[0]?.rule_triggered, "spend_caps.per_transaction_max");
    strictEqual(audit.settlements.length, 0);
  });

  it("refuses when no mandate is in force, without reaching settlement", async () => {
    const { factory, spy } = settlementSpy();
    const outcome = await runAction(action(), {
      controls: controlsPort({ rolling_total_24h: 0, hourly_tx_count: 0 }, null),
      audit: auditSpy(),
      escalations: autoEscalation("approved"),
      authorization: authorizationSpy().factory,
      settlement: factory,
    });

    strictEqual(outcome.status, "no_mandate");
    strictEqual(spy.callCount, 0);
    strictEqual(spy.constructedCount, 0);
  });
});

describe("ESCALATE — held until a human decides", () => {
  it("does not invoke pay() until the decision resolves approved", async () => {
    const registry = createEscalationRegistry();
    const { factory, spy } = settlementSpy();
    const proposed = action({ counterparty: "merchant_new", amount: 0.75 });

    const running = runAction(proposed, {
      controls: controlsPort(),
      audit: auditSpy(),
      escalations: registry,
      authorization: authorizationSpy().factory,
      settlement: factory,
    });

    // Let the orchestrator reach the hold, then confirm nothing has been paid.
    await new Promise((resolve) => setImmediate(resolve));
    strictEqual(spy.callCount, 0, "pay() must not be invoked while the action is held");
    strictEqual(spy.constructedCount, 0);
    deepStrictEqual(registry.pending(), [proposed.action_id]);

    registry.submitDecision(proposed.action_id, {
      reviewer_id: "compliance_officer_01",
      decision: "approved",
      decided_at: "2026-08-07T14:32:03.000Z",
      note: "Known supplier, verified out of band.",
    });

    const outcome = await running;
    strictEqual(outcome.status, "settled");
    strictEqual(spy.callCount, 1, "pay() runs exactly once, after approval");
    strictEqual(outcome.humanReview?.decision, "approved");
  });

  it("never invokes pay() when the reviewer denies", async () => {
    const registry = createEscalationRegistry();
    const { factory, spy } = settlementSpy();
    const auth = authorizationSpy();
    const proposed = action({ counterparty: "merchant_new", amount: 0.75 });
    const running = runAction(proposed, {
      controls: controlsPort(),
      audit: auditSpy(),
      escalations: registry,
      authorization: auth.factory,
      settlement: factory,
    });

    await new Promise((resolve) => setImmediate(resolve));
    strictEqual(auth.constructedCount(), 0, "unapproved ESCALATE must not reach authorizer");
    strictEqual(spy.constructedCount, 0, "unapproved ESCALATE must not reach payment");

    registry.submitDecision(proposed.action_id, {
      reviewer_id: "compliance_officer_01",
      decision: "denied",
      decided_at: "2026-08-07T14:32:03.000Z",
      note: "Could not verify counterparty",
    });
    const outcome = await running;

    strictEqual(outcome.status, "escalation_denied");
    strictEqual(auth.constructedCount(), 0);
    strictEqual(spy.callCount, 0);
    strictEqual(spy.constructedCount, 0);
    strictEqual(outcome.humanReview?.decision, "denied");
  });

  it("records the human decision against the audit record", async () => {
    const audit = auditSpy();
    const { factory } = settlementSpy();
    await runAction(action({ counterparty: "merchant_new", amount: 0.75 }), {
      controls: controlsPort(),
      audit,
      escalations: autoEscalation("approved"),
      authorization: authorizationSpy().factory,
      settlement: factory,
    });

    strictEqual(audit.records[0]?.disposition, "ESCALATE");
    strictEqual(audit.humanReviews.length, 1);
    strictEqual(audit.humanReviews[0]?.auditId, audit.records[0]?.audit_id);
    strictEqual(audit.humanReviews[0]?.review.decision, "approved");
  });
});

describe("ALLOW — settlement proceeds", () => {
  it("fails closed when the trusted authorizer refuses and never constructs settlement", async () => {
    const audit = auditSpy();
    const auth = authorizationSpy({ fail: true });
    const { factory, spy } = settlementSpy();
    const outcome = await runAction(action(), {
      controls: controlsPort(),
      audit,
      escalations: autoEscalation("approved"),
      authorization: auth.factory,
      settlement: factory,
    });

    strictEqual(outcome.status, "authorization_failed");
    strictEqual(outcome.authorizationAttempted, true);
    strictEqual(outcome.settlementAttempted, false);
    strictEqual(spy.constructedCount, 0);
    strictEqual(audit.finalized.length, 1);
  });

  it("invokes pay() exactly once and writes the settlement back", async () => {
    const audit = auditSpy();
    const { factory, spy } = settlementSpy();
    const outcome = await runAction(action({ counterparty: "merchant_xyz", amount: 0.5 }), {
      controls: controlsPort(),
      audit,
      escalations: autoEscalation("approved"),
      authorization: authorizationSpy().factory,
      settlement: factory,
    });

    strictEqual(outcome.status, "settled");
    strictEqual(outcome.disposition?.rule, null);
    strictEqual(spy.callCount, 1);
    strictEqual(spy.calls[0]?.audit_id, "audit_1");
    strictEqual(spy.calls[0]?.envelope.authorization.authorizationId, "auth_test");
    strictEqual(audit.settlements.length, 1);
    strictEqual(audit.settlements[0]?.settlement.tx_hash, "0xdeadbeef");
    // No human is involved in a clean ALLOW.
    strictEqual(audit.humanReviews.length, 0);
    strictEqual(outcome.humanReview, null);
  });

  it("reports a failed settlement without claiming success", async () => {
    const { factory } = settlementSpy({ status: "failed", tx_hash: null, settled_at: null });
    const outcome = await runAction(action(), {
      controls: controlsPort(),
      audit: auditSpy(),
      escalations: autoEscalation("approved"),
      authorization: authorizationSpy().factory,
      settlement: factory,
    });

    strictEqual(outcome.status, "settlement_failed");
    strictEqual(outcome.settlementAttempted, true);
    strictEqual(outcome.settlement?.tx_hash, null);
  });

  it("on a thrown pay(), still writes a failed settlement and finalizes", async () => {
    const audit = auditSpy();
    const { spy } = settlementSpy();
    const factory = () => {
      spy.constructedCount += 1;
      return {
        async pay() {
          spy.callCount += 1;
          throw new Error("facilitator unreachable (simulated)");
        },
      };
    };

    const outcome = await runAction(action(), {
      controls: controlsPort(),
      audit,
      escalations: autoEscalation("approved"),
      authorization: authorizationSpy().factory,
      settlement: factory,
    });

    strictEqual(outcome.status, "settlement_failed");
    strictEqual(outcome.settlementAttempted, true);
    strictEqual(outcome.settlement?.status, "failed");
    strictEqual(outcome.settlement?.tx_hash, null);
    strictEqual(audit.settlements.length, 1);
    strictEqual(audit.settlements[0]?.settlement.status, "failed");
    strictEqual(audit.finalized.length, 1, "terminal anchor must still run after a thrown pay()");
  });
});

describe("the engine's verdict is what drives the branch", () => {
  it("a rolling-window breach denies even though the amount is under the per-tx cap", async () => {
    const { factory, spy } = settlementSpy();
    const outcome = await runAction(action({ amount: 0.5 }), {
      controls: controlsPort({ rolling_total_24h: 2.8, hourly_tx_count: 0 }),
      audit: auditSpy(),
      escalations: autoEscalation("approved"),
      authorization: authorizationSpy().factory,
      settlement: factory,
    });

    strictEqual(outcome.disposition?.rule, "spend_caps.rolling_window");
    strictEqual(spy.callCount, 0);
  });

  it("velocity escalates rather than denying, and settles once approved", async () => {
    const { factory, spy } = settlementSpy();
    const outcome = await runAction(action(), {
      controls: controlsPort({ rolling_total_24h: 0, hourly_tx_count: 10 }),
      audit: auditSpy(),
      escalations: autoEscalation("approved"),
      authorization: authorizationSpy().factory,
      settlement: factory,
    });

    strictEqual(outcome.disposition?.disposition, "ESCALATE");
    strictEqual(outcome.disposition?.rule, "velocity.max_transactions_per_hour");
    strictEqual(spy.callCount, 1);
  });
});

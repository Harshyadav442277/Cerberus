/**
 * Phase 3 Definition of Done.
 *
 * One test per branch of Bible Section 7.4 — including the two the demo script never
 * hits (time_window, velocity) — plus the two corrections that must not regress and
 * the generality proof for demo scenario 3.
 */
import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluate } from "../evaluate.js";
import { MANDATE, NO_PRIOR_ACTIVITY, PROPOSED_AT, action, mandateWith } from "./fixtures.js";

describe("evaluate() — Bible Section 7.4 branches in order", () => {
  it("1. denies an action type outside scope", () => {
    const result = evaluate(action({ action_type: "wire_transfer" }), MANDATE, NO_PRIOR_ACTIVITY);
    deepStrictEqual(result, {
      disposition: "DENY",
      reason: "action_type_out_of_scope",
      rule: "scope.action_types",
    });
  });

  it("1b. denies a currency outside scope", () => {
    const result = evaluate(action({ currency: "EURC" }), MANDATE, NO_PRIOR_ACTIVITY);
    deepStrictEqual(result, {
      disposition: "DENY",
      reason: "currency_out_of_scope",
      rule: "scope.currencies",
    });
  });

  it("2. denies a payment over the per-transaction cap", () => {
    const result = evaluate(action({ amount: 5.0 }), MANDATE, NO_PRIOR_ACTIVITY);
    deepStrictEqual(result, {
      disposition: "DENY",
      reason: "per_transaction_cap_exceeded",
      rule: "spend_caps.per_transaction_max",
    });
  });

  it("2. denies a payment that would breach the rolling 24h cap", () => {
    // 2.80 already spent + 0.50 proposed = 3.30, over the 3.00 rolling cap, while the
    // 0.50 itself is under the 1.00 per-transaction cap.
    const result = evaluate(action({ amount: 0.5 }), MANDATE, {
      rolling_total_24h: 2.8,
      hourly_tx_count: 0,
    });
    deepStrictEqual(result, {
      disposition: "DENY",
      reason: "rolling_window_cap_exceeded",
      rule: "spend_caps.rolling_window",
    });
  });

  it("2. allows a payment that exactly reaches the rolling cap without exceeding it", () => {
    const result = evaluate(action({ amount: 0.5 }), MANDATE, {
      rolling_total_24h: 2.5,
      hourly_tx_count: 0,
    });
    strictEqual(result.disposition, "ALLOW");
  });

  it("3. escalates an unknown counterparty, per the mandate's configured disposition", () => {
    const result = evaluate(action({ counterparty: "merchant_new" }), MANDATE, NO_PRIOR_ACTIVITY);
    deepStrictEqual(result, {
      disposition: "ESCALATE",
      reason: "counterparty_not_on_allowlist",
      rule: "counterparty_policy",
    });
  });

  it("4. denies a payment outside the allowed time window", () => {
    const mandate = mandateWith((m) => {
      m.controls.time_window.allowed_hours_utc = ["09:00-17:00"];
    });
    // 14:32 UTC is inside 09:00-17:00, so shift to 22:00 to fall outside it.
    const result = evaluate(
      action({ proposed_at: "2026-08-07T22:00:00.000Z" }),
      mandate,
      NO_PRIOR_ACTIVITY,
    );
    deepStrictEqual(result, {
      disposition: "DENY",
      reason: "outside_allowed_time_window",
      rule: "time_window",
    });
  });

  it("4. denies a payment on a day outside allowed_days", () => {
    const mandate = mandateWith((m) => {
      m.controls.time_window.allowed_days = ["Mon", "Tue", "Wed", "Thu", "Fri"];
    });
    // 2026-08-08 is a Saturday.
    const result = evaluate(
      action({ proposed_at: "2026-08-08T14:32:00.000Z" }),
      mandate,
      NO_PRIOR_ACTIVITY,
    );
    strictEqual(result.rule, "time_window");
    strictEqual(result.disposition, "DENY");
  });

  it("5. escalates when the velocity threshold is reached", () => {
    const result = evaluate(action(), MANDATE, {
      rolling_total_24h: 0,
      hourly_tx_count: 10,
    });
    deepStrictEqual(result, {
      disposition: "ESCALATE",
      reason: "velocity_threshold_exceeded",
      rule: "velocity.max_transactions_per_hour",
    });
  });

  it("6. allows a clean in-mandate payment with rule explicitly null", () => {
    const result = evaluate(action(), MANDATE, NO_PRIOR_ACTIVITY);
    deepStrictEqual(result, {
      disposition: "ALLOW",
      reason: "within_mandate",
      rule: null,
    });
  });
});

describe("check ordering — hard boundaries resolve before judgment-based checks", () => {
  it("prefers DENY on the cap over ESCALATE on the counterparty", () => {
    // Violates both check 2 (cap) and check 3 (allowlist). Section 7.4's ordering
    // means the unambiguous violation wins.
    const result = evaluate(
      action({ amount: 5.0, counterparty: "merchant_new" }),
      MANDATE,
      NO_PRIOR_ACTIVITY,
    );
    strictEqual(result.disposition, "DENY");
    strictEqual(result.rule, "spend_caps.per_transaction_max");
  });

  it("prefers DENY on scope over DENY on the cap", () => {
    const result = evaluate(
      action({ action_type: "wire_transfer", amount: 5.0 }),
      MANDATE,
      NO_PRIOR_ACTIVITY,
    );
    strictEqual(result.rule, "scope.action_types");
  });

  it("prefers ESCALATE on the counterparty over ESCALATE on velocity", () => {
    const result = evaluate(action({ counterparty: "merchant_new" }), MANDATE, {
      rolling_total_24h: 0,
      hourly_tx_count: 10,
    });
    strictEqual(result.rule, "counterparty_policy");
  });
});

describe("the engine is general, not scripted", () => {
  it("scenario 3 follows unknown_counterparty_disposition with NO code change", () => {
    // The generality proof required by the Phase 3 DoD: flipping one mandate field
    // changes the outcome. Nothing about 'merchant_new' is special-cased.
    const escalating = evaluate(
      action({ counterparty: "merchant_new" }),
      MANDATE,
      NO_PRIOR_ACTIVITY,
    );
    strictEqual(escalating.disposition, "ESCALATE");

    const denying = evaluate(
      action({ counterparty: "merchant_new" }),
      mandateWith((m) => {
        m.controls.counterparty_policy.unknown_counterparty_disposition = "DENY";
      }),
      NO_PRIOR_ACTIVITY,
    );
    strictEqual(denying.disposition, "DENY");

    const observing = evaluate(
      action({ counterparty: "merchant_new" }),
      mandateWith((m) => {
        m.controls.counterparty_policy.unknown_counterparty_disposition = "OBSERVE";
      }),
      NO_PRIOR_ACTIVITY,
    );
    strictEqual(observing.disposition, "OBSERVE");

    // The reason and rule are identical across all three — only the disposition moves.
    strictEqual(escalating.reason, "counterparty_not_on_allowlist");
    strictEqual(denying.reason, "counterparty_not_on_allowlist");
    strictEqual(observing.reason, "counterparty_not_on_allowlist");
  });

  it("adding a counterparty to the allowlist is data, not code", () => {
    const result = evaluate(
      action({ counterparty: "merchant_new" }),
      mandateWith((m) => {
        m.controls.counterparty_policy.allowlist.push("merchant_new");
      }),
      NO_PRIOR_ACTIVITY,
    );
    strictEqual(result.disposition, "ALLOW");
  });
});

describe("every triggered path populates rule (Bible Section 7.4 correction 2)", () => {
  const triggeringCases: Array<[string, () => ReturnType<typeof evaluate>]> = [
    ["scope.action_types", () => evaluate(action({ action_type: "x" }), MANDATE, NO_PRIOR_ACTIVITY)],
    ["scope.currencies", () => evaluate(action({ currency: "EURC" }), MANDATE, NO_PRIOR_ACTIVITY)],
    ["per_transaction_max", () => evaluate(action({ amount: 99 }), MANDATE, NO_PRIOR_ACTIVITY)],
    [
      "rolling_window",
      () => evaluate(action(), MANDATE, { rolling_total_24h: 2.9, hourly_tx_count: 0 }),
    ],
    [
      "counterparty_policy",
      () => evaluate(action({ counterparty: "nope" }), MANDATE, NO_PRIOR_ACTIVITY),
    ],
    [
      "time_window",
      () =>
        evaluate(
          action({ proposed_at: "2026-08-07T22:00:00.000Z" }),
          mandateWith((m) => {
            m.controls.time_window.allowed_hours_utc = ["09:00-17:00"];
          }),
          NO_PRIOR_ACTIVITY,
        ),
    ],
    ["velocity", () => evaluate(action(), MANDATE, { rolling_total_24h: 0, hourly_tx_count: 10 })],
  ];

  for (const [label, run] of triggeringCases) {
    it(`${label} sets a non-null rule and a non-empty reason`, () => {
      const result = run();
      strictEqual(typeof result.rule, "string");
      strictEqual(result.rule!.length > 0, true);
      strictEqual(result.reason.length > 0, true);
    });
  }

  it("only the clean ALLOW has a null rule", () => {
    strictEqual(evaluate(action(), MANDATE, NO_PRIOR_ACTIVITY).rule, null);
  });
});

describe("determinism", () => {
  it("returns an identical result for identical inputs", () => {
    const proposed = action({ counterparty: "merchant_new" });
    const counters = { rolling_total_24h: 1.2, hourly_tx_count: 3 };
    const first = evaluate(proposed, MANDATE, counters);
    const second = evaluate(proposed, MANDATE, counters);
    deepStrictEqual(first, second);
  });

  it("does not mutate its inputs", () => {
    const proposed = action();
    const proposedBefore = structuredClone(proposed);
    const mandateBefore = structuredClone(MANDATE);
    const counters = { rolling_total_24h: 0.5, hourly_tx_count: 1 };
    const countersBefore = structuredClone(counters);

    evaluate(proposed, MANDATE, counters);

    deepStrictEqual(proposed, proposedBefore);
    deepStrictEqual(MANDATE, mandateBefore);
    deepStrictEqual(counters, countersBefore);
  });

  it("depends on proposed_at rather than the wall clock", () => {
    // Same action evaluated twice against a narrow window must agree regardless of
    // when the test happens to run.
    const mandate = mandateWith((m) => {
      m.controls.time_window.allowed_hours_utc = ["14:00-15:00"];
      m.controls.time_window.allowed_days = ["Fri"];
    });
    strictEqual(evaluate(action({ proposed_at: PROPOSED_AT }), mandate, NO_PRIOR_ACTIVITY).disposition, "ALLOW");
    strictEqual(
      evaluate(action({ proposed_at: "2026-08-07T03:00:00.000Z" }), mandate, NO_PRIOR_ACTIVITY)
        .disposition,
      "DENY",
    );
  });
});

describe("the three demo scenarios (Bible Section 9)", () => {
  it("scenario 1 — clean transaction to an allowlisted merchant is ALLOW", () => {
    const result = evaluate(
      action({ counterparty: "merchant_xyz", amount: 0.5 }),
      MANDATE,
      NO_PRIOR_ACTIVITY,
    );
    strictEqual(result.disposition, "ALLOW");
    strictEqual(result.rule, null);
  });

  it("scenario 2 — cap breach is DENY on spend_caps.per_transaction_max", () => {
    const result = evaluate(
      action({ counterparty: "merchant_abc", amount: 5.0 }),
      MANDATE,
      NO_PRIOR_ACTIVITY,
    );
    strictEqual(result.disposition, "DENY");
    strictEqual(result.rule, "spend_caps.per_transaction_max");
  });

  it("scenario 3 — new counterparty under the cap is ESCALATE", () => {
    const result = evaluate(
      action({ counterparty: "merchant_new", amount: 0.75 }),
      MANDATE,
      NO_PRIOR_ACTIVITY,
    );
    strictEqual(result.disposition, "ESCALATE");
    strictEqual(result.rule, "counterparty_policy");
  });
});

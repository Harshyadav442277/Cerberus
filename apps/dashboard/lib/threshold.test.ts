import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { thresholdVsActual } from "./threshold.js";

const MANDATE = {
  scope: { action_types: ["payment"], currencies: ["USDC"] },
  controls: {
    spend_caps: {
      per_transaction_max: 1.0,
      rolling_window: { window: "24h", max_total: 3.0 },
    },
    counterparty_policy: {
      mode: "allowlist",
      allowlist: ["merchant_xyz", "merchant_abc"],
      unknown_counterparty_disposition: "ESCALATE",
    },
    velocity: { max_transactions_per_hour: 10 },
  },
};

describe("thresholdVsActual — Design §5.2", () => {
  it("shows per_transaction_max vs proposed amount for scenario 2", () => {
    const result = thresholdVsActual(
      "spend_caps.per_transaction_max",
      MANDATE,
      { counterparty: "merchant_abc", amount: 5, currency: "USDC" },
    );
    assert.deepEqual(result, {
      control: "spend_caps.per_transaction_max",
      threshold: "1",
      actual: "proposed 5",
    });
  });

  it("returns null for a clean ALLOW", () => {
    assert.equal(
      thresholdVsActual(null, MANDATE, {
        counterparty: "merchant_xyz",
        amount: 0.5,
        currency: "USDC",
      }),
      null,
    );
  });

  it("names the unknown counterparty against the allowlist", () => {
    const result = thresholdVsActual("counterparty_policy", MANDATE, {
      counterparty: "merchant_new",
      amount: 0.75,
      currency: "USDC",
    });
    assert.equal(result?.actual, "merchant_new");
    assert.match(result?.threshold ?? "", /merchant_xyz/);
  });
});

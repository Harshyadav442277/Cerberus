import { strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import { MandateSchema } from "../schemas/mandate.js";

function mandate(window: string) {
  return {
    mandate_id: "mandate_window",
    agent_id: "agent_window",
    version: 1,
    effective_from: "2026-08-01T00:00:00.000Z",
    effective_to: null,
    status: "active",
    scope: { action_types: ["payment"], currencies: ["USDC"] },
    controls: {
      spend_caps: {
        per_transaction_max: 1,
        rolling_window: { window, max_total: 3 },
      },
      counterparty_policy: {
        mode: "allowlist",
        allowlist: ["merchant_xyz"],
        unknown_counterparty_disposition: "ESCALATE",
      },
      time_window: {
        allowed_hours_utc: ["00:00-23:59"],
        allowed_days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      },
      velocity: { max_transactions_per_hour: 10 },
    },
    default_disposition_on_breach: "DENY",
    created_by: "test",
    approved_by: "test",
  };
}

describe("mandate duration boundaries", () => {
  it("refuses a zero-length rolling window", () => {
    strictEqual(MandateSchema.safeParse(mandate("0h")).success, false);
    strictEqual(MandateSchema.safeParse(mandate("00d")).success, false);
  });

  it("accepts supported positive hour and day windows", () => {
    strictEqual(MandateSchema.safeParse(mandate("24h")).success, true);
    strictEqual(MandateSchema.safeParse(mandate("7d")).success, true);
    strictEqual(MandateSchema.safeParse(mandate("24 h")).success, true);
  });
});

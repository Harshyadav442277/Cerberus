import type { Mandate, ProposedAction } from "@safr/core";
import type { Counters } from "../types.js";

/**
 * Mirrors the seeded mandate in packages/db/src/seed-data.ts. Duplicated here rather
 * than imported so the engine package depends on nothing but @safr/core — the purity
 * guarantee the Phase 3 Definition of Done requires.
 */
export const MANDATE: Mandate = {
  mandate_id: "mandate_001",
  agent_id: "agent_treasury_01",
  version: 1,
  effective_from: "2026-08-06T00:00:00.000Z",
  effective_to: null,
  status: "active",
  scope: {
    action_types: ["payment"],
    currencies: ["USDC"],
  },
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
    time_window: {
      allowed_hours_utc: ["00:00-23:59"],
      allowed_days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    },
    velocity: { max_transactions_per_hour: 10 },
  },
  default_disposition_on_breach: "DENY",
  created_by: "compliance_officer_01",
  approved_by: "compliance_officer_01",
};

/** 2026-08-07 is a Friday, 14:32 UTC — inside every seeded window. */
export const PROPOSED_AT = "2026-08-07T14:32:00.000Z";

export const NO_PRIOR_ACTIVITY: Counters = {
  rolling_total_24h: 0,
  hourly_tx_count: 0,
};

export function action(overrides: {
  action_type?: string;
  proposed_at?: string;
  counterparty?: string;
  amount?: number;
  currency?: string;
} = {}): ProposedAction {
  return {
    action_id: "action_00042",
    agent_id: "agent_treasury_01",
    action_type: overrides.action_type ?? "payment",
    proposed_at: overrides.proposed_at ?? PROPOSED_AT,
    payload: {
      counterparty: overrides.counterparty ?? "merchant_xyz",
      amount: overrides.amount ?? 0.5,
      currency: overrides.currency ?? "USDC",
      purpose: "service_fulfillment",
      reference: "invoice_884",
    },
  };
}

/** Deep clone so a test mutating a mandate cannot leak into another test. */
export function mandateWith(mutate: (m: Mandate) => void): Mandate {
  const copy = structuredClone(MANDATE);
  mutate(copy);
  return copy;
}

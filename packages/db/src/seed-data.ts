import type { AgentIdentity, Mandate } from "@safr/core";

/**
 * Seed data for the demo.
 *
 * Field names and structure are exactly Bible Sections 7.1 and 7.2. Only the numeric
 * values differ from the Bible's illustrative figures: the Bible shows
 * per_transaction_max 1000 with a 500 payment, which testnet USDC faucets cannot
 * fund. Confirmed with the project owner on Aug 7 (Memory.md, B4).
 *
 *   per_transaction_max     1.00 USDC
 *   rolling_window.max_total 3.00 USDC
 *   clean demo payment      0.50 USDC  -> ALLOW
 *   cap-breach attempt      5.00 USDC  -> DENY  (spend_caps.per_transaction_max)
 *   unknown counterparty    0.75 USDC  -> ESCALATE (counterparty_policy)
 */

export const SEED_AGENT: AgentIdentity = {
  agent_id: "agent_treasury_01",
  display_name: "Treasury Payments Agent",
  owner_org: "acme_corp",
  created_at: "2026-08-06T09:00:00.000Z",
  // Overwritten by the seed CLI from the public EXECUTOR_WALLET_ADDRESS setting.
  // when one is configured, so the dashboard shows the wallet actually paying.
  wallet_address: "0x0000000000000000000000000000000000000000",
  status: "active",
};

export const SEED_MANDATE: Mandate = {
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
      // Makes the ambiguous demo case rule-driven rather than special-cased.
      unknown_counterparty_disposition: "ESCALATE",
    },
    time_window: {
      allowed_hours_utc: ["00:00-23:59"],
      // Bible Section 7.2 illustrates Mon-Fri. Widened to all seven days as a
      // seed-value change only (Memory.md B5, confirmed Aug 7): the time_window
      // rule is check 4 in the Section 7.4 order, so a Mon-Fri window would resolve
      // demo scenario 1 to DENY on a weekend — and Stage 2 judging is Aug 21-23,
      // which spans Saturday and Sunday. The rule remains fully enforced; only the
      // seeded value is wider.
      allowed_days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    },
    velocity: { max_transactions_per_hour: 10 },
  },

  default_disposition_on_breach: "DENY",
  created_by: "compliance_officer_01",
  approved_by: "compliance_officer_01",
};

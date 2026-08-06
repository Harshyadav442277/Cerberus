import type { AuditLogRecord } from "@safr/core";

/** A clean ALLOW: `rule_triggered` is explicitly null, per Bible Section 7.4. */
export const ALLOW_RECORD: AuditLogRecord = {
  audit_id: "audit_00000001",
  action_id: "action_00000001",
  agent_id: "agent_treasury_01",
  mandate_id: "mandate_001",
  mandate_version: 1,
  disposition: "ALLOW",
  reason: "within_mandate",
  rule_triggered: null,
  evaluated_at: "2026-08-07T14:32:01.000Z",
  human_review: null,
  settlement: {
    status: "settled",
    tx_hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    rail: "x402",
    settled_at: "2026-08-07T14:32:05.000Z",
  },
};

/** A DENY: the rule that fired is named, and `settlement` is null because none happened. */
export const DENY_RECORD: AuditLogRecord = {
  audit_id: "audit_00000002",
  action_id: "action_00000002",
  agent_id: "agent_treasury_01",
  mandate_id: "mandate_001",
  mandate_version: 1,
  disposition: "DENY",
  reason: "per_transaction_cap_exceeded",
  rule_triggered: "spend_caps.per_transaction_max",
  evaluated_at: "2026-08-07T14:32:10.000Z",
  human_review: null,
  settlement: null,
};

/** An ESCALATE carrying both the original proposal's verdict and the human decision. */
export const ESCALATE_RECORD: AuditLogRecord = {
  audit_id: "audit_00000003",
  action_id: "action_00000003",
  agent_id: "agent_treasury_01",
  mandate_id: "mandate_001",
  mandate_version: 1,
  disposition: "ESCALATE",
  reason: "counterparty_not_on_allowlist",
  rule_triggered: "counterparty_policy",
  evaluated_at: "2026-08-07T14:32:20.000Z",
  human_review: {
    reviewer_id: "compliance_officer_01",
    decision: "approved",
    decided_at: "2026-08-07T14:32:25.000Z",
    note: "Known supplier, verified out of band.",
  },
  settlement: {
    status: "settled",
    tx_hash: "0x2222222222222222222222222222222222222222222222222222222222222222",
    rail: "x402",
    settled_at: "2026-08-07T14:32:30.000Z",
  },
};

export const ALL_RECORDS = [ALLOW_RECORD, DENY_RECORD, ESCALATE_RECORD];

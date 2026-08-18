export type Disposition = "ALLOW" | "DENY" | "ESCALATE" | "OBSERVE";

export interface HumanReview {
  reviewer_id: string;
  decision: "approved" | "denied";
  decided_at: string;
  note: string;
}

export interface Settlement {
  status: "settled" | "failed";
  tx_hash: string | null;
  rail: "x402";
  settled_at: string | null;
}

export interface AuditRecord {
  audit_id: string;
  action_id: string;
  agent_id: string;
  mandate_id: string;
  mandate_version: number;
  disposition: Disposition;
  reason: string;
  rule_triggered: string | null;
  evaluated_at: string;
  human_review: HumanReview | null;
  settlement: Settlement | null;
}

export interface ProposedAction {
  action_id: string;
  agent_id: string;
  action_type: string;
  proposed_at: string;
  payload: {
    counterparty: string;
    amount: number;
    currency: string;
    purpose: string;
    reference: string;
  };
}

export interface Anchor {
  audit_id: string;
  record_hash: string;
  anchor_tx_hash: string | null;
  status: "pending" | "anchored" | "failed";
  created_at: string;
  anchored_at: string | null;
  error: string | null;
}

export interface FeedItem {
  record: AuditRecord;
  action: ProposedAction;
  anchor?: Anchor | null;
  execution: ExecutionState | null;
}

export interface ExecutionState {
  reservation_id: string;
  status:
    | "RESERVED"
    | "AUTHORIZED"
    | "SUBMITTING"
    | "SETTLED"
    | "FAILED"
    | "OUTCOME_UNKNOWN"
    | "RECONCILING"
    | "EXPIRED";
  settlement_tx: string | null;
  reconciliation_attempts: number;
  reconciliation_error: string | null;
}

export interface Health {
  ok: boolean;
  database: "up" | "down";
  network: string;
  network_label: string;
  facilitator: string;
  audit_anchor_configured: boolean;
  at: string;
}

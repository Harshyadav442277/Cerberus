import type { FeedItem, ProposedAction } from "./types";

export type JudgeScenario = "deny" | "escalate" | "allow";
export type JudgeScenarioId =
  | "deny-cap-breach"
  | "escalate-new-counterparty"
  | "allow-valid-payment";

export interface JudgeOutcome {
  status:
    | "settled"
    | "settlement_failed"
    | "settlement_unknown"
    | "authorization_failed"
    | "denied"
    | "escalation_denied"
    | "no_mandate";
  audit: { audit_id: string } | null;
  settlement: FeedItem["record"]["settlement"];
  authorizationId: string | null;
  authorizationAttempted: boolean;
  settlementAttempted: boolean;
}

export interface JudgeRun {
  run_id: string;
  scenario: JudgeScenarioId;
  status: "RUNNING" | "COMPLETE" | "FAILED";
  started_at: string;
  finished_at: string | null;
  action: ProposedAction;
  outcome: JudgeOutcome | null;
  error: string | null;
}

export interface ReadinessCheck {
  status: "READY" | "UNAVAILABLE";
  detail: string;
}

export interface JudgeReadiness {
  ok: boolean;
  checked_at: string;
  checks: {
    api: ReadinessCheck;
    database: ReadinessCheck;
    merchant: ReadinessCheck;
    executor: ReadinessCheck;
    reviewer: ReadinessCheck;
    reconciler: ReadinessCheck;
    anchor: ReadinessCheck;
    chain: ReadinessCheck;
  };
}

export interface UnknownChainCheck {
  ok: boolean;
  checked_at: string;
  chain_id: number;
  chain_block: string;
  authorization_consumed: boolean;
  validity_expired: boolean;
  settlement_transaction: null;
}

export interface SettlementChainCheck {
  ok: boolean;
  checked_at: string;
  chain_id: number;
  receipt: "SUCCESS" | "FAILED";
  transaction: string;
  block_number: string;
  transfer: {
    from: string;
    to: string;
    amount_atomic: string;
    amount_usdc: string;
  } | null;
}

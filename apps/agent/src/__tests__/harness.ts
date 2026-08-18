import type {
  AuditLogRecord,
  Disposition,
  HumanReview,
  Mandate,
  ProposedAction,
  Settlement,
} from "@safr/core";
import type { Counters } from "@safr/disposition-engine";
import type { SignedExecutionAuthorization } from "@safr/execution-authorization";
import type {
  AuditPort,
  AuthorizationPort,
  ControlsPort,
  EscalationPort,
  SettlementPort,
} from "../ports.js";
import { AuthorizationRefusalError } from "../ports.js";

export const MANDATE: Mandate = {
  mandate_id: "mandate_001",
  agent_id: "agent_treasury_01",
  version: 1,
  effective_from: "2026-08-06T00:00:00.000Z",
  effective_to: null,
  status: "active",
  scope: { action_types: ["payment"], currencies: ["USDC"] },
  controls: {
    spend_caps: { per_transaction_max: 1.0, rolling_window: { window: "24h", max_total: 3.0 } },
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

export function action(overrides: { counterparty?: string; amount?: number } = {}): ProposedAction {
  return {
    action_id: `action_${overrides.counterparty ?? "x"}_${overrides.amount ?? 0}`,
    agent_id: "agent_treasury_01",
    action_type: "payment",
    proposed_at: "2026-08-07T14:32:00.000Z",
    payload: {
      counterparty: overrides.counterparty ?? "merchant_xyz",
      amount: overrides.amount ?? 0.5,
      currency: "USDC",
      purpose: "service_fulfillment",
      reference: "invoice_884",
    },
  };
}

export function controlsPort(
  counters: Counters = { rolling_total_24h: 0, hourly_tx_count: 0 },
  mandate: Mandate | null = MANDATE,
): ControlsPort {
  return {
    async loadEvaluationContext() {
      return { mandate, counters };
    },
  };
}

export interface SettlementSpy extends SettlementPort {
  /** How many times the x402 client was actually reached. */
  callCount: number;
  /** How many times the settlement port was even constructed. */
  constructedCount: number;
  calls: Parameters<SettlementPort["pay"]>[0][];
}

/**
 * Stands in for `apps/agent/src/settlement`.
 *
 * Tracks construction separately from invocation, because Phase 4's Definition of
 * Done distinguishes "the payment failed" from "the payment was never attempted". A
 * spy that only counted `pay` calls could not tell the difference.
 */
export function settlementSpy(result?: Partial<Settlement>): {
  factory: () => SettlementPort;
  spy: SettlementSpy;
} {
  const spy: SettlementSpy = {
    callCount: 0,
    constructedCount: 0,
    calls: [],
    async pay(request): Promise<Settlement> {
      spy.callCount += 1;
      spy.calls.push(request);
      return {
        status: "settled",
        tx_hash: "0xdeadbeef",
        rail: "x402",
        settled_at: "2026-08-07T14:32:05.000Z",
        ...result,
      };
    },
  };

  return {
    spy,
    factory: () => {
      spy.constructedCount += 1;
      return spy;
    },
  };
}

export const TEST_AUTHORIZATION: SignedExecutionAuthorization = {
  authorization: {
    authorizationId: "auth_test",
    proposalHash: `0x${"11".repeat(32)}`,
    mandateId: "mandate_001",
    mandateVersion: 1,
    reservationId: "phase1_unreserved:audit_1",
    chainId: 84532,
    token: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    amount: "500000",
    payTo: "0x1111111111111111111111111111111111111111",
    resourceHash: `0x${"22".repeat(32)}`,
    expiresAt: 2_000_000_000,
    nonce: `0x${"33".repeat(32)}`,
  },
  signature: `0x${"44".repeat(65)}`,
};

export function authorizationSpy(options: {
  fail?: boolean;
  velocityEscalationOnce?: boolean;
} = {}): {
  factory: () => AuthorizationPort;
  constructedCount: () => number;
  callCount: () => number;
} {
  let constructed = 0;
  let calls = 0;
  return {
    constructedCount: () => constructed,
    callCount: () => calls,
    factory: () => {
      constructed += 1;
      return {
        async issue() {
          calls += 1;
          if (options.velocityEscalationOnce && calls === 1) {
            throw new AuthorizationRefusalError("VELOCITY_ESCALATION_REQUIRED");
          }
          if (options.fail) throw new Error("authorization refused (simulated)");
          return TEST_AUTHORIZATION;
        },
      };
    },
  };
}

export interface AuditSpy extends AuditPort {
  records: AuditLogRecord[];
  settlements: Array<{ auditId: string; settlement: Settlement }>;
  finalized: string[];
}

export function auditSpy(): AuditSpy {
  const spy: AuditSpy = {
    records: [],
    settlements: [],
    finalized: [],
    async record(
      proposedAction: ProposedAction,
      mandate: Mandate,
      disposition: Disposition,
    ): Promise<AuditLogRecord> {
      const record: AuditLogRecord = {
        audit_id: `audit_${spy.records.length + 1}`,
        action_id: proposedAction.action_id,
        agent_id: proposedAction.agent_id,
        mandate_id: mandate.mandate_id,
        mandate_version: mandate.version,
        disposition: disposition.disposition,
        reason: disposition.reason,
        rule_triggered: disposition.rule,
        evaluated_at: "2026-08-07T14:32:01.000Z",
        human_review: null,
        settlement: null,
      };
      spy.records.push(record);
      return record;
    },
    async recordSettlement(auditId: string, settlement: Settlement): Promise<void> {
      spy.settlements.push({ auditId, settlement });
    },
    async finalize(auditId: string): Promise<`0x${string}` | null> {
      spy.finalized.push(auditId);
      return "0xabc";
    },
  };
  return spy;
}

export function autoEscalation(
  decision: "approved" | "denied",
  onCall?: () => void,
): EscalationPort {
  return {
    async awaitDecision(): Promise<HumanReview> {
      onCall?.();
      return {
        reviewer_id: "compliance_officer_01",
        decision,
        decided_at: "2026-08-07T14:32:03.000Z",
        note: "test",
      };
    },
  };
}

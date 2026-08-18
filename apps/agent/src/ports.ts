import type { AuditLogRecord, Disposition, HumanReview, ProposedAction } from "@safr/core";
import type { Counters } from "@safr/disposition-engine";
import type { SignedExecutionAuthorization } from "@safr/execution-authorization";

/**
 * The collaborators the orchestrator talks to.
 *
 * They are interfaces rather than direct imports for one specific reason: Phase 4's
 * Definition of Done requires PROVING that the x402 client's `pay` is never invoked on
 * a DENY path. A spy can only stand in for a real settlement port if the orchestrator
 * depends on the shape, not on the module.
 */

/** Mandate and counter state, resolved at the action's `proposed_at`. */
export interface ControlsPort {
  loadEvaluationContext(
    agentId: string,
    at: string,
  ): Promise<{ mandate: import("@safr/core").Mandate | null; counters: Counters }>;
}

export interface SettlementPort {
  /**
   * Executes the payment. The FIRST thing in the whole program that touches x402.
   * Reaching this method at all is what the DENY tests assert can never happen.
   */
  pay(request: {
    audit_id: string;
    envelope: SignedExecutionAuthorization;
  }): Promise<import("@safr/core").Settlement>;
}

export interface AuthorizationPort {
  /** Requests a signed capability from the trusted Cerberus control-plane process. */
  issue(auditId: string): Promise<SignedExecutionAuthorization>;
}

export interface EscalationPort {
  /** Blocks until a compliance officer decides. */
  awaitDecision(actionId: string): Promise<HumanReview>;
}

export interface AuditPort {
  /** Writes the Section 7.5 record. Called for every disposition, including DENY. */
  record(
    action: ProposedAction,
    mandate: import("@safr/core").Mandate,
    disposition: Disposition,
  ): Promise<AuditLogRecord>;
  recordSettlement(auditId: string, settlement: import("@safr/core").Settlement): Promise<void>;
  /**
   * Anchors the record once it can no longer change. Called at every terminal point,
   * so a DENY is anchored just as an ALLOW is. Must never throw — anchoring cannot be
   * allowed to affect a disposition (Architecture 6.1).
   */
  finalize(auditId: string): Promise<`0x${string}` | null>;
}

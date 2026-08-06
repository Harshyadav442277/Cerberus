import type { AuditLogRecord, Disposition, HumanReview, ProposedAction, Settlement } from "@safr/core";
import { evaluate } from "@safr/disposition-engine";
import type { AuditPort, ControlsPort, EscalationPort, SettlementPort } from "./ports.js";

export interface OrchestratorDeps {
  controls: ControlsPort;
  audit: AuditPort;
  escalations: EscalationPort;
  /**
   * Deliberately a factory, not an instance. On DENY it is never called, so on a
   * denied action the settlement module is not merely unused — it is never even
   * constructed. Nothing that could build an HTTP request comes into existence.
   */
  settlement: () => SettlementPort;
}

export type OutcomeStatus =
  | "settled"
  | "settlement_failed"
  | "denied"
  | "escalation_denied"
  | "no_mandate";

export interface Outcome {
  status: OutcomeStatus;
  action: ProposedAction;
  disposition: Disposition | null;
  audit: AuditLogRecord | null;
  humanReview: HumanReview | null;
  settlement: Settlement | null;
  /** Whether the x402 client was reached at all. Asserted in the DoD tests. */
  settlementAttempted: boolean;
}

/**
 * The SAFR gate — Architecture 2.2, Bible Section 6.
 *
 * The order of the statements below is the entire point of the project, so read it as
 * a sequence rather than as plumbing:
 *
 *   1. resolve the mandate in force at the action's `proposed_at`
 *   2. evaluate — a pure function, no I/O, no network
 *   3. write the audit record, whatever the outcome
 *   4. return early on DENY, and on an escalation that was not approved
 *   5. ONLY THEN construct the settlement port and pay
 *
 * There is no proxy, no interceptor and no patched `fetch` anywhere in this path. On a
 * DENY the function returns before `deps.settlement()` is ever called, so no request
 * object is created and then discarded — none is created at all. That distinction is
 * what Bible Section 6 calls the "pre-execution premise", and it is what the tests in
 * `__tests__/interception.test.ts` verify rather than assume.
 */
export async function runAction(
  action: ProposedAction,
  deps: OrchestratorDeps,
): Promise<Outcome> {
  const base = {
    action,
    disposition: null,
    audit: null,
    humanReview: null,
    settlement: null,
    settlementAttempted: false,
  } satisfies Omit<Outcome, "status">;

  const { mandate, counters } = await deps.controls.loadEvaluationContext(
    action.agent_id,
    action.proposed_at,
  );

  // No mandate in force means nothing authorises this agent to spend. Refusing is the
  // only safe reading; an absent mandate must never be treated as an absent limit.
  if (mandate === null) return { ...base, status: "no_mandate" };

  const disposition = evaluate(action, mandate, counters);
  const audit = await deps.audit.record(action, mandate, disposition);

  if (disposition.disposition === "DENY") {
    return { ...base, status: "denied", disposition, audit };
  }

  // OBSERVE is "log without gating" (Bible Section 4, PRD 4.3): it records the
  // observation and then lets the payment through. It is deliberately NOT a soft
  // DENY. No seeded rule emits it, but treating it as blocking here would silently
  // change its meaning if a mandate ever configured it.

  let humanReview: HumanReview | null = null;
  if (disposition.disposition === "ESCALATE") {
    humanReview = await deps.escalations.awaitDecision(action.action_id);
    await deps.audit.recordHumanReview(audit.audit_id, humanReview);

    if (humanReview.decision !== "approved") {
      return { ...base, status: "escalation_denied", disposition, audit, humanReview };
    }
  }

  // Reachable only on ALLOW, or ESCALATE that a human approved.
  const settlement = await deps.settlement().pay(action);
  await deps.audit.recordSettlement(audit.audit_id, settlement);

  return {
    ...base,
    status: settlement.status === "settled" ? "settled" : "settlement_failed",
    disposition,
    audit,
    humanReview,
    settlement,
    settlementAttempted: true,
  };
}

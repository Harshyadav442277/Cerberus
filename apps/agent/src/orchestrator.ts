import type { AuditLogRecord, Disposition, HumanReview, ProposedAction, Settlement } from "@safr/core";
import { evaluate } from "@safr/disposition-engine";
import type {
  AuditPort,
  AuthorizationPort,
  ControlsPort,
  EscalationPort,
  SettlementPort,
} from "./ports.js";
import { AuthorizationRefusalError } from "./ports.js";

export interface OrchestratorDeps {
  controls: ControlsPort;
  audit: AuditPort;
  escalations: EscalationPort;
  /** Factory so DENY never even constructs the control-plane authorization client. */
  authorization: () => AuthorizationPort;
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
  | "settlement_unknown"
  | "authorization_failed"
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
  authorizationId: string | null;
  authorizationAttempted: boolean;
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
    authorizationId: null,
    authorizationAttempted: false,
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
  let effectiveDisposition = disposition;
  let effectiveAudit = audit;

  if (disposition.disposition === "DENY") {
    await deps.audit.finalize(audit.audit_id);
    return { ...base, status: "denied", disposition, audit };
  }

  // OBSERVE is "log without gating" (Bible Section 4, PRD 4.3): it records the
  // observation and then lets the payment through. It is deliberately NOT a soft
  // DENY. No seeded rule emits it, but treating it as blocking here would silently
  // change its meaning if a mandate ever configured it.

  let humanReview: HumanReview | null = null;
  if (disposition.disposition === "ESCALATE") {
    // The trusted control plane atomically persists both human_review and its bound
    // human_approval before the polling agent can observe this decision.
    humanReview = await deps.escalations.awaitDecision(action.action_id);

    if (humanReview.decision !== "approved") {
      await deps.audit.finalize(audit.audit_id);
      return { ...base, status: "escalation_denied", disposition, audit, humanReview };
    }
  }

  // Reachable only on ALLOW, or ESCALATE that a human approved.
  let envelope: Awaited<ReturnType<AuthorizationPort["issue"]>>;
  const authorization = deps.authorization();
  try {
    envelope = await authorization.issue(audit.audit_id);
  } catch (error) {
    if (
      error instanceof AuthorizationRefusalError &&
      error.code === "VELOCITY_ESCALATION_REQUIRED"
    ) {
      // Two clean evaluations can race while both see count=0. The trusted control
      // plane has now serialized them, promoted this audit to ESCALATE, and minted no
      // capability. Observe a real reviewer decision before making one bounded retry.
      effectiveDisposition = {
        disposition: "ESCALATE",
        reason: "velocity_threshold_exceeded",
        rule: "velocity.max_transactions_per_hour",
      };
      effectiveAudit = {
        ...audit,
        disposition: "ESCALATE",
        reason: effectiveDisposition.reason,
        rule_triggered: effectiveDisposition.rule,
      };
      humanReview = await deps.escalations.awaitDecision(action.action_id);
      if (humanReview.decision !== "approved") {
        await deps.audit.finalize(audit.audit_id);
        return {
          ...base,
          status: "escalation_denied",
          disposition: effectiveDisposition,
          audit: effectiveAudit,
          humanReview,
          authorizationAttempted: true,
        };
      }

      try {
        envelope = await authorization.issue(audit.audit_id);
      } catch {
        await deps.audit.finalize(audit.audit_id);
        return {
          ...base,
          status: "authorization_failed",
          disposition: effectiveDisposition,
          audit: effectiveAudit,
          humanReview,
          authorizationAttempted: true,
        };
      }
    } else {
      await deps.audit.finalize(audit.audit_id);
      return {
        ...base,
        status: "authorization_failed",
        disposition: effectiveDisposition,
        audit: effectiveAudit,
        humanReview,
        authorizationAttempted: true,
      };
    }
  }

  // The agent passes only a signed capability and audit identifier to the isolated
  // executor. It never receives, imports, or derives the payment private key.
  //
  // A soft failure is positive rail evidence and is terminal. A throw is different:
  // the executor request or chain response may have disappeared after money moved.
  // Never synthesize `failed`, write a false audit settlement, or anchor a supposedly
  // terminal record. Durable reservation state and the keyless reconciler own it.
  let settlement: Settlement;
  try {
    settlement = await deps.settlement().pay({ audit_id: audit.audit_id, envelope });
  } catch {
    return {
      ...base,
      status: "settlement_unknown",
      disposition: effectiveDisposition,
      audit: effectiveAudit,
      humanReview,
      settlement: null,
      authorizationId: envelope.authorization.authorizationId,
      authorizationAttempted: true,
      settlementAttempted: true,
    };
  }

  try {
    await deps.audit.recordSettlement(audit.audit_id, settlement);
  } finally {
    // finalize even if the settlement write itself fails — the disposition already
    // happened and the digest must still be computable from the stored row.
    await deps.audit.finalize(audit.audit_id);
  }

  return {
    ...base,
    status: settlement.status === "settled" ? "settled" : "settlement_failed",
    disposition: effectiveDisposition,
    audit: effectiveAudit,
    humanReview,
    settlement,
    authorizationId: envelope.authorization.authorizationId,
    authorizationAttempted: true,
    settlementAttempted: true,
  };
}

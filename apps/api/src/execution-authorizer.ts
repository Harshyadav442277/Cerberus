import { randomBytes, randomUUID } from "node:crypto";
import type { AgentIdentity, AuditLogRecord, Mandate, ProposedAction } from "@safr/core";
import { evaluate } from "@safr/disposition-engine";
import type {
  ApprovalFreshness,
  HumanApprovalBinding,
  PaymentReservation,
  RecordAuthorizationInput,
  ReserveBudgetInput,
  ReserveBudgetResult,
} from "@safr/db";
import { evaluateApprovalFreshness } from "@safr/db";
import {
  BASE_SEPOLIA_USDC,
  atomicUnitsToDecimal,
  buildExecutionTarget,
  exactDecimalString,
  hashProposal,
  isValidPrivateKey,
  issueExecutionAuthorization,
  type SignedExecutionAuthorization,
  type TargetConfig,
} from "@safr/execution-authorization";
import type { Counters } from "@safr/disposition-engine";
import type { Hex } from "viem";
import { isAddress } from "viem";

export class AuthorizationIssuanceError extends Error {
  constructor(
    public readonly code:
      | "AUDIT_NOT_FOUND"
      | "ACTION_NOT_FOUND"
      | "NO_ACTIVE_MANDATE"
      | "AUDIT_CONTEXT_MISMATCH"
      | "DISPOSITION_NOT_EXECUTABLE"
      | "HUMAN_APPROVAL_REQUIRED"
      | "AUTHORIZER_NOT_CONFIGURED"
      /** The shared mandate budget cannot cover this proposal right now. */
      | "INSUFFICIENT_BUDGET"
      /** Atomic velocity enforcement found that this proposal now needs review. */
      | "VELOCITY_ESCALATION_REQUIRED"
      /** This reservation already backs an authorization. One proposal, one capability. */
      | "AUTHORIZATION_ALREADY_ISSUED"
      /** No mandate authorises this agent at execution time. Revoked, or lapsed. */
      | "MANDATE_REVOKED"
      /** The mandate in force now is not the one this decision was made under. */
      | "STALE_MANDATE"
      /** Current authority no longer permits this proposal: limits or allowlist changed. */
      | "CURRENT_AUTHORITY_DENIES"
      /** The human approval no longer covers what is about to happen. */
      | "STALE_APPROVAL"
      /** The agent is suspended, or has no identity at all. Suspension is a kill
       *  switch, not a label: a suspended agent receives no new capability. */
      | "AGENT_SUSPENDED"
      /** A live reservation exists for this proposal but describes a different
       *  payment. Never reused, never silently replaced. */
      | "RESERVATION_CONTEXT_MISMATCH",
  ) {
    super(code);
    this.name = "AuthorizationIssuanceError";
  }
}

export interface EvaluationContext {
  mandate: Mandate | null;
  counters: Counters;
}

export interface AuthorizationContextPort {
  getAudit(auditId: string): Promise<AuditLogRecord | null>;
  getAction(actionId: string): Promise<ProposedAction | null>;
  loadEvaluationContext(agentId: string, at: string): Promise<EvaluationContext>;
  /** The approval binding for an escalated audit, if a human ever decided it. */
  getApproval(auditId: string): Promise<HumanApprovalBinding | null>;
  /**
   * The agent's trusted identity, read from the database at issuance time.
   *
   * Never supplied by the caller. A hostile agent asking for a capability must not
   * also be the source of truth for whether it is still allowed to hold one.
   */
  getAgent(agentId: string): Promise<AgentIdentity | null>;
}

/** The financial-state boundary. Injected so the authorizer stays unit-testable. */
export interface ReservationPort {
  reserve(input: ReserveBudgetInput): Promise<ReserveBudgetResult>;
  bindAuthorization(
    reservationId: string,
    authorizationId: string,
  ): Promise<PaymentReservation | null>;
  recordIssued(input: RecordAuthorizationInput): Promise<unknown>;
  /** Trusted audit transition when the transaction-time velocity check escalates. */
  promoteVelocityEscalation(auditId: string): Promise<boolean>;
}

export interface ExecutionAuthorizerOptions {
  context: AuthorizationContextPort;
  reservations: ReservationPort;
  authorizerPrivateKey: string;
  target: Omit<TargetConfig, "token"> & { token?: string };
  nowMs?: () => number;
}

/** Maps a stale-approval reason onto the refusal the caller sees. */
function approvalRefusal(freshness: Extract<ApprovalFreshness, { usable: false }>) {
  return new AuthorizationIssuanceError(
    freshness.reason === "MISSING" || freshness.reason === "DENIED"
      ? "HUMAN_APPROVAL_REQUIRED"
      : "STALE_APPROVAL",
  );
}

export function createExecutionAuthorizer(options: ExecutionAuthorizerOptions): {
  issue(auditId: string): Promise<SignedExecutionAuthorization>;
} {
  return {
    async issue(auditId): Promise<SignedExecutionAuthorization> {
      if (
        !isValidPrivateKey(options.authorizerPrivateKey) ||
        !isAddress(options.target.payTo) ||
        !Number.isInteger(options.target.chainId) ||
        options.target.chainId <= 0 ||
        !URL.canParse(options.target.merchantBaseUrl)
      ) {
        throw new AuthorizationIssuanceError("AUTHORIZER_NOT_CONFIGURED");
      }
      const nowMs = options.nowMs?.() ?? Date.now();
      const nowIso = new Date(nowMs).toISOString();

      const audit = await options.context.getAudit(auditId);
      if (!audit) throw new AuthorizationIssuanceError("AUDIT_NOT_FOUND");
      const action = await options.context.getAction(audit.action_id);
      if (!action) throw new AuthorizationIssuanceError("ACTION_NOT_FOUND");

      // ── Kill-switch question: may this agent hold financial authority at all? ──
      // Checked before policy evaluation and, critically, before any reservation is
      // committed, so a suspension already in force never consumes budget. An agent
      // with no identity row is treated exactly like a suspended one: authority must
      // be positively established, never assumed from an absence.
      const agent = await options.context.getAgent(action.agent_id);
      if (!agent || agent.status !== "active") {
        throw new AuthorizationIssuanceError("AGENT_SUSPENDED");
      }

      // ── Historical question: was this proposal within its mandate when proposed? ──
      // This is what the audit record asserts, and it is reconstructed at proposed_at
      // so a later mandate edit cannot retroactively rewrite a past decision.
      const historical = await options.context.loadEvaluationContext(
        action.agent_id,
        action.proposed_at,
      );
      const mandate = historical.mandate;
      if (!mandate) throw new AuthorizationIssuanceError("NO_ACTIVE_MANDATE");
      if (
        audit.action_id !== action.action_id ||
        audit.agent_id !== action.agent_id ||
        audit.mandate_id !== mandate.mandate_id ||
        audit.mandate_version !== mandate.version
      ) {
        throw new AuthorizationIssuanceError("AUDIT_CONTEXT_MISMATCH");
      }

      const disposition = evaluate(action, mandate, historical.counters);
      if (disposition.disposition === "DENY") {
        throw new AuthorizationIssuanceError("DISPOSITION_NOT_EXECUTABLE");
      }
      // A concurrent velocity race is discovered only when reservation transactions
      // serialize. The trusted control plane records that later, stronger verdict on
      // the original audit row. It is the sole legitimate difference from the pure
      // historical evaluation; every other mismatch remains evidence of tampering.
      const velocityPromotedAudit =
        audit.disposition === "ESCALATE" &&
        audit.reason === "velocity_threshold_exceeded" &&
        audit.rule_triggered === "velocity.max_transactions_per_hour" &&
        (disposition.disposition === "ALLOW" || disposition.disposition === "OBSERVE");
      if (audit.disposition !== disposition.disposition && !velocityPromotedAudit) {
        throw new AuthorizationIssuanceError("AUDIT_CONTEXT_MISMATCH");
      }

      // ── Current question: is it still permitted, right now? ──
      // A correct historical record is not permission. The mandate may have been
      // revoked, superseded, had its limits tightened, or had the counterparty
      // removed since the proposal was evaluated, and none of that changes what the
      // audit record correctly says about the past.
      const current = await options.context.loadEvaluationContext(action.agent_id, nowIso);
      if (!current.mandate) throw new AuthorizationIssuanceError("MANDATE_REVOKED");
      if (
        current.mandate.mandate_id !== audit.mandate_id ||
        current.mandate.version !== audit.mandate_version
      ) {
        throw new AuthorizationIssuanceError("STALE_MANDATE");
      }

      // Re-run the rules under current authority. This is what catches limits edited
      // in place and a counterparty removed from the allowlist — changes that do not
      // move the version number but do change what the agent may do.
      const currentDisposition = evaluate(action, current.mandate, current.counters);
      if (currentDisposition.disposition === "DENY") {
        throw new AuthorizationIssuanceError("CURRENT_AUTHORITY_DENIES");
      }

      // An escalation needs a human decision that still covers this exact proposal,
      // under this exact mandate version, and has not aged out. The audit record's
      // human_review says a human decided; the binding says what they decided about.
      let velocityOverrideApproved = false;
      if (
        disposition.disposition === "ESCALATE" ||
        currentDisposition.disposition === "ESCALATE" ||
        velocityPromotedAudit
      ) {
        const freshness = evaluateApprovalFreshness(
          await options.context.getApproval(audit.audit_id),
          {
            proposalHash: hashProposal(action),
            currentMandateId: current.mandate.mandate_id,
            currentMandateVersion: current.mandate.version,
            nowMs,
          },
        );
        if (!freshness.usable) throw approvalRefusal(freshness);
        // The decision binds this exact proposal and current mandate version. It may
        // therefore occupy a velocity slot beyond the automatic threshold.
        velocityOverrideApproved = true;
      }

      const token = options.target.token ?? BASE_SEPOLIA_USDC;
      const target = buildExecutionTarget(action, { ...options.target, token });

      // Phase 2 gate. `evaluate()` answers a policy question from settled-only
      // counters; two concurrent proposals both read the same headroom there. The
      // reservation is the financial gate, taken under a lock on the mandate itself.
      const reservation = await options.reservations.reserve({
        auditId: audit.audit_id,
        actionId: action.action_id,
        agentId: action.agent_id,
        mandateId: current.mandate.mandate_id,
        mandateVersion: current.mandate.version,
        currency: action.payload.currency,
        // Derived from the atomic amount rather than from the payload float, so the
        // amount reserved and the amount paid cannot drift apart.
        amountDecimal: atomicUnitsToDecimal(target.amount),
        amountAtomic: target.amount,
        chainId: target.chainId,
        token: target.token,
        maxTotal: exactDecimalString(current.mandate.controls.spend_caps.rolling_window.max_total),
        rollingWindow: current.mandate.controls.spend_caps.rolling_window.window,
        velocityLimit: current.mandate.controls.velocity.max_transactions_per_hour,
        velocityOverrideApproved,
      });
      if (reservation.outcome === "agent_suspended") {
        // Suspended between the check above and the reservation transaction. The
        // transaction refused, so no capacity was committed.
        throw new AuthorizationIssuanceError("AGENT_SUSPENDED");
      }
      if (reservation.outcome === "context_mismatch") {
        throw new AuthorizationIssuanceError("RESERVATION_CONTEXT_MISMATCH");
      }
      if (reservation.outcome === "insufficient_budget") {
        throw new AuthorizationIssuanceError("INSUFFICIENT_BUDGET");
      }
      if (reservation.outcome === "velocity_escalation") {
        const promoted = await options.reservations.promoteVelocityEscalation(audit.audit_id);
        if (!promoted) throw new AuthorizationIssuanceError("AUDIT_CONTEXT_MISMATCH");
        throw new AuthorizationIssuanceError("VELOCITY_ESCALATION_REQUIRED");
      }

      // One reservation backs at most one Execution Authorization, ever. The
      // identifier is durably bound BEFORE it is signed, so a second request for the
      // same audit loses this compare-and-set instead of minting a second capability.
      const authorizationId = `auth_${randomUUID()}`;
      const bound = await options.reservations.bindAuthorization(
        reservation.reservation.reservation_id,
        authorizationId,
      );
      // A lost compare-and-set means this reservation is no longer bindable: either
      // another request already claimed it, or it aged past its TTL between the commit
      // above and here. Both refuse, and refusing is the only safe reading of either.
      if (!bound) throw new AuthorizationIssuanceError("AUTHORIZATION_ALREADY_ISSUED");

      // The capability is recorded BEFORE it is signed. There is therefore never a
      // moment where a validly signed authorization is in circulation that the durable
      // one-shot store has not heard of. A crash between these two statements leaves an
      // ISSUED row that no signature exists for, which is inert and expires on its own.
      const ttlSeconds = 60;
      const nonce = `0x${randomBytes(32).toString("hex")}` as Hex;
      const expiresAtSeconds = Math.floor(nowMs / 1000) + ttlSeconds;
      await options.reservations.recordIssued({
        authorizationId,
        reservationId: bound.reservation_id,
        auditId: audit.audit_id,
        actionId: action.action_id,
        proposalHash: hashProposal(action),
        mandateId: current.mandate.mandate_id,
        mandateVersion: current.mandate.version,
        nonce,
        expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
        issuedAt: nowIso,
      });

      return issueExecutionAuthorization({
        action,
        mandateId: current.mandate.mandate_id,
        mandateVersion: current.mandate.version,
        reservationId: bound.reservation_id,
        target,
        authorizerPrivateKey: options.authorizerPrivateKey as Hex,
        authorizationId,
        nonce,
        ttlSeconds,
        nowMs,
      });
    },
  };
}

import { randomUUID } from "node:crypto";
import type { AuditLogRecord, ProposedAction } from "@safr/core";
import { evaluate } from "@safr/disposition-engine";
import type { PaymentReservation, ReserveBudgetInput, ReserveBudgetResult } from "@safr/db";
import {
  BASE_SEPOLIA_USDC,
  atomicUnitsToDecimal,
  buildExecutionTarget,
  exactDecimalString,
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
      /** This reservation already backs an authorization. One proposal, one capability. */
      | "AUTHORIZATION_ALREADY_ISSUED",
  ) {
    super(code);
    this.name = "AuthorizationIssuanceError";
  }
}

export interface AuthorizationContextPort {
  getAudit(auditId: string): Promise<AuditLogRecord | null>;
  getAction(actionId: string): Promise<ProposedAction | null>;
  loadEvaluationContext(
    agentId: string,
    at: string,
  ): Promise<{
    mandate: import("@safr/core").Mandate | null;
    counters: Counters;
  }>;
}

/** The financial-state boundary. Injected so the authorizer stays unit-testable. */
export interface ReservationPort {
  reserve(input: ReserveBudgetInput): Promise<ReserveBudgetResult>;
  bindAuthorization(
    reservationId: string,
    authorizationId: string,
  ): Promise<PaymentReservation | null>;
}

export interface ExecutionAuthorizerOptions {
  context: AuthorizationContextPort;
  reservations: ReservationPort;
  authorizerPrivateKey: string;
  target: Omit<TargetConfig, "token"> & { token?: string };
  nowMs?: () => number;
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
      const audit = await options.context.getAudit(auditId);
      if (!audit) throw new AuthorizationIssuanceError("AUDIT_NOT_FOUND");
      const action = await options.context.getAction(audit.action_id);
      if (!action) throw new AuthorizationIssuanceError("ACTION_NOT_FOUND");
      const { mandate, counters } = await options.context.loadEvaluationContext(
        action.agent_id,
        action.proposed_at,
      );
      if (!mandate) throw new AuthorizationIssuanceError("NO_ACTIVE_MANDATE");
      if (
        audit.action_id !== action.action_id ||
        audit.agent_id !== action.agent_id ||
        audit.mandate_id !== mandate.mandate_id ||
        audit.mandate_version !== mandate.version
      ) {
        throw new AuthorizationIssuanceError("AUDIT_CONTEXT_MISMATCH");
      }

      const disposition = evaluate(action, mandate, counters);
      if (disposition.disposition === "DENY") {
        throw new AuthorizationIssuanceError("DISPOSITION_NOT_EXECUTABLE");
      }
      if (disposition.disposition === "ESCALATE" && audit.human_review?.decision !== "approved") {
        throw new AuthorizationIssuanceError("HUMAN_APPROVAL_REQUIRED");
      }
      if (audit.disposition !== disposition.disposition) {
        throw new AuthorizationIssuanceError("AUDIT_CONTEXT_MISMATCH");
      }

      const token = options.target.token ?? BASE_SEPOLIA_USDC;
      const target = buildExecutionTarget(action, { ...options.target, token });

      // Phase 2 gate. `evaluate()` above answers the HISTORICAL question — was this
      // proposal within its mandate at proposed_at — from counters that only see
      // spend which already settled. That is the right basis for the audit record and
      // the wrong basis for spending money: two concurrent proposals both read the
      // same headroom there. The reservation below is the financial gate, taken under
      // a lock on the mandate itself, and it is what actually bounds the budget.
      const reservation = await options.reservations.reserve({
        auditId: audit.audit_id,
        actionId: action.action_id,
        agentId: action.agent_id,
        mandateId: mandate.mandate_id,
        mandateVersion: mandate.version,
        currency: action.payload.currency,
        // Derived from the atomic amount rather than from the payload float, so the
        // amount reserved and the amount paid cannot drift apart.
        amountDecimal: atomicUnitsToDecimal(target.amount),
        amountAtomic: target.amount,
        chainId: target.chainId,
        token: target.token,
        maxTotal: exactDecimalString(mandate.controls.spend_caps.rolling_window.max_total),
        rollingWindow: mandate.controls.spend_caps.rolling_window.window,
      });
      if (reservation.outcome === "insufficient_budget") {
        throw new AuthorizationIssuanceError("INSUFFICIENT_BUDGET");
      }

      // One reservation backs at most one Execution Authorization, ever. The identifier
      // is durably bound BEFORE it is signed, so a second request for the same audit
      // loses this compare-and-set instead of minting a second executable capability.
      // This is the fix for "same audit -> AUTH A + AUTH B -> both execute".
      const authorizationId = `auth_${randomUUID()}`;
      const bound = await options.reservations.bindAuthorization(
        reservation.reservation.reservation_id,
        authorizationId,
      );
      // A lost compare-and-set means this reservation is no longer bindable: either
      // another request already claimed it, or it aged past its TTL between the commit
      // above and here. Both refuse, and refusing is the only safe reading of either.
      if (!bound) throw new AuthorizationIssuanceError("AUTHORIZATION_ALREADY_ISSUED");

      return issueExecutionAuthorization({
        action,
        mandateId: mandate.mandate_id,
        mandateVersion: mandate.version,
        reservationId: bound.reservation_id,
        target,
        authorizerPrivateKey: options.authorizerPrivateKey as Hex,
        authorizationId,
        nowMs: options.nowMs?.(),
      });
    },
  };
}

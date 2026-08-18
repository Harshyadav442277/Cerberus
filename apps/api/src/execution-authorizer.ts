import type { AuditLogRecord, ProposedAction } from "@safr/core";
import { evaluate } from "@safr/disposition-engine";
import {
  BASE_SEPOLIA_USDC,
  buildExecutionTarget,
  isValidPrivateKey,
  issueExecutionAuthorization,
  phase1ReservationId,
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
      | "AUTHORIZER_NOT_CONFIGURED",
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

export interface ExecutionAuthorizerOptions {
  context: AuthorizationContextPort;
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

      const reservationId = phase1ReservationId(audit.audit_id);
      return issueExecutionAuthorization({
        action,
        mandateId: mandate.mandate_id,
        mandateVersion: mandate.version,
        reservationId,
        target: buildExecutionTarget(action, {
          ...options.target,
          token: options.target.token ?? BASE_SEPOLIA_USDC,
        }),
        authorizerPrivateKey: options.authorizerPrivateKey as Hex,
        nowMs: options.nowMs?.(),
      });
    },
  };
}

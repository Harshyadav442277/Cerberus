import type { AuditLogRecord, ProposedAction, Settlement } from "@safr/core";
import {
  AuthorizationError,
  InMemoryAuthorizationUseStore,
  buildExecutionTarget,
  phase1ReservationId,
  verifyAndConsumeExecutionAuthorization,
  type AuthorizationUseStore,
  type SignedExecutionAuthorization,
  type TargetConfig,
} from "@safr/execution-authorization";
import type { X402Payer } from "@safr/x402-client";
import type { Address } from "viem";

export class ExecutionRefusedError extends Error {
  constructor(public readonly code: "AUDIT_NOT_FOUND" | "ACTION_NOT_FOUND" | "AUDIT_NOT_EXECUTABLE") {
    super(code);
    this.name = "ExecutionRefusedError";
  }
}

export interface TrustedExecutionContext {
  audit: AuditLogRecord;
  action: ProposedAction;
}

export interface ExecutionContextPort {
  resolve(auditId: string): Promise<TrustedExecutionContext>;
}

export interface ExecutorOptions {
  context: ExecutionContextPort;
  expectedAuthorizer: Address;
  target: TargetConfig;
  payerFactory: () => X402Payer;
  useStore?: AuthorizationUseStore;
  nowMs?: () => number;
}

export interface ExecuteInput {
  audit_id: string;
  envelope: SignedExecutionAuthorization;
}

export function createIsolatedExecutor(options: ExecutorOptions): {
  execute(input: ExecuteInput): Promise<Settlement>;
} {
  const useStore = options.useStore ?? new InMemoryAuthorizationUseStore();

  return {
    async execute(input): Promise<Settlement> {
      const { audit, action } = await options.context.resolve(input.audit_id);
      const executable =
        audit.disposition === "ALLOW" ||
        audit.disposition === "OBSERVE" ||
        (audit.disposition === "ESCALATE" && audit.human_review?.decision === "approved");
      if (!executable || audit.settlement !== null || audit.action_id !== action.action_id) {
        throw new ExecutionRefusedError("AUDIT_NOT_EXECUTABLE");
      }

      const target = buildExecutionTarget(action, options.target);
      await verifyAndConsumeExecutionAuthorization({
        envelope: input.envelope,
        action,
        target,
        expectedAuthorizer: options.expectedAuthorizer,
        expectedMandateId: audit.mandate_id,
        expectedMandateVersion: audit.mandate_version,
        expectedReservationId: phase1ReservationId(audit.audit_id),
        useStore,
        nowMs: options.nowMs?.(),
      });

      // The payment key is first reachable here, after every authorization check and
      // the atomic one-shot consume. Refusal paths never construct this factory.
      const payer = options.payerFactory();
      const result = await payer.pay({
        counterparty: action.payload.counterparty,
        amount: action.payload.amount,
        reference: action.payload.reference,
      });
      return {
        status: result.status,
        tx_hash: result.tx_hash,
        rail: result.rail,
        settled_at: result.settled_at,
      };
    },
  };
}

export { AuthorizationError };

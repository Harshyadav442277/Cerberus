import type { AuditLogRecord, ProposedAction, Settlement } from "@safr/core";
import {
  evaluateApprovalFreshness,
  type HumanApprovalBinding,
  type PaymentReservation,
} from "@safr/db";
import {
  AuthorizationError,
  InMemoryAuthorizationUseStore,
  buildExecutionTarget,
  hashProposal,
  verifyAndConsumeExecutionAuthorization,
  type AuthorizationUseStore,
  type SignedExecutionAuthorization,
  type TargetConfig,
} from "@safr/execution-authorization";
import type { X402Payer } from "@safr/x402-client";
import type { Address } from "viem";

export class ExecutionRefusedError extends Error {
  constructor(
    public readonly code:
      | "AUDIT_NOT_FOUND"
      | "ACTION_NOT_FOUND"
      | "AUDIT_NOT_EXECUTABLE"
      /** No live reservation holds capacity for this audit. */
      | "RESERVATION_NOT_FOUND"
      /** The reservation is not in AUTHORIZED state, or is bound to a different
       *  authorization. This is the durable replay/duplicate-execution refusal. */
      | "RESERVATION_NOT_EXECUTABLE"
      /** No mandate authorises this agent now, or not the one this was reserved under. */
      | "STALE_MANDATE"
      /** The approval is missing, expired, or no longer binds this proposal/authority. */
      | "STALE_APPROVAL",
  ) {
    super(code);
    this.name = "ExecutionRefusedError";
  }
}

export interface TrustedExecutionContext {
  audit: AuditLogRecord;
  action: ProposedAction;
  /** The committed financial state for this audit. Read from the database, not the caller. */
  reservation: PaymentReservation | null;
  /**
   * The mandate in force NOW, at execution time.
   *
   * Null means no authority currently covers this agent. The executor does not
   * re-run policy — that engine stays out of the process holding the payment key —
   * but it must not spend under a mandate that has since been superseded or revoked.
   */
  currentMandate: { mandate_id: string; version: number } | null;
  /** The separately bound approval, read at execution time for escalated audits. */
  approval: HumanApprovalBinding | null;
}

export interface ExecutionContextPort {
  resolve(auditId: string): Promise<TrustedExecutionContext>;
}

/**
 * Durable execution state.
 *
 * Phase 1's one-shot check lived in process memory, so it could not survive a restart
 * and did not span two executor processes. These four calls move that boundary into
 * the database, where it is the same source of truth the control plane reserved
 * against.
 */
export interface ExecutionReservationPort {
  beginSubmission(
    reservationId: string,
    authorizationId: string,
  ): Promise<PaymentReservation | null>;
  markSettled(reservationId: string, settlementTx: string | null): Promise<void>;
  markFailed(reservationId: string): Promise<void>;
  markOutcomeUnknown(reservationId: string): Promise<void>;
}

export interface ExecutorOptions {
  context: ExecutionContextPort;
  reservations: ExecutionReservationPort;
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
      const { audit, action, reservation, currentMandate, approval } = await options.context.resolve(
        input.audit_id,
      );
      const nowMs = options.nowMs?.() ?? Date.now();
      const executable =
        audit.disposition === "ALLOW" ||
        audit.disposition === "OBSERVE" ||
        (audit.disposition === "ESCALATE" && audit.human_review?.decision === "approved");
      if (!executable || audit.settlement !== null || audit.action_id !== action.action_id) {
        throw new ExecutionRefusedError("AUDIT_NOT_EXECUTABLE");
      }
      if (!reservation || reservation.audit_id !== audit.audit_id) {
        throw new ExecutionRefusedError("RESERVATION_NOT_FOUND");
      }

      // Authority freshness, checked independently of the control plane that issued
      // the authorization. A mandate revoked or superseded between issuance and
      // execution must stop the payment here, in the process that holds the key.
      if (
        !currentMandate ||
        currentMandate.mandate_id !== reservation.mandate_id ||
        currentMandate.version !== reservation.mandate_version
      ) {
        throw new ExecutionRefusedError("STALE_MANDATE");
      }

      // An approval can age out after the control plane signs but before the executor
      // receives the capability. Re-check it here, in the process that holds the key,
      // so a delayed request cannot spend on stale human authority.
      if (audit.disposition === "ESCALATE") {
        const freshness = evaluateApprovalFreshness(approval, {
          proposalHash: hashProposal(action),
          currentMandateId: currentMandate.mandate_id,
          currentMandateVersion: currentMandate.version,
          nowMs,
        });
        if (!freshness.usable) throw new ExecutionRefusedError("STALE_APPROVAL");
      }

      const target = buildExecutionTarget(action, options.target);
      const authorization = await verifyAndConsumeExecutionAuthorization({
        envelope: input.envelope,
        action,
        target,
        expectedAuthorizer: options.expectedAuthorizer,
        expectedMandateId: audit.mandate_id,
        expectedMandateVersion: audit.mandate_version,
        // The reservation identifier now comes from committed financial state, so an
        // authorization can only be spent against the capacity actually held for it.
        expectedReservationId: reservation.reservation_id,
        useStore,
        nowMs,
      });

      // The durable one-shot boundary: AUTHORIZED -> SUBMITTING, compare-and-set on
      // the reservation AND the exact authorization bound to it. Two authorizations
      // racing the same reservation, a replay after a restart, or a second executor
      // process all lose here — before the payment key exists.
      const submitting = await options.reservations.beginSubmission(
        reservation.reservation_id,
        authorization.authorizationId,
      );
      if (!submitting) throw new ExecutionRefusedError("RESERVATION_NOT_EXECUTABLE");

      // The payment key is first reachable here, after every authorization check and
      // after capacity is committed to this execution. Refusal paths never construct it.
      const payer = options.payerFactory();
      let result: Awaited<ReturnType<X402Payer["pay"]>>;
      try {
        result = await payer.pay({
          counterparty: action.payload.counterparty,
          amount: action.payload.amount,
          reference: action.payload.reference,
        });
      } catch (error) {
        // A thrown settlement error is NOT evidence that no money moved — the payment
        // may already have been broadcast and accepted with only the response lost.
        // Releasing the capacity here is precisely how a system double-pays, so the
        // reservation keeps holding it. Phase 5 adds the reconciler that resolves this
        // against chain state; nothing retries it in the meantime.
        await options.reservations.markOutcomeUnknown(reservation.reservation_id);
        throw error;
      }

      if (result.status === "settled") {
        await options.reservations.markSettled(reservation.reservation_id, result.tx_hash);
      } else {
        // Positive evidence of non-payment, reported by the rail itself. This is the
        // only outcome that gives the capacity back.
        await options.reservations.markFailed(reservation.reservation_id);
      }

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

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
  consumeExecutionAuthorization,
  hashProposal,
  verifyExecutionAuthorization,
  type AuthorizationUseStore,
  type SignedExecutionAuthorization,
  type TargetConfig,
} from "@safr/execution-authorization";
import {
  PaymentAttemptPersistenceError,
  paymentRequestUrl,
  reconcileEip3009,
  validateX402Challenge,
  type Eip3009ChainReader,
  type PaymentRequest,
  type PaymentAttemptCorrelation,
  type X402Challenge,
  type X402Payer,
} from "@safr/x402-client";
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
      | "STALE_APPROVAL"
      /**
       * The agent is suspended, or has no identity row, at execution time.
       *
       * Read here independently of the control plane and independently of the
       * caller, because suspension can land after the authorization was signed.
       */
      | "AGENT_SUSPENDED",
  ) {
    super(code);
    this.name = "ExecutionRefusedError";
  }
}

/**
 * A signed payment authorization left the executor, but settlement is not proven.
 * The caller must not interpret this as failure or retry; only reconciliation may
 * resolve the durable reservation.
 */
export class SettlementOutcomeUnknownError extends Error {
  constructor(detail: string) {
    super(`OUTCOME_UNKNOWN: ${detail}`);
    this.name = "SettlementOutcomeUnknownError";
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
  /**
   * The agent's status NOW, read from the database by this process.
   *
   * Never accepted from the caller and never inherited from the control plane's
   * earlier decision. Suspension is a kill switch, and a kill switch that only
   * consulted state captured before the authorization was signed would not stop an
   * agent suspended afterwards. Null means no identity row exists, which is treated
   * as suspended: authority must be positively established.
   */
  agentStatus: "active" | "suspended" | null;
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
  recordPaymentAttempt(
    reservationId: string,
    correlation: PaymentAttemptCorrelation,
    reconcileAfter: string,
  ): Promise<PaymentReservation | null>;
  /**
   * Terminal finalization for a chain-proven settlement.
   *
   * Writes the reservation's terminal status, the audit record's terminal settlement,
   * and the durable anchor request in ONE transaction. Returns false when the
   * compare-and-set matched no row, which means a reconciliation worker resolved this
   * payment first. Losing that race is not an error, but it does mean this process
   * must report the winner's truth rather than its own.
   */
  finalizeSettled(reservationId: string, settlementTx: string): Promise<boolean>;
  /** The reservation as it stands now. Used only to read the winner after a lost CAS. */
  readReservation(reservationId: string): Promise<PaymentReservation | null>;
  markFailed(reservationId: string): Promise<void>;
  markOutcomeUnknown(reservationId: string): Promise<void>;
}

export interface ExecutorOptions {
  context: ExecutionContextPort;
  reservations: ExecutionReservationPort;
  expectedAuthorizer: Address;
  target: TargetConfig;
  payerFactory: () => X402Payer;
  /** Unsigned transport path. It has no signer and receives no payment credentials. */
  challengeFetcher: (request: PaymentRequest) => Promise<X402Challenge>;
  /** Read-only chain evidence. Merchant settlement headers are never authoritative. */
  chain: Eip3009ChainReader;
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
      const { audit, action, reservation, currentMandate, approval, agentStatus } =
        await options.context.resolve(input.audit_id);
      const nowMs = options.nowMs?.() ?? Date.now();

      // The kill switch, checked first and in the process that holds the payment key.
      // Everything below this line — including target construction and signature
      // verification — is skipped for a suspended agent, so no refusal path gets
      // anywhere near key material.
      if (agentStatus !== "active") {
        throw new ExecutionRefusedError("AGENT_SUSPENDED");
      }

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
      const authorization = await verifyExecutionAuthorization({
        envelope: input.envelope,
        action,
        target,
        expectedAuthorizer: options.expectedAuthorizer,
        expectedMandateId: audit.mandate_id,
        expectedMandateVersion: audit.mandate_version,
        // The reservation identifier now comes from committed financial state, so an
        // authorization can only be spent against the capacity actually held for it.
        expectedReservationId: reservation.reservation_id,
        nowMs,
      });

      const paymentRequest: PaymentRequest = {
        counterparty: action.payload.counterparty,
        amount: action.payload.amount,
        reference: action.payload.reference,
      };
      const requestUrl = paymentRequestUrl(paymentRequest, options.target.merchantBaseUrl);
      const liveChallenge = await options.challengeFetcher(paymentRequest);
      const challenge = validateX402Challenge(liveChallenge, {
        x402Version: 2,
        scheme: "exact",
        network: `eip155:${authorization.chainId}`,
        asset: authorization.token,
        amount: authorization.amount,
        payTo: authorization.payTo,
        resourceUrl: requestUrl,
        eip712: { name: "USDC", version: "2", assetTransferMethod: "eip3009" },
      });

      // The unsigned merchant request is an untrusted network operation. Authority
      // that was fresh before it began may have expired or been revoked while the
      // merchant was responding, so resolve every trusted fact again with a fresh
      // clock immediately before the durable capability is consumed.
      const freshNowMs = options.nowMs?.() ?? Date.now();
      const fresh = await options.context.resolve(input.audit_id);

      // An administrator may have suspended this agent while the merchant was
      // answering. This is the recheck that closes that race, and it runs before the
      // durable capability is consumed and before the payer is constructed.
      if (fresh.agentStatus !== "active") {
        throw new ExecutionRefusedError("AGENT_SUSPENDED");
      }

      const freshExecutable =
        fresh.audit.disposition === "ALLOW" ||
        fresh.audit.disposition === "OBSERVE" ||
        (fresh.audit.disposition === "ESCALATE" &&
          fresh.audit.human_review?.decision === "approved");
      if (
        !freshExecutable ||
        fresh.audit.settlement !== null ||
        fresh.audit.action_id !== fresh.action.action_id
      ) {
        throw new ExecutionRefusedError("AUDIT_NOT_EXECUTABLE");
      }
      if (
        !fresh.reservation ||
        fresh.reservation.audit_id !== fresh.audit.audit_id ||
        fresh.reservation.reservation_id !== reservation.reservation_id ||
        fresh.reservation.authorization_id !== authorization.authorizationId
      ) {
        throw new ExecutionRefusedError("RESERVATION_NOT_EXECUTABLE");
      }
      if (
        !fresh.currentMandate ||
        fresh.currentMandate.mandate_id !== fresh.reservation.mandate_id ||
        fresh.currentMandate.version !== fresh.reservation.mandate_version
      ) {
        throw new ExecutionRefusedError("STALE_MANDATE");
      }
      if (fresh.audit.disposition === "ESCALATE") {
        const freshness = evaluateApprovalFreshness(fresh.approval, {
          proposalHash: hashProposal(fresh.action),
          currentMandateId: fresh.currentMandate.mandate_id,
          currentMandateVersion: fresh.currentMandate.version,
          nowMs: freshNowMs,
        });
        if (!freshness.usable) throw new ExecutionRefusedError("STALE_APPROVAL");
      }
      const freshAuthorization = await verifyExecutionAuthorization({
        envelope: input.envelope,
        action: fresh.action,
        target: buildExecutionTarget(fresh.action, options.target),
        expectedAuthorizer: options.expectedAuthorizer,
        expectedMandateId: fresh.audit.mandate_id,
        expectedMandateVersion: fresh.audit.mandate_version,
        expectedReservationId: fresh.reservation.reservation_id,
        nowMs: freshNowMs,
      });

      // A challenge mismatch returns above while the durable capability and
      // reservation are untouched. Consume only after the exact live 402 is pinned.
      await consumeExecutionAuthorization(freshAuthorization, useStore);

      // The durable one-shot boundary: AUTHORIZED -> SUBMITTING, compare-and-set on
      // the reservation AND the exact authorization bound to it. Two authorizations
      // racing the same reservation, a replay after a restart, or a second executor
      // process all lose here — before the payment key exists.
      const submitting = await options.reservations.beginSubmission(
        reservation.reservation_id,
        freshAuthorization.authorizationId,
      );
      if (!submitting) throw new ExecutionRefusedError("RESERVATION_NOT_EXECUTABLE");

      // The payment key is first reachable here, after every authorization check and
      // after capacity is committed to this execution. Refusal paths never construct it.
      const payer = options.payerFactory();
      let prepared: Awaited<ReturnType<X402Payer["prepare"]>>;
      try {
        prepared = await payer.prepare(challenge);
      } catch (error) {
        // Preparation may use the key, but it cannot touch transport. With no paid
        // request sent, this is positively known non-payment and capacity is safe to
        // release. A process crash at this point is recovered from the stale
        // SUBMITTING row after its grace period.
        await options.reservations.markFailed(reservation.reservation_id);
        throw error;
      }

      let result: Awaited<ReturnType<typeof prepared.submit>>;
      try {
        result = await prepared.submit(async (correlation) => {
          const reconcileAfter = new Date((options.nowMs?.() ?? Date.now()) + 120_000).toISOString();
          return Boolean(await options.reservations.recordPaymentAttempt(
            reservation.reservation_id,
            correlation,
            reconcileAfter,
          ));
        });
      } catch (error) {
        if (error instanceof PaymentAttemptPersistenceError) {
          // submit() guarantees transport was not reached when persistence refused.
          await options.reservations.markFailed(reservation.reservation_id);
          throw error;
        }
        // A thrown settlement error is NOT evidence that no money moved — the payment
        // may already have been broadcast and accepted with only the response lost.
        // Releasing the capacity here is precisely how a system double-pays, so the
        // reservation keeps holding it until the reconciler resolves chain state.
        await options.reservations.markOutcomeUnknown(reservation.reservation_id);
        throw new SettlementOutcomeUnknownError(
          error instanceof Error ? error.message : String(error),
        );
      }

      if (result.status === "settled") {
        try {
          const proof = await reconcileEip3009(
            {
              token: freshAuthorization.token,
              payer: prepared.correlation.payer,
              nonce: prepared.correlation.nonce,
              validBefore: prepared.correlation.validBefore,
              submissionBlock: prepared.correlation.submissionBlock,
              payTo: freshAuthorization.payTo,
              amount: freshAuthorization.amount,
            },
            options.chain,
          );
          if (proof.outcome === "settled") {
            // Financial truth comes from the chain, not the merchant-provided hash,
            // and it is committed together with the audit truth and the anchor
            // request. Nothing about this record's terminal state depends on the
            // agent calling back afterwards.
            const won = await options.reservations.finalizeSettled(
              reservation.reservation_id,
              proof.transactionHash,
            );
            if (won) {
              return {
                status: "settled",
                tx_hash: proof.transactionHash,
                rail: result.rail,
                settled_at: result.settled_at,
              };
            }

            // The compare-and-set matched no row: a reconciliation worker proved the
            // same settlement first and already wrote the terminal truth. There is
            // exactly one terminal state and one transaction hash, so report the
            // committed one rather than this process's own view of it.
            const winner = await options.reservations.readReservation(
              reservation.reservation_id,
            );
            if (winner?.status === "SETTLED" && winner.settlement_tx) {
              return {
                status: "settled",
                tx_hash: winner.settlement_tx,
                rail: result.rail,
                settled_at: result.settled_at,
              };
            }
            // Lost the transition to something that is not a settlement. Never guess.
            throw new SettlementOutcomeUnknownError(
              `settlement proven on chain but the terminal transition was lost (reservation is ${winner?.status ?? "unreadable"})`,
            );
          }
        } catch {
          // RPC failure or temporarily unavailable evidence is ambiguity, not failure.
        }
        await options.reservations.markOutcomeUnknown(reservation.reservation_id);
        throw new SettlementOutcomeUnknownError(
          `merchant success was not proven on chain (claimed ${result.tx_hash ?? "no transaction"})`,
        );
      }

      // Even a well-formed x402 failure response is controlled by the merchant. Once
      // PAYMENT-SIGNATURE was transmitted, that merchant still possesses a live
      // EIP-3009 authorization and can settle it until validBefore. Hold capacity and
      // let chain reconciliation prove either exact settlement or expired-unused.
      await options.reservations.markOutcomeUnknown(reservation.reservation_id);
      throw new SettlementOutcomeUnknownError(result.error ?? "merchant reported non-settlement");
    },
  };
}

export { AuthorizationError };

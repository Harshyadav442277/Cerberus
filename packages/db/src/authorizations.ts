import type { HumanReview } from "@safr/core";
import { getPool } from "./pool.js";

/**
 * Phase 3 — durable replay protection and authority freshness.
 *
 * Two guarantees live here, and both replace something that was previously only as
 * strong as one process's memory or one unbound JSON blob:
 *
 *  1. An Execution Authorization is consumable at most once, across every executor
 *     process and across restarts, because consumption is a compare-and-set on a row.
 *  2. A human approval binds the exact proposal and the exact mandate version it was
 *     given under, and it expires. An approval is authority to do one specific thing
 *     under one specific set of rules, not a standing permission.
 */

export interface IssuedAuthorization {
  authorization_id: string;
  reservation_id: string;
  audit_id: string;
  action_id: string;
  proposal_hash: string;
  mandate_id: string;
  mandate_version: number;
  nonce: string;
  expires_at: string;
  status: "ISSUED" | "CONSUMED";
  issued_at: string;
  consumed_at: string | null;
}

const AUTHORIZATION_COLUMNS = `authorization_id, reservation_id, audit_id, action_id,
  proposal_hash, mandate_id, mandate_version, nonce, expires_at, status,
  issued_at, consumed_at`;

export interface RecordAuthorizationInput {
  authorizationId: string;
  reservationId: string;
  auditId: string;
  actionId: string;
  proposalHash: string;
  mandateId: string;
  mandateVersion: number;
  nonce: string;
  expiresAt: string;
  issuedAt?: string;
}

/**
 * Records a capability at the moment it is minted, before it is signed.
 *
 * The row exists before the signature does, so there is no window in which a valid
 * authorization is circulating that the database has never heard of.
 */
export async function recordIssuedAuthorization(
  input: RecordAuthorizationInput,
): Promise<IssuedAuthorization> {
  const { rows } = await getPool().query(
    `INSERT INTO execution_authorization (
       authorization_id, reservation_id, audit_id, action_id, proposal_hash,
       mandate_id, mandate_version, nonce, expires_at, status, issued_at, consumed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, 'ISSUED', $10::timestamptz, NULL)
     RETURNING ${AUTHORIZATION_COLUMNS}`,
    [
      input.authorizationId,
      input.reservationId,
      input.auditId,
      input.actionId,
      input.proposalHash,
      input.mandateId,
      input.mandateVersion,
      input.nonce,
      input.expiresAt,
      input.issuedAt ?? new Date().toISOString(),
    ],
  );
  const row = rows[0]!;
  return { ...row, mandate_version: Number(row["mandate_version"]) } as IssuedAuthorization;
}

/**
 * The durable one-shot consume. Replaces the Phase 1 in-memory Set.
 *
 * Compare-and-set on both the identifier and the nonce, from ISSUED to CONSUMED.
 * A replay arriving at a restarted executor, or at a second executor process that has
 * never seen this nonce, loses here — process memory is no longer what decides.
 *
 * @returns true if this caller consumed it; false if it was already used or unknown.
 */
export async function consumeAuthorization(
  authorizationId: string,
  nonce: string,
  at = new Date().toISOString(),
): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `UPDATE execution_authorization
        SET status = 'CONSUMED', consumed_at = $3::timestamptz
      WHERE authorization_id = $1
        AND nonce = $2
        AND status = 'ISSUED'
        AND expires_at > $3::timestamptz`,
    [authorizationId, nonce, at],
  );
  return (rowCount ?? 0) > 0;
}

export async function getIssuedAuthorization(
  authorizationId: string,
): Promise<IssuedAuthorization | null> {
  const { rows } = await getPool().query(
    `SELECT ${AUTHORIZATION_COLUMNS} FROM execution_authorization WHERE authorization_id = $1`,
    [authorizationId],
  );
  if (!rows[0]) return null;
  return { ...rows[0], mandate_version: Number(rows[0]["mandate_version"]) } as IssuedAuthorization;
}

export interface HumanApprovalBinding {
  audit_id: string;
  action_id: string;
  agent_id: string;
  proposal_hash: string;
  mandate_id: string;
  mandate_version: number;
  reviewer_id: string;
  decision: "approved" | "denied";
  decided_at: string;
  expires_at: string;
}

const APPROVAL_COLUMNS = `audit_id, action_id, agent_id, proposal_hash, mandate_id,
  mandate_version, reviewer_id, decision, decided_at, expires_at`;

export interface RecordApprovalInput {
  auditId: string;
  actionId: string;
  agentId: string;
  proposalHash: string;
  mandateId: string;
  mandateVersion: number;
  reviewerId: string;
  decision: "approved" | "denied";
  decidedAt: string;
  ttlSeconds?: number;
}

/** How long a human decision stays usable as execution authority. */
export const APPROVAL_TTL_SECONDS = 30 * 60;

/**
 * Records the binding for a human decision.
 *
 * Written only by the trusted control plane. The agent process must never be able to
 * reach this: a compromised agent that could write its own approval would have
 * defeated the entire escalation path.
 */
export async function recordHumanApproval(
  input: RecordApprovalInput,
): Promise<HumanApprovalBinding> {
  const ttl = input.ttlSeconds ?? APPROVAL_TTL_SECONDS;
  const { rows } = await getPool().query(
    `INSERT INTO human_approval (
       audit_id, action_id, agent_id, proposal_hash, mandate_id, mandate_version,
       reviewer_id, decision, decided_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz,
             $9::timestamptz + make_interval(secs => $10::int))
     ON CONFLICT (audit_id) DO NOTHING
     RETURNING ${APPROVAL_COLUMNS}`,
    [
      input.auditId,
      input.actionId,
      input.agentId,
      input.proposalHash,
      input.mandateId,
      input.mandateVersion,
      input.reviewerId,
      input.decision,
      input.decidedAt,
      ttl,
    ],
  );
  // ON CONFLICT DO NOTHING returns no row when a decision already exists. The first
  // decision stands; a second reviewer does not overwrite it.
  if (rows[0]) {
    return { ...rows[0], mandate_version: Number(rows[0]["mandate_version"]) } as HumanApprovalBinding;
  }
  return (await getHumanApproval(input.auditId))!;
}

export async function getHumanApproval(auditId: string): Promise<HumanApprovalBinding | null> {
  const { rows } = await getPool().query(
    `SELECT ${APPROVAL_COLUMNS} FROM human_approval WHERE audit_id = $1`,
    [auditId],
  );
  if (!rows[0]) return null;
  return { ...rows[0], mandate_version: Number(rows[0]["mandate_version"]) } as HumanApprovalBinding;
}

export type ApprovalFreshness =
  | { usable: true; binding: HumanApprovalBinding }
  | { usable: false; reason: "MISSING" | "DENIED" | "EXPIRED" | "PROPOSAL_CHANGED" | "STALE_MANDATE" };

/**
 * Is this approval still authority to execute, right now?
 *
 * Historical audit correctness and current permission are separate questions. The
 * audit record permanently says a human approved; this asks whether that approval
 * still covers what is about to happen.
 */
export function evaluateApprovalFreshness(
  binding: HumanApprovalBinding | null,
  expected: {
    proposalHash: string;
    currentMandateId: string;
    currentMandateVersion: number;
    nowMs: number;
  },
): ApprovalFreshness {
  if (!binding) return { usable: false, reason: "MISSING" };
  if (binding.decision !== "approved") return { usable: false, reason: "DENIED" };
  if (binding.proposal_hash !== expected.proposalHash) {
    return { usable: false, reason: "PROPOSAL_CHANGED" };
  }
  if (
    binding.mandate_id !== expected.currentMandateId ||
    binding.mandate_version !== expected.currentMandateVersion
  ) {
    return { usable: false, reason: "STALE_MANDATE" };
  }
  if (Date.parse(binding.expires_at) <= expected.nowMs) {
    return { usable: false, reason: "EXPIRED" };
  }
  return { usable: true, binding };
}

export interface ClaimHumanDecisionInput extends RecordApprovalInput {
  humanReview: HumanReview;
}

/**
 * Claims a pending escalation and binds what was decided, in one transaction.
 *
 * The Section 7.5 `human_review` write and the authority binding must not be able to
 * come apart: a claimed review with no binding would be a decision nobody can act on,
 * and a binding with no review would be authority nobody is recorded as granting.
 *
 * The claim is still `WHERE human_review IS NULL`, so a double-click or a second
 * reviewer loses the race rather than overwriting the first decision.
 */
export async function claimHumanDecision(
  input: ClaimHumanDecisionInput,
): Promise<{ claimed: boolean; binding: HumanApprovalBinding | null }> {
  const ttl = input.ttlSeconds ?? APPROVAL_TTL_SECONDS;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const { rowCount } = await client.query(
      `UPDATE audit_log SET human_review = $2
        WHERE audit_id = $1 AND human_review IS NULL`,
      [input.auditId, JSON.stringify(input.humanReview)],
    );
    if (!rowCount) {
      await client.query("ROLLBACK");
      return { claimed: false, binding: null };
    }
    const { rows } = await client.query(
      `INSERT INTO human_approval (
         audit_id, action_id, agent_id, proposal_hash, mandate_id, mandate_version,
         reviewer_id, decision, decided_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz,
               $9::timestamptz + make_interval(secs => $10::int))
       RETURNING ${APPROVAL_COLUMNS}`,
      [
        input.auditId,
        input.actionId,
        input.agentId,
        input.proposalHash,
        input.mandateId,
        input.mandateVersion,
        input.reviewerId,
        input.decision,
        input.decidedAt,
        ttl,
      ],
    );
    await client.query("COMMIT");
    const row = rows[0]!;
    return {
      claimed: true,
      binding: { ...row, mandate_version: Number(row["mandate_version"]) } as HumanApprovalBinding,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

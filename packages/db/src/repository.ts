import {
  AgentIdentitySchema,
  AuditLogRecordSchema,
  MandateSchema,
  ProposedActionSchema,
  type AgentIdentity,
  type AuditLogRecord,
  type HumanReview,
  type Mandate,
  type ProposedAction,
  type Settlement,
} from "@safr/core";
import { getPool } from "./pool.js";

/**
 * Data access for the Bible Section 7 records.
 *
 * Rows come back already shaped like the Bible schemas — nested objects are JSONB and
 * timestamps are parsed to ISO strings in pool.ts — so each read is validated
 * directly with the zod schema. If a column were ever renamed, these parses fail
 * loudly instead of silently drifting from Rules.md R4.
 */

export async function insertAgentIdentity(agent: AgentIdentity): Promise<void> {
  const parsed = AgentIdentitySchema.parse(agent);
  await getPool().query(
    `INSERT INTO agent_identity
       (agent_id, display_name, owner_org, created_at, wallet_address, status)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (agent_id) DO UPDATE SET
       display_name   = EXCLUDED.display_name,
       owner_org      = EXCLUDED.owner_org,
       created_at     = EXCLUDED.created_at,
       wallet_address = EXCLUDED.wallet_address,
       status         = EXCLUDED.status`,
    [
      parsed.agent_id,
      parsed.display_name,
      parsed.owner_org,
      parsed.created_at,
      parsed.wallet_address,
      parsed.status,
    ],
  );
}

export async function getAgentIdentity(agentId: string): Promise<AgentIdentity | null> {
  const { rows } = await getPool().query(
    `SELECT agent_id, display_name, owner_org, created_at, wallet_address, status
       FROM agent_identity WHERE agent_id = $1`,
    [agentId],
  );
  return rows[0] ? AgentIdentitySchema.parse(rows[0]) : null;
}

export async function insertMandate(mandate: Mandate): Promise<void> {
  const parsed = MandateSchema.parse(mandate);
  await getPool().query(
    `INSERT INTO mandate
       (mandate_id, agent_id, version, effective_from, effective_to, status,
        scope, controls, default_disposition_on_breach, created_by, approved_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (mandate_id, version) DO UPDATE SET
       agent_id                      = EXCLUDED.agent_id,
       effective_from                = EXCLUDED.effective_from,
       effective_to                  = EXCLUDED.effective_to,
       status                        = EXCLUDED.status,
       scope                         = EXCLUDED.scope,
       controls                      = EXCLUDED.controls,
       default_disposition_on_breach = EXCLUDED.default_disposition_on_breach,
       created_by                    = EXCLUDED.created_by,
       approved_by                   = EXCLUDED.approved_by`,
    [
      parsed.mandate_id,
      parsed.agent_id,
      parsed.version,
      parsed.effective_from,
      parsed.effective_to,
      parsed.status,
      JSON.stringify(parsed.scope),
      JSON.stringify(parsed.controls),
      parsed.default_disposition_on_breach,
      parsed.created_by,
      parsed.approved_by,
    ],
  );
}

const MANDATE_COLUMNS = `mandate_id, agent_id, version, effective_from, effective_to,
  status, scope, controls, default_disposition_on_breach, created_by, approved_by`;

export async function getMandate(mandateId: string, version: number): Promise<Mandate | null> {
  const { rows } = await getPool().query(
    `SELECT ${MANDATE_COLUMNS} FROM mandate WHERE mandate_id = $1 AND version = $2`,
    [mandateId, version],
  );
  return rows[0] ? MandateSchema.parse(rows[0]) : null;
}

/**
 * The mandate version in force for an agent at a given instant.
 *
 * Honours `effective_from` / `effective_to` (open-ended when `effective_to` is null)
 * and requires status 'active'. Highest version wins if ranges ever overlap, so the
 * result is deterministic.
 *
 * Bible Section 7.2: audit records must be able to reference exactly which mandate
 * version was active at decision time. This is the query that makes that true.
 */
export async function getActiveMandate(agentId: string, at: string): Promise<Mandate | null> {
  const { rows } = await getPool().query(
    `SELECT ${MANDATE_COLUMNS}
       FROM mandate
      WHERE agent_id = $1
        AND status = 'active'
        AND effective_from <= $2
        AND (effective_to IS NULL OR effective_to > $2)
      ORDER BY version DESC
      LIMIT 1`,
    [agentId, at],
  );
  return rows[0] ? MandateSchema.parse(rows[0]) : null;
}

export async function insertProposedAction(action: ProposedAction): Promise<void> {
  const parsed = ProposedActionSchema.parse(action);
  await getPool().query(
    `INSERT INTO proposed_action (action_id, agent_id, action_type, proposed_at, payload)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (action_id) DO UPDATE SET
       agent_id    = EXCLUDED.agent_id,
       action_type = EXCLUDED.action_type,
       proposed_at = EXCLUDED.proposed_at,
       payload     = EXCLUDED.payload`,
    [
      parsed.action_id,
      parsed.agent_id,
      parsed.action_type,
      parsed.proposed_at,
      JSON.stringify(parsed.payload),
    ],
  );
}

const AUDIT_COLUMNS = `audit_id, action_id, agent_id, mandate_id, mandate_version,
  disposition, reason, rule_triggered, evaluated_at, human_review, settlement`;

/**
 * Writes the Bible Section 7.5 record for a disposition.
 *
 * Written for EVERY disposition, including DENY where no payment was ever constructed
 * — a decision not to pay is exactly as auditable as a decision to pay.
 */
export async function insertAuditLogRecord(record: AuditLogRecord): Promise<void> {
  const parsed = AuditLogRecordSchema.parse(record);
  await getPool().query(
    `INSERT INTO audit_log (${AUDIT_COLUMNS})
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      parsed.audit_id,
      parsed.action_id,
      parsed.agent_id,
      parsed.mandate_id,
      parsed.mandate_version,
      parsed.disposition,
      parsed.reason,
      parsed.rule_triggered,
      parsed.evaluated_at,
      parsed.human_review === null ? null : JSON.stringify(parsed.human_review),
      parsed.settlement === null ? null : JSON.stringify(parsed.settlement),
    ],
  );
}

export async function getAuditLogRecord(auditId: string): Promise<AuditLogRecord | null> {
  const { rows } = await getPool().query(
    `SELECT ${AUDIT_COLUMNS} FROM audit_log WHERE audit_id = $1`,
    [auditId],
  );
  return rows[0] ? AuditLogRecordSchema.parse(rows[0]) : null;
}

/** Settlement is written back after the payment resolves, so it starts null. */
export async function updateAuditSettlement(
  auditId: string,
  settlement: Settlement,
): Promise<void> {
  await getPool().query(`UPDATE audit_log SET settlement = $2 WHERE audit_id = $1`, [
    auditId,
    JSON.stringify(settlement),
  ]);
}

/** Records the compliance officer's decision on an escalated action. */
export async function updateAuditHumanReview(
  auditId: string,
  humanReview: HumanReview,
): Promise<void> {
  await getPool().query(`UPDATE audit_log SET human_review = $2 WHERE audit_id = $1`, [
    auditId,
    JSON.stringify(humanReview),
  ]);
}

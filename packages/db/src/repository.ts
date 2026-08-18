import {
  AgentIdentitySchema,
  AuditLogRecordSchema,
  MandateSchema,
  ProposedActionSchema,
  type AgentIdentity,
  type AuditLogRecord,
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
  // The conflict branch supports idempotent seed/provisioning calls and the two
  // one-way lifecycle fields. Migration 006 rejects every policy-bearing difference,
  // so changing policy requires inserting a new version rather than rewriting one.
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
     ON CONFLICT (action_id) DO NOTHING`,
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
  if (parsed.human_review !== null || parsed.settlement !== null) {
    throw new Error("initial audit records cannot create review or settlement authority");
  }
  await getPool().query(
    `INSERT INTO audit_log (
       audit_id, action_id, agent_id, mandate_id, mandate_version,
       disposition, reason, rule_triggered, evaluated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
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

/** Feed row for the dashboard: §7.5 record + the proposal that produced it. */
export interface AuditFeedItem {
  record: AuditLogRecord;
  action: ProposedAction;
}

/**
 * Newest-first audit feed for the dashboard.
 *
 * When `since` is set, only rows evaluated strictly after that timestamp are
 * returned — the live poll / SSE cursor. Cap keeps a projector-friendly page size.
 */
export async function listAuditFeed(options: {
  limit?: number;
  since?: string;
} = {}): Promise<AuditFeedItem[]> {
  const limit = options.limit ?? 100;
  const params: unknown[] = [limit];
  let sinceClause = "";
  if (options.since) {
    params.push(options.since);
    sinceClause = `AND a.evaluated_at > $2`;
  }

  const { rows } = await getPool().query(
    `SELECT
       a.audit_id, a.action_id, a.agent_id, a.mandate_id, a.mandate_version,
       a.disposition, a.reason, a.rule_triggered, a.evaluated_at,
       a.human_review, a.settlement,
       p.action_type, p.proposed_at, p.payload
     FROM audit_log a
     JOIN proposed_action p ON p.action_id = a.action_id
     WHERE TRUE ${sinceClause}
     ORDER BY a.evaluated_at DESC
     LIMIT $1`,
    params,
  );

  return rows.map((row) => ({
    record: AuditLogRecordSchema.parse(row),
    action: ProposedActionSchema.parse({
      action_id: row.action_id,
      agent_id: row.agent_id,
      action_type: row.action_type,
      proposed_at: row.proposed_at,
      payload: row.payload,
    }),
  }));
}

export async function getProposedAction(actionId: string): Promise<ProposedAction | null> {
  const { rows } = await getPool().query(
    `SELECT action_id, agent_id, action_type, proposed_at, payload
       FROM proposed_action WHERE action_id = $1`,
    [actionId],
  );
  return rows[0] ? ProposedActionSchema.parse(rows[0]) : null;
}

/** Escalations waiting on a human — disposition ESCALATE and no human_review yet. */
export async function listPendingEscalations(): Promise<AuditFeedItem[]> {
  const { rows } = await getPool().query(
    `SELECT
       a.audit_id, a.action_id, a.agent_id, a.mandate_id, a.mandate_version,
       a.disposition, a.reason, a.rule_triggered, a.evaluated_at,
       a.human_review, a.settlement,
       p.action_type, p.proposed_at, p.payload
     FROM audit_log a
     JOIN proposed_action p ON p.action_id = a.action_id
     WHERE a.disposition = 'ESCALATE' AND a.human_review IS NULL
     ORDER BY a.evaluated_at DESC`,
  );

  return rows.map((row) => ({
    record: AuditLogRecordSchema.parse(row),
    action: ProposedActionSchema.parse({
      action_id: row.action_id,
      agent_id: row.agent_id,
      action_type: row.action_type,
      proposed_at: row.proposed_at,
      payload: row.payload,
    }),
  }));
}

/**
 * Looks up the audit row for an action. Used by the dashboard decision endpoint and
 * by the agent's DB-backed escalation wait (Phase 6).
 */
export async function getAuditLogRecordByActionId(
  actionId: string,
): Promise<AuditLogRecord | null> {
  const { rows } = await getPool().query(
    `SELECT ${AUDIT_COLUMNS} FROM audit_log WHERE action_id = $1
     ORDER BY evaluated_at DESC LIMIT 1`,
    [actionId],
  );
  return rows[0] ? AuditLogRecordSchema.parse(rows[0]) : null;
}

/** Counts by disposition — the summary strip on the Audit Log screen. */
export async function countByDisposition(): Promise<Record<string, number>> {
  const { rows } = await getPool().query<{ disposition: string; n: string }>(
    `SELECT disposition, COUNT(*)::text AS n FROM audit_log GROUP BY disposition`,
  );
  const out: Record<string, number> = { ALLOW: 0, DENY: 0, ESCALATE: 0, OBSERVE: 0 };
  for (const row of rows) out[row.disposition] = Number(row.n);
  return out;
}

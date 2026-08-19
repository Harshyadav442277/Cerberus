import type { Counters } from "@safr/disposition-engine";
import { getPool, type DatabaseReader } from "@safr/db";

/**
 * Counter state for the Disposition Engine.
 *
 * Agent-visible counters are settled-only at this compatibility layer. The hostile
 * agent role may read audit truth, but deliberately cannot inspect reservation or
 * execution-capability tables. The trusted reservation transaction remains the
 * authoritative monetary and velocity gate: it counts active/executing reservations
 * under a per-agent lock and promotes a raced proposal to ESCALATE when required.
 *
 * This basis is a judgment call — Bible Section 7.4 specifies `get_rolling_total` and
 * `get_hourly_tx_count` without defining what counts. Settled spend was chosen
 * because it is the one definition that is trivially explainable to a compliance
 * officer: it is the money that left the account.
 *
 * The engine never calls these itself; the orchestrator reads them and injects the
 * result, which is what keeps `evaluate()` pure.
 */

/** Total settled spend for an agent in the window ending at `at`. */
export async function getRollingTotal(
  agentId: string,
  at: string,
  windowHours = 24,
  reader: DatabaseReader = getPool(),
): Promise<number> {
  const { rows } = await reader.query<{ total: string | null }>(
    `SELECT COALESCE(SUM((pa.payload ->> 'amount')::numeric), 0)::text AS total
       FROM audit_log al
       JOIN proposed_action pa ON pa.action_id = al.action_id
      WHERE al.agent_id = $1
        AND al.settlement ->> 'status' = 'settled'
        AND al.evaluated_at > ($2::timestamptz - make_interval(hours => $3))
        AND al.evaluated_at <= $2::timestamptz`,
    [agentId, at, windowHours],
  );
  return Number(rows[0]?.total ?? 0);
}

/** Settled transactions in the hour ending at `at`, visible to the hostile agent. */
export async function getHourlyTxCount(
  agentId: string,
  at: string,
  reader: DatabaseReader = getPool(),
): Promise<number> {
  const { rows } = await reader.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total
       FROM audit_log
      WHERE agent_id = $1
        AND settlement ->> 'status' = 'settled'
        AND evaluated_at > ($2::timestamptz - interval '1 hour')
        AND evaluated_at <= $2::timestamptz`,
    [agentId, at],
  );
  return Number(rows[0]?.total ?? 0);
}

/** Both counters for a single evaluation, read at the action's proposed_at. */
export async function getCounters(
  agentId: string,
  at: string,
  reader: DatabaseReader = getPool(),
): Promise<Counters> {
  const [rollingTotal, hourlyTxCount] = await Promise.all([
    getRollingTotal(agentId, at, 24, reader),
    getHourlyTxCount(agentId, at, reader),
  ]);
  return { rolling_total_24h: rollingTotal, hourly_tx_count: hourlyTxCount };
}

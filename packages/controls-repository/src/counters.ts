import type { Counters } from "@safr/disposition-engine";
import { committedVelocityCount, getPool } from "@safr/db";

/**
 * Counter state for the Disposition Engine.
 *
 * Rolling spend remains settled-only at this compatibility layer; the reservation
 * transaction is the authoritative monetary gate. Velocity includes committed and
 * executing reservations immediately, so sequential evaluations see occupied slots
 * before settlement. The reservation transaction independently rechecks it under a
 * per-agent lock to close concurrent check-then-act races.
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
): Promise<number> {
  const { rows } = await getPool().query<{ total: string | null }>(
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

/** Committed, executing, or settled transactions in the hour ending at `at`. */
export async function getHourlyTxCount(agentId: string, at: string): Promise<number> {
  return committedVelocityCount({ agentId, at });
}

/** Both counters for a single evaluation, read at the action's proposed_at. */
export async function getCounters(agentId: string, at: string): Promise<Counters> {
  const [rollingTotal, hourlyTxCount] = await Promise.all([
    getRollingTotal(agentId, at),
    getHourlyTxCount(agentId, at),
  ]);
  return { rolling_total_24h: rollingTotal, hourly_tx_count: hourlyTxCount };
}

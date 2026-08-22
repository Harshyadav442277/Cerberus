/**
 * Publishes the one fixed finals mandate transition as the database schema owner.
 *
 * This is intentionally not a generic mandate editor or an HTTP surface. Supply a
 * schema-owner/operator DATABASE_URL and run `pnpm mandate:publish:finals-v2`.
 */
import { isDeepStrictEqual } from "node:util";
import { MandateSchema, type Mandate } from "@safr/core";
import { closePool, getActiveMandate, getPool } from "../index.js";

const MANDATE_ID = "mandate_001";
const AGENT_ID = "agent_treasury_01";
const SOURCE_VERSION = 1;
const TARGET_VERSION = 2;
const SOURCE_ROLLING_MAX = 3;
const TARGET_ROLLING_MAX = 24;
const EXPECTED_TABLE_OWNER = "safr";

const MANDATE_COLUMNS = `mandate_id, agent_id, version, effective_from, effective_to,
  status, scope, controls, default_disposition_on_breach, created_by, approved_by`;

function buildTarget(source: Mandate, effectiveFrom: string): Mandate {
  return MandateSchema.parse({
    ...source,
    version: TARGET_VERSION,
    effective_from: effectiveFrom,
    effective_to: null,
    status: "active",
    controls: {
      ...source.controls,
      spend_caps: {
        ...source.controls.spend_caps,
        rolling_window: {
          ...source.controls.spend_caps.rolling_window,
          max_total: TARGET_ROLLING_MAX,
        },
      },
    },
  });
}

function assertSource(source: Mandate): void {
  if (
    source.mandate_id !== MANDATE_ID ||
    source.agent_id !== AGENT_ID ||
    source.version !== SOURCE_VERSION ||
    source.controls.spend_caps.rolling_window.window !== "24h" ||
    source.controls.spend_caps.rolling_window.max_total !== SOURCE_ROLLING_MAX ||
    source.controls.spend_caps.per_transaction_max !== 1
  ) {
    throw new Error("mandate_001 v1 does not match the reviewed finals source policy");
  }
}

async function main(): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");

    const ownerResult = await client.query<{ table_owner: string }>(
      `SELECT pg_get_userbyid(relowner) AS table_owner
         FROM pg_class
        WHERE oid = 'public.mandate'::regclass`,
    );
    if (ownerResult.rows[0]?.table_owner !== EXPECTED_TABLE_OWNER) {
      throw new Error("mandate table is not owned by the expected schema-owner role");
    }
    await client.query(`SET LOCAL ROLE ${EXPECTED_TABLE_OWNER}`);

    const versionsResult = await client.query(
      `SELECT ${MANDATE_COLUMNS}
         FROM mandate
        WHERE mandate_id = $1
        ORDER BY version
        FOR UPDATE`,
      [MANDATE_ID],
    );
    const versions = versionsResult.rows.map((row) => MandateSchema.parse(row));
    const source = versions.find((mandate) => mandate.version === SOURCE_VERSION);
    const existingTarget = versions.find((mandate) => mandate.version === TARGET_VERSION);
    if (!source) throw new Error("mandate_001 v1 is missing");
    assertSource(source);

    if (existingTarget) {
      const expected = buildTarget(source, existingTarget.effective_from);
      if (
        versions.length !== 2 ||
        source.status !== "superseded" ||
        source.effective_to !== existingTarget.effective_from ||
        !isDeepStrictEqual(existingTarget, expected)
      ) {
        throw new Error("mandate_001 v2 already exists but does not match the finals target");
      }
      await client.query("ROLLBACK");
      console.log(JSON.stringify({
        result: "ALREADY_PUBLISHED",
        mandate_id: MANDATE_ID,
        old_version: SOURCE_VERSION,
        new_version: TARGET_VERSION,
        effective_at: existingTarget.effective_from,
      }));
      return;
    }

    if (
      versions.length !== 1 ||
      source.status !== "active" ||
      source.effective_to !== null
    ) {
      throw new Error("mandate_001 v1 is not the sole open active version");
    }

    const stateResult = await client.query<{
      pending_reviews: string;
      nonterminal_reservations: string;
    }>(
      `SELECT
         (SELECT COUNT(*)::text
            FROM audit_log
           WHERE agent_id = $1
             AND disposition = 'ESCALATE'
             AND human_review IS NULL) AS pending_reviews,
         (SELECT COUNT(*)::text
            FROM payment_reservation
           WHERE agent_id = $1
             AND (
               status IN ('SUBMITTING', 'OUTCOME_UNKNOWN', 'RECONCILING')
               OR (status IN ('RESERVED', 'AUTHORIZED') AND expires_at > clock_timestamp())
             )) AS nonterminal_reservations`,
      [AGENT_ID],
    );
    const state = stateResult.rows[0];
    if (
      !state ||
      state.pending_reviews !== "0" ||
      state.nonterminal_reservations !== "0"
    ) {
      throw new Error("nonterminal financial state exists; mandate publication refused");
    }

    const timestampResult = await client.query<{ effective_at: string }>(
      "SELECT clock_timestamp() AS effective_at",
    );
    const effectiveAt = timestampResult.rows[0]!.effective_at;
    const target = buildTarget(source, effectiveAt);

    await client.query(
      `INSERT INTO mandate
         (mandate_id, agent_id, version, effective_from, effective_to, status,
          scope, controls, default_disposition_on_breach, created_by, approved_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        target.mandate_id,
        target.agent_id,
        target.version,
        target.effective_from,
        target.effective_to,
        target.status,
        JSON.stringify(target.scope),
        JSON.stringify(target.controls),
        target.default_disposition_on_breach,
        target.created_by,
        target.approved_by,
      ],
    );

    const closeResult = await client.query(
      `UPDATE mandate
          SET status = 'superseded', effective_to = $3
        WHERE mandate_id = $1
          AND version = $2
          AND status = 'active'
          AND effective_to IS NULL`,
      [MANDATE_ID, SOURCE_VERSION, effectiveAt],
    );
    if (closeResult.rowCount !== 1) {
      throw new Error("mandate_001 v1 lifecycle close was not applied exactly once");
    }

    const active = await getActiveMandate(AGENT_ID, effectiveAt, client);
    if (!active || !isDeepStrictEqual(active, target)) {
      throw new Error("the newly published mandate is not the active target version");
    }

    await client.query("COMMIT");
    console.log(JSON.stringify({
      result: "PUBLISHED",
      mandate_id: MANDATE_ID,
      old_version: SOURCE_VERSION,
      new_version: TARGET_VERSION,
      effective_at: effectiveAt,
    }));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

try {
  await main();
} catch (error) {
  console.error(`mandate publication refused: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await closePool();
}

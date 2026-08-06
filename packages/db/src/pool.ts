import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import pg from "pg";

loadDotenv({ path: resolve(import.meta.dirname, "../../../.env"), quiet: true });

/**
 * Return timestamps as ISO-8601 strings rather than JS Date objects.
 *
 * The Bible Section 7 schemas are string-based (`z.string().datetime()`), so parsing
 * here means a row read straight out of Postgres validates without a conversion step
 * and round-trips with zero shape loss. 1114 is `timestamp`, 1184 is `timestamptz`.
 */
pg.types.setTypeParser(1114, (value: string) => new Date(`${value}Z`).toISOString());
pg.types.setTypeParser(1184, (value: string) => new Date(value).toISOString());

export const DATABASE_URL =
  process.env["DATABASE_URL"]?.trim() ||
  "postgres://safr:safr@localhost:5544/safr_runtime";

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: DATABASE_URL });
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

import pg from "pg";

/**
 * Return timestamps as ISO-8601 strings rather than JS Date objects.
 *
 * The Bible Section 7 schemas are string-based (`z.string().datetime()`), so parsing
 * here means a row read straight out of Postgres validates without a conversion step
 * and round-trips with zero shape loss. 1114 is `timestamp`, 1184 is `timestamptz`.
 */
pg.types.setTypeParser(1114, (value: string) => new Date(`${value}Z`).toISOString());
pg.types.setTypeParser(1184, (value: string) => new Date(value).toISOString());

export function getDatabaseUrl(): string {
  const databaseUrl = process.env["DATABASE_URL"]?.trim();
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not configured; launch the process with its dedicated database URL",
    );
  }
  return databaseUrl;
}

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  // Application launchers install their least-privilege URL before the first query.
  // This package deliberately never reads the shared root .env: importing @safr/db
  // inside the hostile-agent process must not reveal the schema-owner credential.
  pool ??= new pg.Pool({ connectionString: getDatabaseUrl() });
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

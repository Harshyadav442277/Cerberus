import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getPool } from "./pool.js";

const MIGRATIONS_DIR = resolve(import.meta.dirname, "../migrations");

export interface Migration {
  id: string;
  upFile: string;
  downFile: string;
}

/** Discovers `NNN_name.up.sql` / `NNN_name.down.sql` pairs, ordered by filename. */
export async function listMigrations(): Promise<Migration[]> {
  const files = await readdir(MIGRATIONS_DIR);
  const ids = files
    .filter((f) => f.endsWith(".up.sql"))
    .map((f) => f.replace(/\.up\.sql$/, ""))
    .sort();

  return ids.map((id) => {
    const downFile = `${id}.down.sql`;
    if (!files.includes(downFile)) {
      throw new Error(`Migration ${id} has no matching ${downFile}. Rollback would be impossible.`);
    }
    return { id, upFile: `${id}.up.sql`, downFile };
  });
}

async function ensureMigrationsTable(): Promise<void> {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          TEXT        PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

export async function appliedMigrations(): Promise<string[]> {
  await ensureMigrationsTable();
  const { rows } = await getPool().query<{ id: string }>(
    "SELECT id FROM schema_migrations ORDER BY id",
  );
  return rows.map((r) => r.id);
}

async function readSql(file: string): Promise<string> {
  return readFile(resolve(MIGRATIONS_DIR, file), "utf8");
}

/**
 * Applies pending migrations. Each migration runs inside a transaction together with
 * its bookkeeping insert, so a failure leaves neither a half-applied schema nor a
 * false record of success.
 */
export async function migrateUp(): Promise<string[]> {
  await ensureMigrationsTable();
  const applied = new Set(await appliedMigrations());
  const pending = (await listMigrations()).filter((m) => !applied.has(m.id));
  const done: string[] = [];

  for (const migration of pending) {
    const sql = await readSql(migration.upFile);
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [migration.id]);
      await client.query("COMMIT");
      done.push(migration.id);
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`Migration ${migration.id} failed: ${(error as Error).message}`);
    } finally {
      client.release();
    }
  }
  return done;
}

/** Rolls back the most recently applied migration. */
export async function migrateDown(): Promise<string | null> {
  await ensureMigrationsTable();
  const applied = await appliedMigrations();
  const last = applied.at(-1);
  if (!last) return null;

  const migration = (await listMigrations()).find((m) => m.id === last);
  if (!migration) {
    throw new Error(`Migration ${last} is recorded as applied but its files are missing.`);
  }

  const sql = await readSql(migration.downFile);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("DELETE FROM schema_migrations WHERE id = $1", [last]);
    await client.query("COMMIT");
    return last;
  } catch (error) {
    await client.query("ROLLBACK");
    throw new Error(`Rollback of ${last} failed: ${(error as Error).message}`);
  } finally {
    client.release();
  }
}

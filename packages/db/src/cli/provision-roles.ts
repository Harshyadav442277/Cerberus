import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { closePool, getPool } from "../pool.js";

interface RuntimeRole {
  label: string;
  envFile: string;
  urlName: string;
  groupRole: string;
}

const roles: RuntimeRole[] = [
  {
    label: "agent",
    envFile: ".env.agent",
    urlName: "AGENT_DATABASE_URL",
    groupRole: "cerberus_agent_role",
  },
  {
    label: "control-plane",
    envFile: ".env.authorizer",
    urlName: "CONTROL_PLANE_DATABASE_URL",
    groupRole: "cerberus_control_plane_role",
  },
  {
    label: "executor",
    envFile: ".env.executor",
    urlName: "EXECUTOR_DATABASE_URL",
    groupRole: "cerberus_executor_role",
  },
];

function readRuntimeUrl(role: RuntimeRole): URL {
  const values: Record<string, string> = {};
  loadEnv({
    path: resolve(import.meta.dirname, `../../../../${role.envFile}`),
    quiet: true,
    processEnv: values,
  });
  const raw = process.env[role.urlName]?.trim() || values[role.urlName]?.trim();
  if (!raw) throw new Error(`${role.urlName} is required in ${role.envFile}`);
  const url = new URL(raw);
  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  if (!/^[a-z_][a-z0-9_]{2,62}$/.test(username)) {
    throw new Error(`${role.urlName} must use a simple PostgreSQL username`);
  }
  if (password.length < 16) {
    throw new Error(`${role.urlName} password must be at least 16 characters`);
  }
  return url;
}

function identifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function provision(role: RuntimeRole): Promise<void> {
  const url = readRuntimeUrl(role);
  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  const quotedUser = identifier(username);
  const existing = await getPool().query<{ exists: boolean; unsafe: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists,
            ($1 = current_user
             OR EXISTS (SELECT 1 FROM pg_database WHERE datdba = (SELECT oid FROM pg_roles WHERE rolname = $1))
             OR EXISTS (SELECT 1 FROM pg_class WHERE relowner = (SELECT oid FROM pg_roles WHERE rolname = $1))
             OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspowner = (SELECT oid FROM pg_roles WHERE rolname = $1))) AS unsafe`,
    [username],
  );
  if (existing.rows[0]?.unsafe) {
    throw new Error(`${role.urlName} must not reuse a database or schema owner role`);
  }
  const memberships = await getPool().query<{ rolname: string }>(
    `SELECT parent.rolname
       FROM pg_auth_members membership
       JOIN pg_roles parent ON parent.oid = membership.roleid
       JOIN pg_roles member ON member.oid = membership.member
      WHERE member.rolname = $1`,
    [username],
  );
  const knownGroups = new Set(roles.map((candidate) => candidate.groupRole));
  const unexpected = memberships.rows
    .map((membership) => membership.rolname)
    .filter((membership) => !knownGroups.has(membership));
  if (unexpected.length > 0) {
    throw new Error(`${role.urlName} inherits unexpected roles: ${unexpected.join(", ")}`);
  }
  if (!existing.rows[0]?.exists) {
    await getPool().query(`CREATE ROLE ${quotedUser} LOGIN`);
  }
  await getPool().query(
    `ALTER ROLE ${quotedUser} LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${literal(password)}`,
  );
  await getPool().query(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${quotedUser}`);
  await getPool().query(`REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ${quotedUser}`);
  await getPool().query(`REVOKE CREATE ON SCHEMA public FROM ${quotedUser}`);
  for (const group of roles.map((candidate) => candidate.groupRole)) {
    await getPool().query(`REVOKE ${identifier(group)} FROM ${quotedUser}`);
  }
  await getPool().query(`GRANT ${identifier(role.groupRole)} TO ${quotedUser}`);
  console.log(`  ${role.label.padEnd(14)} ${username}`);
}

async function main(): Promise<void> {
  console.log("\n  Cerberus runtime database logins");
  const usernames = roles.map((role) => decodeURIComponent(readRuntimeUrl(role).username));
  if (new Set(usernames).size !== roles.length) {
    throw new Error("each runtime process must use a distinct PostgreSQL login");
  }
  for (const role of roles) await provision(role);
  console.log("\n  provisioned without exposing passwords\n");
}

try {
  await main();
} catch (error) {
  console.error(`\n  ERROR ${(error as Error).message}\n`);
  process.exitCode = 1;
} finally {
  await closePool();
}

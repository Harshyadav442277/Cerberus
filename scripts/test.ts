/**
 * Full-suite runner with a defined postcondition: canonical demo state exists.
 *
 * PostgreSQL integration tests intentionally TRUNCATE shared fixtures to exercise
 * real constraints and role grants. Leaving that destruction behind makes a green
 * test command break the very next release/demo command, so restoration is part of
 * the test contract and its failure is a test failure.
 */
import { spawnSync } from "node:child_process";
import { globSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const testFiles = [
  "packages/core/src/__tests__/*.test.ts",
  "packages/disposition-engine/src/__tests__/*.test.ts",
  "packages/execution-authorization/src/__tests__/*.test.ts",
  "packages/x402-client/src/__tests__/*.test.ts",
  "packages/db/src/__tests__/*.test.ts",
  "packages/audit-log/src/__tests__/*.test.ts",
  "apps/agent/src/__tests__/*.test.ts",
  "apps/executor/src/__tests__/*.test.ts",
  "apps/reviewer/src/*.test.ts",
  "contracts/src/__tests__/*.test.ts",
  "apps/api/src/__tests__/*.test.ts",
  "apps/dashboard/lib/*.test.ts",
];

const expandedTestFiles = testFiles.flatMap((pattern) =>
  globSync(pattern, { cwd: ROOT }).sort(),
);

const tests = spawnSync(
  process.execPath,
  [
    "--env-file-if-exists=.env",
    "--import",
    "tsx",
    "--test",
    "--test-concurrency=1",
    "--test-timeout=60000",
    ...expandedTestFiles,
  ],
  { cwd: ROOT, env: process.env, stdio: "inherit" },
);

console.log("\nRestoring canonical demo seed after integration tests...\n");
const restore = spawnSync(
  process.execPath,
  [
    "--env-file-if-exists=.env",
    "--import",
    "tsx",
    "packages/db/src/cli/seed.ts",
  ],
  { cwd: ROOT, env: process.env, stdio: "inherit" },
);

if (tests.error) console.error(tests.error.message);
if (restore.error) console.error(restore.error.message);

const testsPassed = tests.status === 0 && !tests.signal && !tests.error;
const restorePassed = restore.status === 0 && !restore.signal && !restore.error;
if (!testsPassed || !restorePassed) process.exitCode = 1;

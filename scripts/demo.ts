/**
 * Architecture.md §4 entry point for the Bible Section 9 demo.
 *
 * Implementation lives in apps/agent (workspace deps resolve there). This file is a
 * thin launcher so `tsx scripts/demo.ts` and `npm run demo:script` stay equivalent.
 */
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(root, "apps/agent/src/cli/section9.ts");

const child = spawn(
  process.execPath,
  ["--import", "tsx", target, ...process.argv.slice(2)],
  { stdio: "inherit", cwd: root, env: process.env },
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});

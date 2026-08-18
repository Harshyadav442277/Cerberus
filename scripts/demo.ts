/**
 * Architecture.md §4 entry point for the Bible Section 9 demo.
 *
 * Reset/seed is deliberately performed here with the operator's schema-owner URL.
 * The child agent then scrubs that inherited URL and installs AGENT_DATABASE_URL,
 * so an untrusted agent process never receives mandate/reset authority.
 */
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const agentTarget = resolve(root, "apps/agent/src/cli/section9.ts");
const resetTarget = resolve(root, "packages/db/src/cli/reset-demo.ts");
const args = process.argv.slice(2);
const thrice = args.includes("--thrice");
const noReset = args.includes("--no-reset");

if (!noReset) loadEnvFile(resolve(root, ".env"));

function agentEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const name of [
    "DATABASE_URL",
    "CONTROL_PLANE_DATABASE_URL",
    "EXECUTOR_DATABASE_URL",
    "EVM_PRIVATE_KEY",
    "EXECUTOR_EVM_PRIVATE_KEY",
    "EXECUTION_AUTH_PRIVATE_KEY",
    "REVIEWER_API_TOKEN",
    "REVIEWER_ID",
    "REVIEWER_DASHBOARD_USERNAME",
    "REVIEWER_DASHBOARD_PASSWORD",
  ]) {
    delete environment[name];
  }
  return environment;
}

function run(
  target: string,
  childArgs: string[] = [],
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", target, ...childArgs], {
      stdio: "inherit",
      cwd: root,
      env: environment,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${target} exited from signal ${signal}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`${target} exited with status ${code ?? "unknown"}`));
        return;
      }
      resolvePromise();
    });
  });
}

const runs = thrice ? 3 : 1;
for (let index = 1; index <= runs; index += 1) {
  if (!noReset) await run(resetTarget);
  const label = thrice ? `Run ${index} of ${runs}` : "Demo run";
  await run(agentTarget, [`--run-label=${label}`], agentEnvironment());
}

if (thrice) console.log("\n  Three consecutive clean runs succeeded.\n");

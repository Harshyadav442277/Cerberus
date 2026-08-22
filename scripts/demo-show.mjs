#!/usr/bin/env node
/**
 * demo-show.mjs — the ONE command you run on the projected screen.
 *
 *   node "scripts/demo-show.mjs"               DENY  →  ESCALATE (waits for your Approve click)  →  ALLOW
 *   node "scripts/demo-show.mjs" --warmup      the 30-minutes-before warm-up: ESCALATE (Approve) then ALLOW
 *   node "scripts/demo-show.mjs" cap_breach    any explicit list of scenarios, in order
 *   --no-pause                                    don't wait for Enter between scenarios
 *
 * Runs exactly the same `npm run demo -- <scenario>` commands the RUNBOOK names — one at a time,
 * with a large headline before each, the key lines highlighted, and a pause ("press Enter") between
 * them so you control the pace. It hides one stale informational note the CLI prints. It changes
 * nothing in the product and settles nothing you wouldn't settle by hand.
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
const NO_PAUSE = args.includes("--no-pause");
const WARMUP = args.includes("--warmup");
const explicit = args.filter((a) => !a.startsWith("--"));
const SCENARIOS = explicit.length ? explicit : WARMUP ? ["new_counterparty", "clean"] : ["cap_breach", "new_counterparty", "clean"];
const CMD = process.env.DEMO_SHOW_CMD || "npm run demo --"; // override only for testing

const C = { reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", magenta: "\x1b[35m", cyan: "\x1b[36m" };
const META = {
  cap_breach:       { title: "DENY — 5 USDC proposed against a 1 USDC per-transaction cap",               color: C.red,    watch: "watch for:  x402 reached  NO — never constructed" },
  new_counterparty: { title: "ESCALATE — 0.75 USDC to a counterparty NOT on the allowlist",               color: C.yellow, watch: "it will WAIT here  →  dashboard ▸ Escalations ▸ Approve" },
  clean:            { title: "ALLOW — 0.5 USDC to an approved merchant, inside every cap",                color: C.green,  watch: "watch for:  settlement … tx hash  →  explorer link" },
};
const STALE = [/Note: a failed settlement on the ALLOW path/, /expected until the payer wallet is funded/, /affects the disposition path above/];

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));

function banner(i, n, key) {
  const m = META[key] ?? { title: key, color: C.cyan, watch: "" };
  const line = "═".repeat(78);
  process.stdout.write(`\n${m.color}${C.bold}${line}\n  SCENARIO ${i} of ${n}   ${m.title}\n${line}${C.reset}\n`);
  if (m.watch) process.stdout.write(`${C.dim}  ${m.watch}${C.reset}\n`);
  process.stdout.write("\n");
}

function highlight(line) {
  if (/disposition\s+DENY/.test(line)) return `${C.red}${C.bold}${line}${C.reset}`;
  if (/disposition\s+ALLOW/.test(line)) return `${C.green}${C.bold}${line}${C.reset}`;
  if (/disposition\s+ESCALATE/.test(line)) return `${C.yellow}${C.bold}${line}${C.reset}`;
  if (/never constructed/.test(line)) return `${C.magenta}${C.bold}${line}${C.reset}`;
  if (/human review/.test(line)) return `${C.yellow}${line}${C.reset}`;
  if (/settlement|explorer/.test(line)) return `${C.cyan}${C.bold}${line}${C.reset}`;
  if (/ERROR/.test(line)) return `${C.red}${C.bold}${line}${C.reset}`;
  return line;
}

function runScenario(key) {
  return new Promise((resolve) => {
    const child = spawn(`${CMD} ${key}`, { shell: true, stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let rest = "";
    const onChunk = (chunk) => {
      rest += chunk.toString();
      const parts = rest.split(/\r?\n/); rest = parts.pop() ?? "";
      for (const p of parts) { if (STALE.some((re) => re.test(p))) continue; process.stdout.write(highlight(p) + "\n"); }
    };
    child.stdout.on("data", onChunk);
    child.stderr.on("data", onChunk);
    child.on("exit", (code) => { if (rest.length && !STALE.some((re) => re.test(rest))) process.stdout.write(highlight(rest) + "\n"); resolve(code ?? 1); });
  });
}

(async () => {
  process.stdout.write(`${C.bold}Cerberus — live demo${C.reset}  (${SCENARIOS.join("  →  ")})\n`);
  for (let i = 0; i < SCENARIOS.length; i++) {
    const key = SCENARIOS[i];
    if (i > 0 && !NO_PAUSE) await ask(`${C.dim}\n  [Enter] for scenario ${i + 1} of ${SCENARIOS.length} …${C.reset}`);
    banner(i + 1, SCENARIOS.length, key);
    const code = await runScenario(key);
    if (code !== 0) {
      process.stdout.write(`\n${C.red}${C.bold}  ✗ scenario "${key}" exited with code ${code}.${C.reset}  Do NOT retype it more than once — use the fallback row on the dashboard (RUNBOOK §5).\n`);
      if (!NO_PAUSE) await ask(`${C.dim}  [Enter] to continue with the next scenario, Ctrl+C to stop …${C.reset}`);
    } else {
      process.stdout.write(`\n${C.green}  ✓ scenario "${key}" complete.${C.reset}\n`);
    }
  }
  process.stdout.write(`\n${C.bold}Done.${C.reset} Dashboard ▸ Audit Log shows all three.\n`);
  rl.close();
})();

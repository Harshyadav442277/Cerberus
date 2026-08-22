#!/usr/bin/env node
/**
 * demo-up.mjs — ONE command brings up the whole Cerberus demo stack and tells you when it is ready.
 *
 *   node "scripts/demo-up.mjs"                 start merchant, api, executor, dashboard, reconciler, anchor
 *   node "scripts/demo-up.mjs" --prod-dashboard use the production dashboard build (run `npm run build --prefix apps/dashboard` once first)
 *   node "scripts/demo-up.mjs" --dry            show what would be started, start nothing
 *   node "scripts/demo-up.mjs" --check          start nothing; just print the health table for services already running
 *
 * This is a presentation-layer launcher. It does not change the product: it only runs the same
 * `npm run …` scripts you would type into six terminals, prefixes their output, health-checks them,
 * and stops them all together on Ctrl+C. Keep this window OFF the projector; it is for you.
 *
 * Requires: Postgres already up on 5544, env files complete (see docs/submission/RUNBOOK.md and LIVE_EVIDENCE_BLOCKED.md).
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, createWriteStream } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOG_DIR = join(ROOT, "tmp", "demo-logs");
const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const CHECK = args.includes("--check"); // only re-run the health table against already-running services
const PROD_DASH = args.includes("--prod-dashboard");

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", blue: "\x1b[34m", magenta: "\x1b[35m", cyan: "\x1b[36m",
};
const SERVICES = [
  { name: "merchant",   cmd: "npm run merchant",   color: C.cyan,    health: "http://localhost:4021/health", expect: "200" },
  { name: "api",        cmd: "npm run api",        color: C.green,   health: "http://localhost:4050/health", expect: "200" },
  { name: "executor",   cmd: "npm run executor",   color: C.magenta, health: "http://localhost:4060/health", expect: "200" },
  { name: "dashboard",  cmd: PROD_DASH ? "npm run start --prefix apps/dashboard" : "npm run dashboard", color: C.blue, health: "http://localhost:3000/", expect: "401 or 200" },
  { name: "reconciler", cmd: "npm run reconciler", color: C.yellow,  health: null },
  { name: "anchor",     cmd: "npm run anchor",     color: C.dim,     health: null },
];

console.log(`${C.bold}Cerberus demo launcher${C.reset} — repo: ${ROOT}`);
for (const s of SERVICES) console.log(`  ${s.color}${s.name.padEnd(10)}${C.reset} ${s.cmd}`);
if (DRY) { console.log("\n--dry: nothing started."); process.exit(0); }
if (CHECK) {
  (async () => { printSummary(await healthSummary(), true); process.exit(0); })();
}

if (!CHECK) mkdirSync(LOG_DIR, { recursive: true });
const children = new Map();
const lastLines = new Map();
let anchorDisabled = false;

function startService(s) {
  const log = createWriteStream(join(LOG_DIR, `${s.name}.log`), { flags: "a" });
  const child = spawn(s.cmd, { cwd: ROOT, shell: true, stdio: ["ignore", "pipe", "pipe"], env: process.env });
  children.set(s.name, child);
  lastLines.set(s.name, []);
  const NOISE = [/^npm (notice|warn) /i, /^> .*@\d+\.\d+\.\d+ (merchant|api|executor|dashboard|reconciler|anchor|dev)$/, /^> (tsx|npm run|node --env-file|next dev)/];
  let lastLine = null, repeats = 0;
  const onLine = (line) => {
    log.write(line + "\n");
    if (NOISE.some((re) => re.test(line))) return;
    if (line === lastLine) {
      repeats++;
      if (repeats % 25 === 0) process.stdout.write(`${s.color}[${s.name.padEnd(10)}]${C.reset} ${C.dim}(previous line repeated ${repeats}×)${C.reset}\n`);
      return;
    }
    lastLine = line; repeats = 0;
    const buf = lastLines.get(s.name); buf.push(line); if (buf.length > 12) buf.shift();
    if (s.name === "anchor" && /anchoring\s+DISABLED/i.test(line)) anchorDisabled = true;
    process.stdout.write(`${s.color}[${s.name.padEnd(10)}]${C.reset} ${line}\n`);
  };
  for (const stream of [child.stdout, child.stderr]) {
    let rest = "";
    stream.on("data", (chunk) => {
      rest += chunk.toString();
      const parts = rest.split(/\r?\n/); rest = parts.pop() ?? "";
      for (const p of parts) if (p.length) onLine(p);
    });
    stream.on("end", () => { if (rest.length) onLine(rest); });
  }
  child.on("exit", (code) => {
    children.delete(s.name);
    const tail = lastLines.get(s.name).slice(-6).join("\n      ");
    process.stdout.write(`\n${C.red}${C.bold}✗ SERVICE "${s.name}" EXITED (code ${code}).${C.reset} Last lines:\n      ${tail}\n` +
      `${C.yellow}  Fix the cause, then restart just this one in another terminal: ${s.cmd}${C.reset}\n\n`);
  });
}

if (!CHECK) for (const s of SERVICES) startService(s);

async function probe(url, method = "GET") {
  try {
    const res = await fetch(url, { method, signal: AbortSignal.timeout(2500) });
    return res.status;
  } catch { return 0; }
}

async function healthSummary() {
  const rows = [];
  for (const s of SERVICES) {
    if (!s.health) { rows.push([s.name, CHECK ? "no HTTP health — check its window" : children.has(s.name) ? "running" : "EXITED", CHECK ? true : children.has(s.name)]); continue; }
    const st = await probe(s.health);
    const ok = s.name === "dashboard" ? (st === 401 || st === 200) : st === 200;
    rows.push([s.name, st === 0 ? "no answer yet" : `HTTP ${st}`, ok]);
  }
  const tok = await probe("http://localhost:4050/execution-authorizations", "POST");
  rows.push(["exec token", tok === 401 ? "configured (401)" : tok === 503 ? "NOT CONFIGURED (503)" : tok === 0 ? "api not up" : `HTTP ${tok}`, tok === 401]);
  rows.push(["anchor key", anchorDisabled ? "DISABLED — key misplaced" : "ok so far", !anchorDisabled]);
  return rows;
}

function printSummary(rows, final) {
  process.stdout.write(`\n${C.bold}── health ──────────────────────────────${C.reset}\n`);
  for (const [n, status, ok] of rows) process.stdout.write(`  ${ok ? C.green + "✓" : C.red + "✗"} ${n.padEnd(11)}${C.reset} ${status}\n`);
  if (final) {
    const allOk = rows.every((r) => r[2]);
    if (allOk) {
      process.stdout.write(`\n${C.green}${C.bold}READY.${C.reset} Dashboard: http://localhost:3000  (log in now)\n` +
        `In your PROJECTED terminal run:  node "scripts/demo-show.mjs"\n` +
        `Leave this window open (minimised). Ctrl+C here stops everything.\n\n`);
    } else {
      process.stdout.write(`\n${C.red}${C.bold}NOT READY${C.reset} — fix the ✗ lines above before you present. Logs: ${LOG_DIR}\n\n`);
    }
  }
}

if (!CHECK) (async () => {
  const deadline = Date.now() + 120_000;
  let rows;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    rows = await healthSummary();
    if (rows.every((r) => r[2])) break;
  }
  printSummary(rows, true);
})();

function stopAll() {
  process.stdout.write(`\n${C.yellow}stopping all services…${C.reset}\n`);
  for (const [name, child] of children) {
    try {
      if (process.platform === "win32") spawnSync("taskkill", ["/F", "/T", "/PID", String(child.pid)], { stdio: "ignore" });
      else child.kill("SIGTERM");
    } catch { /* best effort */ }
    children.delete(name);
  }
}
process.on("SIGINT", () => { stopAll(); process.exit(0); });
process.on("SIGTERM", () => { stopAll(); process.exit(0); });
if (!CHECK) process.stdin.resume();

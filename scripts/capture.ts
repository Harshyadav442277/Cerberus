/**
 * Evidence capture harness.
 *
 * Runs a named command, tees its combined output to
 * `artifacts/final-evidence/terminal/<name>.log`, and records the exit code,
 * duration and log digest in `artifacts/final-evidence/terminal/index.json`.
 *
 *   npm run capture -- <name> -- <command> [args...]
 *
 * The exit code is recorded, never swallowed: an evidence file that quietly hides a
 * failure is worse than no evidence file, because it converts "we did not check" into
 * "we checked and it was fine". This process exits with the same code the child did.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const TERMINAL_DIR = resolve(ROOT, "artifacts/final-evidence/terminal");
const INDEX = resolve(TERMINAL_DIR, "index.json");

export interface CaptureRecord {
  name: string;
  command: string;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  startedAt: string;
  log: string;
  logSha256: string;
  logBytes: number;
}

const argv = process.argv.slice(2);
const separator = argv.indexOf("--");
if (separator < 1 || separator === argv.length - 1) {
  console.error("usage: npm run capture -- <name> -- <command> [args...]");
  process.exit(2);
}
const name = argv.slice(0, separator).join("-");
const command = argv.slice(separator + 1);

mkdirSync(TERMINAL_DIR, { recursive: true });
const logPath = resolve(TERMINAL_DIR, `${name}.log`);
const startedAt = new Date().toISOString();
const started = Date.now();

const header =
  `# ${command.join(" ")}\n` +
  `# started ${startedAt}\n` +
  `# ${"-".repeat(72)}\n`;
writeFileSync(logPath, header, "utf8");

const child = spawn(command[0]!, command.slice(1), {
  cwd: ROOT,
  shell: process.platform === "win32",
  env: process.env,
});

function tee(chunk: Buffer, stream: NodeJS.WriteStream): void {
  stream.write(chunk);
  appendFileSync(logPath, chunk);
}

child.stdout.on("data", (chunk: Buffer) => tee(chunk, process.stdout));
child.stderr.on("data", (chunk: Buffer) => tee(chunk, process.stderr));

child.on("close", (code, signal) => {
  const durationMs = Date.now() - started;
  appendFileSync(
    logPath,
    `# ${"-".repeat(72)}\n# exit ${code ?? `signal ${signal}`} after ${durationMs}ms\n`,
    "utf8",
  );

  // Some child tools emit CRLF even on Unix. Git's text filters would normalize
  // those bytes on checkout and invalidate a digest taken before the commit, so the
  // capture itself is canonical LF before either its size or hash is recorded.
  const canonical = readFileSync(logPath, "utf8")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n");
  writeFileSync(logPath, canonical, "utf8");

  const bytes = readFileSync(logPath);
  const record: CaptureRecord = {
    name,
    command: command.join(" "),
    exitCode: code,
    signal: signal ?? null,
    durationMs,
    startedAt,
    log: `terminal/${name}.log`,
    logSha256: createHash("sha256").update(bytes).digest("hex"),
    logBytes: bytes.byteLength,
  };

  const existing: CaptureRecord[] = existsSync(INDEX)
    ? (JSON.parse(readFileSync(INDEX, "utf8")) as CaptureRecord[])
    : [];
  // Re-running a capture replaces its entry rather than accumulating duplicates.
  const merged = [...existing.filter((entry) => entry.name !== name), record].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  writeFileSync(INDEX, `${JSON.stringify(merged, null, 2)}\n`, "utf8");

  console.log(`\n  captured  ${record.log}  exit ${code ?? signal}  ${durationMs}ms`);
  process.exit(code ?? 1);
});

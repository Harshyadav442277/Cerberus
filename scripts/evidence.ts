/**
 * Evidence manifest and validator — Phases H and N.
 *
 *   npm run evidence:manifest    build artifacts/final-evidence/manifest.json + README.md
 *   npm run evidence:verify      validate the manifest against what is actually on disk
 *
 * The manifest is generated FROM the artifacts, never hand-written, so it cannot claim
 * something that is not there. The validator then reads it back and checks every path
 * exists, every JSON parses, every recorded exit code is present, transaction hashes
 * are well formed, and no credential value appears anywhere in committed evidence.
 *
 * A missing artifact is recorded as missing. Nothing is defaulted to present, and no
 * result is invented for something that did not run.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { extname, join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const EVIDENCE = resolve(ROOT, "artifacts/final-evidence");
const MANIFEST = resolve(EVIDENCE, "manifest.json");
const CAPTURE_INDEX = resolve(EVIDENCE, "terminal/index.json");

type Mode = "manifest" | "verify";
const mode = (process.argv[2] ?? "manifest") as Mode;

function git(args: string[]): string {
  return spawnSync("git", args, { cwd: ROOT, encoding: "utf8" }).stdout.trim();
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...walk(full));
    else found.push(full);
  }
  return found;
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

interface CaptureRecord {
  name: string;
  command: string;
  exitCode: number | null;
  durationMs: number;
  startedAt: string;
  log: string;
  logSha256: string;
  logBytes: number;
}

interface FileEntry {
  path: string;
  bytes: number;
  sha256: string;
}

// ── Manifest generation ──────────────────────────────────────────────────────

function collectFiles(): FileEntry[] {
  return walk(EVIDENCE)
    .filter((path) => path !== MANIFEST && !path.endsWith("README.md"))
    .map((path) => ({
      path: relative(EVIDENCE, path).replaceAll("\\", "/"),
      bytes: statSync(path).size,
      sha256: sha256(path),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** Terminal colour sequences, which must not defeat the anchored patterns below. */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

/**
 * Pulls a headline number out of a captured log rather than restating it by hand.
 *
 * Prefers the `gate-` capture over the `baseline-` one. Both exist by design — the
 * baseline records the state before any change, the gate records the final state —
 * and reporting the baseline as if it were current would understate the build.
 */
function fromLog(suffix: string, pattern: RegExp): string | null {
  for (const prefix of ["gate-", "baseline-"]) {
    const path = resolve(EVIDENCE, "terminal", `${prefix}${suffix}.log`);
    if (!existsSync(path)) continue;
    // Strip ANSI colour before matching. A capture made on a colour-emitting runner
    // otherwise fails every anchored pattern here, and the loop then falls through to
    // the older baseline log — silently reporting a previous build's numbers as if
    // they were this one's.
    const match = stripAnsi(readFileSync(path, "utf8")).match(pattern);
    if (match) return (match[1] ?? match[0]).trim();
  }
  return null;
}

function buildManifest(): Record<string, unknown> {
  const captureIndex = readJson<CaptureRecord[]>(CAPTURE_INDEX) ?? [];
  // A historical index entry is not evidence when its log was never committed. Only
  // describe captures whose bytes are actually present and still match the recorded
  // digest; the validator independently checks the same facts on read-back.
  const captures = captureIndex.filter((capture) => {
    const path = resolve(EVIDENCE, capture.log);
    return existsSync(path) && sha256(path) === capture.logSha256;
  });
  // Keep the public index as portable as the manifest instead of retaining stale
  // machine-local records that point at absent or changed logs.
  writeFileSync(CAPTURE_INDEX, `${JSON.stringify(captures, null, 2)}\n`, "utf8");
  const mutation = readJson<Record<string, unknown>>(
    resolve(EVIDENCE, "redteam/mutation-matrix.json"),
  );

  const sandboxDir = resolve(EVIDENCE, "sandbox");
  const sandboxRuns = existsSync(sandboxDir)
    ? readdirSync(sandboxDir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => readJson<Record<string, unknown>>(resolve(sandboxDir, f)))
        .filter((r): r is Record<string, unknown> => r !== null)
    : [];

  const recordings = walk(resolve(EVIDENCE, "recording"));
  const screenshots = walk(resolve(EVIDENCE, "screenshots"));

  return {
    generatedAt: new Date().toISOString(),
    repository: {
      sha: git(["rev-parse", "HEAD"]),
      branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
      // Evidence generation necessarily changes the evidence directory. What matters
      // is that the source/configuration under test still matches the named commit.
      sourceTreeClean:
        git([
          "status",
          "--porcelain",
          "--untracked-files=no",
          "--",
          ".",
          ":!artifacts/final-evidence",
        ]) === "",
    },
    network: {
      name: "Base Sepolia",
      chainId: 84532,
      auditAnchorContract: "0x2d2d857ce3c0d5d666b7e0db3fe8067d4b4d6ff7",
    },
    verification: {
      tests: fromLog("tests", /^\s*\S?\s*pass (\d+)\s*$/m),
      testsFailed: fromLog("tests", /^\s*\S?\s*fail (\d+)\s*$/m),
      suites: fromLog("tests", /^\s*\S?\s*suites (\d+)\s*$/m),
      adversarialClasses: fromLog("adversarial", /Attack classes passed:\s+(\S+)/),
      adversarialAssertions: fromLog("adversarial", /Assertions passed:\s+(\d+)/),
      redteamClasses: fromLog("redteam", /Attack classes passed:\s+(\S+)/),
      redteamAssertions: fromLog("redteam", /Assertions passed:\s+(\d+)/),
      dependencyAudit: fromLog("dependency-audit", /(No known vulnerabilities found)/),
      mutationGuardsDetected:
        mutation && typeof mutation.detected === "number" && typeof mutation.total === "number"
          ? `${mutation.detected}/${mutation.total}`
          : null,
    },
    captures: captures.map((c) => ({
      name: c.name,
      command: c.command,
      exitCode: c.exitCode,
      durationMs: c.durationMs,
      log: c.log,
      sha256: c.logSha256,
    })),
    sandbox: sandboxRuns.map((run) => ({
      seed: run.seed,
      agents: run.agents,
      actions: run.actions,
      concurrency: run.concurrency,
      dispositions: run.dispositions,
      throughputPerSecond: run.throughputPerSecond,
      policyLatencyMs: run.policyLatencyMs,
      violations: run.violations,
      result: run.result,
    })),
    mutationMatrix: mutation
      ? { detected: mutation.detected, total: mutation.total, guards: mutation.guards }
      : null,
    live: {
      // Deliberately null, not zero and not an empty success. Phase E did not run.
      status: "BLOCKED",
      reason:
        "Signing keys for the executor, authorizer and anchor worker are not provisioned on this machine; see docs/submission/LIVE_EVIDENCE_BLOCKED.md",
      allow: null,
      escalate: null,
      deny: null,
      preflight: "terminal/e0-preflight.log",
    },
    recordings: recordings.map((path) => ({
      path: relative(EVIDENCE, path).replaceAll("\\", "/"),
      bytes: statSync(path).size,
      sha256: sha256(path),
    })),
    screenshots: screenshots.map((path) => ({
      path: relative(EVIDENCE, path).replaceAll("\\", "/"),
      bytes: statSync(path).size,
      sha256: sha256(path),
    })),
    files: collectFiles(),
    knownLimitations: [
      "No fresh funded live payment on the hardened path. Phase E is blocked on operator key provisioning and funding.",
      "A baseline adversarial recording is present; no fresh funded live-payment recording is claimed.",
      "Settlement proves exact successful chain inclusion, not finality. No confirmation threshold gates the settlement path.",
      "Sensitive control-plane routes use bearer authentication and restricted browser CORS; loopback binding remains defense in depth. TLS and credential rotation are deployment responsibilities.",
      "Process isolation is by OS boundary and database role; host-level compromise defeats it.",
    ],
  };
}

function writeReadme(manifest: Record<string, unknown>): void {
  const v = manifest.verification as Record<string, string | null>;
  const repo = manifest.repository as Record<string, unknown>;
  const sandbox = manifest.sandbox as Array<Record<string, unknown>>;
  const captures = manifest.captures as Array<Record<string, unknown>>;

  const lines = [
    "# Cerberus — Final Evidence",
    "",
    `Generated from the artifacts in this directory at commit \`${String(repo.sha).slice(0, 7)}\`.`,
    "Every number below is read out of a captured log or a machine-written report; none",
    "is restated by hand.",
    "",
    "## Verification",
    "",
    "| Gate | Result |",
    "| --- | --- |",
    `| Tests | ${v.tests ?? "not captured"} passed, ${v.testsFailed ?? "?"} failed, ${v.suites ?? "?"} suites |`,
    `| Adversarial suite | ${v.adversarialClasses ?? "not captured"} classes, ${v.adversarialAssertions ?? "?"} assertions |`,
    `| Security red team | ${v.redteamClasses ?? "not captured"} classes, ${v.redteamAssertions ?? "?"} assertions |`,
    `| Mutation matrix | ${v.mutationGuardsDetected ?? "not captured"} guards proven detectable |`,
    `| Dependency audit | ${v.dependencyAudit ?? "not captured"} |`,
    "",
    "## Captured commands",
    "",
    "| Command | Exit | Log |",
    "| --- | --- | --- |",
    ...captures.map(
      (c) => `| \`${c.command}\` | ${c.exitCode} | [${c.log}](./${c.log}) |`,
    ),
    "",
    "## Seeded sandbox",
    "",
    sandbox.length === 0
      ? "_No sandbox run captured._"
      : [
          "| Seed | Agents | Actions | Concurrency | ALLOW/DENY/ESCALATE | Throughput | Violations | Result |",
          "| --- | --- | --- | --- | --- | --- | --- | --- |",
          ...sandbox.map((s) => {
            const d = s.dispositions as Record<string, number>;
            return `| ${s.seed} | ${s.agents} | ${s.actions} | ${s.concurrency} | ${d.ALLOW}/${d.DENY}/${d.ESCALATE} | ${s.throughputPerSecond}/s | ${s.violations} | ${s.result} |`;
          }),
        ].join("\n"),
    "",
    "## Live payment evidence",
    "",
    "**BLOCKED.** No fresh funded payment was made on the hardened path, and none has",
    "been fabricated. The blocker and the exact procedure to clear it are in",
    "[LIVE_EVIDENCE_BLOCKED.md](../../docs/submission/LIVE_EVIDENCE_BLOCKED.md).",
    "",
    "The preflight that establishes this is captured at",
    "[terminal/e0-preflight.log](./terminal/e0-preflight.log).",
    "",
    "## Recordings and screenshots",
    "",
    (manifest.recordings as unknown[]).length === 0 &&
    (manifest.screenshots as unknown[]).length === 0
      ? [
          "**None captured.** Automated screen capture was unavailable in the build",
          "environment — the browser pane does not composite frames headlessly. The",
          "dashboard was still driven and verified programmatically; its rendered content",
          "is in [database/audit-state.txt](./database/audit-state.txt).",
          "",
          "To produce them, follow",
          "[MANUAL_RECORDING_GUIDE.md](../../docs/submission/MANUAL_RECORDING_GUIDE.md),",
          "then re-run `npm run evidence:manifest`.",
        ].join("\n")
      : [
          ...(manifest.recordings as Array<Record<string, unknown>>).map(
            (r) => `- \`${r.path}\` — ${r.bytes} bytes, sha256 \`${String(r.sha256).slice(0, 16)}…\``,
          ),
          ...(manifest.screenshots as Array<Record<string, unknown>>).map(
            (s) => `- \`${s.path}\` — ${s.bytes} bytes`,
          ),
        ].join("\n"),
    "",
    "## Known limitations",
    "",
    ...(manifest.knownLimitations as string[]).map((l) => `- ${l}`),
    "",
  ];

  writeFileSync(resolve(EVIDENCE, "README.md"), `${lines.join("\n")}\n`, "utf8");
}

// ── Validation (Phase N) ─────────────────────────────────────────────────────

interface Problem {
  severity: "FAIL" | "WARN";
  detail: string;
}

function validate(): Problem[] {
  const problems: Problem[] = [];
  const manifest = readJson<Record<string, unknown>>(MANIFEST);
  if (!manifest) {
    return [{ severity: "FAIL", detail: "manifest.json is missing or does not parse" }];
  }

  // Every file the manifest names must exist, and its digest must still match.
  for (const entry of manifest.files as FileEntry[]) {
    const path = resolve(EVIDENCE, entry.path);
    if (!existsSync(path)) {
      problems.push({ severity: "FAIL", detail: `manifest names a missing file: ${entry.path}` });
      continue;
    }
    if (statSync(path).size === 0) {
      problems.push({ severity: "FAIL", detail: `evidence file is empty: ${entry.path}` });
      continue;
    }
    if (sha256(path) !== entry.sha256) {
      problems.push({
        severity: "FAIL",
        detail: `evidence file changed since the manifest was built: ${entry.path}`,
      });
    }
  }

  // Every JSON artifact must parse.
  for (const path of walk(EVIDENCE).filter((p) => extname(p) === ".json")) {
    if (readJson(path) === null) {
      problems.push({ severity: "FAIL", detail: `JSON does not parse: ${relative(EVIDENCE, path)}` });
    }
  }

  // Captured commands must record an exit code, and a non-zero one must be EXPECTED
  // and explained here. Two of these gates are supposed to fail on this machine, and
  // saying so explicitly is the difference between honest evidence and a suite that
  // has learned to ignore its own red.
  const expectedNonZero: Record<string, string> = {
    "e0-preflight":
      "signing keys are not provisioned; Phase E is blocked and says so",
    "gate-audit-verify":
      "no anchor key is configured, so records are stored but not on chain; the verifier correctly refuses to call UNVERIFIED a pass",
  };
  for (const capture of manifest.captures as Array<Record<string, unknown>>) {
    const name = String(capture.name);
    const log = String(capture.log);
    const logPath = resolve(EVIDENCE, log);
    if (!existsSync(logPath)) {
      problems.push({ severity: "FAIL", detail: `capture names a missing log: ${name} -> ${log}` });
      continue;
    }
    if (sha256(logPath) !== capture.sha256) {
      problems.push({ severity: "FAIL", detail: `capture log digest mismatch: ${name} -> ${log}` });
    }
    if (capture.exitCode === null || capture.exitCode === undefined) {
      problems.push({ severity: "FAIL", detail: `capture has no exit code: ${name}` });
    } else if (capture.exitCode !== 0) {
      const reason = expectedNonZero[name];
      problems.push(
        reason
          ? { severity: "WARN", detail: `${name} exited ${capture.exitCode} as expected — ${reason}` }
          : { severity: "FAIL", detail: `unexplained non-zero exit ${capture.exitCode}: ${name}` },
      );
    }
  }

  // Any transaction hash claimed anywhere must at least be shaped like one, so a
  // placeholder cannot masquerade as evidence.
  const hashPattern = /"(?:tx_hash|transactionHash|anchor_tx_hash|settlement_tx)":\s*"([^"]+)"/g;
  const manifestText = readFileSync(MANIFEST, "utf8");
  for (const match of manifestText.matchAll(hashPattern)) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(match[1]!)) {
      problems.push({
        severity: "FAIL",
        detail: `malformed transaction hash in manifest: ${match[1]}`,
      });
    }
  }

  // No credential value may appear in committed evidence. Values are read from the
  // local env files and searched for; they are never printed, even on failure.
  const secretNames = [
    "EVM_PRIVATE_KEY",
    "EXECUTOR_EVM_PRIVATE_KEY",
    "EXECUTION_AUTH_PRIVATE_KEY",
    "EXECUTION_API_TOKEN",
    "AUDIT_ANCHOR_PRIVATE_KEY",
    "REVIEWER_API_TOKEN",
    "REVIEWER_DASHBOARD_PASSWORD",
    "ANTHROPIC_API_KEY",
  ];
  const secretValues = new Set<string>();
  for (const file of [".env", ".env.agent", ".env.authorizer", ".env.executor", ".env.anchor", ".env.reconciler", ".env.reviewer"]) {
    const path = resolve(ROOT, file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const [name, ...rest] = line.split("=");
      const value = rest.join("=").trim();
      // Short values would produce false positives against ordinary prose.
      if (name && secretNames.includes(name.trim()) && value.length >= 12) secretValues.add(value);
      if (name?.trim().endsWith("DATABASE_URL") && value.includes("@")) {
        const password = value.split("//")[1]?.split("@")[0]?.split(":")[1];
        if (password && password.length >= 8) secretValues.add(password);
      }
    }
  }
  for (const path of walk(EVIDENCE)) {
    const text = readFileSync(path, "utf8");
    for (const secret of secretValues) {
      if (text.includes(secret)) {
        problems.push({
          severity: "FAIL",
          detail: `a credential value appears in ${relative(EVIDENCE, path)} (value not shown)`,
        });
      }
    }
  }

  // The manifest must not claim live evidence that did not happen.
  const live = manifest.live as Record<string, unknown>;
  if (live.status !== "BLOCKED" && (live.allow === null || live.allow === undefined)) {
    problems.push({
      severity: "FAIL",
      detail: "manifest claims live evidence is not blocked but records no ALLOW run",
    });
  }

  // Portability means a fresh clone contains every byte in the manifest. Files that
  // only happen to exist in one developer's ignored working tree are not evidence.
  for (const entry of manifest.files as FileEntry[]) {
    const tracked = spawnSync("git", ["ls-files", "--error-unmatch", `artifacts/final-evidence/${entry.path}`], {
      cwd: ROOT,
      stdio: "ignore",
    });
    if (tracked.status !== 0) {
      problems.push({ severity: "FAIL", detail: `evidence file is not tracked by git: ${entry.path}` });
    }
  }

  return problems;
}

// ── Entry point ──────────────────────────────────────────────────────────────

mkdirSync(EVIDENCE, { recursive: true });

if (mode === "manifest") {
  const manifest = buildManifest();
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  writeReadme(manifest);
  const files = manifest.files as FileEntry[];
  console.log(`\n  manifest  artifacts/final-evidence/manifest.json`);
  console.log(`  readme    artifacts/final-evidence/README.md`);
  console.log(`  indexed   ${files.length} evidence file(s)\n`);
} else {
  console.log("\nEVIDENCE VALIDATION\n");
  const problems = validate();
  const failures = problems.filter((p) => p.severity === "FAIL");
  for (const problem of problems) console.log(`  ${problem.severity}  ${problem.detail}`);
  if (problems.length === 0) console.log("  every manifest entry exists, parses and matches its digest");
  console.log(`\n  ${failures.length} failure(s), ${problems.length - failures.length} warning(s)`);
  console.log(`\nRESULT: ${failures.length === 0 ? "PASS" : "FAIL"}\n`);
  if (failures.length > 0) process.exitCode = 1;
}

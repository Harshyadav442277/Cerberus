import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

/**
 * CERBERUS SECURITY RED-TEAM GATE
 *
 * Run: npm run redteam
 *
 * The adversarial suite (`npm run adversarial`) proves the twelve original attack
 * classes still fail. This gate proves the remediation round: each entry names an
 * attack, points at the assertions that actually execute it, and requires every one
 * of them to appear in the TAP output and pass.
 *
 * This is deliberately not a summary of what the code intends. If an assertion is
 * renamed or deleted, its evidence line stops appearing and the class fails, so the
 * gate cannot silently degrade into a list of claims nobody checks.
 */

interface AttackClass {
  id: string;
  label: string;
  remediation: string;
  files: string[];
  evidence: string[];
}

interface AttackResult {
  id: string;
  label: string;
  tests: number;
  passed: number;
  failed: number;
  ok: boolean;
  diagnostic: string | null;
}

const ROOT = resolve(import.meta.dirname, "..");

const attacks: AttackClass[] = [
  {
    id: "A",
    label: "Suspended agent reaches the payment key",
    remediation: "R1 — suspension is a kill switch",
    files: [
      "apps/api/src/__tests__/execution-authorizer.test.ts",
      "apps/executor/src/__tests__/executor.test.ts",
      "packages/db/src/__tests__/reservations.test.ts",
    ],
    evidence: [
      // Issuance refuses, and commits no capacity.
      "refuses to issue a capability to a suspended agent",
      "refuses an agent with no identity row rather than assuming authority",
      "refuses when suspension lands between the identity read and the reservation",
      // The executor refuses independently, holding the key.
      "refuses a suspended agent holding a valid authorization before the payment key exists",
      "refuses an agent whose identity row is absent rather than assuming authority",
      "refuses an approved escalation once the agent is suspended",
      // The race: suspended while the merchant was answering.
      "refuses when the agent is suspended during the unsigned challenge fetch",
      // The database refuses too.
      "commits no reservation for a suspended agent",
      "commits no reservation for an agent with no identity row",
      "still reserves normally for an active agent",
    ],
  },
  {
    id: "B",
    label: "Hostile agent falsifies audit truth",
    remediation: "R3 — the agent does not own final audit state",
    files: ["packages/db/src/__tests__/privileges.test.ts"],
    evidence: [
      "cannot claim its own payment settled",
      "cannot insert an audit anchor",
      "cannot mark an anchor as anchored on chain",
      "cannot mark its own finalization request complete",
      "leaves audit settlement and anchor state untouched after the attacks",
    ],
  },
  {
    id: "C",
    label: "Fake on-chain anchor passes verification",
    remediation: "R2 — verification independently reads Base Sepolia",
    files: ["packages/audit-log/src/__tests__/verify-chain.test.ts"],
    evidence: [
      "verifies a record whose digest is genuinely on chain",
      "detects a tampered audit record",
      "detects a deleted audit record",
      "detects a database record_hash changed to match a tampered record",
      "detects an anchor_tx_hash swapped for an unrelated successful transaction",
      "detects a transaction sent to the wrong contract",
      "ignores a look-alike Anchored event emitted by another address",
      "detects a failed transaction",
      "detects a nonexistent transaction",
      "detects verification pointed at the wrong chain",
      "reports RPC failure as UNVERIFIED rather than verified",
      "reports a record that was never anchored as UNVERIFIED, not verified",
    ],
  },
  {
    id: "D",
    label: "Direct settlement crash splits financial and audit truth",
    remediation: "R4A — one transaction commits both, plus the anchor request",
    files: ["packages/db/src/__tests__/finalization.test.ts"],
    evidence: [
      "commits reservation, audit and anchor request in one transaction",
      "leaves consistent state when the process dies immediately after committing",
      "never rewrites an audit settlement that is already terminal",
    ],
  },
  {
    id: "E",
    label: "Anchor worker crash loses the finalization",
    remediation: "R4C — durable, leased, idempotent outbox",
    files: [
      "packages/db/src/__tests__/finalization.test.ts",
      "packages/audit-log/src/__tests__/finalizer.test.ts",
    ],
    evidence: [
      "lets only one of many concurrent workers claim a job",
      "reclaims a crashed worker's job once its lease expires",
      "returns a deferred job to the queue and completes it on retry",
      "does not re-claim a completed job",
      "recomputes the digest from the stored record rather than trusting the request",
      "recovers and anchors a job left behind by a crashed worker",
      "does not mark a job done when the chain write failed",
    ],
  },
  {
    id: "F",
    label: "Executor and reconciler both write terminal truth",
    remediation: "R4D — every terminal update checks it won its CAS",
    files: [
      "packages/db/src/__tests__/finalization.test.ts",
      "apps/executor/src/__tests__/executor.test.ts",
    ],
    evidence: [
      "produces one terminal truth when executor and reconciler race",
      "refuses a terminal transition from the wrong state and reports the loss",
      "fences a reconciliation worker that no longer holds the lease",
      "reports the committed settlement when it loses the terminal transition",
      "never reports success when the terminal transition is lost to a non-settlement",
    ],
  },
  {
    id: "G",
    label: "Reservation context mismatch authorizes a different payment",
    remediation: "R5 — reuse verifies every field it inherits",
    files: [
      "packages/db/src/__tests__/reservations.test.ts",
      "apps/api/src/__tests__/execution-authorizer.test.ts",
    ],
    evidence: [
      "cannot reuse a smaller reservation for a larger payment",
      "refuses reuse when the token, chain, currency, agent or mandate version differs",
      "still reuses a reservation whose context matches exactly",
      "treats equal amounts written differently as a match, not a mismatch",
      "refuses to reuse a reservation that describes a different payment",
    ],
  },
  {
    id: "H",
    label: "Unauthenticated network client reaches trusted authority",
    remediation: "R6 — loopback scoping and reviewer-authenticated escalations",
    files: [
      "apps/api/src/__tests__/reviewer-auth-postgres.test.ts",
      "packages/core/src/__tests__/bind-host.test.ts",
    ],
    evidence: [
      "refuses an unauthenticated read of pending escalations",
      "refuses a forged bearer token",
      "refuses an agent-style request with no credential at all",
      "serves the list to the authenticated reviewer control plane",
      "binds loopback when nothing is configured",
      "binds loopback for a blank or whitespace value",
      "reports binding to all interfaces as a deliberate exposure",
    ],
  },
  {
    id: "I",
    label: "Reconciler and anchor worker hold more authority than they need",
    remediation: "R7 — dedicated least-privilege database roles",
    files: ["packages/db/src/__tests__/privileges.test.ts"],
    evidence: [
      "cannot bind an authorization to a reservation",
      "cannot create human approval or mutate mandate policy",
      "cannot author an audit anchor",
      "can still claim, fence and terminalize a reconciliation",
      "cannot transition a payment reservation",
      "cannot rewrite audit settlement",
    ],
  },
];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function metric(output: string, name: string): number | null {
  const match = output.match(new RegExp(`^# ${name}\\s+(\\d+)\\s*$`, "m"));
  return match ? Number(match[1]) : null;
}

function runAttack(attack: AttackClass, index: number): AttackResult {
  process.stdout.write(
    `  [${index + 1}/${attacks.length}] ${attack.id} — ${attack.label}... `,
  );
  const pattern = attack.evidence.map(escapeRegex).join("|");
  const child = spawnSync(
    process.execPath,
    [
      "--env-file-if-exists=.env",
      "--import",
      "tsx",
      "--test",
      "--test-concurrency=1",
      "--test-timeout=60000",
      "--test-reporter=tap",
      `--test-name-pattern=${pattern}`,
      ...attack.files,
    ],
    { cwd: ROOT, encoding: "utf8", env: process.env, maxBuffer: 16 * 1024 * 1024 },
  );

  const output = `${child.stdout ?? ""}\n${child.stderr ?? ""}`;
  const tests = metric(output, "tests");
  const passed = metric(output, "pass");
  const failed = metric(output, "fail");
  const cancelled = metric(output, "cancelled");
  // Every named assertion must actually have run. A silently deleted or renamed test
  // is a regression in the proof, not an absence of evidence.
  const missing = attack.evidence.filter((title) => !output.includes(`- ${title}`));
  const parsed = [tests, passed, failed, cancelled].every((value) => value !== null);
  const ok =
    child.status === 0 &&
    parsed &&
    tests! > 0 &&
    passed === tests &&
    failed === 0 &&
    cancelled === 0 &&
    missing.length === 0;

  process.stdout.write(ok ? `PASS (${passed} assertions)\n` : "FAIL\n");

  const reasons = [
    child.status === 0 ? null : `test process exited ${child.status ?? child.signal ?? "unknown"}`,
    parsed ? null : "TAP totals were not parseable",
    missing.length === 0 ? null : `missing evidence: ${missing.join("; ")}`,
  ].filter((reason): reason is string => reason !== null);

  return {
    id: attack.id,
    label: attack.label,
    tests: tests ?? 0,
    passed: passed ?? 0,
    failed: failed ?? 0,
    ok,
    diagnostic: ok ? null : `${reasons.join("\n")}\n${output.trim()}`,
  };
}

console.log("\nCERBERUS SECURITY RED-TEAM GATE\n");
console.log("Each class executes real assertions against the remediated code.");
console.log("PostgreSQL-backed classes use the configured database.\n");

const results = attacks.map(runAttack);
const classesPassed = results.filter((result) => result.ok).length;
const assertionsPassed = results.reduce((sum, result) => sum + result.passed, 0);
const assertionsFailed = results.reduce((sum, result) => sum + result.failed, 0);
const allPassed = classesPassed === attacks.length;

console.log("\nSUMMARY\n");
for (const [index, result] of results.entries()) {
  const remediation = attacks[index]!.remediation;
  console.log(
    `${result.id}  ${result.label.padEnd(56)} ${result.ok ? "PASS" : "FAIL"} (${result.passed}/${result.tests})`,
  );
  console.log(`   ${remediation}`);
}
console.log("");
console.log(`Attack classes passed:  ${classesPassed}/${attacks.length}`);
console.log(`Assertions passed:      ${assertionsPassed}`);
console.log(`Assertions failed:      ${assertionsFailed}`);
console.log(`\nRESULT: ${allPassed ? "PASS" : "FAIL"}`);

for (const result of results) {
  if (result.diagnostic) {
    console.error(`\n--- ${result.id} ${result.label} diagnostic ---\n${result.diagnostic}`);
  }
}

if (!allPassed) process.exitCode = 1;

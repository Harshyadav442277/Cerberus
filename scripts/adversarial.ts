import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

interface AttackClass {
  label: string;
  files: string[];
  evidence: string[];
}

interface AttackResult {
  label: string;
  tests: number;
  passed: number;
  failed: number;
  skipped: number;
  cancelled: number;
  ok: boolean;
  diagnostic: string | null;
}

const ROOT = resolve(import.meta.dirname, "..");

const attacks: AttackClass[] = [
  {
    label: "Hostile-agent authority attacks",
    files: ["apps/agent/src/__tests__/interception.test.ts"],
    evidence: [
      "scrubs accidentally inherited payment and authorization keys from the agent process",
      "loads only the agent-specific environment file",
      "the agent has no reviewer credential, decision client, or trusted config path",
      "the agent has no control-plane, executor, or schema-owner database config path",
      "only the isolated executor and x402 diagnostics import @safr/x402-client",
      "the entire agent application contains no x402 or payment-key reference",
      "no non-executor application references the payment-key variable",
    ],
  },
  {
    label: "Reviewer impersonation",
    files: ["apps/api/src/__tests__/reviewer-auth-postgres.test.ts"],
    evidence: [
      "rejects agent-style and forged reviewer requests without creating authority",
      "accepts the trusted credential and uses server-controlled reviewer identity",
    ],
  },
  {
    label: "Database privilege attacks",
    files: ["packages/db/src/__tests__/privileges.test.ts"],
    evidence: [
      "cannot create human approval or execution authority",
      "cannot modify mandate policy",
      "cannot forge the control plane's transaction-time velocity verdict",
      "cannot bind or transition a payment reservation",
      "cannot consume an execution authorization",
      "leaves all trusted authority state unchanged after the attacks",
    ],
  },
  {
    label: "Forged authority",
    files: [
      "packages/execution-authorization/src/__tests__/authorization.test.ts",
      "apps/executor/src/__tests__/executor.test.ts",
    ],
    evidence: [
      "rejects a signature from an untrusted authorizer",
      "rejects at the exact expiry boundary",
      "rejects a mutated proposal",
      "rejects a different mandate version",
      "rejects a different reservation",
      "rejects a forged authorization before the payer exists",
      "rejects a proposal mutated after authorization without touching the key",
    ],
  },
  {
    label: "Replay / duplicate execution",
    files: [
      "packages/db/src/__tests__/authorizations.test.ts",
      "packages/db/src/__tests__/reservations.test.ts",
      "apps/executor/src/__tests__/executor.test.ts",
    ],
    evidence: [
      "consumes once and refuses every later attempt",
      "refuses a replay after the executor process that consumed it is gone",
      "lets only one of many concurrent consumers win",
      "creates one financial effect when an identical proposal is submitted concurrently",
      "gives one audit exactly one executable authorization, however many are requested",
      "rejects replay before a second signing attempt",
      "refuses a replay from a SECOND executor process with its own clean memory",
    ],
  },
  {
    label: "Concurrent budget attacks",
    files: ["packages/db/src/__tests__/reservations.test.ts"],
    evidence: [
      "lets only one of two concurrent 80s reserve against a budget of 100",
      "holds the invariant across 20 concurrent requests of 6 against a budget of 100",
      "holds one shared budget when two different agents race the same mandate",
    ],
  },
  {
    label: "Velocity concurrency",
    files: [
      "packages/db/src/__tests__/reservations.test.ts",
      "apps/api/src/__tests__/authorizer-postgres.test.ts",
    ],
    evidence: [
      "allows at most one of two concurrent actions below a limit of one",
      "holds the configured transaction count across a concurrent burst",
      "serializes one agent's velocity across distinct mandate budget locks",
      "atomically escalates one of two concurrent actions at a velocity limit of one",
    ],
  },
  {
    label: "Stale authority",
    files: [
      "packages/db/src/__tests__/authorizations.test.ts",
      "apps/api/src/__tests__/authorizer-postgres.test.ts",
      "apps/api/src/__tests__/execution-authorizer.test.ts",
      "apps/executor/src/__tests__/executor.test.ts",
    ],
    evidence: [
      "rejects an in-place v17 policy mutation after authorization before key use",
      "refuses when the mandate has been superseded since the decision",
      "refuses an approval that has aged out",
      "refuses an approval given under a superseded mandate version",
      "refuses an approval whose proposal was edited afterwards",
      "refuses an approval that expired after signing before the payment key exists",
      "refuses when human approval expires during the unsigned challenge fetch",
      "refuses to spend under a mandate that has been superseded",
    ],
  },
  {
    label: "x402 merchant mutation",
    files: ["apps/executor/src/__tests__/executor.test.ts"],
    evidence: [
      "rejects amount 5 USDC → 50 USDC before the payment key exists",
      "rejects payee Alice → attacker before the payment key exists",
      "rejects wrong token before the payment key exists",
      "rejects wrong chain before the payment key exists",
      "rejects wrong scheme before the payment key exists",
      "rejects wrong EIP-712 token domain before the payment key exists",
      "rejects transfer-method switch before the payment key exists",
      "rejects wrong x402 protocol version before the payment key exists",
      "rejects a wrong resource before the payment key exists",
    ],
  },
  {
    label: "Merchant false failure",
    files: [
      "packages/x402-client/src/__tests__/challenge.test.ts",
      "apps/executor/src/__tests__/executor.test.ts",
    ],
    evidence: [
      "exposes a valid merchant-reported settlement failure only after transmission",
      "treats HTTP 500 as a post-signature non-settled result",
      "throws on malformed JSON only after the signed request was transmitted",
      "keeps a hostile merchant-reported failure OUTCOME_UNKNOWN after transmission",
      "keeps malformed post-signature responses OUTCOME_UNKNOWN",
      "keeps HTTP 500 after signature transmission OUTCOME_UNKNOWN",
      "keeps a post-signature timeout OUTCOME_UNKNOWN without retrying",
      "holds capacity as OUTCOME_UNKNOWN when settlement throws",
    ],
  },
  {
    label: "Merchant fake success",
    files: [
      "packages/x402-client/src/__tests__/reconcile.test.ts",
      "apps/executor/src/__tests__/executor.test.ts",
    ],
    evidence: [
      "proves settlement only from a used nonce and the exact successful transfer",
      "does not confuse nonce cancellation or mismatched transfer evidence with payment",
      "settles only with the chain-proven transaction, not the merchant-provided hash",
      "keeps a fake merchant success and fake transaction OUTCOME_UNKNOWN",
      "keeps merchant success with the wrong chain recipient OUTCOME_UNKNOWN",
      "keeps merchant success with the wrong chain amount OUTCOME_UNKNOWN",
      "keeps merchant success OUTCOME_UNKNOWN while chain RPC is unavailable",
    ],
  },
  {
    label: "Crash / reconciliation",
    files: [
      "packages/db/src/__tests__/reservations.test.ts",
      "apps/executor/src/__tests__/reconciliation.test.ts",
    ],
    evidence: [
      "persists chain correlation and never frees UNKNOWN by reservation TTL",
      "lets only one of many reconciliation workers claim an ambiguous payment",
      "reclaims a crashed worker lease and fences the stale worker",
      "recovers a correlated SUBMITTING row after a post-broadcast process crash",
      "keeps inconclusive evidence UNKNOWN, then safely releases proven non-payment",
      "finds later settlement after a merchant-reported failure without a second payment",
      "releases a merchant-reported failure only after expiry proves the nonce unused",
      "keeps an unexpired authorization capacity-holding and schedules another read",
      "defers on RPC failure instead of guessing non-payment",
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
  process.stdout.write(`  [${index + 1}/${attacks.length}] ${attack.label}... `);
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
    {
      cwd: ROOT,
      encoding: "utf8",
      env: process.env,
      maxBuffer: 16 * 1024 * 1024,
    },
  );

  const output = `${child.stdout ?? ""}\n${child.stderr ?? ""}`;
  const tests = metric(output, "tests");
  const passed = metric(output, "pass");
  const failed = metric(output, "fail");
  const skipped = metric(output, "skipped");
  const cancelled = metric(output, "cancelled");
  const missing = attack.evidence.filter((title) => !output.includes(`- ${title}`));
  const parsed = [tests, passed, failed, skipped, cancelled].every((value) => value !== null);
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
    label: attack.label,
    tests: tests ?? 0,
    passed: passed ?? 0,
    failed: failed ?? 0,
    skipped: skipped ?? 0,
    cancelled: cancelled ?? 0,
    ok,
    diagnostic: ok ? null : `${reasons.join("\n")}\n${output.trim()}`,
  };
}

console.log("\nCERBERUS ADVERSARIAL VERIFICATION\n");
console.log("Executing real assertions; PostgreSQL-backed classes use the configured database.\n");

const results = attacks.map(runAttack);
const classesPassed = results.filter((result) => result.ok).length;
const assertionsPassed = results.reduce((sum, result) => sum + result.passed, 0);
const assertionsFailed = results.reduce((sum, result) => sum + result.failed, 0);
const assertionsSkipped = results.reduce((sum, result) => sum + result.skipped, 0);
const assertionsCancelled = results.reduce((sum, result) => sum + result.cancelled, 0);
const allPassed = classesPassed === attacks.length;

console.log("\nSUMMARY\n");
for (const result of results) {
  console.log(
    `${result.label.padEnd(38)} ${result.ok ? "PASS" : "FAIL"} (${result.passed}/${result.tests})`,
  );
}
console.log("");
console.log(`Attack classes passed:  ${classesPassed}/${attacks.length}`);
console.log(`Assertions passed:      ${assertionsPassed}`);
console.log(`Assertions failed:      ${assertionsFailed}`);
console.log(`Assertions skipped:     ${assertionsSkipped}`);
console.log(`Assertions cancelled:   ${assertionsCancelled}`);
console.log(`\nRESULT: ${allPassed ? "PASS" : "FAIL"}`);

for (const result of results) {
  if (result.diagnostic) {
    console.error(`\n--- ${result.label} diagnostic ---\n${result.diagnostic}`);
  }
}

if (!allPassed) process.exitCode = 1;

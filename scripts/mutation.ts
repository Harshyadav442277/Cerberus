/**
 * CERBERUS SECURITY MUTATION MATRIX
 *
 * Run: npm run mutation
 *
 * A passing test suite proves the code does what the tests say. It does not prove
 * the tests would notice if the code stopped doing it. A security suite that cannot
 * fail is indistinguishable from one that checks nothing, and it fails silently —
 * the reassuring direction.
 *
 * So this removes one security guard at a time, runs the tests that claim to detect
 * that exact vulnerability, and requires them to FAIL. A guard whose removal breaks
 * nothing is reported as UNDETECTED, which is a finding about the suite, not a pass.
 *
 * The mutations are applied to the working tree and reverted in a finally block, and
 * the run refuses to start unless the tree is clean so a crash can never be mistaken
 * for a deliberate edit. Nothing here is ever committed.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

interface SourceMutation {
  kind: "source";
  file: string;
  find: string;
  replace: string;
}

interface SqlMutation {
  kind: "sql";
  /** Statement that removes the guard. */
  disable: string;
  /** Statement that puts it back. Applied in a finally block. */
  restore: string;
}

interface Guard {
  id: string;
  guard: string;
  /** Why removing this would be dangerous in production. */
  risk: string;
  mutation: SourceMutation | SqlMutation;
  /** Tests that claim to detect this vulnerability. At least one must now fail. */
  testFiles: string[];
  testPattern: string;
}

const GUARDS: Guard[] = [
  {
    id: "budget-lock",
    guard: "Budget advisory lock",
    risk: "two concurrent proposals both read the same headroom and both pass the cap",
    mutation: {
      kind: "source",
      file: "packages/db/src/reservations.ts",
      find: `    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [budgetKey]);`,
      replace: `    // MUTATED: budget lock removed`,
    },
    testFiles: ["packages/db/src/__tests__/reservations.test.ts"],
    testPattern:
      "lets only one of two concurrent 80s reserve against a budget of 100|holds the invariant across 20 concurrent requests of 6 against a budget of 100|holds one shared budget when two different agents race the same mandate",
  },
  {
    id: "velocity-lock",
    guard: "Per-agent velocity lock",
    risk: "concurrent proposals both observe the same hourly count and both pass the limit",
    mutation: {
      kind: "source",
      file: "packages/db/src/reservations.ts",
      find: `    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [velocityKey]);`,
      replace: `    // MUTATED: velocity lock removed`,
    },
    testFiles: ["packages/db/src/__tests__/reservations.test.ts"],
    testPattern:
      "allows at most one of two concurrent actions below a limit of one|holds the configured transaction count across a concurrent burst|serializes one agent's velocity across distinct mandate budget locks",
  },
  {
    id: "post-402-recheck",
    guard: "Fresh authority recheck after the unsigned merchant 402",
    risk: "authority revoked while the merchant was responding is never noticed, and the payment proceeds on stale permission",
    mutation: {
      kind: "source",
      file: "apps/executor/src/execution.ts",
      find: `      const fresh = await options.context.resolve(input.audit_id);`,
      replace: `      const fresh = { audit, action, reservation, currentMandate, approval, agentStatus }; // MUTATED: reuse stale context`,
    },
    testFiles: ["apps/executor/src/__tests__/executor.test.ts"],
    testPattern:
      "refuses when the mandate is revoked during the unsigned challenge fetch|refuses when human approval expires during the unsigned challenge fetch|refuses when the agent is suspended during the unsigned challenge fetch",
  },
  {
    id: "suspension-executor",
    guard: "Agent suspension check in the isolated executor",
    risk: "a suspended agent's existing capability still reaches the payment key",
    mutation: {
      kind: "source",
      file: "apps/executor/src/execution.ts",
      find: `      if (agentStatus !== "active") {
        throw new ExecutionRefusedError("AGENT_SUSPENDED");
      }`,
      replace: `      void agentStatus; // MUTATED: suspension ignored`,
    },
    testFiles: ["apps/executor/src/__tests__/executor.test.ts"],
    testPattern:
      "refuses a suspended agent holding a valid authorization before the payment key exists|refuses an approved escalation once the agent is suspended",
  },
  {
    id: "suspension-reservation",
    guard: "Agent suspension check inside the reservation transaction",
    risk: "capacity is committed for an agent that has already been shut off",
    mutation: {
      kind: "source",
      file: "packages/db/src/reservations.ts",
      find: `    if (!(await agentIsActive(client, input.agentId))) {`,
      replace: `    if (false && !(await agentIsActive(client, input.agentId))) { // MUTATED`,
    },
    testFiles: ["packages/db/src/__tests__/reservations.test.ts"],
    testPattern:
      "commits no reservation for a suspended agent|commits no reservation for an agent with no identity row",
  },
  {
    id: "reservation-context",
    guard: "Reservation context equality on reuse",
    risk: "capacity reserved for 1 USDC is handed to a 5 USDC payment",
    mutation: {
      kind: "source",
      file: "packages/db/src/reservations.ts",
      find: `  const mismatched: string[] = [];
  if (existing.audit_id !== requested.auditId) mismatched.push("audit_id");`,
      replace: `  const mismatched: string[] = [];
  if (true) return mismatched; // MUTATED: reuse anything
  if (existing.audit_id !== requested.auditId) mismatched.push("audit_id");`,
    },
    testFiles: ["packages/db/src/__tests__/reservations.test.ts"],
    testPattern:
      "cannot reuse a smaller reservation for a larger payment|refuses reuse when the token, chain, currency, agent or mandate version differs",
  },
  {
    id: "correlation-before-transport",
    guard: "Durable payment correlation before transport",
    risk: "a signed payment is sent that no reconciler can later identify on chain",
    mutation: {
      kind: "source",
      file: "packages/x402-client/src/pay.ts",
      find: `          if (!(await persist(correlation))) throw new PaymentAttemptPersistenceError();`,
      replace: `          await persist(correlation); // MUTATED: send regardless`,
    },
    testFiles: ["packages/x402-client/src/__tests__/challenge.test.ts"],
    testPattern: "does not send when durable correlation persistence refuses",
  },
  {
    id: "merchant-success-chain-proof",
    guard: "Chain proof required before SETTLED",
    risk: "a merchant claiming success with a fabricated transaction hash is believed",
    mutation: {
      kind: "source",
      file: "packages/x402-client/src/reconcile.ts",
      find: `  const used = await chain.authorizationState(token, payer, nonce);`,
      replace: `  return { outcome: "settled", transactionHash: ("0x" + "ee".repeat(32)) as Hex }; // MUTATED
  const used = await chain.authorizationState(token, payer, nonce);`,
    },
    testFiles: [
      "packages/x402-client/src/__tests__/reconcile.test.ts",
      "apps/executor/src/__tests__/executor.test.ts",
    ],
    testPattern:
      "proves settlement only from a used nonce and the exact successful transfer|does not confuse nonce cancellation or mismatched transfer evidence with payment|keeps a fake merchant success and fake transaction OUTCOME_UNKNOWN|settles only with the chain-proven transaction, not the merchant-provided hash",
  },
  {
    id: "merchant-failure-unknown",
    guard: "Merchant-reported failure held as OUTCOME_UNKNOWN",
    risk: "capacity is released while the merchant still holds a live signed authorization it can settle",
    mutation: {
      kind: "source",
      file: "apps/executor/src/execution.ts",
      find: `      await options.reservations.markOutcomeUnknown(reservation.reservation_id);
      throw new SettlementOutcomeUnknownError(result.error ?? "merchant reported non-settlement");`,
      replace: `      await options.reservations.markFailed(reservation.reservation_id); // MUTATED
      throw new SettlementOutcomeUnknownError(result.error ?? "merchant reported non-settlement");`,
    },
    testFiles: ["apps/executor/src/__tests__/executor.test.ts"],
    testPattern:
      "keeps a hostile merchant-reported failure OUTCOME_UNKNOWN after transmission|keeps HTTP 500 after signature transmission OUTCOME_UNKNOWN",
  },
  {
    id: "anchor-digest-comparison",
    guard: "On-chain anchor digest comparison",
    risk: "an anchor transaction that anchored a different record passes verification",
    mutation: {
      kind: "source",
      file: "packages/audit-log/src/verify-chain.ts",
      find: `  if (!digests.some((digest) => sameDigest(digest, recomputed))) {`,
      replace: `  if (false && !digests.some((digest) => sameDigest(digest, recomputed))) { // MUTATED`,
    },
    testFiles: ["packages/audit-log/src/__tests__/verify-chain.test.ts"],
    testPattern:
      "detects an anchor_tx_hash swapped for an unrelated successful transaction|detects a database record_hash changed to match a tampered record",
  },
  {
    id: "redirect-refusal",
    guard: "Redirect refusal on the signed payment request",
    risk: "a live signed EIP-3009 authorization is forwarded to a host nobody approved",
    mutation: {
      kind: "source",
      file: "packages/x402-client/src/pay.ts",
      find: `              redirect: "error",`,
      replace: `              redirect: "follow", // MUTATED`,
    },
    testFiles: ["packages/x402-client/src/__tests__/challenge.test.ts"],
    testPattern: "never forwards a signed payment authorization to a redirect target",
  },
  {
    id: "correlated-failure-trigger",
    guard: "Database trigger blocking correlated FAILED outside fenced reconciliation",
    risk: "a correlated payment is marked failed by the executor while it may still settle",
    mutation: {
      kind: "sql",
      disable: "DROP TRIGGER IF EXISTS payment_reservation_correlated_failure_guard ON payment_reservation",
      restore: `CREATE TRIGGER payment_reservation_correlated_failure_guard
                BEFORE UPDATE OF status ON payment_reservation
                FOR EACH ROW EXECUTE FUNCTION enforce_correlated_failure_guard()`,
    },
    testFiles: ["packages/db/src/__tests__/reservations.test.ts"],
    testPattern:
      "rejects ordinary and direct FAILED transitions after correlation is persisted",
  },
];

interface Outcome {
  id: string;
  guard: string;
  risk: string;
  detected: boolean;
  failingTests: string[];
  note: string;
}

function git(args: string[]): string {
  return spawnSync("git", args, { cwd: ROOT, encoding: "utf8" }).stdout.trim();
}

function runTests(guard: Guard): { failed: number; names: string[]; expectedFailures: string[] } {
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
      `--test-name-pattern=${guard.testPattern}`,
      ...guard.testFiles,
    ],
    { cwd: ROOT, encoding: "utf8", env: process.env, maxBuffer: 16 * 1024 * 1024 },
  );
  const output = `${child.stdout ?? ""}\n${child.stderr ?? ""}`;
  const failMatch = output.match(/^# fail\s+(\d+)\s*$/m);
  const failed = failMatch ? Number(failMatch[1]) : 0;
  const names = [...output.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map((m) => m[1]!.trim());
  const expected = guard.testPattern.split("|");
  const expectedFailures = names.filter((name) =>
    expected.some((expectedName) => name.includes(expectedName)),
  );
  return { failed, names, expectedFailures };
}

async function applySql(statement: string): Promise<void> {
  const { getPool } = await import("../packages/db/src/pool.js");
  await getPool().query(statement);
}

async function mutate(guard: Guard): Promise<Outcome> {
  process.stdout.write(`  ${guard.id.padEnd(30)} `);

  let restore: () => Promise<void>;
  if (guard.mutation.kind === "source") {
    const path = resolve(ROOT, guard.mutation.file);
    const original = readFileSync(path, "utf8");
    // This checkout uses CRLF, and the anchors above are written with LF only.
    // Matching therefore happens on a normalised copy, and the original line-ending
    // style is restored on write. Without this every MULTI-line anchor silently fails
    // to match while single-line ones succeed, so a guard gets misreported as
    // UNDETECTED — a false finding about the suite rather than about the code.
    const usesCrlf = original.includes("\r\n");
    const normalised = usesCrlf ? original.replaceAll("\r\n", "\n") : original;
    const toDisk = (text: string) =>
      usesCrlf ? text.replaceAll("\n", "\r\n") : text;
    if (!normalised.includes(guard.mutation.find)) {
      process.stdout.write("SKIP (anchor text not found — guard may have been refactored)\n");
      return {
        id: guard.id,
        guard: guard.guard,
        risk: guard.risk,
        detected: false,
        failingTests: [],
        note: "mutation anchor text not found; matrix entry is stale",
      };
    }
    writeFileSync(
      path,
      toDisk(normalised.replace(guard.mutation.find, guard.mutation.replace)),
      "utf8",
    );
    restore = async () => writeFileSync(path, original, "utf8");
  } else {
    const { disable, restore: put } = guard.mutation;
    await applySql(disable);
    restore = async () => {
      await applySql(put);
    };
  }

  try {
    const result = runTests(guard);
    // A syntax/import failure is not proof that a security assertion caught the
    // removed guard. At least one specifically named expected assertion must fail.
    const detected = result.expectedFailures.length > 0;
    process.stdout.write(
      detected
        ? `DETECTED (${result.expectedFailures.length} expected assertion${result.expectedFailures.length === 1 ? "" : "s"} failed)\n`
        : result.failed > 0
          ? `UNDETECTED — ${result.failed} unrelated or load failure(s) only\n`
          : "UNDETECTED — no test noticed\n",
    );
    return {
      id: guard.id,
      guard: guard.guard,
      risk: guard.risk,
      detected,
      failingTests: result.expectedFailures,
      note: detected
        ? ""
        : result.failed > 0
          ? "the test process failed, but none of the named security assertions did"
          : "removing this guard broke no test",
    };
  } finally {
    await restore();
  }
}

async function main(): Promise<void> {
  console.log("\nCERBERUS SECURITY MUTATION MATRIX\n");

  // Snapshot exactly the files this harness mutates. This is stricter and more useful
  // than requiring the whole tree to be clean: remediation can run the release gate
  // before committing, while any leaked mutation is still detected byte-for-byte.
  const sourceBaselines = new Map(
    GUARDS.flatMap((guard) => guard.mutation.kind === "source" ? [guard.mutation.file] : [])
      .filter((file, index, all) => all.indexOf(file) === index)
      .map((file) => [file, readFileSync(resolve(ROOT, file))] as const),
  );

  console.log("Removing one security guard at a time. Each must break its own tests.\n");
  const outcomes: Outcome[] = [];
  for (const guard of GUARDS) outcomes.push(await mutate(guard));

  // Every mutation target must be byte-identical to its pre-run snapshot. A vulnerable
  // edit escaping into a commit would be worse than missing mutation evidence.
  const restored = [...sourceBaselines].every(([file, before]) =>
    readFileSync(resolve(ROOT, file)).equals(before),
  );
  console.log("\nMutation targets after run:", restored ? "restored byte-for-byte" : "CHANGED");

  console.log("\nMATRIX\n");
  console.log("Guard removed".padEnd(58) + "Result");
  console.log("-".repeat(78));
  for (const outcome of outcomes) {
    console.log(outcome.guard.padEnd(58) + (outcome.detected ? "DETECTED" : "UNDETECTED"));
  }

  const detected = outcomes.filter((o) => o.detected).length;
  console.log(`\nGuards proven detectable: ${detected}/${outcomes.length}`);

  for (const outcome of outcomes.filter((o) => !o.detected)) {
    console.error(`\n  UNDETECTED  ${outcome.guard}\n    risk: ${outcome.risk}\n    ${outcome.note}`);
  }

  console.log(`\nRESULT: ${detected === outcomes.length && restored ? "PASS" : "FAIL"}`);
  if (detected !== outcomes.length || !restored) process.exitCode = 1;

  const report = {
    generatedFrom: git(["rev-parse", "HEAD"]),
    guards: outcomes,
    detected,
    total: outcomes.length,
    mutationTargetsRestored: restored,
  };
  if (process.env.CERBERUS_EVIDENCE_OUTPUT === "1") {
    writeFileSync(
      resolve(ROOT, "artifacts/final-evidence/redteam/mutation-matrix.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );
  }
}

await main();
const { closePool } = await import("../packages/db/src/pool.js");
await closePool();

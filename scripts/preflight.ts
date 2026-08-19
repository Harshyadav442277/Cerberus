/**
 * E0 — live preflight.
 *
 * Answers one question before any funded run is attempted: is every precondition for
 * a real Base Sepolia payment actually in place?
 *
 *   npm run preflight
 *
 * Prints public information only — addresses, balances, contract, chain id, service
 * URLs. It never prints a private key, a token, or a database password, and it reads
 * the executor's signer only to derive its public address.
 *
 * Exits non-zero if anything required for a live run is missing, so it can gate the
 * evidence capture rather than being advisory.
 */
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { createPublicClient, formatEther, formatUnits, getAddress, http, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const ROOT = resolve(import.meta.dirname, "..");

function parse(file: string): Record<string, string> {
  const values: Record<string, string> = {};
  loadDotenv({ path: resolve(ROOT, file), quiet: true, processEnv: values });
  return values;
}

const root = parse(".env");
const executor = parse(".env.executor");
const authorizer = parse(".env.authorizer");
const anchor = parse(".env.anchor");
const agent = parse(".env.agent");

function value(name: string, ...sources: Array<Record<string, string>>): string {
  for (const source of [process.env as Record<string, string>, ...sources]) {
    const found = source[name]?.trim();
    if (found) return found;
  }
  return "";
}

const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const USDC_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** Enough for a handful of demo payments plus the anchor transactions. */
const MIN_ETH_WEI = 2_000_000_000_000_000n; // 0.002 ETH
const MIN_USDC_ATOMIC = 1_000_000n; // 1.00 USDC

interface Check {
  label: string;
  ok: boolean;
  detail: string;
  required: boolean;
}

/**
 * Readable text for a thrown value.
 *
 * `String(error)` on an AggregateError — which is what a failed Postgres connection
 * produces when every candidate address is refused — yields "AggregateError" with no
 * detail at all. A preflight that reports a blocker without saying what it was is
 * only marginally better than not checking.
 */
function describeError(error: unknown): string {
  if (error instanceof AggregateError) {
    const inner = error.errors.map(describeError).filter(Boolean);
    return inner.length > 0 ? inner.join("; ") : error.message || "AggregateError";
  }
  if (error instanceof Error) {
    const cause = error.cause ? ` (cause: ${describeError(error.cause)})` : "";
    return `${error.message}${cause}`;
  }
  return String(error);
}

const checks: Check[] = [];
function record(label: string, ok: boolean, detail: string, required = true): void {
  checks.push({ label, ok, detail, required });
}

/**
 * Retries a read-only chain call a few times before giving up.
 *
 * The public Base Sepolia endpoint intermittently answers "no backend is currently
 * healthy to serve traffic". This preflight GATES a funded run, so a transient
 * upstream blip reporting a blocker that does not exist is not a harmless false
 * alarm — it would stop a run that should have proceeded, or send someone hunting a
 * configuration problem they do not have. Only reads are retried; nothing here
 * writes.
 */
async function withRetry<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
  throw lastError;
}

/** Derives a public address from a signer without ever printing the key. */
function addressOf(privateKey: string): string | null {
  try {
    return privateKeyToAccount(privateKey as `0x${string}`).address;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  console.log("\nCERBERUS LIVE PREFLIGHT — Base Sepolia\n");

  const rpcUrl = value("EVM_RPC_URL", executor, root) || "https://sepolia.base.org";
  const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });

  // ── Chain reachability ────────────────────────────────────────────────────
  let chainId: number | null = null;
  let blockNumber: bigint | null = null;
  try {
    chainId = await withRetry(() => client.getChainId());
    blockNumber = await withRetry(() => client.getBlockNumber());
    record(
      "Base Sepolia RPC reachable",
      chainId === baseSepolia.id,
      `chain ${chainId}, head block ${blockNumber}, via ${rpcUrl}`,
    );
  } catch (error) {
    record("Base Sepolia RPC reachable", false, `${rpcUrl} — ${describeError(error)}`);
  }

  // ── Payer identity and balances ───────────────────────────────────────────
  const executorKey = value("EXECUTOR_EVM_PRIVATE_KEY", executor);
  const payer = executorKey ? addressOf(executorKey) : null;
  record(
    "Executor payment signer configured",
    payer !== null,
    payer ? `payer ${payer}` : "EXECUTOR_EVM_PRIVATE_KEY missing or invalid in .env.executor",
  );

  if (payer && chainId === baseSepolia.id) {
    try {
      const eth = await withRetry(() => client.getBalance({ address: getAddress(payer) }));
      record(
        "Payer ETH balance sufficient for gas",
        eth >= MIN_ETH_WEI,
        `${formatEther(eth)} ETH (need >= ${formatEther(MIN_ETH_WEI)})`,
      );
    } catch (error) {
      record("Payer ETH balance sufficient for gas", false, describeError(error));
    }

    try {
      const usdc = (await withRetry(() =>
        client.readContract({
          address: getAddress(BASE_SEPOLIA_USDC),
          abi: USDC_ABI,
          functionName: "balanceOf",
          args: [getAddress(payer)],
        }),
      )) as bigint;
      record(
        "Payer USDC balance sufficient",
        usdc >= MIN_USDC_ATOMIC,
        `${formatUnits(usdc, 6)} USDC (need >= ${formatUnits(MIN_USDC_ATOMIC, 6)})`,
      );
    } catch (error) {
      record("Payer USDC balance sufficient", false, describeError(error));
    }
  }

  // ── Payee ─────────────────────────────────────────────────────────────────
  const payTo = value("EVM_ADDRESS", executor, root);
  record(
    "Merchant payee address configured",
    isAddress(payTo),
    payTo ? `payTo ${payTo}` : "EVM_ADDRESS not set",
  );

  // ── Signer separation ─────────────────────────────────────────────────────
  const authKey = value("EXECUTION_AUTH_PRIVATE_KEY", authorizer);
  const authAddress = authKey ? addressOf(authKey) : null;
  record(
    "Execution Authorization signer configured",
    authAddress !== null,
    authAddress ? `authorizer ${authAddress}` : "EXECUTION_AUTH_PRIVATE_KEY missing in .env.authorizer",
  );
  const expectedAuthorizer = value("EXECUTION_AUTHORIZER_ADDRESS", executor, root);
  record(
    "Executor trusts the configured authorizer",
    Boolean(authAddress) &&
      isAddress(expectedAuthorizer) &&
      getAddress(expectedAuthorizer) === getAddress(authAddress!),
    authAddress && isAddress(expectedAuthorizer)
      ? `executor expects ${getAddress(expectedAuthorizer)}`
      : "EXECUTION_AUTHORIZER_ADDRESS missing or does not match the authorizer key",
  );

  const anchorKey = value("AUDIT_ANCHOR_PRIVATE_KEY", anchor, authorizer);
  const anchorAddress = anchorKey ? addressOf(anchorKey) : null;
  record(
    "Audit anchor signer configured",
    anchorAddress !== null,
    anchorAddress ? `anchor signer ${anchorAddress}` : "AUDIT_ANCHOR_PRIVATE_KEY missing in .env.anchor",
  );
  if (anchorAddress && chainId === baseSepolia.id) {
    try {
      const eth = await withRetry(() => client.getBalance({ address: getAddress(anchorAddress) }));
      record(
        "Anchor signer has gas",
        eth > 0n,
        `${formatEther(eth)} ETH — anchoring needs gas of its own`,
      );
    } catch (error) {
      record("Anchor signer has gas", false, describeError(error));
    }
  }

  // The whole point of the isolation boundary: these must be three different keys.
  // Guarded on all three being present, because "0 distinct signers are distinct" is
  // vacuously true and would report a reassuring OK for a completely unconfigured
  // machine — the exact situation this check exists to catch.
  const signers = [payer, authAddress, anchorAddress].filter(Boolean);
  const distinct = new Set(signers);
  if (signers.length < 3) {
    record(
      "Payment, authorization and anchor signers are distinct",
      false,
      `only ${signers.length}/3 signers configured — separation cannot be established`,
    );
  } else {
    record(
      "Payment, authorization and anchor signers are distinct",
      distinct.size === signers.length,
      distinct.size === signers.length
        ? "3 distinct signer addresses"
        : `only ${distinct.size} distinct address(es) across 3 roles — a key is reused`,
    );
  }

  // ── Contract ──────────────────────────────────────────────────────────────
  const anchorContract = value("AUDIT_ANCHOR_ADDRESS", anchor, root, agent);
  if (isAddress(anchorContract) && chainId === baseSepolia.id) {
    try {
      const code = await withRetry(() => client.getCode({ address: getAddress(anchorContract) }));
      record(
        "AuditAnchor contract deployed",
        Boolean(code && code !== "0x"),
        `${getAddress(anchorContract)} — ${code && code !== "0x" ? `${(code.length - 2) / 2} bytes of code` : "no code at address"}`,
      );
    } catch (error) {
      record("AuditAnchor contract deployed", false, describeError(error));
    }
  } else {
    record("AuditAnchor contract deployed", false, "AUDIT_ANCHOR_ADDRESS not set or invalid");
  }

  // ── Services and database ─────────────────────────────────────────────────
  const merchantBaseUrl = value("MERCHANT_BASE_URL", executor, root) || "http://localhost:4021";
  try {
    const response = await fetch(`${merchantBaseUrl}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    record("Merchant reachable", response.ok, `${merchantBaseUrl} — HTTP ${response.status}`);
  } catch {
    record("Merchant reachable", false, `${merchantBaseUrl} — not responding (start: npm run merchant)`);
  }

  const apiBaseUrl = value("NEXT_PUBLIC_API_URL", agent, root) || "http://localhost:4050";
  try {
    const response = await fetch(`${apiBaseUrl}/health`, { signal: AbortSignal.timeout(3000) });
    record("Control plane reachable", response.ok, `${apiBaseUrl} — HTTP ${response.status}`);
  } catch {
    record("Control plane reachable", false, `${apiBaseUrl} — not responding (start: npm run api)`);
  }

  const executorUrl = value("EXECUTOR_URL", agent, root) || "http://localhost:4060";
  try {
    const response = await fetch(`${executorUrl}/health`, { signal: AbortSignal.timeout(3000) });
    record("Isolated executor reachable", response.ok, `${executorUrl} — HTTP ${response.status}`);
  } catch {
    record("Isolated executor reachable", false, `${executorUrl} — not responding (start: npm run executor)`);
  }

  record(
    "Reviewer credential configured",
    (value("REVIEWER_API_TOKEN", authorizer).length >= 32),
    value("REVIEWER_API_TOKEN", authorizer)
      ? "present (value not shown)"
      : "REVIEWER_API_TOKEN missing or shorter than 32 characters in .env.authorizer",
  );

  try {
    const { getPool, closePool } = await import("../packages/db/src/index.js");
    const { rows } = await getPool().query<{ n: string }>(
      "SELECT count(*)::text AS n FROM information_schema.tables WHERE table_schema = 'public'",
    );
    await closePool();
    record("Database initialised", Number(rows[0]!.n) > 0, `${rows[0]!.n} tables in public schema`);
  } catch (error) {
    record("Database initialised", false, describeError(error));
  }

  // ── Report ────────────────────────────────────────────────────────────────
  const width = Math.max(...checks.map((c) => c.label.length));
  for (const check of checks) {
    console.log(`  ${check.ok ? "OK  " : "FAIL"}  ${check.label.padEnd(width)}  ${check.detail}`);
  }

  const failed = checks.filter((c) => !c.ok && c.required);
  console.log(`\n  ${checks.length - failed.length}/${checks.length} preflight checks passed`);

  if (failed.length > 0) {
    console.log("\n  LIVE RUN BLOCKED. Unmet preconditions:\n");
    for (const check of failed) console.log(`    - ${check.label}: ${check.detail}`);
    console.log("");
    process.exitCode = 1;
  } else {
    console.log("\n  Ready for a funded live run.\n");
  }
}

await main();

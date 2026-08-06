/**
 * Phase 4 Definition of Done, part 2 — the interception constraint is STRUCTURAL.
 *
 * The orchestrator tests prove the gate behaves correctly today. These tests prove it
 * cannot quietly stop being correct: they scan the whole repository so that a future
 * proxy, a patched `fetch`, or a stray x402 import fails the suite rather than
 * silently defeating the pre-execution premise (Bible Section 6, Rules R6).
 */
import { strictEqual } from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

const SKIP_DIRS = new Set(["node_modules", ".git", ".pnpm-store", "dist", ".next", "docs"]);

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (/\.(ts|tsx|js|mjs)$/.test(entry)) found.push(full);
  }
  return found;
}

/**
 * Comments are stripped before scanning. Otherwise prose describing what the codebase
 * must NOT do reads as evidence that it does — the merchant's own "contains no
 * governance logic" note would fail the governance check.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** This scanner holds the forbidden patterns as literals, so it cannot scan itself. */
const SELF = relative(REPO_ROOT, fileURLToPath(import.meta.url));

const FILES = sourceFiles(REPO_ROOT)
  .map((path) => relative(REPO_ROOT, path))
  .filter((path) => path !== SELF)
  .map((path) => {
    const text = readFileSync(join(REPO_ROOT, path), "utf8");
    return { path, text, code: stripComments(text) };
  });

describe("repository scan preconditions", () => {
  it("finds the source tree", () => {
    strictEqual(FILES.length > 15, true, `only found ${FILES.length} source files`);
  });
});

describe("x402 is importable from exactly one place (Rules R6)", () => {
  it("only apps/agent/src/settlement imports @safr/x402-client", () => {
    // The x402 package's own source and scripts are naturally exempt.
    const allowed = [
      join("apps", "agent", "src", "settlement") + sep,
      join("packages", "x402-client") + sep,
    ];

    const importers = FILES.filter(
      (file) =>
        /from\s+["']@safr\/x402-client["']|import\(\s*["']@safr\/x402-client["']/.test(file.code) &&
        !allowed.some((prefix) => file.path.startsWith(prefix)),
    ).map((file) => file.path);

    strictEqual(
      importers.length,
      0,
      `@safr/x402-client may only be imported from apps/agent/src/settlement/. Found: ${importers.join(", ")}`,
    );
  });

  it("the orchestrator itself does not import the x402 client", () => {
    const orchestrator = FILES.find(
      (file) => file.path === join("apps", "agent", "src", "orchestrator.ts"),
    );
    strictEqual(orchestrator !== undefined, true);
    strictEqual(/@safr\/x402-client|@x402\//.test(orchestrator!.code), false);
  });

  it("no module outside packages/x402-client imports the raw @x402/* SDK", () => {
    const allowed = [
      join("packages", "x402-client") + sep,
      join("apps", "merchant") + sep, // the payee resource server, not the payer
    ];
    const importers = FILES.filter(
      (file) =>
        /from\s+["']@x402\//.test(file.code) &&
        !allowed.some((prefix) => file.path.startsWith(prefix)),
    ).map((file) => file.path);

    strictEqual(importers.length, 0, `Raw x402 SDK imported outside its module: ${importers.join(", ")}`);
  });
});

describe("no interception-after-the-fact anywhere (Architecture 2.1)", () => {
  const FORBIDDEN: Array<[string, RegExp]> = [
    ["global fetch is patched", /\b(?:globalThis|global|window)\s*\.\s*fetch\s*=/],
    ["fetch is reassigned", /^\s*fetch\s*=\s*[^=]/m],
    ["http-proxy is used", /["'](?:http-proxy|http-proxy-middleware|node-http-proxy)["']/],
    ["a proxy agent is configured", /\b(?:HttpsProxyAgent|HttpProxyAgent)\b/],
    ["undici interceptors are installed", /\bsetGlobalDispatcher\b/],
    ["XHR is patched", /XMLHttpRequest\.prototype\.\w+\s*=/],
  ];

  for (const [label, pattern] of FORBIDDEN) {
    it(`nothing indicates ${label}`, () => {
      const offenders = FILES.filter((file) => pattern.test(file.code)).map((file) => file.path);
      strictEqual(
        offenders.length,
        0,
        `${label} — forbidden by Bible Section 6 / Rules R6. Found in: ${offenders.join(", ")}`,
      );
    });
  }
});

describe("governance lives only in the engine (Rules R3)", () => {
  it("the merchant resource server contains no governance logic", () => {
    const merchant = FILES.filter((file) => file.path.startsWith(join("apps", "merchant") + sep));
    strictEqual(merchant.length > 0, true);

    const offenders = merchant
      .filter((file) => /\b(?:evaluate|mandate|allowlist|disposition|spend_caps)\b/i.test(file.code))
      .map((file) => file.path);
    strictEqual(offenders.length, 0, `Merchant must stay dumb scaffolding. Found: ${offenders.join(", ")}`);
  });

  it("the intent generator never sees a mandate", () => {
    const generator = FILES.find(
      (file) => file.path === join("apps", "agent", "src", "intent-generator.ts"),
    );
    strictEqual(generator !== undefined, true);
    strictEqual(
      /@safr\/disposition-engine|getActiveMandate|@safr\/controls-repository/.test(generator!.code),
      false,
      "The LLM must produce intents only; it must never touch mandates or the engine.",
    );
  });

  it("no LLM call exists anywhere in the decision path", () => {
    const decisionPath = FILES.filter(
      (file) =>
        file.path.startsWith(join("packages", "disposition-engine") + sep) ||
        file.path.startsWith(join("packages", "controls-repository") + sep) ||
        file.path === join("apps", "agent", "src", "orchestrator.ts"),
    );
    const offenders = decisionPath
      .filter((file) => /anthropic|openai|api\.anthropic\.com|gpt-|claude-/i.test(file.code))
      .map((file) => file.path);
    strictEqual(offenders.length, 0, `LLM referenced in the decision path: ${offenders.join(", ")}`);
  });
});

# Cerberus — final freeze

**FINALIST RELEASE STATUS: release candidate. No reproducible P0 or P1 remains in the
completed adversarial audit.**

This is the authoritative statement of what is frozen, what was measured, and what is
deliberately deferred. Where any other document disagrees about *current* status, this
file and the README's "Current finalist build" section win.

## Release identity

| | |
|---|---|
| **Start SHA** (this pass began here) | `ec52e325be385493d57b57cf99c9a9dbb34b4a3c` |
| **Tested source SHA** | `98e735ccce49b0d22124cfb4316260870317d89a` — what `repository.sha` in `artifacts/final-evidence/manifest.json` attests, with `sourceTreeClean: true` |
| **Release payload SHA** | `6d40e85bef71d2dfa51edff34a99c7a6b8eebad1` — carries the regenerated evidence; this is the commit CI ran against |
| **Attestation SHA** | the documentation-only commit immediately after, recording the CI result below |

Those last two are separate on purpose. A commit cannot truthfully contain its own SHA
or the result of a CI run that has not started yet. The manifest attests the **source**
it was generated against; the attestation commit records CI for the **payload**.

**CI: PASS on exactly the release payload.** Run
[32301340842](https://github.com/Harshyadav442277/Cerberus/actions/runs/32301340842),
head SHA `6d40e85bef71d2dfa51edff34a99c7a6b8eebad1`, all 21 steps green in 1m56s. On a
clean Linux runner with no wallet secrets it independently reproduced 384 passing tests
across 78 suites with 0 failures, 12/12 adversarial classes, 12/12 red-team classes, a
clean dependency audit, the portable evidence validation, and the assertion that no
credential file was committed. Parent-SHA CI was not accepted as a substitute.

## Gate results

Every figure below is from an actual execution during this pass, not restated from a
previous build.

| Gate | Result |
|---|---|
| `npm run typecheck` | **PASS** — clean |
| `npm test` | **PASS — 384/384 tests, 78 suites**, 0 failed, 0 skipped, 0 cancelled |
| `npm run adversarial` | **PASS — 12/12 attack classes**, 80 assertions |
| `npm run redteam` | **PASS — 12/12 attack classes**, 70 assertions |
| `npm run mutation` | **PASS — 12/12 guards proven detectable**; targets restored byte-for-byte |
| `npm run sandbox --seed 42` | **PASS** — 1,000 actions / 50 agents / concurrency 25; 0 budget, duplicate-effect or replay violations |
| `npm run sandbox --seed 1337` | **PASS** — same shape; 0 violations |
| `npm run db:seed` / `npm run db:verify` | **PASS** — all 13 checks |
| `npm run build --prefix apps/dashboard` | **PASS** — authenticated runtime route emitted |
| `npm run contracts:compile` | **PASS** — solc 0.8.36, 263-byte deployable bytecode |
| `corepack pnpm audit` | **PASS** — no known vulnerabilities |
| `npm run evidence:verify` | **PASS** — see the evidence commit |

The test count rose from 381 to 384 in this pass: three regression tests covering the
dashboard health proxy fix. No test was removed or weakened.

### Demo smoke (real least-privilege local roles)

| Path | Result |
|---|---|
| **ALLOW** | Governance reaches the authorized payment path. `disposition ALLOW`, `within_mandate`. |
| **DENY** | `spend_caps.per_transaction_max`; **x402 never constructed**. No authorization, executor or payment authority ever exists. |
| **ESCALATE** | Held for a human. Approved through the authenticated `reviewer:auto` flow; `human_review` persisted. |
| **Unauthenticated review** | Refused — `/escalations`, `/audit`, `/mandates/active`, `/agents/:id` all return `401`; a forged bearer returns `403`. |
| **`reviewer:auto`** | Authenticated pending **GET** and decision **POST** both succeed. |
| **Evil origin** | Receives no `Access-Control-Allow-Origin` grant. |
| **Dashboard** | Audit feed, mandate, agent and escalation pages all render with live records; health indicators now render accurately. |

**At the time of this gate run, no funded settlement was claimed** — the three signer
keys were not yet provisioned on this machine, so `x402 reached` was `NO` on the ALLOW
path and settlement was `null`. That was confirmed identical at the unmodified start
commit, so it was an environment state, not a regression. The signers were provisioned
afterwards and the live run set was captured; see **Current live-evidence status**
below. The gate figures in this section are unchanged by that capture — no product code
was modified for it.

## Current live-evidence status

**CAPTURED — 22 August 2026.** The three signers were provisioned into three separate
processes and the hardened path was run live against Base Sepolia (`eip155:84532`).

| Scenario | Audit | Result |
|---|---|---|
| DENY — 5 USDC against a 1 USDC per-transaction cap | `audit_84670a33` | `per_transaction_cap_exceeded`; x402 never constructed; no settlement, because payment authority never existed |
| ESCALATE — 0.75 USDC, counterparty not on the allowlist | `audit_30aa1a70` | Held for a human, approved by `reviewer:local`, then `SETTLED` — `0x55ba3c22d58a83a1b6093f2e289c544239d4839cd97b008b791d5a6052225469`, receipt `status = 0x1`, 750000 atomic |
| ALLOW — 0.5 USDC within mandate | `audit_ff45a977` | `SETTLED` — `0xfe4d02288ea8882d8b75e520cf627e97d57b04e4f3a3cc81e40b780a36c995fa`, receipt `status = 0x1`, 500000 atomic |
| Ambiguous signed outcome (real incident, not staged) | `audit_0aaac796` | No blind retry; capacity held; keyless reconciler deferred 17 times; EIP-3009 authorization expired unused. Terminal `FAILED`, `settlement_tx` `NULL`, safe to retry |

`npm run audit:verify` reports **5/5 anchored records proven on chain**. The package,
its SHA-256 manifest and a read-only re-verification transcript are in
[`artifacts/judge-evidence/`](../../artifacts/judge-evidence/); the per-scenario
narrative is in [EVIDENCE.md](./EVIDENCE.md).

`artifacts/final-evidence/manifest.json` still carries `live.status = "BLOCKED"` and is
**deliberately left untouched**: it is the frozen attestation of the earlier gate run
and rewriting it after the fact would defeat its purpose. The current live status is
this section and the `judge-evidence` package.

Historical Stage-1 Base Sepolia transactions remain in the repository and are **labelled
historical**. They predate signer isolation, trusted-time remediation, the current
authentication boundaries and the reconciliation architecture, and are **not** evidence
for any of them.

## Known deferred limitations

Full per-item detail, verified against this build, is in
[`../EDGE_CASES.md`](../EDGE_CASES.md). In summary:

**Known non-blocking finalist limitations** — duplicate action IDs can produce a messy
audit story without any duplicate payment; the SSE live feed can skip rows sharing one
timestamp (a projection defect, not a record defect); anchor-worker "stored-only" jobs
are not automatically revisited when a signer is enabled later; overlapping active
mandate versions are deterministic but ungoverned.

**Deferred production requirements** — API overload control and rate limiting; database
pool, statement and lock timeout policy; durable workflow resumption after agent process
death; recovery for audit rows whose finalization enqueue never happened; chain
confirmation-depth, finality and reorg semantics; public-internet workload identity;
backup/restore/DR; key rotation, HSM and secret-manager operations; production
retention, monitoring and alerting.

**Explicitly outside the threat model** — full host or root compromise. Process and
database-role separation is defeated by root on the same machine, as on any single-host
deployment. This is stated, not defended against.

None of the above is called a security vulnerability, because none of them lets the
untrusted agent move money it was not authorised to move, approve its own work, or
falsify settlement.

## What Cerberus does and does not claim

**Claimed:**

- A finalist release candidate with no reproducible P0/P1 remaining in the completed
  adversarial audit.
- Exact successful chain inclusion is proven before a payment is marked `SETTLED`.
- Cerberus operationalizes the runtime-governance pattern described by MAS SAFR. SAFR
  describes governance checkpoints; Cerberus explores how to make those checkpoints
  enforceable even against a compromised agent.

**Not claimed, and must never be:**

- "No bugs", "completely secure", or "production-safe for real money".
- MAS approved, MAS certified, or SAFR compliant in any official or certification sense.
- Irreversible blockchain finality. A production deployment would add a chain-specific
  confirmation/finality threshold before treating accounting state as irreversible.
- Current signer-isolation proof drawn from historical Stage-1 transactions. The
  hardened-path claim rests only on the 22 August 2026 run set in
  `artifacts/judge-evidence/`; no Stage-1 hash stands in for it.

---

# Freeze policy

Effective from the release payload commit.

## Architecture freeze — HARD

Forbidden from this point:

- trust-boundary changes;
- signer-role changes;
- reservation model changes;
- settlement-state-machine changes;
- new payment rails;
- new policy semantics;
- new database authority model;
- new product features.

## Feature freeze — HARD

Forbidden:

- feature additions;
- speculative functionality;
- competitor-driven feature matching;
- UI expansion unrelated to the demo;
- architectural "cleanup".

## Code freeze — SOFT

Code may change **only** for:

1. a reproducible P0;
2. a reproducible P1;
3. an actual funded-demo correctness failure;
4. an actual judge-demo crash or hang;
5. a tiny evidence/recording reliability fix;
6. a trivial documentation or provenance correction;
7. an explicitly approved tiny P2/P3 patch with near-zero regression risk.

Every code change after freeze requires **all** of:

- a reproduction;
- the smallest possible patch;
- a regression test;
- targeted tests;
- the full gate;
- exact-SHA green CI.

## Remaining work

Signer provisioning, the funded Base Sepolia run, audit anchoring, screenshots, the
screen recordings, the public evidence page and the hosted Judge Console are **done** —
see **Current live-evidence status** above, `artifacts/judge-evidence/`, and the
post-freeze addendum below. In scope now:

- presentation;
- rehearsal on the hosted console and on the local fallback;
- judge Q&A.

## Post-freeze addendum — 23 August 2026 (`caf7057`)

The freeze above governs the **financial runtime**: policy, reservations, authorization,
settlement, reconciliation, audit and the signer split. None of that changed after the
release payload. What was added after the freeze is a **presentation layer and operator
tooling**, recorded here so this document stays true:

| Added | Where | What it is / is not |
|---|---|---|
| Public evidence page | `judge-site/` → <https://judge-site.vercel.app> | Static, read-only page presenting the 22 Aug hardened run (receipts, anchors, recordings, manifest, limitations). No runtime, no secrets. |
| Judge Console | `apps/dashboard/app/judge/`, `components/judge/`, `lib/judge-*.ts` → <https://cerberus-judge-console.vercel.app/judge> | Basic-auth-gated presenter surface that runs the three **fixed** scenarios (`cap_breach`, `new_counterparty`, `clean`) and a read-only chain check for the `audit_0aaac796` incident. Financial fields are fixed server-side; the browser cannot set amounts, counterparties, mandates or payees. Falls back to the captured 22 Aug evidence, never labelled live. See `JUDGE_CONSOLE.md`. |
| Presenter service | `apps/presenter/` | One persistent process that invokes the existing `@safr/agent` `runAction` with the existing adapters; agent DB role + execution bearer only; one active run at a time; rejects browser Origins; no signer, no reviewer credential. Its `/reset` counterpart clears only the volatile presentation registry after a financial-state check — it touches no table. |
| Deployment scaffolding | `deploy/` (systemd units, Kubernetes manifests, ingress proxy, ngrok tunnel) | How the unchanged services are kept running and reached by the Vercel dashboard. Not a new trust boundary: the API keeps its reviewer bearer, the presenter its runner bearer. |
| Mandate v2 publisher | `packages/db/src/cli/publish-finals-mandate-v2.ts` | Schema-owner CLI that publishes `mandate_001` **v2**: rolling 24-hour budget 3 → **24 USDC** so repeated finals runs cannot trip the window; per-transaction cap stays **1 USDC**; velocity, allowlist and escalation policy unchanged. Versioned, never an in-place edit. |
| Demo launcher / driver | `scripts/demo-up.mjs`, `scripts/demo-show.mjs` | Local one-command start and scenario driver over the existing `npm run` scripts (RUNBOOK §2b). |
| Test-runner reliability | `packages/x402-client/src/__tests__/challenge.test.ts`, `scripts/test.ts` | Timeout tests pin their pending Requests against GC; the runner fails on a glob that matches no files. No assertion removed. |

**Gate re-run at `caf7057` (23 Aug, local Postgres, all fixes applied):** `npm test`
**411/411 tests across 83 suites**, 0 failed (the frozen 384 plus the presentation-layer
tests); `npm run typecheck` clean; `npm run evidence:verify` PASS; `npm run db:verify` 13
checks. The **Current finalist build** figures in the README are the freeze-pass numbers
and are kept as written; `artifacts/final-evidence/` remains frozen and untouched.

**Still not claimed, unchanged:** production readiness; irreversible finality; MAS
approval or certification; an immutable audit log (it is tamper-evident); service-to-
service authentication beyond bearer tokens and loopback/tunnel scoping; hardened-path
evidence beyond the one supervised 22 Aug run set.

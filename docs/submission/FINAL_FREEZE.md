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
- Fresh hardened live payment evidence. None exists.
- Current signer-isolation proof drawn from historical Stage-1 transactions.

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

Not product code. In scope after freeze:

- signer provisioning;
- funded Base Sepolia evidence;
- audit anchoring;
- screenshots;
- recording;
- presentation;
- rehearsal;
- judge Q&A.

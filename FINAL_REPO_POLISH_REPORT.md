# Cerberus — final repository polish and freeze report

## Release identity

| | |
|---|---|
| **START SHA** | `ec52e325be385493d57b57cf99c9a9dbb34b4a3c` |
| **FINAL RELEASE PAYLOAD SHA** | `6d40e85bef71d2dfa51edff34a99c7a6b8eebad1` |
| **FINAL ATTESTATION SHA** | the documentation-only commit carrying this report |

Intermediate commits, in order:

| SHA | Commit |
|---|---|
| `2926c99aac871669412e33e3f0e9c2976fe69b33` | Fix authenticated dashboard health proxy |
| `7fd64a7c33d8caa5ae8b482d19dfc93d29c92bd3` | Finalize release documentation and freeze policy |
| `98e735ccce49b0d22124cfb4316260870317d89a` | Stop the evidence manifest reporting a stale build's test counts — **tested source SHA** |
| `6d40e85bef71d2dfa51edff34a99c7a6b8eebad1` | Publish final freeze evidence — **release payload, CI ran here** |

At start, `HEAD == origin/main` and the tracked tree was clean. The untracked
`decisions/` directory was deliberately not touched and remains untracked.

## Files changed

40 paths relative to the start commit: 4 production/tooling source files, 13
documentation files (2 new), and 23 regenerated evidence artifacts.

### Production code changes

Three source files, all minimal.

1. **`apps/dashboard/lib/runtime-route.ts`** — added the single exact path `health` to
   the authenticated runtime proxy allowlist. Four lines including the comment.
2. **`apps/dashboard/lib/runtime-proxy.test.ts`** — three regression tests.
3. **`packages/audit-log/src/audit-log.ts`** — comment only. The `finalize()` comment
   claimed "an un-enqueued record is re-enqueued by the sweeper"; no sweeper exists.
   Replaced with an honest statement of the limitation. No behaviour change.

### Tooling change

4. **`scripts/evidence.ts`** — `fromLog()` now strips ANSI before matching. See
   "Evidence integrity defect" below.

### Documentation changes

New: `docs/EDGE_CASES.md`, `docs/submission/FINAL_FREEZE.md`.

Modified: `README.md`, `docs/Architecture.md`, `docs/Critique.md`, `docs/Memory.md`,
`docs/Phases.md`, `docs/submission/DEPENDENCY_AUDIT.md`, `docs/submission/EVIDENCE.md`,
`docs/submission/MANUAL_RECORDING_GUIDE.md`, `docs/submission/RUNBOOK.md`,
`docs/submission/SECURITY_REMEDIATION.md`.

### Evidence changes

All 17 captures regenerated against the frozen source, plus `manifest.json`,
`index.json`, the generated evidence `README.md`, the mutation matrix and both sandbox
reports.

## Edge-case register

The repository's only register was `decisions/EDGE_CASES_AND_OPEN_DECISIONS.md`, which
is **untracked** — no judge cloning the repository could see it — and entirely
pre-remediation. Since `decisions/` was explicitly out of scope, the register was
delivered as a new tracked document, `docs/EDGE_CASES.md`, linked from the README.
`decisions/` was left exactly as found.

### Fixed-but-stale entries corrected

All six were independently verified against current source before being marked closed:

| Finding | Now | Evidence |
|---|---|---|
| Caller-controlled `proposed_at` bypass | **IMPLEMENTED** | `execution-authorizer.ts` evaluates history at `proposed_at` but re-evaluates current authority with trusted `nowIso`; proposal and hash semantics preserved |
| Unauthenticated Execution Authorization issuance | **IMPLEMENTED** *within the finalist deployment boundary* | `execution-auth.ts` constant-time bearer on the route; 401/403/503; `execution-route-auth.test.ts`. Explicitly **not** claimed as public-internet workload identity |
| Arbitrary reflected CORS | **IMPLEMENTED** | `cors-policy.ts` explicit allowlist; verified live that an evil origin receives no grant |
| `reviewer:auto` GET missing bearer | **IMPLEMENTED** | shared client authenticates GET and POST; verified live end to end |
| Paid x402 request without timeout | **IMPLEMENTED / CONSERVATIVE** | 30s bounded request; post-transmission abort still `OUTCOME_UNKNOWN`, capacity retained, never auto-retried |
| Least-privilege agent unable to evaluate | **IMPLEMENTED** | settled-only counters from `audit_log`; no reservation grant added; `agent-role-postgres.test.ts` |

### Known finalist limitations (documented, not solved)

Duplicate action IDs can produce a messy audit story with no duplicate payment; the SSE
feed can skip rows sharing one timestamp (a projection defect, not a record defect);
anchor-worker "stored-only" jobs are not revisited when a signer is enabled later;
overlapping active mandate versions are deterministic but ungoverned.

### Deliberately deferred production requirements

API overload/rate limiting; database pool, statement and lock timeouts; durable workflow
resumption after agent process death; recovery for audit rows whose finalization enqueue
never happened; chain confirmation-depth, finality and reorg semantics; public-internet
workload identity; backup/restore/DR; key rotation, HSM and secret-manager operations;
production retention, monitoring and alerting.

None is labelled a security vulnerability, because none lets the untrusted agent move
unauthorised money, approve its own work, or falsify settlement. Full host or root
compromise is stated as outside the threat model.

## Health proxy

**FIXED.**

Reproduced first, against the real handler: a browser health poll to
`/api/runtime/health` returned **404 `runtime_path_not_allowed`** with **0 upstream
calls**, so the sidebar status dots could only ever render the failure state.

The patch adds only that one exact read-only path. Verified after the fix, on the
running dashboard: authenticated `GET /api/runtime/health` returns **200** with live
data (`database: up`); unauthenticated returns **401**; `execution-authorizations`,
`health/detail` and `healthz` all remain **404**; and the server-only reviewer bearer
appears in no browser-reachable response.

## Evidence integrity defect found and fixed

Regenerating evidence produced a manifest claiming **260 tests across 48 suites** for a
build whose own captured log says **384 across 78**.

Cause: the manifest's headline numbers are extracted from captured logs with anchored
patterns. Those patterns do not match a log containing ANSI colour, and `fromLog()` then
silently falls through from the `gate-` capture to the older `baseline-` capture,
reporting a previous build's numbers as the current build's. The earlier capture
happened to be colour-free, which is why this had never fired.

Fixed by stripping ANSI before matching. The `gate-` over `baseline-` preference is
unchanged. This is exactly the class of defect this pass existed to catch: it would have
shipped a manifest misdescribing its own release.

## Gate results

Every figure is from an execution during this pass.

| Gate | Result |
|---|---|
| **TESTS** | **PASS — 384/384, 78 suites**, 0 failed / skipped / cancelled |
| **ADVERSARIAL** | **PASS — 12/12 classes**, 80 assertions |
| **RED TEAM** | **PASS — 12/12 classes**, 70 assertions |
| **MUTATION** | **PASS — 12/12 guards** detectable; targets restored byte-for-byte |
| **SANDBOX 42** | **PASS** — 1,000 actions / 50 agents / concurrency 25; 0 budget, duplicate-effect, replay violations |
| **SANDBOX 1337** | **PASS** — same shape; 0 violations |
| **DB VERIFY** | **PASS** — 13/13 checks after seed |
| **DASHBOARD** | **PASS** — Next.js production build, authenticated runtime route emitted |
| **CONTRACT** | **PASS** — solc 0.8.36, 263-byte deployable bytecode |
| **DEPENDENCY AUDIT** | **PASS** — no known vulnerabilities |
| **EVIDENCE VERIFY** | **PASS** — 0 failures, 1 expected blocked-preflight warning |
| **TYPECHECK** | **PASS** |

### Demo smoke

**PASS**, using real least-privilege local roles.

- **ALLOW** — governance reaches the authorized payment path (`within_mandate`).
- **DENY** — `spend_caps.per_transaction_max`; **x402 never constructed**; no
  authorization, executor or payment authority ever exists.
- **ESCALATE** — held, then approved through the authenticated `reviewer:auto` flow;
  `human_review` persisted.
- **Unauthenticated review fails** — `/escalations`, `/audit`, `/mandates/active` and
  `/agents/:id` all `401`; forged bearer `403`; evil origin receives no CORS grant.
- **`reviewer:auto`** — authenticated pending GET and decision POST both succeed.
- **Dashboard** — audit feed, mandate, agent and escalation pages render with live
  records; health indicators now render accurately.

No funded settlement is claimed. The three signer keys are unprovisioned, so the ALLOW
path reports `x402 reached NO` and `settlement null`. This was confirmed **identical at
the unmodified start commit**, so it is environment state, not a regression.

### CI

**PASS on exactly the release payload.** Run
[32301340842](https://github.com/Harshyadav442277/Cerberus/actions/runs/32301340842),
head SHA `6d40e85bef71d2dfa51edff34a99c7a6b8eebad1`, all 21 steps green in 1m56s,
independently reproducing 384/78/0, 12/12 adversarial, 12/12 red team, clean dependency
audit, portable evidence validation, and the no-committed-credentials assertion.
Parent-SHA CI was not accepted as a substitute.

## Live hardened evidence

**BLOCKED.**

`manifest.json` carries `live.status = "BLOCKED"` with `allow`, `escalate` and `deny`
all `null`, and the reason recorded. Historical Stage-1 Base Sepolia transactions remain
in the repository and are labelled historical; none has been promoted into current
evidence for signer isolation, trusted-time remediation, the current authentication
boundaries or the reconciliation architecture.

## Security review of this diff

Asked only: *did this pass accidentally weaken a security boundary?* **No.**

The single behavioural change is one exact single-segment allowlist entry, applied
**after** the dashboard authentication check, exposing a read-only status route that
carries no payment or policy data. `audit-log.ts` and the tooling change alter no
runtime behaviour. Nothing touched auth, CORS, database roles, trusted time, execution
authorization, reservation, `OUTCOME_UNKNOWN`, reconciliation, the anchor path, or
environment variables.

Secret hygiene: no credential value appears in the diff — the only `Bearer` strings are
the pre-existing dummy test fixture. Only `.example` env files are tracked. Regenerated
evidence contains no credentials; the 64-hex values in `database/audit-state.txt` are
anchor transaction hashes and record digests, and that file predates this pass. CI's own
"no credential files committed" step passed.

## Outstanding

**P0 REMAINING: 0**

**P1 REMAINING: 0**

---

# READY FOR ARCHITECTURE + FEATURE FREEZE

Architecture: **HARD FROZEN.** Features: **HARD FROZEN.** General code: **SOFT FROZEN.**
The policy is in [`docs/submission/FINAL_FREEZE.md`](docs/submission/FINAL_FREEZE.md).

Remaining work is signer provisioning, funded Base Sepolia evidence, audit anchoring,
screenshots, recording, presentation, rehearsal and judge Q&A — not product code.

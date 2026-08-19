# Cerberus Final Release Remediation

BASE AUDITED SHA: `7a51ab5f87b37bc42ed4b4ebece89fd668e724ba`

FINAL TESTED SOURCE SHA: `cd75049c0ade2f8e1ec03227079cb2bcf5c77b50`

FINAL SHA: `bb3f6a282d8f3436cb79bcb21a939741a72a9022` is the exact release-payload
commit containing the remediated source, generated evidence and initial report. It
passed CI. The immediate descendant is a report-only CI attestation because a commit
cannot truthfully contain its own SHA or its not-yet-started CI result.

COMMITS ADDED: source remediation `cd75049c0ade2f8e1ec03227079cb2bcf5c77b50`,
release evidence/report `bb3f6a282d8f3436cb79bcb21a939741a72a9022`, and one
report-only CI attestation immediately afterward.

FILES CHANGED: 55 source/test/configuration/documentation files, 33 final-evidence
files, and this report (89 paths total relative to the audited commit).

## Scope and method

The audited SHA was still both local `HEAD` and `origin/main` when remediation began.
Every P1 and P2 was reproduced before its fix. The final source diff was then reviewed
read-only for new authority, CORS, role-grant, replay, budget, approval-freshness and
outcome-state regressions. No new reproducible P0/P1 was found in that pass.

Local `.env.*` files contain test-only credentials and are ignored. They are not part
of the release. The pre-existing untracked `decisions/` directory was deliberately
left out of the remediation commits.

## Original findings

### P1-1 — unauthenticated, any-origin capability issuance

- Reproduced: **YES.** An unauthenticated evil-origin POST returned `201`, reflected
  `Access-Control-Allow-Origin`, and created one reservation plus one signed execution
  authorization.
- Root cause: `POST /execution-authorizations` had no caller authentication and the
  API reflected every browser origin.
- Fix: a dedicated constant-time bearer boundary now protects capability issuance;
  it is separate from reviewer identity. API CORS now permits only explicitly
  configured dashboard origins. The agent carries only this narrow request credential;
  policy re-evaluation, trusted time, reservation, exact binding, signer isolation and
  one-shot consumption remain authoritative.
- Regression tests: `execution-route-auth.test.ts`, control-plane read auth tests,
  existing DENY/orchestrator tests, and red-team class H.
- Verification: missing token `401`, forged token `403`, evil origin receives no
  CORS grant, configured service token reaches the handler, and the real API produced
  exactly one reservation/authorization only for the valid request.
- Residual limitation: this bearer credential lets its holder request policy-bound
  authority for an existing audit; it does not bypass policy or sign/spend/review.
  Public deployment still requires TLS, credential rotation, rate limiting and
  perimeter controls.

### P1-2 — real least-privilege agent cannot evaluate a proposal

- Reproduced: **YES.** `npm run demo -- clean` failed with SQLSTATE `42501`; the same
  committed-velocity query succeeded as schema owner/control plane and failed as
  `cerberus_agent_app`.
- Root cause: the shared evaluation counter began reading `payment_reservation`, a
  trusted financial table intentionally hidden from the hostile-agent role.
- Fix: agent-visible policy counters are settled-only reads from `audit_log`, which
  the role may already read. The trusted reservation transaction still counts active,
  executing and settled capacity under advisory locks and is the authoritative budget
  and velocity gate. No reservation-table grant was added.
- Regression test: `agent-role-postgres.test.ts` calls `loadEvaluationContext()` using
  the real agent login and separately proves direct reservation reads still fail
  `42501`.
- Verification: real-role clean demo reaches `ALLOW`; DENY never constructs the
  authorization client; 1,000-action concurrent sandboxes preserve all financial
  invariants.
- Residual limitation: preliminary policy display counts settled activity only;
  transaction-time trusted enforcement includes committed reservations.

### P2-1 — evidence cannot be verified in a clean clone

- Reproduced: **YES.** The audited checkout failed on missing ignored logs and hashes
  changed by checkout line-ending conversion.
- Root cause: blanket `*.log` ignore, no evidence-specific Git text policy, and raw
  pre-normalization capture hashes.
- Fix: evidence logs are explicitly tracked; `.gitattributes` pins LF for text and
  binary treatment for MP4; the capture harness canonicalizes LF before hashing; the
  manifest keeps only present/hash-matching captures; its public index is pruned to
  the same set; verification rejects any manifest file not tracked by Git and scans
  the new execution token as a secret.
- Regression/gate: `npm run evidence:verify` is now part of CI.
- Verification: local staged-tree and detached clean-checkout validation at
  `bb3f6a2` both report `0 failure(s)` with one honest expected warning for blocked
  live preflight. CI independently reproduced the clean-checkout PASS.
- Residual limitation: fresh funded evidence is not available; the manifest says
  `BLOCKED` rather than fabricating success.

### P2-2 — tests destroy canonical demo state

- Reproduced: **YES.** `db:verify` passed before the suite and failed afterward because
  the canonical agent/mandate were gone.
- Root cause: PostgreSQL integration suites truncate shared fixtures and the root test
  command had no postcondition.
- Fix: `scripts/test.ts` runs the complete explicit file set and always restores the
  canonical seed; restore failure makes the test command fail.
- Regression: the release sequence is seed → verify → 381 tests → verify.
- Verification: 381/381 pass; immediate post-test `db:verify` passes all 13 checks;
  the subsequent real-role clean demo also passes governance evaluation.
- Residual limitation: integration tests still share the configured test database;
  the deterministic restore is the finalist-safe isolation choice.

### P2-3 — sensitive audit/mandate reads remain public

- Reproduced: **YES.** Adjacent audit and mandate routes returned payment/policy data
  without credentials while `/escalations` was protected.
- Root cause: reviewer authentication covered only the escalation router, and the
  dashboard browser called neighbouring API reads directly.
- Fix: audit feed/SSE/drill-down, active mandate and agent reads require the reviewer
  bearer token. The dashboard uses authenticated server reads and a Basic-authenticated,
  allowlisted same-origin runtime proxy that replaces Basic auth with the server-only
  reviewer bearer. The browser never receives the bearer value.
- Regression tests: `control-plane-read-auth.test.ts` and
  `runtime-proxy.test.ts`, plus the existing reviewer proxy tests.
- Verification: actual API requests return `401` missing, `403` forged, `200/404`
  only after valid authentication; the evil origin gets no CORS header; the production
  dashboard build succeeds.
- Residual limitation: dashboard Basic auth is a prototype operator boundary, not
  institutional SSO/MFA.

No original P0 finding existed.

## Additional candidates

### Trusted time / forged `proposed_at` — CONFIRMED AND FIXED

The vulnerable authorizer minted current authority using caller-controlled historical
time. Current re-evaluation now substitutes trusted `nowIso` only for the time-window
decision while preserving the original proposal and its hash. Regressions cover forged
past and future timestamps, trusted time inside/outside the window, the documented
inclusive whole-minute boundary, stale mandate, stale approval and capability expiry.

### `reviewer:auto` GET authentication — CONFIRMED AND FIXED

The pending GET returned `401` because only the decision POST sent the token. A shared
reviewer client now authenticates both GET and POST. Unit coverage inspects both
headers; the real command approved a waiting escalation end to end and server-controlled
reviewer identity remained authoritative.

### Paid x402 request timeout — CONFIRMED AND FIXED

A hostile paid-request fetch remained pending with no direct bound. The signed request
now has a 30-second timeout. Durable correlation still precedes transport; any abort
after possible transmission remains `OUTCOME_UNKNOWN`, retains capacity, schedules
reconciliation and is never retried automatically. Deterministic payer and executor
tests prove one attempt and no false `FAILED` transition.

## Selected P3 closure and additional reliability findings

- Sub-atomic and over-precision proposal amounts are rejected at the schema boundary;
  valid six-decimal values are accepted despite binary floating-point representation.
- Zero rolling windows are rejected in schema and defensively in reservation parsing.
- README test count is 381, stale hand-maintained current-SHA claims are removed, and
  installation follows the pinned pnpm 11/Corepack path.
- Mutation detection requires named expected assertions and proves every mutation
  target is restored byte-for-byte. Ordinary runs no longer dirty evidence.
- Sandbox replay reporting now reads the named replay invariant. The final gate also
  exposed swallowed insert errors and unstable duplicate audit identities; retries now
  use one stable action/audit identity and unexpected database errors fail loudly.
- A same-timestamp concurrency race was fixed by reading `clock_timestamp()` only
  after reservation locks are held. Five repeated real-PostgreSQL velocity races and
  both final sandboxes passed.
- Inclusive whole-minute time-window semantics were deliberately preserved and are
  explicitly regression-tested.

## Complete release gate

FULL TEST RESULT: **PASS — 381/381 tests, 78 suites, 0 failed/skipped/cancelled.**

ADVERSARIAL RESULT: **PASS — 12/12 classes, 80 assertions.**

REDTEAM RESULT: **PASS — 12/12 classes, 70 assertions.**

MUTATION RESULT: **PASS — 12/12 named guards detected; targets restored byte-for-byte.**

SANDBOX 42 RESULT: **PASS — 1,000 actions at concurrency 25; 0 budget, duplicate-effect or replay violations.**

SANDBOX 1337 RESULT: **PASS — 1,000 actions at concurrency 25; 0 budget, duplicate-effect or replay violations.**

DB VERIFY RESULT: **PASS — all 13 checks immediately after the full test suite.**

DASHBOARD RESULT: **PASS — Next.js production build, authenticated runtime route included.**

CONTRACT RESULT: **PASS — solc compile, 263-byte deployable bytecode.**

DEPENDENCY AUDIT RESULT: **PASS — no known vulnerabilities.**

EVIDENCE VERIFY RESULT: **PASS — local staged tree, detached clean checkout at `bb3f6a2`, and CI; 0 failures, one expected blocked-preflight warning.**

NON-FUNDED DEMO RESULT: **PASS — clean ALLOW; cap breach DENY with x402 never constructed; new counterparty ESCALATE approved through authenticated `reviewer:auto`. No funded settlement is claimed.**

CI RESULT: **PASS — exact release payload `bb3f6a282d8f3436cb79bcb21a939741a72a9022`, run [32285988923](https://github.com/Harshyadav442277/Cerberus/actions/runs/32285988923), all 17 steps green in 1m52s.**

P0 REMAINING: **0**

P1 REMAINING: **0**

P2 REMAINING: **0 original audit findings**

KNOWN DEFERRED LIMITATIONS:

- no fresh funded live payment or anchor under the hardened path because the three
  signer roles/funding are not provisioned on this machine;
- settlement proves exact successful chain inclusion, not confirmation-depth finality;
- bearer/Basic auth plus loopback are not a complete public-internet perimeter;
- OS process isolation and database roles do not survive full host compromise;
- production HA, disaster recovery, HSM, rotation framework, institutional RBAC/MFA,
  monitoring and arbitrary rate-limit infrastructure remain deliberately out of the
  feature-frozen finalist scope.

## Final verdict

**RELEASE-CANDIDATE PASS — NO REPRODUCIBLE P0/P1 REMAINS**

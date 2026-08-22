# Memory — SAFR Runtime working log

Working log per `Rules.md` R10. Newest entry at the top. Short and factual.
A cold session should be able to resume from this file plus `SAFR_RUNTIME_PROJECT_BIBLE.md` alone.

**Read order for a cold start:** Bible → `Rules.md` → `Phases.md` (current phase) → this file's top entry.

---

## Current state at a glance

- **ARCHITECTURE AND FEATURE FROZEN — HARD. GENERAL CODE FROZEN — SOFT.** The freeze
  policy and the exact release SHAs are in
  [`submission/FINAL_FREEZE.md`](submission/FINAL_FREEZE.md), which is authoritative.
  Feature freeze was first declared at `ba5c853`; the final release-candidate lineage
  is `cd75049` → `bb3f6a2` → `ec52e32` → this polish pass. Signer provisioning and the
  funded hardened-path evidence are now **done** (see the Aug 22 entry below and
  `artifacts/judge-evidence/`). Remaining work is presentation rehearsal — not product
  code.

- **Project name:** **CERBERUS** (corrected spelling locked by the project owner on Aug 13), named for the three-headed guardian of Hades. The three heads map to ALLOW, DENY, and ESCALATE; SAFR Runtime remains the technical description.
- **Phase 0:** **complete.** Funded-wallet and network checks pass.
- **Phase 1:** **complete.** Bare x402 settlement succeeded on Base Sepolia (`0xed51af70…efab9`).
- **Phase 2:** **complete.** DoD met and verified by `npm run db:verify` (13/13 checks).
- **Phase 3:** **complete.** DoD met — engine purity is machine-verified.
- **Phase 4:** **complete.** DoD met — the interception constraint is proven by test, not asserted.
- **Phase 5:** **complete.** `AuditAnchor` is deployed; two fresh supervised runs anchored all six terminal records, and final-run verification is 3/3.
- **Phase 6:** **DoD met.** API + dashboard live; two real dashboard Approve clicks unblocked separate agent processes and both payments settled.
- **Phase 7:** **complete.** The disposition path passed thrice, then two fresh supervised runs produced real ALLOW and approved-ESCALATE settlement hashes with DENY never constructing x402.
- **Phase 8:** narration recorded; final visual edit not completed to publication standard and intentionally omitted. Non-blocking: the architecture diagram and verified evidence satisfy the Stage 1 supporting-material requirement.
- **Phase 9:** **complete.** The submission-ready architecture slide is tracked at `docs/assets/safr-architecture-slide.png` and embedded in the README.
- **Phase 10:** repository-side technical copy and evidence are complete. Team identity and portal submission state are human-only and intentionally not inferred here.
- **Stage-2 finalist hardening:** active under `Critique.md`. Phase 1 (signer
  isolation, Execution Authorization) and Stage-2 Phase 2 (atomic budget reservations)
  are complete on `main`. Stage-2 Phase 3 (durable replay plus
  mandate/human-approval freshness) is complete and verified: typecheck, dashboard
  production build, contract compile, migration 004 down/up, and 176/176 tests across
  36 suites pass against real PostgreSQL. Phase 3.5A reviewer authentication is also
  complete: the API requires a trusted reviewer credential, browser approval crosses
  an independently authenticated server-only Next.js route, scripted approval runs in
  a separate trusted process, and the agent has no reviewer credential or decision
  client. Phase 3.5B database privilege separation is complete: distinct agent,
  control-plane, and executor PostgreSQL roles enforce the authority boundary with
  GRANT/REVOKE, and agent-credential attacks fail at the database. Phase 3.5C mandate
  immutability is complete: published policy fields cannot change in place, and only
  one-way lifecycle closure remains mutable. Phase 3.5D concurrent velocity
  enforcement is complete: a per-agent transactional lock counts committed/executing
  reservations, promotes a raced ALLOW to ESCALATE through the trusted control plane,
  and requires a bound human approval before one retry. Stage-2 Phase 4 exact live
  x402 challenge binding is complete: the executor performs one unsigned request,
  validates and pins the merchant's actual v2.21.0 PaymentRequirements, and only then
  obtains a fresh clock/context read and rechecks authorization, mandate, approval,
  and reservation authority before consuming or signing. The unsigned request has a
  10-second timeout, and the final database CAS operations enforce expiry. The full
  suite is now 260/260 across 48 suites after Phase 6. Phase 5
  `OUTCOME_UNKNOWN` reconciliation is complete: correlation is durable before
  transport, a keyless fenced worker resolves
  exact settlement or expired-unused non-payment, and audit/dashboard state preserves
  UNKNOWN honestly. Phase 6 is complete: `npm run adversarial` passed 78/78 selected
  assertions across 12/12 attack classes using named TAP evidence and real PostgreSQL
  where required. **The finalist security remediation pass is complete** — agent
  suspension enforced as a real kill switch, on-chain anchor verification that
  actually reads Base Sepolia, the hostile agent stripped of settlement and anchor
  authority, atomic terminal financial/audit state with a durable finalization
  outbox and trusted anchor worker, reservation context equality, loopback-scoped
  services with reviewer-authenticated escalation reads, dedicated reconciler and
  anchor database roles, and a clean dependency audit. *(As written, Phases 7–8 had not
  started. Phase 7 is since complete; Phase 8's narration was recorded and the visual
  edit intentionally omitted.)* The fresh funded hardened-path run remains pending.
- **Post-review hardening (Aug 7):** atomic escalation claim, pay() throw → failed settlement + finalize, Agent page §7.1 fields, drill-down threshold vs actual, Audit Log 24h spend strip.
- **Pre-recording hardening (Aug 14):** judge-visible product branding is CERBERUS / SAFR Runtime; strict evidence capture refuses failed settlements, missing human approval, unanchored records, or an unconfigured anchor contract.
- **Submission PDF (Aug 14):** an 11-page 16:9 CERBERUS supporting-deck draft and reproducible LaTeX/TikZ source remain local under ignored `output/`. They were verified before B1 resolved and still contain stale "public-chain capture pending" wording, so they are reference material only unless regenerated from the verified evidence in `docs/submission/EVIDENCE.md`.
- **Deadline (authoritative, from the organizer's published rules):** **Fri Aug 14, 2026, 11:59 PM SGT = 21:29 IST.** Self-imposed submission target Aug 14, 12:00 IST. Earlier notes in this file and in the Bible said 21:15 IST / 11:45 PM SGT, taken from the schedule banner; the rules text is the controlling source and gives 11:59 PM SGT. Do not plan to the last 14 minutes either way.
- **Test count:** **384/384 across 78 suites** at the final freeze pass
  (historically: 381/78 after the final release remediation pass; 363/72 at the
  finalist completion build; 330/61 after the security
  remediation pass; 260/48 after Stage-2 Phase 6),
  against real PostgreSQL on `5544`. Adversarial: 12/12 classes, 80 assertions. Red
  team (`npm run redteam`): 12/12 classes, 70 assertions. Mutation matrix
  (`npm run mutation`): 12/12 guards proven detectable. Sandbox: 0 violations on two
  seeds. Dependency audit: clean. The reservation, finalization
  and privilege suites test database properties and are worthless against stubs.
  Test files run with `--test-concurrency=1` because the database suites share one
  database. Historical entries below preserve the counts correct when written.
- **Next concrete step:** provision the three signers and fund them, then capture a
  fresh funded ALLOW plus dashboard-approved ESCALATE through the hardened path. The
  exact procedure is in `docs/submission/LIVE_EVIDENCE_BLOCKED.md`; `npm run preflight`
  reports what is still missing and exits non-zero until it is all present. After that,
  record the demo using `docs/submission/MANUAL_RECORDING_GUIDE.md`. Phase 7 (seeded
  sandbox) is complete.
- **New operational requirement:** `npm run anchor` must run alongside the other
  services. The agent no longer anchors its own records — it holds no anchor signer
  and no `audit_anchor` privilege — so without the worker, digests are stored
  durably but never reach the chain.

**Current finalist claim limits (after Stage-2 Phase 5 implementation):** the
reservation ID is committed financial state; authorizations are recorded and consumed
by a durable database compare-and-set; human approvals bind proposal, mandate version,
and expiry; and both the authorizer and executor fail closed on stale authority before
key use. The executor now fetches the live HTTP 402 without a payment signature and
requires an exact match on protocol version, scheme, network, token contract, atomic
amount, payee, resource URL, EIP-712 token identity, and transfer method before
performing a fresh authority read and constructing the payer. The post-fetch check
uses a new timestamp, and both final database transitions independently require
unexpired authority/reservation state. These guarantees passed the
real-PostgreSQL restart/concurrency suite. `OUTCOME_UNKNOWN` now persists its exact
EIP-3009 correlation before transport and is resolved by a keyless, leased chain-state
worker without constructing a second payment. Merchant success is non-authoritative:
the executor records SETTLED only after the same chain reader proves the exact
AuthorizationUsed/receipt/USDC transfer, and records the chain-derived transaction.
The legacy policy-layer rolling-spend counter still hardcodes a 24h window and measures
settled-only spend; the reservation layer parses `rolling_window.window` and is the
actual financial gate. The hourly velocity counter now reads committed/executing
reservation state plus non-duplicated legacy settlements. The prototype isolates secrets by application process and configuration, not
by a separate OS/container security principal; production must run the executor under
a distinct identity or managed secret boundary before claiming resistance to
arbitrary same-host filesystem compromise. The older sequential-demo limitations
remain: overnight time-window wrap is unsupported. Reviewer authentication and
least-privilege PostgreSQL roles are now enforced. The schema-owner URL is loaded only
by operator CLIs/tests, not the shared DB package or runtime applications. Published
mandate policy bodies are database-immutable by version. Transaction-count velocity
is concurrency-safe at reservation time and preserves ESCALATE semantics.

**Command reference** (run from repo root; no nested pnpm):
`npm run typecheck` · `npm test` · `npm run adversarial` · `npm run db:up` · `npm run db:migrate` · `npm run db:migrate:down` · `npm run db:migrate:status` · `npm run db:roles` · `npm run db:seed` · `npm run db:verify` · `npm run merchant` · `npm run demo` · `npm run demo:reset` · `npm run demo:script` · `npm run api` · `npm run executor` · `npm run reconciler` · `npm run reviewer:auto` · `npm run dashboard` · `npm run audit:verify` · `npm run audit:tamper-demo` · `npm run contracts:compile` · `npm run contracts:deploy` · `npm run phase1:preflight` · `npm run phase1`

`npm run demo` / `demo:script` need `npm run merchant` running and an authenticated
dashboard click or separate `npm run reviewer:auto`. Use `reviewer:auto -- --count=3`
with `demo:script -- --thrice`.
Install is the one thing that needs pnpm: `npx --yes pnpm@10.34.5 install`.

**Stack as resolved on the Windows evidence machine:** TypeScript/Node 24, pnpm 10
workspaces, user-local Postgres 18.6 on host port **5544**, x402 TS SDK **v2.21.0**,
Base Sepolia `eip155:84532`, testnet facilitator `https://x402.org/facilitator`.


---

## CERBERUS FEATURE FREEZE

**Frozen at:** `ba5c85309be54363ff31ecf9ecc9f6364bdcc29d`

Declared after the finalist completion build passed its release gate. From this point
only the following are permitted:

- critical bug fixes
- demo reliability fixes
- wording corrections
- evidence recapture (including the blocked live run and the screen recordings)
- presentation rehearsal

**No new features.**

State at freeze:

| | |
|---|---|
| Tests | 363 passed / 363, 72 suites |
| Adversarial | 12/12 classes, 80 assertions |
| Security red team | 9/9 classes, 60 assertions |
| Mutation matrix | 12/12 guards proven detectable |
| Seeded sandbox | 0 budget violations, 0 duplicate effects, 0 replay violations (seeds 42 and 1337) |
| Dependency audit | no known vulnerabilities |
| Typecheck / dashboard build / contract compile / db:verify | all clean |
| Evidence manifest | validates, 0 failures |
| Fresh funded live evidence | **BLOCKED** — not captured, not fabricated |
| Screen recordings | **not captured** — automated capture unavailable |

---

## Aug 22 — Hardened-path live evidence captured, packaged and verified

The blocker that stood since Aug 19 is cleared. The operator provisioned the three
signers, the hardened path ran live on Base Sepolia, and the run set was then packaged
and re-verified read-only. **No product code was changed for any of it.**

**The four headline scenarios, all against `eip155:84532`.**

| Scenario | Audit | Outcome |
|---|---|---|
| DENY — 5 USDC to `merchant_abc` against a 1 USDC per-transaction ceiling | `audit_84670a33` | `per_transaction_cap_exceeded`, rule `spend_caps.per_transaction_max`. x402 never constructed, so there is no settlement and no failed transaction — payment authority never existed |
| ESCALATE — 0.75 USDC to `merchant_new` | `audit_30aa1a70` | `counterparty_not_on_allowlist`; held for a human; approved by `reviewer:local`; authorization `auth_f70a3e32-…`; `SETTLED` on `0x55ba3c22…25469`, receipt `status 0x1`, 750000 atomic |
| ALLOW — 0.5 USDC to `merchant_xyz`, `invoice_884` | `audit_ff45a977` | `within_mandate`; authorization `auth_8b204222-…`; `SETTLED` on `0xfe4d0228…c995fa`, receipt `status 0x1`, 500000 atomic |
| Ambiguous signed outcome | `audit_0aaac796` | ALLOW, then execution went ambiguous after signing. Capacity held, no blind retry, keyless reconciler `deferred` ×17, EIP-3009 authorization expired unused. Terminal `FAILED`, `settlement_tx` `NULL`, `safe to retry` |

The ambiguous outcome was a **real incident during the run set**, not manufactured for
the demo. Its value is that the non-payment is proven positively rather than assumed:
`USDC.authorizationState(payer, nonce)` for `res_bcaf9720-…` reads **false** and the
authorization's `validBefore` (2026-08-22T00:49:44Z) has elapsed. The merchant's HTTP
response was never treated as financial truth.

`npm run audit:verify` → **5/5 proven on chain** (`audit_03117a66`, `audit_84670a33`,
`audit_30aa1a70`, `audit_0aaac796`, `audit_ff45a977`), each against its own anchor
transaction.

**Packaging.** `artifacts/judge-evidence/` holds 38 phase-evidence files across phases
0–7 — logs, five screenshots, seven screen recordings — plus `08_final/` carrying
`SHA256SUMS.txt` for the whole package, `evidence-summary.json`, and
`final-verification.log`: a read-only re-read of the authoritative database rows, the
least-privilege logins, the credential boundary, both settlement receipts, the
unconsumed EIP-3009 authorization and all five anchor receipts. No zero-byte files, no
malformed JSON, nothing missing. `artifacts/final-evidence/` was deliberately not
touched — it is frozen evidence of the earlier gate run and rewriting it after the fact
would defeat its purpose.

**Two things to know when reading the raw logs.** The demo CLI prints a generic note
that failed settlement and unanchored records "are expected until the payer wallet is
funded (Memory.md blocker B1)". That text is stale and does not describe these runs —
the payer was funded, both permitted scenarios settled, all five records anchored.
Historical logs were kept byte-for-byte rather than edited. And
`05_escalate/escalate-raw.log` is the first attempt, which timed out waiting for a human
reviewer; it is retained because it shows the human gate is a genuine cross-process
hold. One file, `05_escalate/audit-verify.log`, was removed: it contained a mis-pasted
shell prompt line and no evidence. Phase 5's anchor is verified in
`06_allow/audit-verify.log` and again in `08_final/final-verification.log`.

**Documentation updated to match, not rewritten:** `README.md`,
`docs/submission/EVIDENCE.md`, `FINAL_FREEZE.md`, `LIVE_EVIDENCE_BLOCKED.md`
(now marked RESOLVED, procedure retained), `RUNBOOK.md`, `JUDGE_SCRIPT.md` and this
file. `JUDGE_SCRIPT.md` also had two stale figures corrected to the current gate — the
red-team suite is 12/12, and the suite is 384 tests.

**Remaining:** presentation rehearsal. Nothing else.

---

## Aug 19 — Finalist completion build (red-team, sandbox, evidence)

Ran straight after the security remediation pass, on top of `cc2d66e`.

**Two real vulnerabilities found and fixed.**

1. **Signed payment authority could cross a redirect.** Both x402 request paths used
   fetch's default `redirect: "follow"`. The paid request carries a live signed
   EIP-3009 authorization in a custom `PAYMENT-SIGNATURE` header, and the fetch spec
   strips only `Authorization`, `Cookie` and `Proxy-Authorization` across a
   cross-origin redirect — custom headers are forwarded intact. A merchant could
   therefore bounce Cerberus's signed payment authority to an unapproved host.
   Severity is bounded because EIP-3009 binds the recipient, so funds cannot be
   redirected; but a live payload reaching a third party still breaks the
   exact-resource threat model. Both paths now use `redirect: "error"`.
2. **`z.number().positive()` accepts `Infinity`.** An infinite amount parsed as a
   valid proposal. It was never spendable — the cap denies it and the atomic
   conversion refuses it — but that made the safety a property of two downstream
   checks rather than of the type. Now `.finite()`.

**One test found to be incapable of failing.** The mutation matrix, not review, caught
it: flipping `redirect:"error"` to `"follow"` left the redirect test green. The
assertion lived inside the fetch stub, and its own AssertionError message contained
the word "redirect", which the rejection matcher accepted as evidence the guard had
fired. The test passed whether the guard existed or not.

**New tooling, all wired into package.json.**

- `npm run mutation` — removes one security guard at a time and requires the tests
  claiming to detect it to fail. **12/12 guards proven detectable.** Refuses to run on
  a dirty tree and asserts the tree is clean again before reporting PASS, so a
  vulnerable mutation cannot escape into a commit.
- `npm run sandbox` — Phase 7. Deterministic hostile workload through the real engine
  and reservation layer; six invariants queried from PostgreSQL **after** the run
  rather than from application counters. 1000 actions / 50 agents / 25 concurrent:
  zero budget violations, zero duplicate effects, zero replay violations, on two
  seeds, ~1050 actions/s, policy p50 4.3 ms / p99 17.7 ms.
- `npm run preflight` — gates any funded run; exits non-zero until every precondition
  is met. Prints public data only.
- `npm run capture` / `evidence:manifest` / `evidence:verify` — terminal capture with
  recorded exit codes, a manifest generated FROM the artifacts, and a validator that
  checks digests, JSON, hash shapes and that no credential value appears in evidence.

**Three harness bugs worth remembering**, each of which would have produced a *false*
result: mutation anchors written with LF against a CRLF checkout silently failed to
match every multi-line guard; the velocity-lock pattern omitted the one test that
isolates it (same-mandate racers serialise on the *budget* lock); and the sandbox
called `pick()` inside a `find()` predicate, redrawing a different id per element and
destroying determinism.

**Phase E is BLOCKED and stays blocked.** The three signers are not provisioned on
this machine and the anchor signer would start with zero ETH. Nothing was fabricated;
`docs/submission/LIVE_EVIDENCE_BLOCKED.md` has the exact provisioning and funding
procedure. Known balances: Stage-1 payer `0x8cD059…34e7` has 13.72 USDC but only
0.000097 ETH; payee `0x3EE24C…08c2` has 6.28 USDC and 0 ETH.

**Screen capture was unavailable** — the browser pane does not composite frames
headlessly. The dashboard was still driven and verified programmatically (its rendered
output is in `artifacts/final-evidence/database/audit-state.txt`, showing real
ALLOW/DENY/ESCALATE from the real engine, and the DENY drill-down reading
"settlement: null — no payment request constructed"). `MANUAL_RECORDING_GUIDE.md`
covers the gap step by step.

**Attack H was also proven live**, not only in tests: against the running control
plane, unauthenticated `GET /escalations` returned 401 and the reviewer token returned
200, and the API bound `127.0.0.1` rather than `0.0.0.0`.

**CI is green.** Three runs failed before this was noticed, all at the install step.
pnpm 11 renamed `onlyBuiltDependencies` (list) to `allowBuilds` (map); the old key
is still PARSED and shows in `pnpm config list`, so it looked configured while doing
nothing, and pnpm 11 also promoted an ignored build from warning to hard error.
Local installs passed only because node_modules already existed. `packageManager` is
now pinned so CI and local cannot drift apart again, and setup-node's automatic
pnpm cache is disabled because it runs before corepack. CI now independently
reproduces every headline number on a clean Linux runner.

**Verified.** typecheck clean; `npm test` **363/363 across 72 suites**;
`npm run adversarial` 12/12 classes / 80 assertions; `npm run redteam` 9/9 / 60;
`npm run mutation` 12/12; sandbox PASS on seeds 42 and 1337; dashboard build clean;
contracts compile; `db:verify` all pass; `corepack pnpm audit` clean;
`evidence:verify` PASS.

Full detail: `docs/submission/REDTEAM_REPORT.md`,
`docs/submission/LIVE_EVIDENCE_BLOCKED.md`, `docs/submission/JUDGE_SCRIPT.md`,
`artifacts/final-evidence/`.

---

## Aug 19 — Finalist security remediation pass

Ran before any Phase 7 work and before any funded payment, against the security
remediation addendum. Baseline inspected first: the local checkout was 26 commits
behind `origin/main` and still sitting on the pre-hardening `4f974ff`. Fast-forwarded
to `6159474` and re-verified the stated baseline exactly — 260/260 tests across 48
suites, adversarial 12/12 classes and 78/78 assertions — before changing anything.

**What was actually still broken.** Most of the original financial-authority findings
were already closed. Six genuine gaps remained:

1. **Suspension was decorative.** `agent_identity.status` had existed since migration
   001 and nothing read it. A suspended agent kept full execution authority.
2. **`audit:verify` never touched the chain.** It re-hashed the record, compared it to
   `audit_anchor.record_hash`, then printed "on chain" because the same table said
   `status='anchored'`. Every value came from one database, so anyone who could write
   that table satisfied the verifier completely.
3. **The hostile agent owned final audit truth.** Its role held
   `UPDATE (settlement) ON audit_log` and both `INSERT` and `UPDATE` on `audit_anchor`,
   and its process loaded `AUDIT_ANCHOR_PRIVATE_KEY`.
4. **Terminal financial and audit state could diverge.** The executor set the
   reservation SETTLED and depended on an agent callback for the audit settlement and
   the anchor. A crash between them left SETTLED with `settlement IS NULL`.
5. **Reservation reuse verified nothing.** `reserveBudget` returned any live row
   matching `audit_id OR action_id` without checking amount, token, chain, agent,
   mandate version or currency.
6. **Both HTTP services bound `0.0.0.0`,** and `GET /escalations` was unauthenticated.

**What changed.** Suspension is now enforced at four independent points, including
inside the reservation transaction (so no capacity is ever committed for a suspended
agent) and again in the executor after the merchant's 402 response. A new
`verify-chain` module fetches the receipt from Base Sepolia, requires success, the
expected chain and contract, decodes the `Anchored` event, and demands recomputed ==
stored == chain-proven; RPC failure yields UNVERIFIED and a non-zero exit, never a
pass. Migration 011 revokes the agent's settlement and anchor privileges, adds an
`audit_finalization` outbox, and creates `cerberus_anchor_role` and
`cerberus_reconciler_role`. A single `terminalizeSettlement()` transaction commits
reservation status, audit settlement and the anchor request together, and both the
direct executor and the reconciler go through it. A new trusted anchor worker
(`npm run anchor`) drains the outbox under a lease, re-reading each record and
computing the digest itself — so the agent's one remaining power, `INSERT (audit_id)`,
cannot influence what gets anchored.

**Deliberate non-implementations, stated rather than hidden.** Confirmation depth is
reported by the audit verifier with a configurable threshold, but the *settlement*
path still treats exact successful inclusion as SETTLED: gating it would make every
demo ALLOW report `OUTCOME_UNKNOWN` for several blocks, which the addendum explicitly
said to avoid. The deployment boundary is loopback scoping, not service-to-service
authentication, and no public-internet safety is claimed anywhere.

**Two pre-existing problems found in passing.** `apps/reviewer` had never had its
dependencies installed, so `npm run typecheck` failed at baseline on a missing
`dotenv`. And `.gitignore` covered `.env.agent`/`.env.executor`/`.env.authorizer`/
`.env.reviewer` but not `.env.reconciler`. Both fixed.

**Dependency audit.** The remembered figure was "6: 4 high, 2 moderate". The actual
current audit was **8 (5 high, 2 moderate, 1 low)** — all transitive, all build-time,
dev-only or optional-and-unused, none on the payment path. All eight fixed by pnpm
`overrides` raising `postcss`, `nanoid`, `tmp` and `sharp`, with no framework major
version forced. Audit now reports no known vulnerabilities.

**Verified.** typecheck clean; `npm test` **330/330 across 61 suites**;
`npm run adversarial` **12/12 classes, 80 assertions** (no regression — Attack I);
`npm run redteam` **9/9 classes, 60 assertions**; dashboard production build clean
with eight routes; `AuditAnchor` compiles; `npm run db:verify` all checks pass;
`corepack pnpm audit` clean. The agent's *real* database login was additionally
tested directly and is denied settlement writes, anchor inserts, anchor updates and
finalization completion, while retaining only the narrow outbox enqueue.

**Not done, deliberately.** No funded payment. Phase 7 not started. The fresh
hardened-path live evidence run remains pending, and the README now says so in one
authoritative place rather than in scattered stale numbers.

Full detail: `docs/submission/SECURITY_REMEDIATION.md`,
`docs/submission/DEPENDENCY_AUDIT.md`.

---

## Aug 18 — Stage-2 Phase 3: durable replay and authority freshness

**Vulnerabilities closed.** Execution Authorization consumption no longer depends on
an executor process's in-memory `Set`: every issued authorization is recorded before
signing and consumed by a database compare-and-set shared across processes and
restarts. Human decisions now have a separate binding to the exact proposal, mandate
version, reviewer, decision, and expiry while the frozen Bible §7.5 `human_review`
shape remains unchanged.

**Freshness boundary.** The dashboard sends the mandate version it rendered; the API
refuses stale-page decisions and writes the audit review plus approval binding in one
transaction. The authorizer reconstructs historical context, then independently
re-evaluates current authority and approval freshness. The executor re-reads the
current mandate and approval immediately before capability consumption and payer
construction, so a mandate change or approval expiry after signing still fails before
the payment key is reached.

**Verification.** Migration `004_durable_replay_and_freshness` rolled down and back up
cleanly. The full suite passed **176/176 tests across 36 suites** against PostgreSQL
18.6 on port 5544. The database cases prove replay refusal after a pool/process restart,
exactly one winner among eight concurrent consumers, unknown/nonce-mismatched
authorization refusal, atomic review/binding claims, and approval proposal/version/TTL
freshness. Typecheck, the six-route dashboard production build, contract compile, and
`git diff --check` also pass.

**Environment.** Docker Desktop remained unable to start its Linux engine, as already
documented below. The existing Scoop PostgreSQL test cluster was hung but recovered
with a clean `pg_ctl stop -m fast` / `pg_ctl start`; application configuration and the
database under test remained the same.

**Next:** Phase 4 exact live x402 challenge binding.

---

## Aug 18 — Stage-2 Phase 2: atomic budget reservations

**Vulnerability closed.** Remaining budget was derived from audit rows that had
already SETTLED (`controls-repository/counters.ts`), keyed on `agent_id`. Two
concurrent proposals therefore read the same headroom and both passed the
rolling-window check. Separately, `POST /execution-authorizations` was unbounded: the
same `audit_id` twice minted two validly signed authorizations with different ids and
nonces, and the executor's one-shot store keyed on exactly those, so both passed and
both saw `settlement === null`.

**Schema.** New `payment_reservation` table (migration `003`). The frozen Bible
Section 7 tables are untouched — reservations are execution state, so they live
beside the records the way the Phase 5 anchor does. Partial unique indexes on
`action_id`, `audit_id` and `authorization_id` enforce idempotency in the database
rather than by application sequencing; `FAILED`/`EXPIRED` are outside the predicate so
a positively-known non-payment can legitimately retry.

**Locking.** `pg_advisory_xact_lock(hashtextextended(budget_key, 0))` where
`budget_key = mandate:<mandate_id>`. Locked on the mandate, not the agent, because two
agents under one corporate mandate share one budget. Transaction-scoped, so it is
released by COMMIT, ROLLBACK or a dead connection. The reservation commits before any
authorization is signed, so no DB transaction is ever open across x402.

**Invariant.** Per (mandate, currency):
`settled + active reserved + requested <= rolling_window.max_total`. All money
arithmetic stays in Postgres NUMERIC; amounts cross process boundaries as strings and
the reserved decimal is derived from the atomic amount so the two cannot drift.
Pre-Phase-2 settled audit rows with no reservation are counted once via a LEFT JOIN
anti-match, so history is neither lost nor double counted.

**Capacity release rules at this historical Phase-2 checkpoint.** Settled → SETTLED.
Rail reported failure → FAILED, released. Thrown settlement error → OUTCOME_UNKNOWN,
capacity held and NOT sweepable by TTL. Phase 5.1 later superseded the reported-failure
rule: after signed correlation exists, even a returned failure remains UNKNOWN until
chain reconciliation. Pre-broadcast RESERVED/AUTHORIZED expire on TTL, which bounds
reservation griefing; SUBMITTING and OUTCOME_UNKNOWN never do.

**Verification.** 143/143 tests, typecheck clean, dashboard production build clean,
three consecutive green suite runs. The concurrency tests were validated by mutation:
deleting the advisory lock fails tests 1/2/3; also dropping the partial unique indexes
fails test 4; removing the `bindAuthorization` CAS guard fails test 5. A first attempt
at tests 1 and 3 passed even with the lock deleted — a two-way race is timing
dependent and the pool was opening a connection for the second caller while the first
finished. Fixed with a pre-warmed pool, a shared barrier, and ten rounds per test.

**Environment note.** Docker Desktop's Linux engine would not start on this machine
(HTTP 500 from the API pipe), so the suite was run against a throwaway PostgreSQL 18.6
cluster on `5544` created with the scoop-installed binaries. `docker compose up -d`
remains the documented path and the schema is unchanged by this substitution.

---

## Blockers

**B1 — RESOLVED (Aug 14).** The demo-machine payer
`0x8cD0592123215f5510A5a0774323c765b9DA34e7` was funded on Base Sepolia. The
bare x402 payment settled, `AuditAnchor` deployed at
`0x2D2d857ce3c0d5d666B7e0dB3fE8067d4B4D6Ff7`, and two fresh supervised
runs settled and anchored successfully. Exact transaction hashes are in
`docs/submission/EVIDENCE.md`. The other Aug 13 wallet remains unused; do not
switch identities for the recorded demo.

**B-LIVE — RESOLVED (Aug 22).** Fresh hardened-path live evidence, blocked since Aug 19
on signer provisioning, is captured. Three signers provisioned into three separate
processes; DENY, ESCALATE with real human approval, ALLOW with real USDC settlement and
a genuine ambiguous-outcome reconciliation all recorded; 5/5 anchors proven on chain.
Package and hashes: `artifacts/judge-evidence/`. See the Aug 22 log entry.

**B2 — RESOLVED BY DESCOPE.** Judged runs use deterministic Proposed Action fixtures. The optional LLM intent path remains schema-validated but is not needed and never participates in the compliance decision.

**B5 — RESOLVED (Aug 7).** The seeded `time_window` would have DENIED the demo on a weekend.
Bible Section 7.2 sets `allowed_days: ["Mon".."Fri"]`, and the seed originally followed it exactly. Time window is check 4 in the Section 7.4 order, so on a Saturday or Sunday demo scenario 1 resolved to **DENY on rule `time_window`** instead of ALLOW — the engine behaving correctly, the demo looking broken. **Stage 2 judging is Aug 21-23, which spans Saturday Aug 22 and Sunday Aug 23.**
**Resolution, confirmed by the project owner:** seeded `allowed_days` widened to all seven days. Seed-value change only, same category as B4 — no schema field names touched and the `time_window` rule is still fully enforced and unit-tested (two tests cover it, including a Saturday DENY). `npm run db:verify` still prints a WARNING if the seed is ever narrowed to exclude the current day.

**B3 — EXTERNAL.** Names, affiliations, Student Group vs. Public Group, and portal submission state are human-only facts. They are not needed for the build and are intentionally not invented or stored in this repository.

**B4 — RESOLVED (Aug 7).** Seed mandate uses faucet-sized values: `per_transaction_max: 1.00`, `rolling_window.max_total: 3.00`, clean demo payment `0.50`, cap-breach attempt `5.00`. Schema field names are exactly as Bible section 7.2 — only the numeric seed values differ from the Bible's illustrative `1000`/`500`/`3000`, because testnet faucets cannot fund those.

---

## Log

### Aug 19 — Stage-2 Phase 6: consolidated adversarial proof

**Judge command.** `npm run adversarial` runs selected existing security assertions in
12 deliberate classes: hostile-agent/key isolation, reviewer impersonation, database
privilege attacks, forged authority, replay/duplicate execution, concurrent budget,
velocity concurrency, stale authority, x402 challenge mutation, merchant false
failure, merchant fake success, and crash/reconciliation. Each class names its required
test evidence; the runner parses TAP totals and fails on missing evidence, zero tests,
child failure, cancellation, or an assertion failure. PASS text is not hardcoded.

**Coverage strengthened.** The authenticated reviewer attack now also asserts that no
execution authorization row is created. A distinct post-signature timeout test proves
one signed request attempt becomes `OUTCOME_UNKNOWN`, retains capacity, and does not
retry.

**Measured verification.** The consolidated run passed **12/12 classes and 78/78
selected assertions**, with 0 failed, 0 skipped, and 0 cancelled. The full suite passed
**260/260 tests across 48 suites** against real PostgreSQL. Typecheck, the seven-route
dashboard production build, and the solc 0.8.36 compile of the 263-byte `AuditAnchor`
bytecode are clean.

**Not proven by Phase 6.** Fresh funded hardened-path Base Sepolia settlement and
authenticated dashboard ESCALATE evidence remain pending. Reconciled audit records do
not yet have durable anchor finalization; the reconciler login still inherits the
broader executor role; same-host filesystem compromise remains outside the prototype
process-isolation claim; and production finality would require a configurable
confirmation threshold. Phase 7 has not started.

**Next:** stop for approval, then capture fresh hardened live evidence. Do not begin
Phase 7 automatically.

### Aug 19 — Stage-2 Phase 5.2: chain-proven merchant success

**Trust gap closed.** The x402 SDK decodes the merchant's `PAYMENT-RESPONSE`, but its
`success: true` and transaction field no longer create terminal financial truth. The
executor now runs the persisted EIP-3009 correlation through the existing read-only
Base Sepolia evidence verifier before `markSettled()`. It requires the payer/nonce's
`AuthorizationUsed`, a successful receipt, and the exact token/from/to/value transfer;
the recorded transaction comes from chain evidence rather than the merchant header.

**Fail-closed behavior.** A fake transaction, wrong recipient, wrong amount, missing
or not-yet-indexed evidence, and RPC failure all become `OUTCOME_UNKNOWN`. Capacity
remains held and the existing fenced reconciler retries without constructing another
payment. No new secret or payment authority was added; the executor reuses its public
Base Sepolia RPC configuration and the keyless reader.

**Verification.** The new adversarial executor tests pass 41/41. The complete suite
passes **259/259 tests across 48 suites** against real PostgreSQL; typecheck, the
seven-route dashboard production build, and the solc 0.8.36 contract compile are
clean.

**Remaining boundary.** Reconciled records still need durable audit-anchor
finalization, and the reconciler login still inherits the broader executor database
role. Fresh funded hardened-path evidence remains pending. Phase 6 has not started.

**Next:** Phase 6 consolidated adversarial command. Stop before implementing it.

### Aug 19 — Stage-2 Phase 5.1: post-signature failure safety

**Regression closed.** A merchant response is not proof of non-payment after it has
received `PAYMENT-SIGNATURE`; it still holds a live EIP-3009 authorization. The
executor now maps valid settlement-failure responses, HTTP errors, malformed bodies,
timeouts, and other post-persistence exceptions to `OUTCOME_UNKNOWN`. It returns a
distinct 503 `OUTCOME_UNKNOWN` response to the agent, which independently refuses to
write or anchor any returned non-settled result.

**Database defense.** Migration 010 adds a trigger that rejects correlated
reservations entering `FAILED` except from a fenced `RECONCILING` row. Ordinary
`markFailed()` is additionally limited to SUBMITTING rows with no payment nonce, so
only preparation/persistence failures positively known to be pre-transport release
capacity. Correlated failure is terminal only after the chain reader proves the nonce
unused at strict EIP-3009 expiry.

**Adversarial evidence.** Tests cover a hostile valid failure after transmission,
later exact settlement with no second payment, expired-unused release, ordinary and
raw-SQL correlated failure attempts, malformed JSON, and HTTP 500. The full suite
passes **255/255 tests across 48 suites** against real PostgreSQL. Migration 010 rolls
down/up cleanly and typecheck passes.

**Remaining boundary.** Reconciled records still need a durable anchor-finalization
outbox before the final live demo, and the reconciler login still inherits the broader
executor database role. Neither weakens payment safety; both remain explicit hardening
items before final evidence/freeze. Phase 6 has not started.

**Next:** Phase 6 complete adversarial suite. Stop before implementing it.

### Aug 19 — Stage-2 Phase 5: durable `OUTCOME_UNKNOWN` reconciliation

**Protocol correlation.** Inspection of installed x402 v2.21.0 confirmed that the
Base Sepolia USDC exact scheme signs EIP-3009
`transferWithAuthorization(from,to,value,validAfter,validBefore,nonce)`. Before the
paid request may start transport, the executor commits payer, recipient, nonce,
payload hash, `validBefore`, and submission block. A failure to persist is positively
pre-transport and releases capacity; any throw after persistence becomes
`OUTCOME_UNKNOWN` and is never retried by the executor.

**Reconciliation.** Migration 008 adds durable correlation, `RECONCILING`, due time,
attempt count, lease token, and error state; migration 009 adds the exact recipient
and atomic terminal audit update. The keyless worker reads Circle USDC
`authorizationState`. Used is accepted as settlement only with the matching
`AuthorizationUsed` transaction, successful receipt, and exact token/from/to/value
transfer. Unused is safe failure only once the latest chain timestamp reaches the
strict `validBefore` boundary. Live authorization, cancellation/mismatched evidence,
or RPC failure stays UNKNOWN and retains capacity.

**Crash and concurrency safety.** Claims use `FOR UPDATE SKIP LOCKED`; rotating fencing
tokens prevent an expired worker from finalizing after a restart. Stale SUBMITTING
without correlation is safely unpaid because the prepared x402 request cannot touch
transport until its persistence callback returns true. UNKNOWN and RECONCILING remain
in both budget and velocity counts and are excluded from TTL expiry. Terminal
reservation plus Section 7.5 settlement commit in one transaction; terminal settlement
is first-writer-wins so a late HTTP failure cannot overwrite stronger chain evidence.

**Process and UI boundary.** `.env.reconciler` contains a distinct database login and
public RPC only. The worker does not parse root/operator or executor config and scrubs
inherited payment, authorization, reviewer, and anchor credentials. Agent-side
transport throws now report `settlement_unknown` without writing a false failed audit
or anchoring a non-terminal record. API/dashboard projections show SUBMITTING,
OUTCOME_UNKNOWN, RECONCILING, and reconciled terminal state beside—not inside—the
frozen audit JSON.

**Verification.** Migrations 008 and 009 each rolled down/up cleanly during
implementation and both are applied. The full real-PostgreSQL suite passes **249/249
tests across 48 suites**. Typecheck, seven-route dashboard production build,
263-byte contract compile, `db:verify`, migration status, and `git diff --check` pass.

**Remaining boundary.** A used nonce without the exact transfer proof intentionally
remains UNKNOWN for manual investigation. RPC downtime defers rather than guessing.
The reconciler atomically updates terminal audit settlement but does not itself submit
an on-chain audit anchor; fresh fully hardened settlement/anchor evidence remains
Phase 8. Host-level process isolation remains a deployment responsibility.

**Next:** Phase 6 complete adversarial suite. Stop before implementing it.

### Aug 19 — Stage-2 Phase 4: exact live x402 challenge binding

**Vulnerability closed.** The isolated executor no longer hands an unverified merchant
challenge to the x402 SDK. It first verifies the signed Execution Authorization, makes
one unsigned resource request, parses the actual x402 v2.21.0 `PaymentRequired`
response, and validates the selected requirement against the signed authority. The
comparison covers protocol version 2, `exact` scheme, CAIP-2 network, exact token
contract, atomic amount, payee, resource URL, USDC EIP-712 name/version, and `eip3009`
transfer method.

**Signer boundary.** Validation returns a branded, frozen challenge containing only
the exact matching offer. Authorization consumption and the reservation's
`SUBMITTING` transition occur only after that validation. Only then is the payer
factory invoked. The paid request is constructed directly from the pinned requirement;
it does not perform a second 402 fetch that could substitute a different offer.

**Adversarial evidence.** Mutated amount (5 USDC to 50 USDC), payee, token, chain,
resource, scheme, protocol version, EIP-712 domain, and transfer method all fail before
payer construction. Each refusal leaves the authorization unconsumed and the
reservation `AUTHORIZED`; a subsequent exact challenge can still execute once. A
multi-offer test proves that a malicious first offer is ignored and only the exact
matching offer is signed. The paid-retry test decodes the emitted payment header and
confirms its amount and payee came from that pinned challenge.

**Verification.** The full suite passed **225/225 tests across 45 suites** against real
PostgreSQL on port 5544. Typecheck, the seven-route dashboard production build,
263-byte contract compile, and `git diff --check` pass.

**Post-challenge freshness (Phase 4.1).** The unsigned merchant fetch is bounded at 10
seconds. After it returns, the executor re-resolves trusted state with a fresh clock
and re-verifies authorization expiry, current mandate, human approval, and reservation
binding immediately before consumption. The database consumption and submission CAS
operations enforce their own expiry boundaries. Delayed authorization expiry,
mid-fetch mandate revocation, delayed approval expiry, and a non-responsive merchant
all fail before payer construction. The expanded suite passes **232/232**.

**Remaining boundary.** `OUTCOME_UNKNOWN` retains capacity and prevents blind retry,
but no durable reconciler yet determines whether an ambiguous broadcast settled
(Phase 5). Host-level secret isolation remains a deployment responsibility. The fresh
funded hardened-path evidence run remains pending for Phase 8.

**Next:** Phase 5 `OUTCOME_UNKNOWN` reconciliation. Stop before implementing it.

### Aug 19 — Stage-2 Phase 3.5D: concurrent velocity enforcement

**Vulnerability closed.** Hourly velocity no longer depends on a settled-only
check-then-act counter. `reserveBudget()` takes a transaction-scoped advisory lock on
`velocity:<agent_id>` before the existing shared-mandate budget lock, checks financial
capacity first to preserve rule ordering, then counts hourly committed/executing
reservations. `SETTLED`, `SUBMITTING`, and `OUTCOME_UNKNOWN` always count;
unexpired `RESERVED`/`AUTHORIZED` count; `FAILED`/`EXPIRED` do not. Legacy settled
audits without reservations are included once.

**ESCALATE semantics.** If the serialized count reaches the mandate limit, no
reservation or Execution Authorization is created. The trusted control plane narrowly
promotes the raced ALLOW/OBSERVE audit to `ESCALATE` with rule
`velocity.max_transactions_per_hour`; the agent role cannot update those audit
columns. Orchestration waits for authenticated reviewer authority. Denial never
constructs settlement; a fresh approval bound to the exact proposal and mandate
permits one authorization retry with an explicit velocity override.

**Adversarial evidence.** At limit 1, two concurrent authorizer requests produce one
authorization and one promoted escalation. A 20-request burst at limit 5 produces
exactly five reservations and fifteen escalations. Repeated same-agent races use two
different mandate budget locks, proving the separate per-agent velocity lock rather
than accidentally relying on budget serialization. Mutation-checking removed that
lock and the test failed with two `created` outcomes; restoring it returned the test
to green. Real agent credentials receive SQLSTATE `42501` when attempting to forge the
promoted verdict.

**Verification.** Migration `007_concurrent_velocity_enforcement` rolled down and
back up cleanly. The full suite passed **202/202 tests across 41 suites** against real
PostgreSQL on port 5544. Typecheck, the seven-route dashboard production build,
263-byte contract compile, schema/demo verification, and `git diff --check` pass.

**Remaining boundary.** The executor still validates the intended target rather than
the merchant's exact live HTTP 402 challenge (Phase 4). `OUTCOME_UNKNOWN` still holds
capacity without reconciliation (Phase 5). Host-level secret isolation remains a
deployment responsibility.

**Next:** Phase 4 exact live x402 challenge binding. Stop before implementing it.

### Aug 19 — Stage-2 Phase 3.5C: mandate immutability/content freshness

**Vulnerability closed.** Migration `006_mandate_immutability` installs a PostgreSQL
trigger on every published mandate row. `mandate_id`, version, agent binding,
`effective_from`, scope, controls, default disposition, creator, and approver cannot
change for the same version. Policy changes must publish a new row/version. Only
one-way lifecycle closure is permitted: `active → superseded|revoked` and setting a
previously-null `effective_to` once.

**Adversarial evidence.** A real authorizer issues Execution Authorization under v17;
an attempted in-place spend-cap mutation then fails with SQLSTATE `23514` and
constraint `mandate_published_content_immutable` before the payment-key boundary. The
stored controls remain unchanged and authorization remains unconsumed. Separate cases
cover identity/version, agent binding, effective authority start, scope, default
disposition, creator/approver, valid lifecycle closure, and rejected reopening.

**Verification.** Migration 006 rolled down and back up cleanly. The full suite passed
**194/194 tests across 40 suites** against real PostgreSQL on port 5544. Typecheck,
the seven-route dashboard production build, 263-byte contract compile, schema/demo
verification, and `git diff --check` pass.

**Remaining boundary.** Lifecycle closure remains schema-owner/operator authority;
runtime application roles cannot update mandates. Transaction-count velocity is not
yet concurrency-safe (Phase 3.5D), the live 402 challenge is not yet bound (Phase 4),
and `OUTCOME_UNKNOWN` has no reconciler (Phase 5).

**Next:** Phase 3.5D concurrent velocity enforcement. Stop before implementing it.

### Aug 19 — Stage-2 Phase 3.5B: database privilege separation

**Vulnerability closed.** Migration `005_database_privilege_separation` creates
NOLOGIN agent, control-plane, and executor group roles, revokes PUBLIC access, and
grants only the table/column operations each process needs. Provisioning creates three
distinct LOGIN roles from `AGENT_DATABASE_URL`, `CONTROL_PLANE_DATABASE_URL`, and
`EXECUTOR_DATABASE_URL`, rejects schema/database-owner reuse, strips stronger inherited
URLs, and never prints passwords. The DB pool no longer parses the root `.env`, so an
agent import cannot capture the schema-owner URL.

**Authority split.** The agent writes immutable-on-conflict proposals, initial audit
rows, settlement audit state, and anchors. It cannot write `human_review` or
`human_approval`, mutate mandates, create/bind/transition reservations, issue
authorizations, or consume them. The trusted control plane owns review/approval,
reservation creation, and authorization issuance/binding. The executor owns one-shot
consumption and execution-state transitions. Demo reset/seed moved out of the agent
process into the trusted operator launcher.

**Verification.** Migration 005 rolled down and back up cleanly. Real-login attacks
for human approval, mandate mutation, authorization creation/binding, SUBMITTING, and
authorization consumption all returned PostgreSQL SQLSTATE `42501`; the permitted
agent → control-plane → executor path also completed. The full suite passed **191/191
tests across 40 suites** against PostgreSQL 16.14 on port 5544. Typecheck, the
seven-route dashboard production build, 263-byte contract compile, and
`git diff --check` pass.

**Remaining boundary.** The prototype still relies on process/config and filesystem
deployment hygiene rather than separate OS/container identities. Published mandate
contents remain mutable until Phase 3.5C; velocity concurrency remains Phase 3.5D.

**Next:** Phase 3.5C mandate immutability/content freshness. Stop before implementing it.

### Aug 19 — Stage-2 Phase 3.5A: reviewer authentication

**Vulnerability closed.** The agent-side `createAutoEscalationPort()` and its direct
decision POST were removed. `POST /escalations/:actionId/decision` now authenticates a
bearer reviewer credential before authority-state access and derives `reviewer_id`
from trusted API configuration rather than the request body. Dashboard clicks cross a
server-only Next.js route protected by a separate human reviewer login; browser
JavaScript never receives the API token. Deterministic demo approval moved to a
separate trusted reviewer process.

**Isolation evidence.** The agent scrubs accidentally inherited reviewer variables,
reads neither reviewer config nor credential files, and has no production decision
client. PostgreSQL endpoint tests prove missing/invalid credentials return 401/403
without writing either `human_review` or `human_approval`; a valid credential writes
both atomically with the server-controlled reviewer identity. DENY and unapproved or
denied ESCALATE still construct neither authorizer nor settlement.

**Verification.** 183/183 tests across 38 suites passed against PostgreSQL 18.6 on
port 5544. Typecheck, the seven-route dashboard production build, 263-byte contract
compile, and `git diff --check` pass. Phase 3.5A has no contract/schema migration.

**Remaining boundary.** The reviewer credential is separated by application config,
not an OS/container principal. More importantly, processes still share the same
powerful PostgreSQL role; Phase 3.5B must enforce the boundary with database grants.

**Next:** Phase 3.5B database privilege separation. Stop before implementing it.

### Aug 18 — Stage-2 Phase 1 signer isolation and Execution Authorization

**Built:** added `packages/execution-authorization` with strict signed-capability
schemas, deterministic proposal hashing, expiry and exact-field verification, and an
atomic process-local one-shot store. Added `apps/executor`, the only application that
loads `EXECUTOR_EVM_PRIVATE_KEY` or imports the payer. Added a trusted API authorizer
that re-reads and deterministically re-evaluates stored action/mandate/counter state
before signing. The agent now calls the authorizer and executor over bounded HTTP and
has no payer import or payment key. Runtime secrets are split across `.env.agent`,
`.env.authorizer`, and `.env.executor`; shared `.env` is public configuration only.

**Verified:** typecheck clean; **119/119 tests in 26 suites**; dashboard production
build clean with six routes; `AuditAnchor` compiles to 263-byte bytecode; `git diff
--check` clean. Adversarial tests refuse forged, expired, replayed, proposal-mutated,
mandate-mutated, reservation-mutated, chain-mutated, token-mutated, amount-mutated,
payee-mutated, and resource-mutated authorizations before payer construction. A
repository scan proves the agent reads only `.env.agent`, contains no payer/key
reference, and `DENY` reaches neither authorization nor execution.

**Not yet verified live:** this clean worktree has no `.env`, `.env.agent`,
`.env.authorizer`, or `.env.executor`, so no fresh funded settlement was attempted.
The Aug 14 hashes prove the older Stage-1 path, not the new signer boundary.

**Decisions:** the Bible §7 schemas remain untouched; Execution Authorization is a
separate security record. Phase 1 uses explicit `phase1_unreserved:<audit_id>` and
process-local replay state so it cannot accidentally claim Phase-2/3 guarantees.
Exact challenge binding and ambiguous settlement classification remain in their
fixed later phases. The agent-specific environment file was chosen so even a legacy
root `.env` payment key is never parsed into agent memory.

**Next:** migrate secrets on the funded demo machine without committing them, run the
four-service hardened path, and record fresh ALLOW/approved-ESCALATE hashes. Begin
atomic reservations only after that Phase-1 DoD evidence is green.

### Aug 14 — README clone-to-reproduction walkthrough

**Changed:** replaced the abbreviated setup block with a nine-step public walkthrough covering prerequisites, clone/install, environment creation, Postgres initialization, build verification, three service terminals, deterministic ALLOW/DENY/ESCALATE reproduction, the live human-review hold, funded x402 settlement, audit-anchor deployment, verification, expected outputs, and shutdown. The README explicitly separates the no-cost governance verification path from the testnet-funded settlement path and states that no LLM key is required.

**Verified:** every documented command maps to an existing package script; expected counts match the final checks (91/91 tests, 13/13 database checks, six dashboard routes, 263-byte contract bytecode). Markdown formatting and local links pass.

**Next:** no product code changed. The project owner approved publication as the second of two final commits to `main`.

---

### Aug 14 — final repository synchronization and cleanup

**Synchronized:** fast-forwarded local `main` from `2026fbe` to origin commit `b16970f`, which publishes the verified Base Sepolia settlement, contract deployment, two supervised runs, anchor transactions, final dashboard captures, and updated evidence manifest.

**Cleaned:** corrected final-state drift across README, Rules, PRD, Phases, demo script, Devpost copy, evidence manifest and runbook; recorded that the optional video visual edit was omitted; replaced Cloudflare-prone BaseScan links with equivalent Blockscout links; narrowed the root crash-dump ignore so it no longer masks `packages/core/`; ignored local video/PDF/temp outputs. The obsolete pre-rebrand `02-escalations.png` was moved recoverably to ignored `.local-trash/2026-08-14-final-cleanup/`; the final escalation drill-down and supervised-run manifest remain tracked.

**Verified:** `npm test` 91/91; typecheck clean; dashboard production build clean; `AuditAnchor` compiles to 263-byte bytecode; `db:verify` 13/13; no tracked secret candidates; no missing local Markdown links; GitHub, MAS and Blockscout evidence URLs return HTTP 200. This Linux clone's current database re-hashes 3/3 records but has 0/3 anchor transaction hashes, so it is not the final evidence database snapshot; the public chain manifest and screenshots from the Windows evidence machine are the durable evidence.

**Publication:** the project owner approved publishing the cleanup and README work to `main` as two deliberate commits on 14 August 2026.

**Next:** no further product code is planned. Only human-owned portal/team actions remain unless the project advances to Stage 2.

---

### Aug 14 — live Base Sepolia settlement and anchoring complete

**B1 resolved.** The configured payer was funded and `npm run phase1:preflight`
passed every check. The bare x402 payment settled 0.01 USDC in transaction
`0xed51af702ebc263f8296c1fc6cb677928880f4a4dc6eee7a05f69e14e99efab9`.

**Contract live.** `AuditAnchor` is deployed at
`0x2D2d857ce3c0d5d666B7e0dB3fE8067d4B4D6Ff7` by transaction
`0x2cb059b1671678ae8ade38edca8daaa29f8a9e44b758e60484993f3899cebd08`.
The deployment receipt succeeded and its 236-byte runtime is an exact byte-for-byte
match for the runtime compiled from this repository.

**Supervised proof.** Two fresh full runs each settled ALLOW, refused DENY before
x402 construction, blocked ESCALATE on a genuine cross-process dashboard decision,
then settled only after a real Approve click. All six audit records anchored. Every
one of the 11 settlement/anchor receipts returned `status = 0x1` from the public Base
Sepolia RPC. The final database state re-verifies 3/3 record digests and 3/3 anchors
with no tampering. Exact hashes and explorer screenshots are in
`docs/submission/EVIDENCE.md`.

**Runtime state.** Postgres recovered cleanly after an OS resource-exhaustion wedge;
merchant, API, and dashboard are healthy. Remaining work is human/submission work:
record or upload the video, fill team identity fields, and submit before the deadline.

---

### Aug 14 - submission PDF draft

**Built:** replaced the earlier report-style draft with an 11-page landscape CERBERUS supporting brief authored as standalone LaTeX/TikZ. The sequence now moves from control gap to native architecture, versioned mandate, deterministic evaluation, the three Section 9 outcomes, real human-review hold, audit evidence, verified build proof, adjacent-control comparison and a final evidence gate. The architecture shows DENY bypassing settlement, every terminal path reaching audit and the prototype trust boundary explicitly; scenario cards expose threshold versus actual values and the exact unknown-counterparty disposition field.

**Evidence status:** stale screenshots showing failed settlement, pending anchors, old branding or `Reconnecting` were not embedded. At build time the cover and closing evidence gate correctly stated that public-chain capture was pending. B1 subsequently resolved in commit `b16970f`, so that pending wording is now stale; the draft must not be uploaded as the final artifact without replacing it with the verified settlement and anchor evidence.

**Verified:** LuaLaTeX builds cleanly in two passes; all 11 pages were rendered and visually inspected at full resolution; page geometry is 960.01x540; all Noto fonts are embedded with Unicode mappings; PDF text extraction and five external link annotations pass. GitHub, MAS SAFR and hackathon URLs are embedded. Wording scan finds no SAFR-compliance claim, first-ever claim, rejected three-layers phrasing, internal Bible labels or unsupported live-settlement claim. The `.tex`, generated PDF and TeX auxiliaries are ignored locally under `output/pdf/`.

**Next:** keep the draft local as reference, or regenerate it from `docs/submission/EVIDENCE.md` under a final filename and re-render every page before any future upload.

### Aug 14 — pre-recording branding and final-evidence guard

**Changed:** dashboard sidebar now shows `CERBERUS` / `SAFR Runtime`; browser metadata is `CERBERUS — Compliance`; the Section 9 terminal and API startup banners identify CERBERUS while retaining SAFR Runtime as the implemented pattern. The architecture slide was regenerated with the CERBERUS title and visually verified at 1200×720; topology, dispositions, terminology, and the pre-execution constraint remain unchanged.

**Evidence safety:** `scripts/capture-evidence.ps1 -Final` now refuses final capture unless API/database health is green, the x402 facilitator responds, `AUDIT_ANCHOR_ADDRESS` is configured, ALLOW and approved ESCALATE have real settlement hashes, DENY has no settlement, and all three terminal records are anchored. The Audit Log `Live` frame remains a required manual real-browser capture because headless SSE cannot prove that state. PowerShell is unavailable on this Linux machine, so Harsh must execute strict capture on the Windows recording machine after pulling; the script's application inputs and record fields match the existing API schema.

**Verified:** `npm run typecheck` clean; `npm test` **91/91**; `npm run build --prefix apps/dashboard` clean. No governance, schema, settlement, or disposition behavior changed.

**Still external:** the funded run, contract deployment, real hashes, strict screenshots, and raw video must be produced on Harsh's machine because its funded `.env` cannot be transferred through Git.

---

### Aug 13 (later) — second machine rebuilt; submission pack written

**Note on the two Aug 13 entries.** This one and the entry below describe the same day on **two different machines**. Both are accurate. The consequence that matters is in B1: there are now two payer wallets and only the one whose private key is on the demo machine can settle. Pick the demo machine before funding anything.

**Environment rebuilt.** `.env` recreated from `.env.example` with a fresh dedicated testnet keypair (new `npm run wallets:new` script). Schema migrated and seeded; `npm run db:verify` **13/13**. merchant `:4021`, API `:4050`, dashboard `:3000` all verified responding.

**Postgres is no longer Docker on this machine.** Docker Desktop's Linux VM is broken here — the engine's init control API never responds, every `docker` command returns HTTP 500, and the WSL `docker-desktop` distro fails to mount (`getpwuid(0) failed`). A Docker Desktop restart and `wsl --shutdown` did not clear it. Repairing it needs a factory reset, which would destroy the unrelated containers on ports 5432/5433, so it was left alone. Postgres 18.6 was installed **user-locally via scoop** on the same port 5544 with the same role and database, so `DATABASE_URL` is unchanged and no application code knows the difference. `docker-compose.yml` is untouched and still correct on a working Docker host. Start/stop commands are in `docs/submission/RUNBOOK.md` §1.

**Verified.** typecheck clean; `npm test` **91/91**; dashboard production build clean; `npm run demo:script -- --thrice` three consecutive clean runs; and a **live escalation end-to-end** — a real Approve click on the dashboard unblocked a separate agent process, `human_review` persisted, x402 reached.

**Written.** `docs/submission/` — `DEVPOST.md` (paste-ready copy for every mandatory field, mapped to the published judging criteria, with prior-work and sponsor-tool disclosures that the earlier internal checklist omitted), `DEMO_SCRIPT.md` (100s narration, shot list, two settlement variants), `EVIDENCE.md` (manifest + slots for the on-chain hashes), `RUNBOOK.md` (cold start, failure modes). Seven dashboard evidence PNGs captured to `docs/assets/evidence/` via the new `scripts/capture-evidence.ps1`.

**Corrected.** Deadline is **11:59 PM SGT / 21:29 IST**, from the organizer's rules text; the 21:15 IST figure came from the schedule banner. Test count reconciled to 91.

**Still blocked:** B1 only. On this machine, fund `0x8cD0592123215f5510A5a0774323c765b9DA34e7`.

---

### Aug 13 — local runtime environment restored (first machine)

**Built:** recreated the corrupted one-byte `.env` from `.env.example` with dedicated, separate testnet-only payer and merchant identities. `.env` is gitignored and mode 600; no private key was printed or placed in tracked files.

**Working:** Postgres is healthy on `:5544`; migrations current; seed loaded; `db:verify` 13/13. Merchant `:4021`, API `:4050`, and dashboard `:3000` are running and respond successfully. Merchant returns a real HTTP 402 challenge; API returns the new agent identity, zero counters, and active mandate. x402 facilitator and Base Sepolia RPC are reachable.

**Blocked:** preflight fails only on external balances: payer has 0 Base Sepolia ETH and 0 Base Sepolia USDC. `audit_anchor_configured=false` until the funded payer deploys `AuditAnchor`.

**Next:** fund payer `0x0fe2676DcBA5aBc648BF46403dCc24BBdF90f824`, rerun preflight, then execute the bare Phase 1 settlement.

---

### Aug 13 — repository recovery and Phase 9 architecture asset

**Recovered:** eight tracked files that had become zero-byte local files were restored exactly from intact `HEAD` (`59bc765`); `main` and `origin/main` were already identical, so no source code was missing from GitHub.

**Published asset prepared:** selected the enterprise-style 16:9 architecture slide, embedded it in the README, and ignored `core`, `core.*`, and `.local-trash/`. Empty placeholder files, duplicate artwork, and seven crash dumps were moved into the ignored `.local-trash/2026-08-13-prepush/` quarantine; none are part of the repository.

**Verified:** `npm run typecheck` clean; `npm test` **91/91**; `npm run build --prefix apps/dashboard` clean. A prior 92-test result included an empty untracked `feed.test.ts` and was not the canonical suite count.

**Next:** record Phase 8 demo video, complete Phase 10 submission, and resolve B1 for explorer-verifiable settlement/anchor evidence.

---

### Aug 7 — Review hardening (atomic escalation, pay throw path, dashboard §7.1 / Design gaps)

**Fixed**
1. `claimAuditHumanReview` — `UPDATE … WHERE human_review IS NULL`; API returns 409 on lost race / double-click.
2. Orchestrator — thrown `pay()` becomes `{status:"failed"}`; settlement write + `finalize` always run.
3. Agent page — `owner_org` + `wallet_address` (Bible §7.1).
4. Drill-down — threshold vs actual from pinned mandate version (scenario 2: `1` / `proposed 5`).
5. Audit Log summary — live `rolling_total_24h / max_total` strip (Design §5.1).

**Left alone (demo-safe):** rolling_window.window parse, evaluate→settle locking, overnight time windows, API auth, facilitator probe, SSE-only settlement push.

---

### Aug 7 — Phase 7: Section 9 demo script + reset (disposition DoD met thrice; settlement blocked by B1)

**Built**
- `packages/db` — `resetDemoState()` + `npm run demo:reset` (truncates audit_anchor / audit_log / proposed_action, re-seeds agent + mandate).
- `apps/agent/src/cli/section9.ts` + `scripts/demo.ts` launcher — `npm run demo:script` runs clean → cap_breach → new_counterparty with pre-staged approval, asserts dispositions/rules/interception/persistence/anchor digests.
- Flags: `--thrice`, `--no-reset`, `--live` (dashboard Approve for scenario 3).

**Verified**
- `npm run demo:script -- --thrice`: three consecutive clean runs, ~1s each after reset. ALLOW / DENY(`spend_caps.per_transaction_max`, x402 never constructed) / ESCALATE→approved with human_review persisted.
- Typecheck clean; 87/87 tests still green.

**Not met (B1 only)**
- DoD line "settlement hash within seconds" — settlement status is `failed` on ALLOW and approved-ESCALATE until the wallet holds Base Sepolia USDC + gas. Script reports this explicitly rather than narrating over it.

**Decisions**
- Pre-staged approval is the default (Bible §9); `--live` is the stretch path already proven in Phase 6.
- Demo script drains the anchor queue before asserting digests — anchoring is async, so a naked `getAnchor` right after `finalize` raced and flaked once.

---

### Aug 7 — Phase 6: API + dashboard (COMPLETE, DoD met)

**Built**
- `apps/api` — Express on `:4050`. `GET /audit`, `GET /audit/stream` (SSE + 1s Postgres poll), `GET /audit/:id`, `GET /escalations`, `POST /escalations/:actionId/decision`, `GET /mandates/active`, `GET /agents/:id`, `GET /health`.
- `apps/agent` — `createDbEscalationPort` + `npm run demo -- --live-escalation` so a dashboard Approve unblocks a waiting agent across processes.
- `apps/dashboard` — Next.js per `Design.md`: Audit Log (rule column first-class, disposition colours, live indicator), drill-down (§7.5 near-direct), Escalations (one-click Approve/Deny), Mandate, Agent + counters.
- `packages/db` — `listAuditFeed`, `listPendingEscalations`, `getAuditLogRecordByActionId`, `countByDisposition`.

**Verified**
- API smoke against live Postgres: `/health` up, `/audit` returns prior demo rows, `/escalations` empty when none pending.
- `next build` succeeds for all six routes.
- 87/87 tests green (includes API decision-body tests).

**Decisions**
- **SSE + 1s poll instead of WebSocket.** Visually identical in a demo; Phases.md descope ladder item 3. The poll also catches writes from the separate agent process.
- **DB-backed escalation wait** rather than sharing the in-memory registry across processes. API writes `human_review`; agent polls that column. Orchestrator unchanged.

**Verified end-to-end (Aug 7 evening)**
- `npm test` 87/87; typecheck clean; `db:verify` 13/13; `next build` green.
- Full demo: ALLOW / DENY (`spend_caps.per_transaction_max`, x402 never constructed) / ESCALATE→approved.
- `--deny-escalation`: x402 never constructed.
- `--live-escalation`: API `POST .../decision` approved `action_9ac6a9c4`; agent unblocked; `x402 reached yes`.
- Feed exposes DENY rule path; drill-down returns `{record, action, anchor}`; SSE emits audit events; dashboard routes `/`, `/escalations`, `/mandate`, `/agent`, `/audit/:id` all 200.
- `audit:verify` 8/8 digests reproduce; tamper-demo detects DENY→ALLOW rewrite.

**Not done / expected gaps**
- Settlement still fails (B1 — unfunded wallet). Anchors pending on chain for the same reason.
- Projector legibility check belongs to Phase 7.

---

### Aug 7 — Phase 5: audit log write path + immutability anchor (code complete; 2 of 4 DoD items met, 2 blocked by B1)

**Built**
- `packages/audit-log` — `canonical.ts` (deterministic JSON + `auditRecordHash`), `anchor.ts` (viem client for the contract), `queue.ts` (the asynchronous, non-blocking anchor path), `repository.ts` (the `audit_anchor` table), `audit-log.ts` (the facade the agent uses).
- `contracts/AuditAnchor.sol` + `compile.ts` (solc, in memory — no artifacts on disk) + `deploy.ts`. Contract is 263 bytes of bytecode and stores nothing but a `bytes32` digest.
- `packages/db/migrations/002_audit_anchor.{up,down}.sql` — one row per record: `record_hash`, `anchor_tx_hash`, `status`, `error`.
- `npm run audit:verify` — re-hashes every stored record against its digest. `npm run audit:tamper-demo` — edits a real record, shows the digest break, and rolls back.
- `apps/agent/src/audit.ts` now delegates to `@safr/audit-log`; the CLI drains anchors and prints them.

**Verified working (84/84 tests; 32 new)**
- **DoD 1 — record shape.** All three scenarios write records matching Section 7.5 field-for-field, with `rule_triggered` populated for DENY (`spend_caps.per_transaction_max`) and ESCALATE (`counterparty_policy`) and explicitly `null` for the clean ALLOW.
- **DoD 3, off-chain half — re-hashing reproduces the digest.** `npm run audit:verify` reports 3/3. Proven the hard way rather than by assertion: `audit:tamper-demo` flipped a stored DENY to ALLOW and the digest moved from `0x4ff1b60c…` to `0x53831020…`; after rollback it returned to `0x4ff1b60c…`. Tests also cover tampering with `disposition`, `reason`, `rule_triggered`, `mandate_version`, `evaluated_at`, and attaching a forged settlement to a denied record.
- **DoD 4 — anchoring cannot break a disposition.** Covered by six tests: a broken RPC, a chain call that never resolves, a dead database, a failure while recording the failure, and anchoring being unconfigured. In every case `enqueue()` returns immediately and `drain()` does not reject. The digest is always persisted *before* the network call, so an RPC outage still leaves something verifiable.
- Migration 002 applies, rolls back and re-applies cleanly.
- The hand-written ABI is asserted equal to solc's output, so `abi.ts` cannot drift from the Solidity and start reverting at runtime.

**Decisions**
- **Anchoring happens at the record's TERMINAL state, not at creation.** A record is mutated after it is written — `human_review` on an escalation, `settlement` when a payment resolves — so anchoring at creation would anchor a digest the stored record no longer matches, and the DoD's "re-hashing the stored record reproduces the anchored hash" would be false for every ALLOW. `AuditPort.finalize(audit_id)` is therefore called at each terminal point in the orchestrator, including DENY. Not spelled out in the Bible; flagged because it changes when the anchor is written.
- **`finalize()` re-reads the record from Postgres before hashing** rather than hashing the in-memory copy. The digest is then over exactly the bytes a verifier will later read back, which closes the gap where the two could differ.
- **Canonical JSON is hand-rolled (about 30 lines), not a dependency.** Keys sorted recursively, no whitespace, array order preserved, `null` kept. Keeping `null` matters: dropping it would let a clean ALLOW (`rule_triggered: null`) and a rule-triggered record collide.
- **The contract is permissionless and does not deduplicate.** Access control would add a failure mode to a demo-critical path for nothing — the digest is meaningless without the off-chain record, and a duplicate anchor is harmless.
- **`solc` added as a devDependency of `contracts/`.** Bible Section 8 requires a testnet contract and a contract requires a compiler; it is build-time tooling, not a runtime stack change (Rules R2).
- **`--test-timeout=60000` added to `npm test`.** A test of mine hung the suite indefinitely because node:test has no default timeout; a hang should fail, not stall.

**Not working / not done**
- **DoD 2 (ALLOW record carries a real `settlement.tx_hash`)** — not met. Settlement still fails on insufficient balance; the DENY record's `settlement` **is** correctly `NULL`, which is the other half of that item and is verified in the database.
- **DoD 3, on-chain half (each record has an anchor tx hash)** — not met. All three records sit at `status = 'pending'` with digests computed and stored; nothing has been written to Base Sepolia because the wallet has no gas.
- Both are **B1 only**. `AuditAnchor.sol` has never been deployed, so it has never executed on chain. The deploy script refuses with a clear message on a zero balance rather than failing obscurely.

---

### Aug 7 — Phase 4: engine wired in front of x402 (COMPLETE, DoD met)

This is the phase that makes the project what it claims to be. The interception constraint is now a **structural, tested property**, not a convention.

**Built**
- `apps/agent/src/orchestrator.ts` — `runAction(action, deps)`. Resolves the mandate at `proposed_at` → `evaluate()` → writes the audit record → returns early on DENY and on an unapproved ESCALATE → only then reaches settlement. Reads top to bottom as the Architecture 2.2 sketch.
- **Historical Stage-1 boundary, superseded Aug 18:** `apps/agent/src/settlement/`
  was then the only module outside `packages/x402-client` allowed to import the x402
  client. It now contains HTTP clients only; `apps/executor` is the sole payer importer.
- `apps/agent/src/intent-generator.ts` — Anthropic Messages API over plain `fetch` when `ANTHROPIC_API_KEY` is set, fixtures otherwise. Both validated against the Section 7.3 schema, so nothing downstream can tell which produced an action.
- `apps/agent/src/escalations.ts` — `createEscalationRegistry()` (a real hold, resolved by `submitDecision`; Phase 6's API replaces it without touching the orchestrator) and `createAutoEscalationPort()` for the scripted run.
- `apps/agent/src/audit.ts` + new writes in `packages/db` — `insertProposedAction`, `insertAuditLogRecord`, `updateAuditSettlement`, `updateAuditHumanReview`.
- `apps/agent/src/cli/run.ts` — `npm run demo`, all three Bible Section 9 scenarios.

**Verified working (52/52 tests; 23 new)**
- **The DoD assertion, stated three ways:** on DENY, `pay()` call count is 0, the settlement port's *construction* count is 0, and `settlementAttempted` is false. Construction is tracked separately from invocation precisely because the DoD distinguishes "the payment failed" from "the payment was never attempted".
- On ESCALATE, `pay()` is 0 while the action is held (checked mid-flight, with the registry showing the action pending), then exactly 1 after approval, and 0 forever if the reviewer denies.
- **Database evidence, not just test doubles:** after a live run the DENY row's `settlement` column is `NULL` while ALLOW and approved-ESCALATE rows have a settlement object. A payment that was built and discarded could not produce that.
- **Structural scans over the whole repo:** `@safr/x402-client` is imported from `apps/agent/src/settlement/` and nowhere else; the raw `@x402/*` SDK appears only in its own package and the merchant; and nothing patches global `fetch`, reassigns `fetch`, uses `http-proxy`/proxy agents/`setGlobalDispatcher`, or patches `XMLHttpRequest`.
- Further scans: the merchant contains no governance logic, the intent generator never touches a mandate or the engine, and no LLM reference exists anywhere in the decision path.
- **The scanner was validated against a deliberate violation.** A temporary file with a stray x402 import and a patched `globalThis.fetch` made exactly the two expected tests fail; removing it returned the suite to green. A guard that never fires proves nothing, so this was checked rather than assumed.
- End-to-end from the CLI: ALLOW (rule `null`), DENY on `spend_caps.per_transaction_max` with x402 never reached, ESCALATE→approved settling, ESCALATE→denied with x402 never reached.

**Decisions**
- **`settlement` is injected as a FACTORY, not an instance.** On DENY the factory is never called, so the settlement module is not merely unused — it is never constructed. Nothing capable of building an HTTP request comes into existence on a denied action. This is a stronger reading of Bible Section 6 than "don't call pay", and it is what the `constructedCount` assertion pins.
- **`OBSERVE` does not block settlement.** Bible Section 4 and PRD 4.3 define it as "log without gating", so treating it as a soft DENY would silently change its meaning. No seeded rule emits it; the branch exists so that a mandate configuring it behaves as documented.
- **A missing mandate is refused (`no_mandate`), not allowed.** An absent mandate must never read as an absent limit.
- **The Section 7.5 Postgres write path was built now rather than in Phase 5.** Phase 4's DoD requires all three dispositions to reach their terminal state end-to-end, which is only demonstrable if decisions are recorded. The record shape written is already the final Section 7.5 shape, so Phase 5 adds the anchor and the event stream on top instead of reworking it. Deliberate, small pull-forward — flagged because Phases.md assigns these writes to Phase 5.
- **No LLM SDK dependency.** The Anthropic call is one HTTP POST via `fetch`; the approved stack is closed (Rules R2) and a package for a single request is added risk, not saved time.
- **The audit record copies `mandate_version` at decision time**, so a later mandate edit cannot retroactively change the record of a past decision.

**Not working / not done**
- Settlement still fails with insufficient balance on the ALLOW path — blocker **B1** only, unchanged. The CLI states this plainly rather than papering over it. Everything upstream of the payment is proven.
- Intent generation runs in `fixture` mode (blocker **B2**). The LLM path is written but has never executed against a real key.

---

### Aug 7 — Phase 3: Disposition Engine + Controls Repository (COMPLETE, DoD met)

**Built**
- `packages/disposition-engine` — `evaluate(proposed_action, mandate, counters) -> Disposition`. The Bible Section 7.4 order is a single `CHECKS` array read top to bottom; each check is its own file returning a `Disposition` to stop or `null` to fall through. The order is legible in one screen, which matters because the ordering *is* the design argument.
- `packages/controls-repository` — `getActiveMandate(agent_id, at)` (wraps the `@safr/db` query) and `getCounters(agent_id, at)`, plus `loadEvaluationContext` returning both.
- 29 unit tests, `npm test`.

**Verified working (29/29 tests, plus 3 new checks in `npm run db:verify`)**
- One test per Section 7.4 branch, **including the two the demo never hits** — `time_window` (both the hours case and the allowed_days case) and `velocity`.
- Both Section 7.4 corrections are covered and guarded against regression: `scope.currencies` is actually enforced, and every triggered path populates a non-null `rule` (a table-driven test walks all seven rules; only the clean ALLOW is null).
- **Generality proof for demo scenario 3:** flipping `unknown_counterparty_disposition` to DENY and then OBSERVE changes the outcome with zero code change, while `reason` and `rule` stay identical. A second test adds `merchant_new` to the allowlist and gets ALLOW. Nothing about `merchant_new` is special-cased.
- **Ordering tests**, since the order is load-bearing: an action breaching both the cap and the allowlist resolves DENY on the cap, not ESCALATE on the counterparty.
- **Determinism:** identical inputs give identical output; inputs are not mutated; a narrow time window gives the same answer regardless of when the suite runs (proves it reads `proposed_at`, not the wall clock).
- **Purity, machine-verified rather than asserted:** the engine's only runtime dependency is `@safr/core` (types), its production imports are `@safr/core` plus its own relative files, and a scan for `fetch`, `require(`, `Date.now`, `Math.random`, `process.env`, `new Pool` and `axios` finds nothing.
- **Seed/engine drift guard:** `db:verify` now feeds the mandate **as actually stored in Postgres** to the real engine and asserts the three Bible Section 9 outcomes (ALLOW / DENY on `spend_caps.per_transaction_max` / ESCALATE on `counterparty_policy`). The unit tests use an in-memory fixture, so without this the seed and the engine could drift and it would first surface during the live demo.

**Decisions**
- **`node:test` as the runner, no new dependency.** Rules R2 permits a test runner; Node's built-in avoids adding Vitest/Jest to a stack the Bible fixed.
- **Counters are injected, never fetched by the engine.** This is what makes purity real rather than a claim, and it is why the counter definition can change without touching the engine.
- **Counter basis: settled transactions only, for both counters.** Bible Section 7.4 names `get_rolling_total` and `get_hourly_tx_count` without defining what counts. Settled spend was chosen because it is the one definition that is one sentence to a compliance officer — the money that actually left the account. A denied proposal and a failed settlement both moved nothing, so neither consumes budget or velocity allowance. Judgment call; flagged here because it is not in the Bible.
- **Velocity uses `>=`, spend caps use `>`.** The velocity counter is transactions already recorded, so at the cap one more would exceed it. The spend caps compare the projected total including the proposed amount, so `>` is correct there. A test pins the exact-boundary case (2.50 spent + 0.50 proposed against a 3.00 cap is ALLOW).
- **The engine test fixture duplicates the seeded mandate rather than importing it.** Importing would give `@safr/disposition-engine` a dependency on `@safr/db` and destroy the purity guarantee. The duplication risk is neutralised by the drift guard in `db:verify` described above.
- **`OBSERVE` is reachable only through mandate configuration**, per the Step 1 decision: supported in the schema and exercised by one test, never emitted by the seeded demo mandate.

**Not working / not done:** nothing in Phase 3. The counters have no integration test yet because `audit_log` is still empty — that arrives with Phase 5, and the queries are exercised end-to-end in Phase 4.

---

### Aug 7 — Phase 2: Postgres schema (COMPLETE, DoD met)

**Built**
- `packages/core` — zod schemas + inferred types mirroring Bible Sections 7.1, 7.2, 7.3, 7.5 field-for-field, plus the disposition enum (`ALLOW`/`DENY`/`ESCALATE`/`OBSERVE`).
- `packages/db/migrations/001_init.{up,down}.sql` — `agent_identity`, `mandate`, `proposed_action`, `audit_log`. Nested objects (`scope`, `controls`, `payload`, `human_review`, `settlement`) are JSONB so the Bible's shape is preserved verbatim rather than flattened. `mandate` PK is `(mandate_id, version)`; `audit_log` has a composite FK to `(mandate_id, mandate_version)`.
- `packages/db/src/migrator.ts` + `cli/migrate.ts` — up/down/status. Each migration runs in a transaction together with its bookkeeping insert, so a failure cannot leave a half-applied schema recorded as successful.
- `packages/db/src/repository.ts` — `insertAgentIdentity`, `getAgentIdentity`, `insertMandate`, `getMandate`, `getActiveMandate(agent_id, at)`.
- `packages/db/src/seed-data.ts` + `cli/seed.ts` — `agent_treasury_01` and `mandate_001` v1.
- `packages/db/src/cli/verify.ts` — proves the Phase 2 DoD by running it.

**Verified working (10/10 checks via `npm run db:verify`)**
- All four tables have **exactly** the Bible Section 7 column names, no more and no fewer.
- `mandate` round-trips Postgres → zod with **deep equality** against the source object: zero renaming, zero shape loss. Confirmed visually too — the stored JSONB shows `unknown_counterparty_disposition`, `per_transaction_max`, `rolling_window.max_total`, `max_transactions_per_hour` etc. under their exact Bible names.
- `getActiveMandate` honours effective ranges: returns null before `effective_from`, v1 inside its range, v2 after v1's `effective_to`, and treats `effective_from` as inclusive / `effective_to` as exclusive at the boundary.
- Migration rolls back cleanly (only `schema_migrations` remains) and re-applies cleanly.

**Decisions**
- **Timestamps parsed to ISO strings at the driver level** (`pg.types.setTypeParser` for OIDs 1114/1184 in `pool.ts`) instead of returning JS `Date`. The Bible Section 7 schemas are string-based, so a row read straight from Postgres validates with no conversion layer — which is what makes the deep-equality round-trip test possible.
- **Money values live inside JSONB, never in a `NUMERIC` column.** `pg` returns `NUMERIC` as a string, which would break the numeric schema fields; JSONB numbers come back as JS numbers. Avoids a whole class of silent type drift.
- **The Phase 5 on-chain anchor hash is deliberately NOT a column on `audit_log`.** Architecture.md 6.1 says it is stored "alongside the record"; a separate table keeps `audit_log` exactly as Bible Section 7.5 defines it (Rules R4 forbids adding fields).
- **`packages/db` holds the migrations rather than a top-level `db/` directory.** Architecture.md section 4 proposed `db/migrations/` at the root, but the runner needs to declare `pg` and `@safr/core` as dependencies, which only a workspace package can do. Layout detail only — no schema or behaviour change.
- **`getActiveMandate` lives in `packages/db` (data access); Phase 3's `packages/controls-repository` will wrap it** rather than re-implement the query.
- **Added `pg` to the approved dependency list.** Bible Section 8 mandates Postgres, and Postgres needs a driver; `pg` is a driver, not an ORM (Rules R2 forbids ORMs). Not a stack substitution.

**Not working / not done:** nothing in Phase 2. Note B5 below — the seeded `time_window` is Mon-Fri per the Bible, which will DENY the demo on a weekend.

---

### Aug 7 — Toolchain fix: pnpm was deleting itself mid-install

**Symptom:** `pnpm install` purged `node_modules`, which contained the npm-installed `pnpm` it was running from, killing itself with `Worker pnpm#6 exited with code 1` and leaving a broken tree.

**Fixes**
- **`pnpm` removed from root `devDependencies`.** It is now always run from the npx cache: `npx --yes pnpm@10.34.5 install`. Nothing the installer might delete can be the installer.
- **All root scripts call `tsx` directly** (`tsx packages/db/src/cli/migrate.ts up`) instead of nesting `pnpm --filter ...`. Day-to-day commands are therefore plain `npm run <script>`; pnpm is only needed for installing.
- **`onlyBuiltDependencies: [esbuild]` and `confirmModulesPurge: false` moved from `.npmrc` to `pnpm-workspace.yaml`.** pnpm 10 relocated these settings; in `.npmrc` they were silently ignored, which is why esbuild's postinstall kept being skipped and why installs kept blocking on a TTY prompt.

---

### Aug 7 — Phase 1: bare x402 payment (code complete, blocked on funding)

**Built**
- `apps/merchant` — `@x402/express` resource server standing in for the payee. Routes `GET /pay/{merchant_xyz,merchant_abc,merchant_new}` (the three Bible section 9 counterparties), plus an unprotected `/health` used by preflight. Contains no governance logic.
- `packages/x402-client` — `src/pay.ts` exposes `createX402Payer()` → `payer.pay({counterparty, amount, reference})`. The only module that touches x402.
- `packages/x402-client/scripts/preflight.ts` — checks env, payer key, Sepolia ETH balance, Base Sepolia USDC balance, merchant reachability, facilitator reachability. Reports exactly what is missing.
- `packages/x402-client/scripts/phase1-pay.ts` — the Phase 1 DoD script. Fires one payment, prints tx hash + explorer URL.

**Verified working**
- Merchant boots and serves a correct HTTP 402 challenge. Decoded `PAYMENT-REQUIRED` header shows `scheme: exact`, `network: eip155:84532`, `amount: "10000"` (= 0.01 USDC at 6 decimals), `asset: 0x036CbD53842c5426634e7929541eC2318f3dCF7e` (canonical Base Sepolia USDC), correct `payTo`.
- Dynamic per-request pricing works — `?amount=0.01` correctly became `10000` atomic units.
- Preflight passes on env, key derivation, merchant reachability and facilitator reachability; on-chain balance reads against `https://sepolia.base.org` succeed.
- `pnpm phase1` against the unfunded throwaway wallet fails with exactly `payment_required: invalid_exact_evm_insufficient_balance`. This is the informative outcome: the client built the payment payload, signed it, sent it, the merchant forwarded it to the facilitator, and the facilitator verified and rejected it **solely** for lack of USDC. Everything except funding is proven.
- `npx pnpm typecheck` clean across the workspace.

**Not working / not done**
- Phase 1 DoD (a real settlement hash) is not met. Blocked by B1 only.

**Decisions**
- **Dynamic per-request pricing on the merchant, rather than a fixed price per route.** Bible section 9 requires the agent to pay the amount it proposed, so the payee must be able to charge a per-request amount; `PaymentOption.price` accepts a function of the request context. Implemented now (about 8 lines) to avoid reworking the merchant in Phase 4. Judgment call, traces to section 9.
- **All three demo counterparties defined as data, not three code paths.** Adding a counterparty is a list entry. Keeps the system general rather than scripted, per Bible section 7.2's design note.
- **`SettlementResult` returns `{status, tx_hash, rail, settled_at}`** — deliberately the exact shape of the `settlement` object in Bible section 7.5, so the Phase 5 audit write path can store it without reshaping.
- **Deleted `package-lock.json`.** `npm install` is only the bootstrap that provides pnpm; `pnpm-lock.yaml` is the real lockfile. Two lockfiles in one repo is a footgun.
- **Wrote `README.md`** (was empty). Bible section 11 lists the GitHub repo as a recommended Stage 1 submission link, so the repo needs to be presentable.

**API notes for whoever picks this up** (x402 v2 differs from some published examples):
- Client: `x402Client`, `x402HTTPClient` from `@x402/core/client`; `wrapFetchWithPayment` from `@x402/fetch`; `registerExactEvmScheme(client, { signer, schemeOptions })` from `@x402/evm/exact/client`.
- Server: `paymentMiddleware(routes, server)` and `x402ResourceServer` from `@x402/express`; `HTTPFacilitatorClient` from `@x402/core/server`; `registerExactEvmScheme(server, {})` from `@x402/evm/exact/server`.
- Types `Network` and `SettleResponse` come from `@x402/core/types`, **not** `@x402/core/server`.
- The settlement tx hash is `SettleResponse.transaction`.
- `HTTPAdapter.getQueryParams` is optional — call it as `getQueryParams?.() ?? {}`.

---

### Aug 7 — Phase 0: prerequisites and repo skeleton

**Built**
- pnpm workspace monorepo per `Architecture.md` section 4: `pnpm-workspace.yaml`, root `package.json`, `tsconfig.base.json`, `tsconfig.json`, `.gitignore`, `.npmrc`, `.env.example`.
- `docker-compose.yml` with Postgres 16 (container only; no schema yet — that is Phase 2).

**Working:** workspace installs and typechecks; Postgres 16.14 container healthy and accepting connections; `.env` confirmed gitignored (`git check-ignore` passes, `git status` does not list it).
**Not done:** the DoD item "payer wallet's USDC balance confirmed non-zero by an on-chain read" fails — the read works, the balance is zero. Blocked by B1.

**Decisions**
- **pnpm installed as a local devDependency, invoked via `npx pnpm`.** `corepack enable pnpm` fails here with `EACCES` symlinking into the nvm bin directory outside the workspace. This keeps the stack exactly as declared in `Rules.md` R2 (pnpm workspaces, not npm workspaces) without elevated permissions. Bootstrap is `npm install && npx pnpm install`.
- **pnpm store relocated into the workspace** via `.npmrc` `store-dir=.pnpm-store`. The default `~/.local/share/pnpm/store` is not writable in this sandbox and pnpm **hung silently** for 9+ minutes rather than erroring. Also set `confirm-modules-purge=false` so installs never block on an interactive prompt in a non-TTY shell.
- **`esbuild` added to `pnpm.onlyBuiltDependencies`.** pnpm 10 blocks build scripts by default; `tsx` needs esbuild's.
- **Postgres on host port 5544, not 5432.** Unrelated containers on this machine already hold 5432 and 5433. Container-internal port is unchanged.
- **No build step between workspace packages.** Package `exports` point at `src/*.ts`, everything runs via `tsx`, typechecking is `tsc --noEmit`. Revisit only if Next.js's bundler needs compiled output.

**Environment note:** the network here is slow (registry tarballs at roughly 20 KiB/s); the first `pnpm install` took about 4 minutes. Subsequent installs reuse `.pnpm-store` and are fast.

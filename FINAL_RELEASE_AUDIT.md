# CERBERUS — FINAL INDEPENDENT RELEASE AUDIT

```
AUDITED SHA:                7a51ab5f87b37bc42ed4b4ebece89fd668e724ba
AUDIT DATE:                 2026-08-19
WORKING TREE CLEAN AT START: NO — 4 untracked files (see §0)
WORKING TREE CLEAN AT END:   YES — byte-for-byte identical to HEAD for all tracked files

TOTAL PRODUCTION FILES:     149 (.ts/.tsx/.sql/.sol, tests excluded)
FILES REVIEWED:             149 read; 73 security-sensitive files reviewed line by line
SECURITY-SENSITIVE FILES:   73
DYNAMICALLY EXERCISED:      ~120 (via 363 tests, adversarial, red-team, mutation,
                            sandbox, db:verify, dashboard build, live HTTP probing,
                            direct per-role SQL probing)
IMPORTANT UNCOVERED PATHS:  1 critical — the untrusted agent's DATABASE READ path is
                            executed by no test under the agent role. It contains P1-2.

BUILD RESULT:               PASS  (typecheck exit 0; dashboard build exit 0, 8 routes;
                                   contracts:compile exit 0, 263 bytes bytecode)
FULL TEST RESULT:           PASS  (363/363, 72 suites, 0 failed, 0 skipped, 0 cancelled)
ADVERSARIAL RESULT:         PASS  (12/12 classes, 80 assertions)
REDTEAM RESULT:             PASS  (9/9 classes, 60 assertions)
MUTATION RESULT:            PASS  (12/12 guards proven detectable; tree restored)
DATABASE RESULT:            PASS  (13/13 db:verify checks after seeding; all 11
                                   migrations applied; every prohibited cross-role
                                   write denied with SQLSTATE 42501)
CONTRACT RESULT:            PASS  (compiles; ABI matches; logic reviewed)
DASHBOARD RESULT:           PASS  (production build clean)
DEPENDENCY AUDIT RESULT:    PASS  (pnpm audit — no known vulnerabilities; 13 external
                                   runtime deps, all registry-sourced, 1 build script)

P0:            0
P1:            2
P2:            3
P3:            7
INFO:          3
UNCONFIRMED:   0 reported as findings (see §5 for what could not be tested)
```

---

## EXECUTIVE VERDICT

**STOP — P0/P1 RELEASE BLOCKER FOUND**

Two reproducible P1 findings exist. Neither is a fund-theft or double-payment defect —
the money invariants held under every attack I could construct — but both are release
blockers by the stated standard:

1. **P1-1** — an unauthenticated caller from **any web origin** can mint a valid,
   signed, one-shot Execution Authorization from the control plane, consume mandate
   budget capacity, and deny the legitimate agent its payment. Demonstrated live:
   `HTTP 201 Created` with `Access-Control-Allow-Origin: https://evil.example`.
   The red-team gate contains an attack class named *"Unauthenticated network client
   reaches trusted authority"* which passes 7/7 while this endpoint has no
   authentication at all.

2. **P1-2** — the untrusted agent process **cannot execute a single proposal** against
   a correctly-provisioned least-privilege database. `npm run demo` and
   `npm run demo:script` both die on scenario 1 with
   `permission denied for table payment_reservation`. The judged demo does not run.

Both are deterministic, 10/10 reproducible, and neither is mentioned in the RUNBOOK's
failure-mode table.

I did **not** find: a way to move money outside policy, a double payment, a signing-key
leak, a forged settlement, a forged anchor that passes verification, a way for the
agent to grant itself authority, or a concurrency defect in the budget/velocity gate.
Those areas are genuinely strong and are documented as such in §3.

---

## 0. BUILD PINNING AND TREE STATE

```
git rev-parse HEAD      7a51ab5f87b37bc42ed4b4ebece89fd668e724ba
git branch --show-current   main
git rev-parse origin/main   7a51ab5f87b37bc42ed4b4ebece89fd668e724ba   (HEAD == origin/main, 0 ahead / 0 behind)
git log -1 --oneline    7a51ab5 Record that CI is green, not merely implemented
```

**The repository was already dirty at the start.** Reported before proceeding, as
required. Four untracked files, none of them source:

```
?? "docs/assets/01-audit-log (2).zip"
?? docs/assets/01-audit-log.png
?? docs/assets/01-audit-log.zip
?? docs/assets/safr-architecture-slide.zip
```

No tracked file was modified. All findings refer to `AUDIT_HEAD=7a51ab5`.

### Temporary changes made during this audit, and their restoration

| What | Where | Restored |
|---|---|---|
| `npm run mutation` overwrote tracked `artifacts/final-evidence/redteam/mutation-matrix.json` | repo | `git checkout --` ✓ |
| `npm run sandbox` overwrote tracked `artifacts/final-evidence/sandbox/seed-42.json` | repo | `git checkout --` ✓ |
| Money/time boundary harness `_audit_money_edge.ts` | `apps/api/src/` | deleted ✓ |
| Clean-checkout worktree at HEAD | scratchpad | `git worktree remove --force` + `prune` ✓ |
| Role probe, counters repro, cleanup scripts | scratchpad only, never in repo | n/a |
| Probe rows (`audit_csrf`, `action_csrf`, `audit_probe_*`) | PostgreSQL | deleted ✓ |
| Throwaway authorizer key for P1-1 | **process env only, never written to disk** | process stopped ✓ |

Final state proof:

```
$ git status --porcelain --untracked-files=no     # (no output)
$ git diff HEAD --stat                            # (no output)
$ grep -c MUTATED  <all 5 mutation target files>  # 0 0 0 0 0
$ git worktree list                               # only the main worktree
```

The repository is byte-for-byte identical to `7a51ab5` for every tracked file.
This report file (`FINAL_RELEASE_AUDIT.md`) is the requested deliverable and is left
untracked. Nothing was committed or pushed.

---

## 1. WHAT I VERIFIED BY RUNNING IT

Every number below is from a command I executed at `7a51ab5` on this machine, against
a real PostgreSQL 16 on `localhost:5544` with all 11 migrations applied and the five
least-privilege logins provisioned.

| Gate | Command | Exit | Result |
|---|---|---|---|
| Typecheck | `npm run typecheck` | 0 | clean |
| Full tests | `npm test` | 0 | **363 tests, 72 suites, 363 pass, 0 fail, 0 skipped, 0 cancelled** |
| Adversarial | `npm run adversarial` | 0 | **12/12 classes, 80 assertions** |
| Red team | `npm run redteam` | 0 | **9/9 classes, 60 assertions** |
| Mutation | `npm run mutation` | 0 | **12/12 guards DETECTED**, tree restored clean |
| Sandbox | `npm run sandbox -- --seed 42 --agents 50 --actions 1000 --concurrency 25` | 0 | 6/6 SQL-verified invariants PASS, 0 violations |
| DB verify | `npm run db:verify` (after `db:seed`) | 0 | **13 OK** |
| Contracts | `npm run contracts:compile` | 0 | 263 bytes |
| Dashboard | `npm run build --prefix apps/dashboard` | 0 | 8 routes incl. both server-only proxies |
| Dep audit | `corepack pnpm audit` | 0 | No known vulnerabilities |
| Evidence | `npm run evidence:verify` **on a clean checkout** | **1** | **28 failures** — see P2-1 |

The published counts (363/72, 12/12, 9/9, 12/12, 13 OK) are **accurate**. The test
suite is real, it is not self-satisfying, and the mutation matrix proves the security
guards are load-bearing. That is genuinely above the norm for a hackathon build.

A green suite is baseline evidence, not the conclusion. The findings below are what
the suite does not cover.

---

## 2. CONFIRMED FINDINGS

### P1-1 — Unauthenticated, any-origin minting of a signed Execution Authorization

**SEVERITY** P1 — HIGH

**EXACT LOCATION**
- `apps/api/src/server.ts:30` — `app.use(cors({ origin: true }))`
- `apps/api/src/routes/execution-authorizations.ts:52` — `POST /` with **no auth middleware**
- Contrast `apps/api/src/routes/escalations.ts:39,57`, which *do* apply `createReviewerAuth`

**INVARIANT VIOLATED**
"No untrusted party can trigger the issuance of payment authority."
This is the invariant the project's own red-team class **H — "Unauthenticated network
client reaches trusted authority"** claims to have closed (`scripts/redteam.ts:161-177`),
and the invariant `packages/core/src/bind-host.ts:5-9` is written to protect:
*"'cannot change the payment' is not the same as 'cannot make the payment happen now'."*

**PRECONDITIONS**
- The stack is running as the RUNBOOK documents (API on `127.0.0.1:4050`, authorizer
  key provisioned — i.e. the normal demo/judging configuration).
- An audit record exists in an executable disposition (`ALLOW`, or approved `ESCALATE`).
- The operator's browser loads **any** page from **any** origin — no host access, no
  credentials, no same-site relationship required.

**REPRODUCTION** (exactly as executed)

```bash
# API started with a throwaway authorizer key supplied in process env only:
EXECUTION_AUTH_PRIVATE_KEY=<throwaway> EXECUTION_AUTHORIZER_ADDRESS=<its address> npm run api

# 1. Cross-origin preflight for a JSON POST — must fail for a loopback-scoped service
curl -s -D - -o /dev/null -X OPTIONS http://127.0.0.1:4050/execution-authorizations \
  -H "Origin: https://evil.example" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type"

# 2. Mint the capability, cross-origin, with no credential of any kind
curl -s -D - -X POST http://127.0.0.1:4050/execution-authorizations \
  -H "Origin: https://evil.example" -H "content-type: application/json" \
  -d '{"audit_id":"audit_csrf"}'
```

**EXPECTED**
Preflight rejected, or the POST rejected `401`/`403` before any authority state is
touched.

**ACTUAL**

```
# step 1
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://evil.example
Access-Control-Allow-Methods: GET,HEAD,PUT,PATCH,POST,DELETE
Access-Control-Allow-Headers: content-type

# step 2
HTTP/1.1 201 Created
Access-Control-Allow-Origin: https://evil.example

{"authorization":{
  "authorizationId":"auth_0364b7c8-3875-487a-8595-d92171da8a9b",
  "proposalHash":"0xff21280ad8cf3b58b1c8a95e809f16bf6c798f6221d691b77aa93de09d0d3101",
  "mandateId":"mandate_001","mandateVersion":1,
  "reservationId":"res_badede67-569e-4dff-a045-c7756b154940",
  "chainId":84532,"token":"0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "amount":"500000","payTo":"0x3EE24C8af00b88828D17E390ed63Eb8A302208c2",
  "resourceHash":"0xb5fc...05de","expiresAt":1787158179,"nonce":"0xf5ab...8e8a"},
 "signature":"0xc80704b9ce7801fed1ade38cb92a4d00e382b2dbb1be2b856467e7b28334bd63...1b"}
```

A complete, valid, signed one-shot payment capability, returned **readable** to a
hostile origin. Durable side effects committed by the attacker's request, confirmed
in PostgreSQL afterwards:

- one row in `payment_reservation` (mandate budget capacity consumed), and
- one row in `execution_authorization` bound to it.

The legitimate agent then receives, for that same audit record:

```
$ curl -s -X POST http://127.0.0.1:4050/execution-authorizations \
    -H "content-type: application/json" -d '{"audit_id":"audit_csrf"}'
{"error":"AUTHORIZATION_ALREADY_ISSUED"}   -> HTTP 409
```

**WHY THIS HAPPENS**
Root cause: the most authority-bearing endpoint in the system was never given an
authentication gate, and `cors({ origin: true })` reflects whatever `Origin` the
caller sends. `origin: true` is not "same-origin only" — it is "every origin,
individually approved". Because `Access-Control-Allow-Credentials` is not set the
attacker sends no cookies, but this endpoint needs none: `{"audit_id": "..."}` is the
entire request. Loopback binding does not help, because the attacker is not on the
network — the operator's own browser is, and it will happily reach `127.0.0.1`.

**FINANCIAL / SECURITY EFFECT**
- Unauthorized triggering of payment-authority issuance.
- Unauthorized consumption of shared mandate budget capacity.
- Denial of service on a legitimate payment: the one-shot binding is burned, so the
  agent's own request fails `409 AUTHORIZATION_ALREADY_ISSUED`. During a judged demo
  this presents as the payment silently refusing to proceed.
- Disclosure of a live signed payment capability to an unapproved origin.

**What it does NOT achieve, stated precisely:** the capability is bound to the exact
proposal, amount, payee, token, chain and resource, so the attacker cannot redirect or
resize the payment. And the attacker cannot reach the executor from a browser —
`apps/executor/src/server.ts` mounts **no** CORS middleware, so the preflight for a
JSON POST to `:4060` fails, and a "simple request" with `text/plain` is not parsed by
`express.json()` and dies at the zod gate with `400`. **This is not fund theft.** It is
unauthenticated authority triggering, capacity consumption, capability disclosure and
payment denial.

**REPRODUCIBILITY** deterministic, 10/10.

**CONFIDENCE** high — executed end to end at `7a51ab5`, with the response body and CORS
headers captured above.

**TEST GAP**
Red-team class H tests exactly two things: that `GET /escalations` requires a bearer
token, and that `resolveBindHost()` returns loopback by default
(`scripts/redteam.ts:161-177`). No test in the repository sends a request to
`POST /execution-authorizations`, and no test asserts anything about CORS. The class
name — *"Unauthenticated network client reaches trusted authority"* — is therefore
broader than what it verifies, which is why a passing gate coexists with this hole.

**MINIMUM FIX DIRECTION**
Put `createReviewerAuth`-style bearer authentication (or a dedicated
service credential) in front of `POST /execution-authorizations`, and replace
`cors({ origin: true })` with an explicit allowlist containing only the dashboard
origin — or drop CORS entirely, since the dashboard already talks to the API
server-side.

---

### P1-2 — The untrusted agent cannot execute any proposal; the judged demo does not run

**SEVERITY** P1 — HIGH (demo-breaking; fails closed, so no money is at risk)

**EXACT LOCATION**
- `packages/controls-repository/src/counters.ts:43` — `getHourlyTxCount()` calls
  `committedVelocityCount()`
- `packages/db/src/reservations.ts:214-237` — `COMMITTED_VELOCITY_SQL` reads
  `payment_reservation`
- `packages/db/migrations/005_database_privilege_separation.up.sql:38-39` — the agent
  role is granted `SELECT` on `agent_identity, mandate, proposed_action, audit_log,
  audit_anchor` and **not** on `payment_reservation`. No later migration adds it.

**INVARIANT VIOLATED**
Not a security invariant — the opposite. The system fails *closed* so hard that the
documented primary flow cannot run at all. This is the "demo-breaking payment failure"
case in the P1 definition.

**PRECONDITIONS**
The configuration the README, `.env.agent.example` and CI all mandate:
`AGENT_DATABASE_URL` pointing at the least-privilege `cerberus_agent_app` login
provisioned by `npm run db:roles`. `.env.agent.example` states plainly:
*"Least-privilege login. Provision it with `npm run db:roles`; never use DATABASE_URL."*

**REPRODUCTION**

```bash
npm run db:migrate && npm run db:roles && npm run db:seed   # documented setup
npm run demo -- clean
npm run demo:script
```

**EXPECTED**
`Scenario 1 — clean transaction` resolves `ALLOW`, per README §6 and
`docs/submission/DEMO_SCRIPT.md`.

**ACTUAL** (both commands, exit code 1)

```
Scenario 1 — clean transaction   [clean]
  proposes      0.5 USDC to merchant_xyz  (invoice_884, via fixture)

  ERROR permission denied for table payment_reservation
```

Isolated to the exact statement, run as each real login:

```
The velocity counter query the AGENT runs, per role:
  OK      schema owner (.env DATABASE_URL)   current_user=safr                  committed=0
  FAILED  agent      (.env.agent)            SQLSTATE=42501  permission denied for table payment_reservation
  OK      control    (.env.authorizer)       current_user=cerberus_control_app  committed=0
```

**WHY THIS HAPPENS**
Commit `335d4d1` ("Enforce velocity limits atomically") changed the shared
`getCounters()` helper from a settled-only `audit_log` read to
`committedVelocityCount()`, which reads `payment_reservation`. That helper is called by
**both** the trusted control plane and the untrusted agent
(`apps/agent/src/orchestrator.ts:81`). The accompanying migration `007` granted the
control plane a new `UPDATE` privilege but never granted the agent `SELECT` on
`payment_reservation`. The control plane already had that grant from `005`, so the
change worked there and the regression stayed invisible. The agent's orchestrator
throws inside `loadEvaluationContext()` — step 1 — so `evaluate()` is never reached.

**FINANCIAL / SECURITY EFFECT**
None directly: nothing is authorized, no capacity is committed, no key is touched. The
effect is total loss of the primary demonstrated capability. In front of judges,
scenario 1 aborts with a raw SQL permission error.

**REPRODUCIBILITY** deterministic, 10/10, on both a freshly seeded and a
post-test database.

**TEST GAP**
Three separate layers of coverage each miss it:
- `apps/agent/src/__tests__/harness.ts:67` **stubs** `loadEvaluationContext`, so the
  agent suite never touches the database.
- `packages/db/src/__tests__/reservations.test.ts:398,419` calls
  `committedVelocityCount` through `getPool()` — the **schema owner**.
- `packages/db/src/__tests__/privileges.test.ts` connects as the agent role but tests
  only *writes*; its single agent read (line 241) is against `mandate`, which is
  granted.

No test executes the agent's read path under the agent role. CI never runs
`npm run demo` or `npm run demo:script` (`.github/workflows/ci.yml` has no such step),
so CI is green while the demo is dead.

**MINIMUM FIX DIRECTION**
Add `GRANT SELECT ON payment_reservation TO cerberus_agent_role` in a new migration,
or split the counter helper so the agent uses a settled-only source it can already
read. Then add one test that runs `loadEvaluationContext` under the agent login.

---

### P2-1 — `evidence:verify` fails on every file it names in a clean checkout

**SEVERITY** P2 — MEDIUM

**EXACT LOCATION** `.gitignore:18` (`*.log`); `artifacts/final-evidence/manifest.json`;
`scripts/evidence.ts:298-314`; absence of `.gitattributes`.

**INVARIANT VIOLATED**
"The manifest is generated FROM the artifacts, never hand-written, so it cannot claim
something that is not there" (`scripts/evidence.ts:7-9`). In a clean clone it claims
28 files that a verifier cannot check.

**REPRODUCTION**

```bash
git worktree add --detach /tmp/clean-wt HEAD
node --import tsx /tmp/clean-wt/scripts/evidence.ts verify
```

**ACTUAL** — exit 1, `28 failure(s), 2 warning(s)`, `RESULT: FAIL`:
- **23 × `manifest names a missing file: terminal/*.log`** — every captured log is
  excluded by `.gitignore:18` (`*.log`). Only 7 of 28 evidence files are tracked.
- **5 × `evidence file changed since the manifest was built`** — the 5 files that *are*
  tracked also fail, because `core.autocrlf=true` with no `.gitattributes` rewrites
  them to CRLF on checkout, so their sha256 no longer matches the manifest.
  Example, `sandbox/seed-42.json`: manifest records
  `f40a80c4…33be2bf`; clean checkout hashes to `1d8394ea…b051207b`.

**WHY THIS HAPPENS** Two independent causes: a blanket `*.log` ignore rule that also
catches the evidence directory, and byte-level digests taken over files that git is
free to re-encode on checkout.

**EFFECT** Every headline number in `artifacts/final-evidence/README.md` and
`manifest.json` — 363 tests, 12/12 classes, 9/9 classes, 12/12 guards — is derived by
`fromLog()` from logs that are not in the repository. A judge cloning the repo cannot
verify any of them, and the tool built to prove the evidence is real reports total
failure. (I independently re-ran every one of those gates and they *are* accurate —
the numbers are true, they are just unverifiable from the repo.)

**REPRODUCIBILITY** deterministic, 10/10.

**TEST GAP** `evidence:verify` is never run by CI, and never run against a clean
checkout — only against the working machine, where the logs happen to exist.

**MINIMUM FIX DIRECTION** Add `!artifacts/final-evidence/**/*.log` to `.gitignore` and
commit the logs, plus a `.gitattributes` marking `artifacts/final-evidence/** -text`;
or hash normalized content rather than raw bytes.

---

### P2-2 — The test suite destroys the demo seed and leaves its own fixtures behind

**SEVERITY** P2 — MEDIUM (demo reliability)

**EXACT LOCATION** `packages/db/src/__tests__/fixtures.ts:59-64` (`resetFixtures()`
truncates `mandate` and `agent_identity`); `packages/db/src/__tests__/reservations.test.ts:449-458`
(creates `agent_reconcile` / `m_reconcile` and never removes them).

**REPRODUCTION**

```bash
npm run db:seed && npm run db:verify   # 13 OK, exit 0
npm test                               # 363/363, exit 0
npm run db:verify                      # exit 1
```

**ACTUAL**

```
3 check(s) failed.
        mandate_001 not found — run npm run db:seed first
```

Database state after `npm test`: `agent_identity` contains only `agent_reconcile`;
`mandate` contains only `m_reconcile`. The demo agent and mandate are gone.

**EFFECT** The README's own ordering is step 3 `db:verify` → step 4 `npm test` →
step 5 start services → step 6/7 demo. After step 4 the database no longer has the
seed. `npm run demo:script` self-heals (it resets first), but `npm run demo -- …` —
used in README step 7 and in "The three-headed demo" — does not, and neither does a
re-run of `db:verify`. Test residue is also left in the demo database permanently.

**REPRODUCIBILITY** deterministic, 10/10.

**MINIMUM FIX DIRECTION** Re-seed in an `after()` hook, namespace the test fixtures
away from the demo identities, or make the README re-seed after step 4.

---

### P2-3 — The data Remediation 6D authenticated is served unauthenticated, cross-origin, by a neighbouring route

**SEVERITY** P2 — MEDIUM (information disclosure; contradicts a stated remediation)

**EXACT LOCATION** `apps/api/src/routes/audit.ts:20` (`GET /audit`), `:76`
(`GET /audit/:auditId`), `apps/api/src/routes/mandates.ts:8,27`; all mounted without
auth in `apps/api/src/server.ts:34-37`.

**INVARIANT VIOLATED** `docs/submission/SECURITY_REMEDIATION.md:34` states
`GET /escalations` was authenticated because it "returned counterparty, amount and
agent for every waiting payment" and that is not public information.

**REPRODUCTION / ACTUAL**

```
$ curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4050/escalations
401                                                    # the remediated route

$ curl -s -H "Origin: https://evil.example" http://127.0.0.1:4050/audit
HTTP/1.1 200 OK
Access-Control-Allow-Origin: https://evil.example
  leaked 1 audit records; first:
    {"audit_id":"audit_csrf","disposition":"ALLOW","counterparty":"merchant_xyz","amount":0.5}
  rolling spend: {"agent_id":"agent_treasury_01","rolling_total_24h":0,"max_total":3,"currency":"USDC"}
```

`GET /audit` returns every audit record including `ESCALATE` rows with
`human_review: null` — i.e. precisely the pending escalations, with counterparty and
amount — plus the agent's live rolling spend against its cap. `GET /mandates/active`
similarly discloses full policy.

**EFFECT** The stated protection is bypassable by design from any web origin. Same
root cause as P1-1; listed separately because it contradicts an explicit,
individually-claimed remediation.

**REPRODUCIBILITY** deterministic, 10/10.

**MINIMUM FIX DIRECTION** Apply the same reviewer authentication to the audit and
mandate reads, or state in the remediation table that these reads remain public.

---

### P3-1 — A sub-atomic amount is ALLOWed by policy, then crashes the control plane with HTTP 500

**LOCATION** `packages/core/src/schemas/proposed-action.ts:21`;
`packages/execution-authorization/src/target.ts:46-55`;
`apps/api/src/execution-authorizer.ts:248`;
`apps/api/src/routes/execution-authorizations.ts:57-66`.

An `amount` below one USDC atomic unit (`1e-7`, or `5e-324`) passes
`ProposedActionPayloadSchema` (positive and finite) and is `ALLOW`ed by the engine.
`buildExecutionTarget` then throws a **plain `Error`**
(`"exponential payment amounts are not supported"`), which is not an
`AuthorizationIssuanceError`, so the route falls through to `next(error)` and the
generic handler returns `500 {"error":"internal_error","message": …}`.

Measured directly against the production functions:

```
ACCEPTED  amount = 1e-7 (below USDC atomic unit)               -> 1e-7
ACCEPTED  amount = smallest float > 0 (5e-324)                 -> 5e-324
refused   decimalToAtomicUnits(1e-7)   -> exponential payment amounts are not supported
```

**Fails closed** — no reservation, no capability, no money. But the audit record says
`ALLOW`, the agent sees `HTTP 500`, and an internal error string is returned to the
caller. Also worth stating positively: **no silent rounding exists anywhere on the
money path** — `decimalToAtomicUnits` refuses `>6dp` and exponent notation rather than
truncating, and the reserved decimal is derived *from* the atomic amount, so the amount
reserved and the amount signed cannot drift.

**FIX DIRECTION** Reject sub-atomic amounts at the schema or map the conversion failure
onto a typed `AuthorizationIssuanceError`.

---

### P3-2 — `rolling_window.window: "0h"` silently disables the rolling budget cap

**LOCATION** `packages/db/src/reservations.ts:118-123` (`windowHours`), used at
`:185,201` in `COMMITTED_SPEND_SQL`.

`windowHours("0h")` returns `0`, making the window predicate
`counts_at > (at - 0 hours) AND counts_at <= at` — an empty range. Committed spend is
then always `0`, so the rolling cap never binds. `MandateSchema` accepts any non-empty
string for `window`, and nothing validates it at insert time. Measured:

```
ACCEPTED  windowHours("0h")     -> 0
ACCEPTED  windowHours("24 h")   -> 24      (whitespace tolerated)
refused   windowHours("24")     -> unsupported rolling window: 24
```

Requires an operator to author the mandate, and mandate rows are immutable-by-version
and unwritable by the agent — so this is a configuration footgun, not a privilege
bypass. Still a silent policy-disabling value.

**FIX DIRECTION** Validate `window` against the supported grammar in `MandateSchema`
and reject a zero-length window.

---

### P3-3 — Contradictory and stale published numbers

- `README.md:45` claims **"330 automated tests"**; `README.md:56` and `:278` claim
  **363**. The correct figure is 363 (measured). The 330 line is stale.
- `README.md:55` pins the finalist build to commit **`5a0f367`**; `HEAD` is
  `7a51ab5`, six commits later. The table is headed "the build as it stands right now".
- `artifacts/final-evidence/manifest.json` records
  `"sha": "652c2d6…"` and **`"workingTreeClean": false`** — the committed evidence
  describes a different commit *and* admits it was generated from a dirty tree.

**FIX DIRECTION** Regenerate the manifest at the release commit with a clean tree, and
delete or update the 330 line.

---

### P3-4 — Documented install uses a different pnpm major than the repo pins

`README.md:184` instructs `npx --yes pnpm@10.34.5 install`, while
`package.json:10` pins `"packageManager": "pnpm@11.22.0"` and CI uses
`corepack enable` (pnpm 11). `pnpm-workspace.yaml:12-22` documents that `allowBuilds`
is the pnpm 11 spelling and that the pnpm 10 spelling "no longer drives the
behaviour". Both keys are present so pnpm 10 will likely work, but the documented
path is not the tested path.

---

### P3-5 — The mutation harness accepts any test failure as proof, and dirties tracked evidence

**LOCATION** `scripts/mutation.ts:263-284,334`.

`runTests()` concludes `detected = result.failed > 0`. Unlike `scripts/adversarial.ts`
and `scripts/redteam.ts` — which require every *named* assertion to appear in the TAP
output — the mutation harness does not check *which* test failed. A mutation that
merely broke module loading would be scored `DETECTED` without any security assertion
having caught it. (I inspected all 12 mutations; none currently has that problem, so
the 12/12 result is sound — but the harness cannot tell the difference.)

Separately, `npm run mutation` writes tracked
`artifacts/final-evidence/redteam/mutation-matrix.json`, and `npm run sandbox` writes
tracked `artifacts/final-evidence/sandbox/seed-*.json`. Both therefore leave the tree
dirty; the mutation script's own dirty-tree guard deliberately excludes
`artifacts/final-evidence/` (`scripts/mutation.ts:256-260`), so it cannot catch this.

**FIX DIRECTION** Assert the specific expected assertion names failed, as the other two
gates already do.

---

### P3-6 — The sandbox report prints the wrong invariant under "Replay violations"

**LOCATION** `scripts/sandbox.ts:637`.

`invariants[2]` is *"one reservation, at most one authorization"*; the replay invariant
is pushed later and lives at index 5. The console line labelled `Replay violations`
therefore prints a different invariant's count. The overall PASS/FAIL is computed from
the sum of all invariants and is correct; only the label is wrong.

---

### P3-7 — An hour range is one minute wider than it reads

**LOCATION** `packages/disposition-engine/src/checks/time-window.ts:36-39`.

Comparison is at whole-minute granularity with an inclusive end, so a mandate
configured `"09:00-17:00"` actually permits proposals up to `17:00:59.999`. Measured:

```
2026-08-19T16:59:59.999Z       -> inside=true
2026-08-19T17:00:00.000Z       -> inside=true
2026-08-19T17:00:59.999Z       -> inside=true     <-- outside the range as written
2026-08-19T17:01:00.000Z       -> inside=false
```

The inclusive convention is deliberate and documented (it is what makes `"00:00-23:59"`
mean the whole day), so this is a documentation/semantics nit rather than a defect. It
is reported because §8 asked specifically about `<` versus `<=` consistency.

---

### INFO

- **`markSettled` is exported but never called** in production
  (`packages/db/src/index.ts:37`); the direct settle path goes through
  `terminalizeSettlement`. Dead surface on a money-path module.
- **No `.gitattributes`** in a repository that commits byte-digested artifacts and is
  developed on Windows with `core.autocrlf=true`.
- **CI does not run the agent.** `.github/workflows/ci.yml` runs migrate/roles/seed/
  verify/test/adversarial/redteam/contracts/dashboard, but never `npm run demo` or
  `demo:script` — which is exactly why P1-2 shipped green.

---

## 3. ATTACKS THAT FAILED — recorded as failures, not twisted into findings

These are the attacks I ran that the system correctly withstood. They are the reason
the verdict is "fix two blockers", not "unsafe design".

### Database hostile-credential testing (§12) — all denied

I connected as each of the five **real** least-privilege logins from the runtime env
files and attempted every operation outside its authority. Every prohibited operation
was refused by PostgreSQL itself, not by application code:

| Role | Attempt | Result |
|---|---|---|
| agent | falsify `audit_log.settlement` (claim money moved) | `42501` |
| agent | rewrite `audit_log.disposition` DENY→ALLOW | `42501` |
| agent | forge `audit_log.human_review` | `42501` |
| agent | INSERT / UPDATE `audit_anchor` (manufacture proof) | `42501` |
| agent | rewrite `mandate.controls`; revoke `mandate.status` | `42501` |
| agent | un-suspend itself via `agent_identity.status` | `42501` |
| agent | INSERT `payment_reservation`; settle it | `42501` |
| agent | INSERT `execution_authorization`; mark CONSUMED | `42501` |
| agent | INSERT `human_approval` | `42501` |
| agent | mark its own `audit_finalization` DONE | `42501` |
| agent | **read** `payment_reservation` / `execution_authorization` / `human_approval` | `42501` |
| control plane | rewrite mandate policy; write settlement; consume authorization; insert anchor; change agent status | `42501` |
| executor | rewrite mandate policy; insert human approval; insert anchor; change agent status; self-bind `authorization_id` | `42501` |
| reconciler | consume authorization; bind `authorization_id`; insert approval; author anchor | `42501` |
| anchor worker | change `audit_log.settlement` / `disposition`; transition reservation; consume authorization; insert approval | `42501` |
| **all five** | `CREATE TABLE` in `public`; `GRANT` itself another role; read `pg_shadow` | `42501` |

Only the two intended capabilities succeeded: the reconciler updating
`payment_reservation.status`, and the anchor worker updating `audit_anchor`. The
agent's `INSERT (audit_id)` on `audit_finalization` reached the FK check (`23503`)
rather than a privilege error, confirming the grant is exactly the single-column
request-only power documented in migration 011.

**This is the strongest part of the system.** Application logic is not load-bearing
for these boundaries; SQL permissions are.

### Pre-execution interception (§ headline claim) — verified independently

I did not rely on the project's own scanning test:

- Only `apps/executor/**` and `apps/merchant/**` (the payee) import `@safr/x402-client`
  or `@x402/*`. `apps/agent/**` imports neither.
- `apps/agent` references payment-key variables only to `delete` them
  (`apps/agent/src/env.ts:21-22`).
- No `globalThis.fetch =`, `ProxyAgent`, `setGlobalDispatcher` or proxy interception
  exists anywhere in `apps/`, `packages/` or `scripts/`.

The pre-execution position is real, not narrated.

### Money boundaries (§7) — no silent rounding, no boundary slip

Executed against the real schema, conversion functions and engine:

- `0`, `-1`, `-0`, `NaN`, `Infinity`, `-Infinity`, `"5"`, `"0.5"` — all **refused** by
  `ProposedActionPayloadSchema`.
- Per-transaction cap (1.0): `0.999999` ALLOW, `1.0` ALLOW (at cap), `1.000001` DENY,
  `1.0000000000000002` DENY. Boundary is `>`, consistently.
- Rolling window (3.0): exactly `3.0` ALLOW, `3.000001` DENY.
- Velocity (10): 9 ALLOW, 10 ESCALATE, 11 ESCALATE. Boundary is `>=`, consistently.
- `decimalToAtomicUnits` **refuses** `>6dp` and exponent notation rather than
  truncating; `atomicUnitsToDecimal` round-trips exactly; the reserved decimal is
  derived from the atomic amount, so reserved and signed amounts cannot diverge.

### Concurrency and replay (§10, §11) — invariants held

`npm run sandbox --seed 42 --agents 50 --actions 1000 --concurrency 25`, with all
invariants **queried from PostgreSQL after the run**, not from application counters:

```
PASS  committed spend <= mandate budget           every budget authority within 50 USDC
PASS  one proposal, at most one live reservation  no proposal produced a second financial effect
PASS  one reservation, at most one authorization  no reservation backs a second capability
PASS  no capacity committed for a refused proposal DENY and ESCALATE never reached the financial layer
PASS  velocity ceiling held without approval      no agent exceeded 8 reservations in the window
PASS  no proposal reserved twice across the run   55 duplicate(s) submitted; no action_id reserved more than once
```

The 12 mutation experiments independently prove these guards are load-bearing: removing
the budget lock, the velocity lock, the suspension checks, the reservation-context
equality check, the correlation-before-transport gate, the chain-proof requirement, the
OUTCOME_UNKNOWN hold, the anchor digest comparison, the redirect refusal or the
correlated-failure trigger each **broke its own tests**.

### Merchant / network adversary (§14) and chain settlement (§15)

Reviewed and exercised through the existing adversarial classes, which I re-ran and
which do execute real assertions: amount/payee/token/chain/scheme/EIP-712-domain/
transfer-method/version/resource mutation are all refused **before the payer is
constructed**; merchant-claimed success without chain proof stays `OUTCOME_UNKNOWN`;
merchant-reported failure after transmission stays `OUTCOME_UNKNOWN` (because the
merchant still holds a live EIP-3009 authorization); redirects are refused on both the
unsigned challenge and the signed request. `reconcileEip3009` proves settlement only
from a used nonce **plus** an exact successful `Transfer` in a successful receipt.

The project's claim about what it proves is accurate and appropriately narrow:
**inclusion, not finality.** `verify-chain.ts` reports confirmation depth and supports a
threshold; the settlement path deliberately does not gate on it, and says so.

### Audit / anchor attacks (§16) — UNVERIFIED cannot become PASS

`verifyAnchorOnChain` recomputes the digest from the stored record, requires the
receipt to exist, to have succeeded, to have been sent to the expected AuditAnchor
contract, and reads the anchored digest **from the chain's own event logs** (filtered
to that contract address, so a look-alike event from another address is ignored). All
three digests — recomputed, database-recorded, chain-read — must agree. RPC failure
yields `UNVERIFIED`, and `verify-anchors.ts:108-110` exits non-zero on `UNVERIFIED`.
I could not make UNVERIFIED become PASS.

### Secrets and supply chain (§18, §19)

- **No credential value is committed.** Every 64-hex match in tracked files is a public
  transaction hash, a test fixture (`0xaa…`, `0xbb…`), or the secp256k1 order constant.
  All six runtime `.env*` files are untracked and gitignored; CI asserts this.
- 13 external runtime dependencies, all registry-sourced. No git or tarball
  dependencies. One allowed build script (`esbuild`). `pnpm audit`: no known
  vulnerabilities. 292 resolved packages.
- Each process scrubs credentials it must not hold before constructing anything
  (`apps/agent/src/env.ts:21-35`, `apps/executor/src/reconciler-env.ts:15-22`,
  `packages/audit-log/src/cli/anchor-worker.ts:37-40`).

---

## 4. SMART CONTRACT (§20)

`contracts/AuditAnchor.sol` — 44 lines, compiles to 263 bytes with solc 0.8.36.

`anchor(bytes32)` increments a counter in `unchecked` and emits `Anchored`. It is
deliberately permissionless and non-deduplicating, and the comment explains why: the
digest is meaningless without the off-chain record, and a duplicate anchor is harmless.
That reasoning holds. No external calls, no ether handling, no ownership, no
initializer, no upgradeability, no reentrancy surface, no unchecked return values. The
`unchecked` counter cannot realistically overflow (`uint256`), and `anchorCount` is
documentation, not an accounting invariant.

The hand-written ABI in `contracts/src/abi.ts` is asserted against the compiler's
output by `contracts/src/__tests__/contract.test.ts`, so the two cannot drift.

Anyone can anchor an arbitrary digest — which is by design and is not a weakness,
because verification requires the digest to match a specific stored record, and
`verifyAnchorOnChain` additionally requires the transaction to have been sent to this
exact contract.

No Foundry/Slither run: neither is in the approved stack and the contract is 44 lines
with no state machine worth fuzzing.

---

## 5. WHAT I COULD NOT TEST — stated, not papered over

| Area | Status | Why |
|---|---|---|
| Live Base Sepolia settlement | **BLOCKED** | No signer keys provisioned and no funded wallet on this machine. `npm run preflight` correctly exits 1. I did **not** substitute a mock for live evidence, and I fabricated no hash. |
| End-to-end black-box demo (§24) | **BLOCKED by P1-2** | The agent cannot reach the disposition engine, so ALLOW / DENY / ESCALATE could not be observed through the real interfaces. Verified through unit/integration paths and `db:verify`'s engine check instead. |
| Full crash-injection matrix (§13) | **PARTIAL** | I reasoned through all 18 boundaries against the code and confirmed the covered ones through the existing reconciliation/finalization tests, but I did not force real process death at each point. The state machine is CAS-fenced at every terminal transition and I found no path to a contradictory state by inspection. |
| Executable coverage percentage (§5) | **NOT MEASURED** | No coverage tooling is configured, and Node's built-in reporter was not wired up. I substituted targeted analysis of security-sensitive uncovered paths — which is how P1-2 was found. |
| Dashboard browser behaviour | **PARTIAL** | Production build verified (8 routes, both server-only proxies, middleware present); reviewer auth verified by reading `middleware.ts` and the two proxy handlers. No browser session was driven. |

**UNCONFIRMED SUSPICIONS:** none. Everything above is either a confirmed finding with a
reproduction, or an attack I ran that failed and recorded as failed.

---

## 6. RELEASE DECISION

Per §31: a reproducible P1 exists, so **STOP**. Do not proceed to demo polishing until
the authors have reviewed P1-1 and P1-2.

Ordered by what actually blocks a public demonstration:

1. **P1-2** — without it there is no demo at all. One `GRANT` plus one test.
2. **P1-1** — authentication on `POST /execution-authorizations` and a CORS allowlist.
3. **P2-2** — re-seed after the test suite, or the demo database is empty at step 6.
4. **P2-1** — commit the evidence logs and add `.gitattributes`, or the manifest is
   unverifiable to a judge.
5. **P2-3, P3-3** — align the claims with the code and with `HEAD`.

The remaining P3/INFO items are genuine but should not trigger redesign.

A closing note in fairness to the build: the database privilege separation, the atomic
reservation gate, the chain-proof-before-SETTLED rule, the OUTCOME_UNKNOWN discipline,
and the mutation matrix are unusually rigorous, and I could not break any of them. Both
P1s are gaps at the *edges* of that work — one endpoint that never received the
authentication its neighbours got, and one `GRANT` that a later refactor needed and
never received — not flaws in its centre.

This audit does not claim the system has no bugs, and does not claim it is completely
secure. It reports what was executed, what was found, and what could not be tested.

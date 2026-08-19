# Edge cases and open decisions — current register

This register describes **what the code at this commit actually decides**. It is the
judge-facing answer to "what did you not solve, and do you know it?"

It was re-verified against current source during the final release polish pass. Every
entry below was checked by reading the code and, where a claim is that something is
enforced, by locating the test that proves it.

## Status labels

| Label | Meaning |
|---|---|
| **IMPLEMENTED** | Enforced in code or database, and covered by a named test. |
| **CONSERVATIVE** | Fails closed or holds capacity. Correct, but may need operator action. |
| **PARTIAL** | Real safety exists; the operational behaviour around it is incomplete. |
| **DEFERRED — FINALIST SCOPE** | Deliberately not built. Outside the finalist threat model or scope. |
| **KNOWN NON-BLOCKING BUG** | A real defect that does not violate a money or authority invariant. |
| **OPEN — PRODUCTION REQUIREMENT** | Required before real funds or exposure. Not a finalist vulnerability. |

A **DEFERRED** or **OPEN — PRODUCTION REQUIREMENT** entry is a *known
production-hardening limitation*, not a live security vulnerability. It is only called
a vulnerability here if it breaks the threat model stated in
[Architecture.md](Architecture.md) and summarised below.

## Threat model this register is scored against

The untrusted party is **the agent**. It holds no payment key, no execution
authorization signing key, no anchor key, and no reviewer credential; it runs under a
least-privilege PostgreSQL role and cannot author terminal financial truth.

**Full host or root compromise is explicitly outside this model.** An attacker with
root can read process memory and configuration and defeat OS- and role-level
separation, exactly as they would on any single-machine deployment. Nothing in this
repository claims otherwise.

---

## Previously reported findings that are now fixed

These were open in earlier drafts of this register. They are **closed at this commit**.
They are listed explicitly so that no reader carries forward a stale conclusion.

### Caller-controlled `proposed_at` could bypass the time-window rule — IMPLEMENTED

A hostile agent used to be able to choose an in-window historical timestamp and mint
current authority with it.

Authorization now asks two separate questions. The *historical* evaluation still uses
`action.proposed_at`, so a later mandate edit cannot rewrite what a past audit record
correctly says. The *current* re-evaluation substitutes trusted process time
(`{ ...action, proposed_at: nowIso }`) so an old in-window proposal cannot mint fresh
authority after its window closed. The stored proposal and its canonical hash are
unchanged — only the time-window input is substituted.

- Source: `apps/api/src/execution-authorizer.ts` (historical vs. current evaluation).
- Tests: forged past and future timestamps, trusted time inside and outside the
  window, the documented inclusive whole-minute boundary, stale mandate, stale
  approval, capability expiry.

### Unauthenticated Execution Authorization issuance — IMPLEMENTED (within the finalist deployment boundary)

`POST /execution-authorizations` used to accept an unauthenticated request and mint a
signed capability. It now sits behind a dedicated constant-time service bearer
credential, separate from reviewer identity.

- Source: `apps/api/src/execution-auth.ts`, applied at
  `apps/api/src/routes/execution-authorizations.ts`.
- Behaviour: missing token `401`, forged token `403`, unconfigured token `503`.
- Tests: `apps/api/src/__tests__/execution-route-auth.test.ts`, red-team class H.

**This is not full public-internet workload identity.** It closes the unauthenticated
authority-triggering surface inside the finalist deployment boundary (loopback plus
bearer). The credential's holder can request *policy-bound* authority for an existing
audit; it cannot bypass policy, sign, spend, or review. Public deployment still
requires TLS, credential rotation, rate limiting and perimeter controls — see
"Public-internet workload identity" below.

### Arbitrary reflected CORS — IMPLEMENTED

The API used to reflect every browser `Origin`. It now consults an explicit allowlist
and grants nothing to an unlisted origin. Service-to-service calls carry no `Origin`
and correctly need no CORS grant.

- Source: `apps/api/src/cors-policy.ts`, applied at `apps/api/src/server.ts`.

### `reviewer:auto` sent no bearer on the pending GET — IMPLEMENTED

`GET /escalations` is authenticated, but the auto-reviewer only sent its token on the
decision POST, so it could not discover work. Both requests now go through one shared
client that sets `authorization` on each.

- Source: `apps/reviewer/src/client.ts`.
- Test: `apps/reviewer/src/client.test.ts` inspects both request headers.

### Paid x402 request had no timeout — IMPLEMENTED / CONSERVATIVE

The signed paid request now carries a finite 30-second timeout.

The conservative half is deliberate and unchanged: durable correlation is persisted
*before* transport, so any abort after possible transmission stays `OUTCOME_UNKNOWN`,
retains budget capacity, schedules reconciliation, and is **never** retried
automatically. A timeout is not evidence of non-payment and is not treated as one.

- Source: `packages/x402-client/src/pay.ts` (`paidRequestTimeoutMs`, `redirect: "error"`).

### Least-privilege agent could not evaluate a proposal — IMPLEMENTED

The shared evaluation counter read `payment_reservation`, a trusted table deliberately
hidden from the hostile-agent role, so a real least-privilege demo failed with
SQLSTATE `42501`.

Agent-visible counters are now settled-only reads from `audit_log`, which that role may
already read. **No reservation grant was added.** The trusted reservation transaction
still counts active, executing and settled capacity under advisory locks and remains
the authoritative budget and velocity gate.

- Source: `packages/controls-repository/src/counters.ts`.
- Test: `apps/agent/src/__tests__/agent-role-postgres.test.ts` calls
  `loadEvaluationContext()` as the real agent login, and separately proves a direct
  reservation read still fails `42501`.

Consequence worth stating: the dashboard's preliminary policy display counts settled
activity only, so it can show more headroom than is actually reservable. Transaction-time
enforcement is the stricter of the two. This is a display/enforcement asymmetry, not a
budget hole.

---

## Money and authority invariants — IMPLEMENTED

These are the invariants the release is built to protect. Each is enforced and tested.

| Question | Status | Mechanism |
|---|---|---|
| Two requests at the same instant | **IMPLEMENTED** for money | Advisory locks serialise reservation; the loser re-reads committed spend and may be refused or escalated. No fairness or FIFO promise. |
| Two authorizations for one audit | **IMPLEMENTED** | Compare-and-set `RESERVED → AUTHORIZED` plus one-authorization-per-reservation unique indexes; the loser gets `AUTHORIZATION_ALREADY_ISSUED`. |
| One capability replayed, or sent to two executors | **IMPLEMENTED** | Signature and exact-field verification first, then durable `ISSUED → CONSUMED` and `AUTHORIZED → SUBMITTING` compare-and-sets. Survives restarts. |
| Two reviewers clicking at once | **IMPLEMENTED** | `UPDATE ... WHERE human_review IS NULL` and the approval insert in one transaction; the loser gets `409 already_decided`. |
| Two workers claiming one job | **IMPLEMENTED** | `FOR UPDATE SKIP LOCKED`, 30-second leases, random fencing tokens, fenced terminal writes. |
| Executor and reconciler finishing together | **IMPLEMENTED** | Shared `terminalizeSettlement`; one source-state compare-and-set wins and the loser never overwrites terminal truth. |
| Forged, mutated or expired capability | **IMPLEMENTED** | Refused on signature and exact binding — proposal, mandate version, chain, token, atomic amount, payee, resource — before any key use. |
| Agent suspended mid-flight | **IMPLEMENTED** until broadcast | Checked at issuance, inside the reservation transaction, and twice in the executor including after the merchant's 402. |
| Merchant claims success with a fake hash | **IMPLEMENTED** | The merchant's hash is not authority; the executor finds the exact EIP-3009 authorization and transfer on chain or reports unknown. |
| Merchant redirects the paid request | **IMPLEMENTED** | `redirect: "error"`; the signed header is never forwarded. Rejection is treated as `OUTCOME_UNKNOWN`, not as non-payment. |
| Crash after chain proof, during terminal commit | **IMPLEMENTED** | Reservation, audit settlement and anchor job commit in one transaction, or all roll back and stay reconcilable. |
| Approval reused for unrelated work | **IMPLEMENTED** | Bound to one audit, action, proposal hash and mandate version; expires after 30 minutes; can never raise a money budget. |
| Agent falsifying settlement or audit proof | **IMPLEMENTED** | No `UPDATE (settlement)` on `audit_log`, no anchor signer, no `audit_anchor` write. Its only finalization power is `INSERT (audit_id)` on a durable outbox. |
| Exactly equal to the budget cap | **IMPLEMENTED** | Allowed. Only *greater than* the ceiling is refused, in both the pure engine and the transaction gate. |

Crash points between reservation and signature are **CONSERVATIVE**: state survives in
PostgreSQL, capacity is held until the pre-broadcast TTL expires, and no valid
signature is left in circulation.

---

## Known non-blocking finalist limitations

Real, understood, and deliberately not fixed under code freeze. None of them lets the
untrusted agent move money it was not authorised to move, or falsify settlement.

### Duplicate action IDs can produce a messy audit story — KNOWN NON-BLOCKING BUG

`proposed_action.action_id` is a primary key inserted with `ON CONFLICT (action_id) DO
NOTHING`, while `audit_log.action_id` is **not** unique and action-plus-audit creation
is not one transaction. Reusing an ID can therefore leave an orphan proposal or more
than one audit row referencing it.

**No duplicate payment results**: only one live reservation can exist per action, and a
reservation found under a different audit or payment context is refused rather than
reused. The defect is audit legibility, not money.

Production fix: reject duplicate IDs unless the canonical proposal hash matches, or add
an idempotency-key table with a stored response.

### Live feed can skip rows sharing one timestamp — KNOWN NON-BLOCKING BUG

The SSE projection polls with a strict `evaluated_at >` cursor and a page limit of 50.
If more than 50 rows share a single timestamp, advancing the cursor can permanently
skip the remainder in the *live* view.

This is a **projection** defect. The audit records themselves are complete and correct
in the database, and the dashboard's full refresh normally repairs the view. SSE is
explicitly a live convenience, not a durable event stream: there are no event IDs,
resume tokens, or acknowledgements.

Production fix: a compound `(evaluated_at, audit_id)` cursor or a monotonic sequence.

### Finalization enqueue that never happened is not swept — OPEN — PRODUCTION REQUIREMENT

`finalize()` deliberately swallows a failed outbox insert so that anchoring can never
fail a disposition (Architecture 6.1). There is **no sweeper** that later finds terminal
audit rows with no `audit_finalization` row. During a narrow database outage a `DENY` or
review denial can therefore stay unanchored until an operator re-enqueues it.

The record itself is committed, valid and re-hashable throughout. What is missing is
automatic recovery, not the record.

### Anchor worker "stored-only" jobs are not revisited — PARTIAL

Running the worker with no signer or contract configured stores the digest and marks the
finalization job `DONE` (`outcome: "stored_only"`). Enabling the signer later does **not**
automatically revisit that job and put the digest on chain.

Records report as `pending`, never as anchored, so nothing is overstated — but on-chain
catch-up is a manual step.

### Durable workflow resumption after agent process death — OPEN — PRODUCTION REQUIREMENT

The escalation hold is an in-process polling promise. If the agent process exits or
times out while waiting, a later human approval does **not** automatically resume
authorization and execution.

All financial state survives in PostgreSQL; only the in-memory workflow does not. A
production system would replace the promise with a durable workflow or job.

### Overlapping active mandate versions are deterministic but ungoverned — PARTIAL

The query selects the highest version, and the database prevents mutation of published
policy — but it does not prevent two active versions with overlapping effective ranges.
Whether that is a legitimate staged rollout or a configuration error is an undecided
governance rule. Production should usually enforce non-overlap per agent.

### Other accepted semantics

- **Overnight time windows** (`22:00-02:00`) are not supported by the parser and never
  match. The schema validates shape, not hour and minute ranges. UTC only.
- **Floating-point money** in the pure engine. At execution, amounts become six-decimal
  USDC atomic strings and PostgreSQL uses exact `NUMERIC`; exponential notation and
  over-precision are refused at the schema boundary. Adequate for the demo range, not a
  general financial amount model.
- **Counterparty and currency strings are exact and case-sensitive.** There is no
  registry or normalisation rule.
- **`default_disposition_on_breach` is currently unused.** Unknown-counterparty
  behaviour comes from `unknown_counterparty_disposition`. Do not read the unused field
  as an active fallback.
- **No active mandate produces no audit row** — `runAction` refuses with `no_mandate`
  before settlement. Safe, but not auditable, if "every attempted action is auditable"
  is a requirement.
- **Health indicators are partial.** Database health is a real `SELECT 1`; network and
  facilitator fields report configuration strings, not live reachability.
- **Audit feed scoping is inconsistent.** The spend summary honours `agent_id` while the
  feed and disposition counts are global.

---

## Deliberately deferred — production requirements

Not built, on purpose. Each is a known production-hardening limitation, not a finalist
vulnerability.

### Chain confirmation depth, finality and reorganisation — DEFERRED — FINALIST SCOPE

Settlement requires **exact successful on-chain inclusion** and zero additional
confirmation depth. The settlement state machine has no reorg handling.

This is a deliberate demo trade-off: gating on a confirmation threshold would make every
demo `ALLOW` report `OUTCOME_UNKNOWN` for several blocks. The audit verifier already
reports confirmation depth and supports a threshold; the payment path deliberately does
not gate on it.

A production deployment would choose a chain-specific finality depth before treating
accounting state as irreversible.

### API overload control and rate limiting — OPEN — PRODUCTION REQUIREMENT

There is no rate limit, per-agent quota, bounded request queue, concurrency semaphore,
load shedding, or retry budget. A burst can exhaust the connection pool and accumulate
lock waiters.

**The budget invariant still holds under load** — this is proven by two 1,000-action
sandboxes at concurrency 25 with zero violations. What degrades is availability, not
correctness. Reservation griefing is bounded by the 120-second pre-broadcast TTL but is
not otherwise prevented.

### Database pool, statement and lock timeout policy — OPEN — PRODUCTION REQUIREMENT

Each process uses `pg` defaults with no explicit connection, idle, statement or lock
timeout, and no application-level circuit breaker. A client HTTP timeout does not cancel
server-side SQL.

### Public-internet workload and service identity — OPEN — PRODUCTION REQUIREMENT

Authority-bearing and sensitive read routes require bearer credentials and browser CORS
is allowlisted; both trusted services bind `127.0.0.1` by default as defence in depth.
There is no mTLS, JWT, or workload identity, and the reviewer boundary has no rate limit,
lockout, CSRF/origin check, session expiry, or MFA. One configured reviewer identity
represents all human decisions.

Dashboard Basic auth is a prototype operator boundary, not institutional SSO/MFA.

### Full host or root compromise — DEFERRED — FINALIST SCOPE, BY DESIGN

Out of the threat model, stated plainly rather than defended against. Process and
database-role separation is defeated by root on the same host. Production would use
separately administered hosts or containers with workload identity and a secrets
manager or HSM.

### Operations — OPEN — PRODUCTION REQUIREMENT

Deliberately absent, each a deployment concern rather than a runtime-governance one:

- backup, restore, RPO/RTO, point-in-time recovery and restore testing;
- retention, partitioning and archival (a legal decision — no deletion is implemented,
  on purpose);
- monitoring, alerting and dead-letter processes;
- high availability, supervision, readiness gates, rolling deploys, database failover;
- key rotation and compromise response for the authorization signer, payment key,
  reviewer token, anchor key and database logins; production secret manager or HSM;
- clock-source and maximum-skew policy across Node, PostgreSQL and EVM block time;
- expand/contract schema migration policy for live traffic.

### Audit tampering

**Detectable after anchoring, not prevented.** Least-privilege runtime roles cannot
freely edit audits, and the on-chain verifier detects changed or deleted records against
their anchor. A schema owner can still alter data, and a record that was never anchored
has no external proof. Append-only/WORM retention and backup governance remain open.

---

## How to re-derive this register

Read these first — where prose and code disagree, the code wins:

- `apps/agent/src/orchestrator.ts`
- `apps/api/src/execution-authorizer.ts`, `execution-auth.ts`, `cors-policy.ts`
- `apps/executor/src/execution.ts`, `reconciliation.ts`
- `packages/db/src/reservations.ts`, `authorizations.ts`, `finalization.ts`
- `packages/execution-authorization/src`, `packages/x402-client/src`
- `packages/audit-log/src`, `packages/controls-repository/src/counters.ts`
- `apps/api/src/live.ts`, `packages/db/migrations`

The tests under each package are part of the evidence. `npm run redteam` and
`npm run mutation` exist specifically to prove the security tests can fail.

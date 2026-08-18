# Cerberus finalist security critique and hardening specification

**Status:** approved Stage 2 security-depth amendment, 18 August 2026.

**Source:** distilled from the project owner's `cerberus_cheatsheet_UPDATED.md` and
the attached finalist implementation prompt. The private competitive analysis is not
copied into the public repository; the engineering requirements are preserved here.

**Relationship to the Bible:** `SAFR_RUNTIME_PROJECT_BIBLE.md` remains authoritative
for product direction, SAFR terminology, frozen Section 7 schemas, deterministic rule
order, and the Base Sepolia USDC/x402 rail. This document supersedes only the old
Stage-1 decisions to defer signer isolation, concurrent budget safety, replay/stale
state protection, exact execution binding, and ambiguous-settlement handling.

## Finalist objective

Cerberus must be the strongest possible answer to:

> What happens if the AI itself becomes malicious or compromised?

Depth of authority enforcement wins; breadth does not. Do not add payment rails,
live settlement currencies, FX, checkout features, credit, unrelated UI work,
unrelated refactors, or unnecessary AI behavior.

## Required execution path

```text
AI/runtime
    -> deterministic Cerberus Disposition Engine
    -> ALLOW or approved ESCALATE
    -> atomic budget reservation
    -> one-shot signed Execution Authorization
    -> isolated executor holding the payment key
    -> exact x402 challenge validation
    -> settlement
```

The agent/application process must never receive the x402 payment private key.

## Build order

Complete one phase at a time. Each phase must pass existing tests, new adversarial
tests, typecheck, and the dashboard production build before the next starts.

1. Signer isolation and Execution Authorization.
2. Atomic budget reservations.
3. Replay, stale mandate, and stale human-approval protection.
3.5A. Reviewer authentication.
3.5B. Database privilege separation.
3.5C. Mandate immutability/content freshness.
3.5D. Concurrent velocity enforcement.
4. Exact x402 challenge binding.
5. `OUTCOME_UNKNOWN` settlement reconciliation.
6. Complete adversarial suite.
7. Seeded judge-facing scalability/adversarial sandbox.
8. Demo hardening and feature freeze.

## Execution Authorization contract

Every signed authorization binds at minimum:

- `authorizationId`
- `proposalHash`
- `mandateId`
- `mandateVersion`
- `reservationId`
- `chainId`
- exact token contract
- exact atomic amount
- exact `payTo`
- exact resource/challenge hash
- expiry
- nonce

The executor independently verifies the signature, expiry, one-shot state, proposal,
mandate context, reservation context, chain, token, amount, payee, and resource before
the payer/signer is constructed.

## Financial state

```text
RESERVED -> AUTHORIZED -> SUBMITTING -> SETTLED
                                  |---> FAILED
                                  `---> OUTCOME_UNKNOWN -> RECONCILING -> SETTLED | FAILED
```

- `FAILED` means execution is positively known not to have happened; release safely.
- `OUTCOME_UNKNOWN` means execution may have happened; never retry blindly.
- Do not hold a database transaction open during network or chain settlement.

## Required adversarial evidence

- DENY never reaches the authorizer, executor, or x402.
- Compromised agent process has no payment key or x402 payer import.
- Forged, expired, and replayed authorizations are refused before key use.
- Mutated proposal, payee, amount, token, chain, and resource are refused.
- Concurrent requests, including different agents sharing a mandate, cannot overspend.
- Stale mandate and stale human approval are refused.
- Duplicate proposal creates one financial effect.
- Lost response after broadcast becomes `OUTCOME_UNKNOWN` and is reconciled before retry.
- Positively known failure releases its reservation.

## Current phase boundary

Phases 1, 2, 3, 3.5A, 3.5B, 3.5C, 3.5D, 4, and 5 are complete. The Phase 5 release
gate passed the full **248/248-test suite across 48 suites** against real PostgreSQL.
Phase 6 has not started.

Phase 1 introduced a trusted API/control-plane authorizer and an isolated executor.
Phase 2 replaced the placeholder `phase1_unreserved:<audit_id>` marker with committed
financial state: a `payment_reservation` row created under a transaction-scoped
advisory lock on the mandate, which is the shared financial authority. The invariant
`settled + active reserved + requested <= rolling_window.max_total` is enforced per
(mandate, currency) and is proven by concurrency tests against a real PostgreSQL.

What may now be claimed:

- Concurrent requests, including different agents sharing one mandate, cannot overspend.
- One proposal produces one financial reservation, enforced by partial unique indexes
  as well as by the lock.
- One reservation backs at most one Execution Authorization, so the same audit cannot
  obtain two independently executable capabilities.
- A positively reported settlement failure releases its capacity; a thrown settlement
  error does not, and is recorded as `OUTCOME_UNKNOWN`.
- A reservation survives a process crash between reservation and authorization, and a
  retry resumes the existing hold rather than taking a second one.

Phase 3 now adds a durable `execution_authorization` compare-and-set, a proposal- and
mandate-bound `human_approval` record with an expiry, stale-page refusal in the review
route, current-authority re-evaluation in the authorizer, and independent mandate plus
approval freshness checks in the executor before payer construction.

Phase 3.5A requires a bearer reviewer credential at the API decision endpoint and
derives reviewer identity from trusted server configuration. The browser submits via
an independently authenticated, server-only Next.js route; the API token is never
placed in client JavaScript. The agent has neither dashboard credentials nor an API
reviewer credential, trusted config path, or decision-posting client. Scripted approval
moved to a separate trusted reviewer process.

Phase 3.5B adds three NOLOGIN group roles plus distinct provisioned LOGIN roles. The
agent can write proposals and initial/settlement audit state but cannot modify policy,
review, approval, reservation authority, or authorization state. The control plane
owns approval, reservation creation, and authorization issuance/binding. The executor
can consume authorization and transition execution state. The shared DB package no
longer reads the schema-owner root `.env`; only admin CLIs/tests opt into it.

Phase 3.5C makes every published `(mandate_id, version)` policy body immutable with a
database trigger. Mandate identity/version, agent binding, `effective_from`, scope,
controls, default disposition, creator, and approver cannot change in place. Policy
change means publishing the next version. The only permitted updates are one-way
lifecycle closure: `active → superseded|revoked` and `effective_to: NULL → timestamp`.

Phase 3.5D serializes transaction-count velocity under a per-agent advisory lock while
retaining the shared-mandate budget lock. A raced threshold breach becomes ESCALATE,
not DENY or ALLOW, and no authorization exists until trusted human approval is bound.

Phase 4 fetches the merchant's real x402 v2.21.0 challenge without a signature,
validates protocol version, scheme, chain, token, atomic amount, payee, resource,
EIP-712 identity, and transfer method, and pins the one matching offer. After the
bounded network fetch it obtains a new clock value and fresh database context, then
rechecks authorization expiry, current mandate, approval, and reservation immediately
before consumption. The authorization and reservation database compare-and-sets also
enforce expiry independently.

Phase 5 persists the exact x402 EIP-3009 payer, recipient, nonce, signed-payload hash,
`validBefore`, and pre-submission block before the paid request can leave the executor.
Ambiguous outcomes retain budget and velocity capacity, transition through a leased
`RECONCILING` state, and are resolved by a keyless worker using Circle USDC
`authorizationState`, matching `AuthorizationUsed`, a successful receipt, and the
exact token/from/to/value `Transfer`. An unused authorization is releasable only when
the latest chain timestamp has reached its strict expiry. RPC errors, live
authorizations, cancellations, and mismatched transfer evidence remain UNKNOWN.
`FOR UPDATE SKIP LOCKED` plus rotating fencing tokens gives one terminal writer across
concurrent workers and worker restarts. Terminal reservation and audit settlement are
committed together, and the dashboard projects live execution state beside the frozen
Section 7.5 audit JSON.

What may **not** yet be claimed:

- **Phase 6.** The consolidated judge-facing adversarial suite has not been assembled
  as a single evidence command, even though its component security tests are green.
- The fresh funded hardened-path evidence run remains pending for Phase 8.
- A nonce used without exact transfer evidence is intentionally retained for manual
  investigation; Cerberus does not guess that a cancellation was a payment.

## Phase 2 verification notes

The concurrency tests were checked by deleting the protections and confirming the
tests fail, rather than by observing that the normal path behaves correctly:

- removing the advisory lock fails the two-concurrent-80s, 20-way burst, and
  shared-mandate tests;
- removing the advisory lock and the partial unique indexes additionally fails the
  duplicate-proposal test;
- removing the `bindAuthorization` compare-and-set guard fails the
  one-authorization-per-audit test.

A single two-way race is timing-dependent and can pass by luck with no lock at all, so
the two-party tests repeat their round ten times on a clean budget. `race()` in the
fixtures pre-warms the connection pool and releases every caller from one barrier;
without the pre-warm the first caller completes while the second is still finishing a
TCP and auth handshake, and the test is quietly sequential.

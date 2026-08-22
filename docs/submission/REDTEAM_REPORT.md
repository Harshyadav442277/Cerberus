# Red-Team Report

Deep cross-process and cross-state bug hunt over the finalist build, run after the
security remediation pass and before feature freeze.

**Two genuine vulnerabilities were found and fixed. One test was found to be
incapable of failing. Three tooling bugs in the harness itself were found and fixed.**

Reproduce any of it:

```bash
npm run redteam
```
```bash
npm run mutation
```
```bash
npm run sandbox -- --seed 42 --agents 50 --actions 1000 --concurrency 25
```

---

## Findings

### 1. Signed payment authority could be forwarded across a redirect — **FIXED**

| | |
| --- | --- |
| **Severity** | High (bounded — see below) |
| **Where** | `packages/x402-client/src/pay.ts`, `challenge.ts` |
| **Status** | Fixed in `dfa44af` |

Both x402 request paths used `fetch`'s default `redirect: "follow"`. The paid request
carries a live signed EIP-3009 authorization in a `PAYMENT-SIGNATURE` header, and the
fetch specification strips only `Authorization`, `Cookie` and `Proxy-Authorization`
across a cross-origin redirect — a custom header is forwarded intact.

A merchant could therefore answer the paid request with a 302 and have Cerberus hand
its signed payment authority to a host nobody approved.

**Why the severity is bounded:** EIP-3009 binds the recipient into the signature, so a
redirect target cannot redirect the funds to itself. What it *can* do is read a live
signed payload and settle it at a timing of its choosing. That still breaks the
exact-resource threat model the executor is built around, which is the whole premise
of validating the merchant's challenge before signing.

**Fix.** Both paths now use `redirect: "error"`, with a response-shape check behind it
for any fetch implementation that reports rather than throws. The unsigned path
surfaces `CHALLENGE_REDIRECTED` before anything is signed. The signed path rejects
*after* the request reached the intended merchant, so the executor correctly resolves
it as `OUTCOME_UNKNOWN` rather than assuming non-payment.

**Tests.** `packages/x402-client/src/__tests__/challenge.test.ts` →
`redirects never carry payment authority` (3 assertions).

---

### 2. An infinite amount parsed as a valid proposal — **FIXED**

| | |
| --- | --- |
| **Severity** | Low (never spendable, but the safety was accidental) |
| **Where** | `packages/core/src/schemas/proposed-action.ts` |
| **Status** | Fixed in `5c727c7` |

`z.number().positive()` accepts `Infinity`, because `Infinity` is a number and is
greater than zero. An infinite amount therefore parsed as a well-formed proposal.

It was never spendable — the per-transaction cap denies it, since `Infinity` exceeds
every finite ceiling, and the atomic conversion refuses it outright. But that made the
safety a property of two downstream checks rather than of the type, and any future
path not passing through both would have inherited the hole.

**Fix.** `z.number().positive().finite()`.

**Tests.** `packages/execution-authorization/src/__tests__/money.test.ts` (17
assertions covering zero, negative, NaN, both infinities, a seventh decimal place,
exponential notation in both directions, and exact round-tripping).

---

### 3. A security test that could not fail — **FIXED**

| | |
| --- | --- |
| **Severity** | Medium (the vulnerability was absent, but the proof was worthless) |
| **Where** | `packages/x402-client/src/__tests__/challenge.test.ts` |
| **Status** | Fixed in `79c5b17` |

Found by the mutation matrix, not by review. Flipping `redirect: "error"` to
`"follow"` left the redirect test green.

The assertion on `request.redirect` lived *inside* the fetch stub. An `AssertionError`
raised there rejects the fetch promise, and its own message contains the word
"redirect" — which the rejection matcher was accepting as evidence that the guard had
fired. The test passed whether the guard existed or not.

**Fix.** The redirect mode is recorded in the stub and asserted after the call, and
the matcher looks for the specific thrown message rather than any mention of
redirects.

This is the finding that most justifies the mutation matrix existing. A security suite
that cannot fail is indistinguishable from one that checks nothing, and it fails in
the reassuring direction.

---

### 4. Harness bugs found while building the red team — **FIXED**

Not product vulnerabilities, but each would have produced a *false* result, which is
worse than no result.

| Bug | Consequence had it shipped | Fix |
| --- | --- | --- |
| Mutation anchors written with `LF` against a `CRLF` checkout | Every **multi-line** anchor silently failed to match, reporting 4 guards as UNDETECTED — a false finding about the suite | `65c567a` |
| Velocity-lock mutation pattern omitted the one test designed to catch it | Reported the velocity lock as undetectable; same-mandate racers serialise on the *budget* lock, so only the distinct-mandate test isolates it | `65c567a` |
| Sandbox called `pick()` inside a `find()` predicate | Redrew a different id per element — broke the lookup and consumed a varying number of random values, destroying the determinism the generator exists to provide | `e6985df` |
| Sandbox replay invariant flagged any duplicate that reserved | A duplicate whose original was refused has no prior financial effect and is a legitimate retry; the check contradicted the SQL invariant instead of agreeing with it | `e6985df` |

---

## D1 — Crash injection matrix

Each boundary must resolve to exactly one of: safe retry before payment authority
left the process, `OUTCOME_UNKNOWN`, or exactly one `SETTLED` effect.

| # | Crash point | Outcome | Proven by |
| --- | --- | --- | --- |
| 1 | After reservation | Pre-broadcast TTL releases capacity | `releases a pre-broadcast reservation once its TTL passes` |
| 2 | After authorization DB record | Inert ISSUED row, expires unused | `packages/db/src/__tests__/authorizations.test.ts` |
| 3 | After authorization signature | One-shot store refuses any later use | `refuses a replay after the executor process that consumed it is gone` |
| 4 | After durable consume | Replay refused across processes | `refuses a replay from a SECOND executor process with its own clean memory` |
| 5 | After SUBMITTING | Stale row recovered by reconciler | `recovers a correlated SUBMITTING row after a post-broadcast process crash` |
| 6 | After payer preparation | Positively known non-payment, capacity released | `does not send when durable correlation persistence refuses` |
| 7 | After payment correlation | Correlation durable before transport; reconcilable | `persists chain correlation and never frees UNKNOWN by reservation TTL` |
| 8 | After signed request leaves | `OUTCOME_UNKNOWN`, never retried blindly | `keeps a post-signature timeout OUTCOME_UNKNOWN without retrying` |
| 9 | After merchant response | Merchant is not authoritative either way | `keeps a hostile merchant-reported failure OUTCOME_UNKNOWN after transmission` |
| 10 | After chain proof | Terminal transition is a compare-and-set | `refuses a terminal transition from the wrong state and reports the loss` |
| 11 | After reservation terminal update | Same transaction wrote audit + outbox | `commits reservation, audit and anchor request in one transaction` |
| 12 | Before audit update | Impossible — one transaction | as above |
| 13 | Before outbox commit | Impossible — one transaction | as above |
| 14 | Before anchor | Outbox row survives; worker reclaims it | `leaves consistent state when the process dies immediately after committing` |
| 15 | After anchor submit, before local confirm | Lease expires, job reclaimed, re-anchoring is safe | `reclaims a crashed worker's job once its lease expires` |

Points 12 and 13 are not *tested* so much as *designed out*: the reservation
transition, the audit settlement and the outbox insert are one `terminalizeSettlement()`
transaction, so there is no interval between them in which a crash can land.

---

## D2 — Executor vs reconciler race

Forced both routes to prove the same settlement concurrently.

**Result:** exactly one terminal reservation truth, one transaction hash, one audit
settlement, one finalization request. The loser is *told* it lost rather than silently
ignoring a zero-row update, reports the committed transaction rather than its own
view, and refuses to report success at all if it lost to a non-settlement.

`markSettled()` was replaced entirely by `terminalizeSettlement()`, which returns
whether it won its compare-and-set. Proven by `produces one terminal truth when
executor and reconciler race` and `terminal transition races` (5 assertions).

---

## D3 — Hostile agent audit attack

Every statement issued with the **agent's real database credentials** — not a mock, and
not a code-level guard a compromised process could route around.

| Attempt | Result |
| --- | --- |
| `UPDATE mandate` | `42501` permission denied |
| `INSERT human_approval` | `42501` |
| `INSERT execution_authorization` | `42501` |
| `UPDATE payment_reservation` | `42501` |
| Consume an authorization | `42501` |
| `UPDATE audit_log SET settlement` | `42501` |
| `INSERT audit_anchor` | `42501` |
| `UPDATE audit_anchor` | `42501` |
| `UPDATE audit_finalization SET status` | `42501` |
| `INSERT audit_finalization (audit_id)` | **allowed, deliberately** — a DENY never reaches the executor and must still be anchored. The worker re-reads the record and derives the digest itself, so this cannot influence *what* is anchored. |

Additionally verified directly against the live `cerberus_agent_app` login outside the
test suite, to confirm the grants and not merely the fixtures.

---

## D4 — Security mutation matrix

**12/12 guards proven detectable.** Each guard is removed, the tests that claim to
detect that exact vulnerability are run, and they must fail.

| Guard removed | Result |
| --- | --- |
| Budget advisory lock | DETECTED |
| Per-agent velocity lock | DETECTED |
| Fresh authority recheck after the unsigned 402 | DETECTED |
| Agent suspension check in the executor | DETECTED |
| Agent suspension check in the reservation transaction | DETECTED |
| Reservation context equality on reuse | DETECTED |
| Durable payment correlation before transport | DETECTED |
| Chain proof required before SETTLED | DETECTED |
| Merchant-reported failure held as OUTCOME_UNKNOWN | DETECTED |
| On-chain anchor digest comparison | DETECTED |
| Redirect refusal on the signed request | DETECTED |
| Database trigger blocking correlated FAILED | DETECTED |

The run refuses to start on a dirty working tree and asserts the tree is clean again
before reporting PASS, so a vulnerable mutation cannot escape into a commit. Machine
output: `artifacts/final-evidence/redteam/mutation-matrix.json`.

---

## D5 — Money boundaries

Every case refused or converted exactly; nothing silently rounds.

Refused: `0`, negative, `NaN`, `Infinity`, `-Infinity`, seven decimal places,
exponential notation in both directions, a string amount (no coercion), and any atomic
value that is not a non-negative integer.

Exact: smallest unit (`0.000001` → `1`), `0.3` → `300000` with no float drift, and
exact round-tripping across every boundary amount. Conversion runs through `BigInt`,
never floating-point arithmetic.

---

## D6 — Time boundaries

Each expiry comparison pinned at **−1 ms, the boundary instant, and +1 ms**, because
both `<` and `<=` pass every test written a whole second away.

Convention, now proven consistent in both directions: **expiry is exclusive**. An
authority is usable strictly before its expiry instant and unusable at it. Lower
bounds covered too — an authority not valid at its own issuance instant would be
unusable for its entire life. Mandate `effective_from`/`effective_to` boundaries are
covered by `npm run db:verify`.

---

## D7 — Network and merchant ugliness

Challenge timeout, malformed 402, malformed JSON, HTTP 500, wrong protocol version,
wrong chain, wrong token, wrong amount, wrong recipient, wrong resource, wrong EIP-712
domain, wrong transfer method, a malicious offer listed first, merchant delaying until
authority expires, RPC down after merchant success, merchant reporting failure then
settling later, and merchant reporting success with a fabricated hash — all covered by
the existing adversarial classes and all still green.

**Redirects** were the gap, and are finding #1 above.

---

## D8 — Database invariant stress

`npm run sandbox -- --seed 42 --agents 50 --actions 1000 --concurrency 25`

| | Seed 42 | Seed 1337 |
| --- | --- | --- |
| ALLOW / DENY / ESCALATE | 884 / 52 / 64 | 863 / 70 / 67 |
| Throughput | 1050 actions/s | 915 actions/s |
| Policy latency p50 / p95 / p99 | 4.28 / 7.92 / 17.66 ms | 4.91 / 10.97 / 21.19 ms |
| Hostile proposals | 139 | — |
| Duplicates submitted | 55 | 49 |
| **Budget violations** | **0** | **0** |
| **Duplicate financial effects** | **0** | **0** |
| **Replay violations** | **0** | **0** |

All six invariants queried from PostgreSQL *after* the run, never from application
counters:

- committed spend ≤ mandate budget, including across shared mandates
- one proposal, at most one live reservation
- one reservation, at most one authorization
- no capacity committed for a DENY or ESCALATE
- velocity ceiling held without an approval
- no proposal reserved twice across the run

---

## Remaining limitations

Stated plainly, as of this report's date. None of these is claimed as fixed anywhere in
this repository, except where an item is explicitly annotated below as resolved later.

- **Inclusion, not finality.** Settlement proof requires an exact successful on-chain
  transfer but does not wait for a confirmation threshold. The audit verifier reports
  and can threshold confirmation depth; the settlement path deliberately does not gate
  on it, because doing so would make every demo ALLOW report `OUTCOME_UNKNOWN` for
  several blocks.
- **Authentication is not a complete internet perimeter.** Trusted services bind
  `127.0.0.1`; capability issuance and sensitive control-plane routes also require
  separate bearer credentials and browser CORS is allowlisted. A public deployment
  still needs TLS, rotation, rate limiting, monitoring and perimeter controls.
- **Same-host compromise.** Process isolation is by operating-system boundary and
  database role. An attacker with root on the host defeats it, as they would defeat
  any single-machine deployment.
- **Fresh funded live evidence.** *(Stated as blocked when this report was written on
  19 August 2026; resolved on 22 August 2026.)* The signers were provisioned and the
  hardened path settled live on Base Sepolia — see
  [FINAL_FREEZE.md](./FINAL_FREEZE.md) and
  [`artifacts/judge-evidence/`](../../artifacts/judge-evidence/). Nothing was fabricated
  while the blocker stood.
- **The sandbox does not settle.** It exercises the governance gate at scale, not the
  payment rail; the rail is proven adversarially and (historically) live.

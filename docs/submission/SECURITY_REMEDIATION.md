# Security Remediation — Finalist Hardening Pass

**Baseline inspected:** `6159474` (`origin/main`, "Record Phase 6 adversarial proof")
**Baseline verification:** 260 tests / 48 suites; adversarial 12/12 classes, 78/78 assertions

**After remediation** (figures as at the close of this pass; the later finalist
completion build raised them to 363 / 72 — see the README's current-build section):
330 tests / 61 suites; adversarial 12/12 classes, 80 assertions;
red team 9/9 classes, 60 assertions; dependency audit clean.

This pass did **not** reopen the financial-authority work that earlier phases already
closed (self-approval, caller-controlled reviewer identity, shared DB credential,
reservation→larger-payment mutation, same-version mandate mutation, concurrent
velocity bypass, live x402 substitution, ambiguous-outcome handling, blind retry,
merchant-reported failure and success). Regression coverage for all of it stayed green
throughout — see **Attack I** below.

---

## Summary table

| Finding | Previous status | Fix | Attack test | Result | Residual limitation |
| --- | --- | --- | --- | --- | --- |
| **Agent suspension was not a kill switch** | `agent_identity.status` was stored but never consulted. A suspended agent kept full execution authority. | Status is read from trusted state at three independent points: authorization issuance, inside the reservation transaction, and twice in the executor (initial resolve + post-402 fresh recheck). Absent identity is treated as suspended. | Attack A — 10 assertions | **Fixed** | Suspension is enforced at authority boundaries, not by killing an in-flight RPC. A payment already broadcast is resolved by chain reconciliation, as any other in-flight payment is. |
| **On-chain audit verification never read the chain** | `audit:verify` re-hashed the record, compared it to `audit_anchor.record_hash`, then printed "on chain" from `status='anchored'`. Every value came from one database. | New verifier fetches the receipt from Base Sepolia, requires success, the expected chain, the expected contract, and decodes the `Anchored` event — then requires recomputed == DB-recorded == chain-proven. RPC failure yields UNVERIFIED and a non-zero exit. | Attack C — 12 assertions | **Fixed** | Verification proves *exact successful inclusion*. It reports confirmation depth but does not require a finality threshold — see "Confirmation / finality" below. |
| **Hostile agent could write terminal settlement** | `GRANT UPDATE (settlement) ON audit_log TO cerberus_agent_role`, and the agent wrote it after every payment. | Revoked in migration 011. Terminal audit truth is now written by whichever trusted process proved the outcome on chain. `recordSettlement` was removed from the agent's port entirely. | Attack B — 5 assertions | **Fixed** | The agent still writes the *initial* proposal/disposition record, by design — that is the auditable claim it is supposed to make. |
| **Hostile agent could manufacture anchor state** | Agent role held `INSERT` and `UPDATE` on `audit_anchor`; agent process loaded `AUDIT_ANCHOR_PRIVATE_KEY`. | Both revoked. The agent's only remaining power is `INSERT (audit_id)` on the finalization outbox — "please anchor this row". The worker re-reads the record and computes the digest itself. | Attack B — 5 assertions; Attack E — 7 assertions | **Fixed** | The agent can still *enqueue* a finalization, deliberately: a DENY never reaches the executor and must still be anchored. It cannot choose the digest, mark anything anchored, or retire a job. |
| **Audit-anchor key ownership** | Key was read by `apps/agent` env loader and listed in `.env.agent.example`. | Removed from the loader, deleted from `process.env` defensively at startup, removed from the example file, and moved to a new trusted anchor worker with its own `.env.anchor` and DB role. | Attack B (`agent has no anchor authority`); `npm run adversarial` class 1 | **Fixed** | — |
| **Terminal financial and audit state could diverge** | Executor set the reservation `SETTLED`, returned, and depended on an agent callback to write audit settlement and the anchor. A crash between them left `SETTLED` + `settlement IS NULL`. | One `terminalizeSettlement()` transaction commits reservation status, audit settlement, and the durable anchor request together. No agent callback is involved. | Attack D — 3 assertions | **Fixed** | — |
| **Finalization crash recovery** | Anchoring was fire-and-forget in the agent process; a crash lost it silently. | Durable `audit_finalization` outbox with lease + fencing token, `FOR UPDATE SKIP LOCKED` claim, backoff, and idempotent completion. A crashed worker's job is reclaimed on lease expiry. | Attack E — 7 assertions | **Fixed** | The worker must be running (`npm run anchor`) for anchors to reach the chain. If it is not, digests are still stored durably and records report as pending — never as anchored. |
| **Executor / reconciler race** | Both could prove the same settlement; terminal updates did not check whether they won. | Every terminal update is a compare-and-set (and a lease fence for the reconciler) and returns whether it won. The executor that loses reports the *committed* transaction, and refuses to report success if it lost to a non-settlement. | Attack F — 5 assertions | **Fixed** | — |
| **Reservation reuse did not verify its own invariants** | `reserveBudget` returned any live reservation matching `audit_id OR action_id` without checking amount, token, chain, agent, mandate version or currency. | Reuse now requires exact equality on all of them (money compared as `NUMERIC`, token case-insensitively). A mismatch returns `context_mismatch` → `RESERVATION_CONTEXT_MISMATCH`; the existing reservation is neither reused nor replaced. Applied on both the normal path and the unique-violation recovery path. | Attack G — 5 assertions, incl. the judge-readable *"cannot reuse a smaller reservation for a larger payment"* | **Fixed** | — |
| **Internal service exposure** | `app.listen(PORT)` bound `0.0.0.0` on both the control plane and the executor. | Both bind `127.0.0.1` by default. Capability issuance now also requires a dedicated service bearer token; reviewer and sensitive read routes require the reviewer bearer token; browser CORS is allowlisted. | Attack H plus final-release auth regressions | **Fixed with authentication and defense in depth** | A wider deployment still requires TLS, credential rotation, rate limiting, monitoring and perimeter controls. |
| **Pending escalation exposure** | `GET /escalations` was unauthenticated and returned counterparty, amount and agent for every waiting payment. | Reviewer-authenticated. The dashboard reaches it through a new server-side proxy (`/api/escalations`) that holds the bearer token, so it never enters browser JavaScript. | Attack H — 4 of its 7 assertions | **Fixed** | The waiting-agent mechanism was unaffected: it observes decisions by polling `audit_log` directly and never used this route. |
| **Reconciler database role** | The reconciler login inherited `cerberus_executor_role` wholesale, including execution-authorization consumption. | New `cerberus_reconciler_role` with only what reconciliation needs: correlation reads, lease claim/fence, defer, chain-proven settle, expired-unused failure, terminal audit write, outbox enqueue. | Attack I — 6 assertions | **Fixed — not deferred** | It retains `UPDATE (settlement) ON audit_log`, which is required: the reconciler is a trusted terminal finalizer. It cannot consume authorizations, bind reservations, mutate mandates, create approvals, or author anchors. |
| **Confirmation / finality semantics** | Chain proof verified exact successful inclusion only. | Confirmation depth is now computed and reported by the audit verifier, with a configurable `AUDIT_MIN_CONFIRMATIONS` threshold that flags shallow anchors. | Attack C — 2 confirmation assertions | **Partially implemented — deliberately** | **The settlement path still treats exact successful inclusion as SETTLED.** Requiring N confirmations there would make every ALLOW demo report `OUTCOME_UNKNOWN` for N blocks, which is the demo destabilization the remediation brief said to avoid. See the explicit statement below. |
| **Dependency audit** | Stale claim of "6 vulnerabilities: 4 high, 2 moderate". Actual current audit: 8 (5 high, 2 moderate, 1 low). | All 8 fixed via pnpm `overrides` raising `postcss`, `nanoid`, `tmp`, `sharp`. No direct dependency or framework major version changed. | Build + full suite re-verified after the upgrade | **Fixed — 0 vulnerabilities** | See [DEPENDENCY_AUDIT.md](./DEPENDENCY_AUDIT.md). All 8 were build-time, dev-only, or optional-and-unused; none was on the payment path. |
| **CI** | No GitHub status checks on head. | GitHub Actions workflow running PostgreSQL, migrations, role provisioning, seed, schema verification, typecheck, tests, adversarial, red team, contract compile and dashboard build — with no wallet secrets and no live payment. | Run [32263194913](https://github.com/Harshyadav442277/Cerberus/actions/runs/32263194913) | **Implemented and green** | CI does not run a funded payment, by design. The live-evidence run stays manual. It independently reproduces 363/363 tests, 12/12 adversarial classes, 9/9 red-team classes and a clean dependency audit on a fresh Linux runner. |
| **Documentation consistency** | Stage-1 numbers mixed with Stage-2 claims. | README carries one **Current finalist build** section with the real SHA and counts; historical evidence is labelled as such rather than rewritten. | — | **Fixed** | — |

---

## What the implementation actually provides

### Suspension semantics (Remediation 1D)

The lifecycle is `active ⇄ suspended`, and reactivation is permitted. The invariant
the implementation provides is **option B**, and it holds for a specific reason:

> A capability issued before suspension does not become usable again on reactivation,
> because it cannot survive that long.

Execution Authorizations carry a **60-second TTL** and are **one-shot** — durably
consumed by a compare-and-set on `execution_authorization`. The backing reservation
holds a **120-second pre-broadcast TTL** and is released to `EXPIRED` once it lapses.
So a capability minted before a suspension is expired and unusable long before any
realistic reactivation, and the executor re-verifies TTL, one-shot state, reservation
binding, mandate version, approval freshness **and now agent status** on every attempt.

A suspension shorter than 60 seconds is therefore the only window in which a
pre-existing capability could be replayed after reactivation — and within that window
the executor's own status check refuses it while the agent is suspended, and after
reactivation the agent is, by the operator's own action, authorized again.

### Confirmation / finality — the precise claim

> Cerberus proves **exact successful chain inclusion**: the transaction exists, it
> succeeded, it went to the expected contract on the expected chain, and it carries
> the expected transfer or digest. A production deployment should additionally wait
> for a configurable confirmation/finality threshold before treating accounting state
> as irreversible. This prototype does not, on the settlement path.

The audit verifier reports depth and can flag anchors below a configured threshold.
The settlement path does not gate on depth. This is a stated limitation, not an
oversight.

### Deployment boundary — the precise claim

> Prototype trusted-service interfaces are authenticated and loopback scoped by default.

`apps/api` and `apps/executor` bind `127.0.0.1` by default. The reconciler and the
anchor worker have no HTTP surface at all. The dashboard is a local Next.js server
that holds the reviewer credential server-side. No claim of public-internet safety is
made anywhere in this repository.

---

## Trust boundaries after remediation

| Process | Signing authority | Database role | May write final audit truth |
| --- | --- | --- | --- |
| `apps/agent` (untrusted) | none | `cerberus_agent_role` | **No.** Initial disposition record + `INSERT (audit_id)` on the outbox only |
| `apps/api` (control plane) | Execution Authorization key | `cerberus_control_plane_role` | No |
| `apps/executor` (isolated) | x402 payment key | `cerberus_executor_role` | Terminal settlement only, from its own chain proof |
| reconciler | none | `cerberus_reconciler_role` | Terminal settlement only, from its own chain proof |
| anchor worker | audit-anchor key | `cerberus_anchor_role` | Anchors only — no financial authority at all |

No process holds two of: the payment key, the authorization key, the anchor key, the
reviewer credential.

---

## Release gate

Run from a clean checkout with PostgreSQL up and migrations applied:

```bash
npm run typecheck && npm test && npm run adversarial && npm run redteam && npm run build --prefix apps/dashboard && npm run contracts:compile && npm run db:verify && corepack pnpm audit
```

| Gate | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm test` | **330 passed / 330**, 61 suites, 0 failed |
| `npm run adversarial` | **12/12 classes**, 80 assertions |
| `npm run redteam` | **9/9 classes**, 60 assertions |
| `npm run build --prefix apps/dashboard` | builds |
| `npm run contracts:compile` | AuditAnchor, solc 0.8.36 |
| `npm run db:verify` | all checks pass |
| `corepack pnpm audit` | no known vulnerabilities |

### Stop conditions — all clear

| # | Stop condition | Status |
| --- | --- | --- |
| 1 | Suspended agent can still reach the payment key | **Clear** — Attack A |
| 2 | Hostile agent can write terminal settlement truth | **Clear** — Attack B |
| 3 | Hostile agent can write final audit-anchor state | **Clear** — Attack B |
| 4 | Fake DB anchor can pass on-chain verification | **Clear** — Attack C |
| 5 | Reservation context mismatch can authorize a different payment | **Clear** — Attack G |
| 6 | Direct chain settlement can leave contradictory reservation/audit truth | **Clear** — Attack D, F |
| 7 | Any existing P0 financial attack reappears | **Clear** — Attack I / `npm run adversarial` 12/12 |

---

## Repository hygiene

- **No secrets are tracked.** Only `.env*.example` files are committed, and all
  credential fields in them are empty or `CHANGE_ME` placeholders.
- The 64-hex literals in tracked files are the **secp256k1 curve order** (a public
  constant in `keys.ts`), synthetic test fixtures (`0x1111…`), and **public Base
  Sepolia transaction hashes** in the evidence docs.
- `.gitignore` was missing `.env.reconciler`; that gap is closed, and `.env.anchor` is
  ignored from the outset.
- Branch `codex/publish-current-code` is **obsolete**: `main` is 62 commits ahead of
  it. It is documented here rather than deleted, since it still holds commits not
  reachable from `main` and branch deletion is not this repository's call to make
  automatically.

---

## What this pass does *not* claim

- No funded live payment was made during this remediation. Every result above comes
  from local tests, mocked-chain tests, real PostgreSQL, and read-only verification
  logic with injected chain adapters.
- The on-chain verifier was exercised against injected read-only adapters covering
  every failure mode. Running it against historical Base Sepolia anchors requires
  `AUDIT_ANCHOR_ADDRESS` and RPC access.
- This is a hackathon prototype on testnet. It is not a production payment system.

# SAFR Runtime — Build Phases

**Derived from:** Bible Section 10's build sequence, converted into phases with explicit Definitions of Done.
**Authority:** `SAFR_RUNTIME_PROJECT_BIBLE.md` overrides this document on any conflict.

**Final implementation status (Aug 14):** Phases 0–7 and 9 are complete and verified. Phase 8's narration was recorded, but the visual edit was not completed to publication standard and is intentionally omitted; the mandatory supporting-material requirement is satisfied by the architecture diagram and verified evidence captures. Phase 10's repository materials are complete; team identity and portal submission state remain external human-only facts.

## Stage 2 finalist hardening — active from 18 August 2026

The sections below preserve the completed Stage-1 build history. Stage 2 is governed
by `Critique.md`, which strengthens the authority boundary without changing the
Bible's product scope, schemas, terminology, deterministic rule order, or x402/Base
Sepolia rail. Complete these phases strictly in order; do not begin the next phase
until the current phase passes its Definition of Done.

1. **Signer isolation and Execution Authorization — code and adversarial tests
   complete; fresh hardened live run pending.** The agent contains neither payment
   key nor payer import. A trusted control plane re-evaluates stored context and signs
   a short-lived capability. Only an isolated executor may load the payment key,
   verify every bound field, consume the capability, and construct the payer.
2. **Atomic budget reservations — complete.** Spend is reserved transactionally before
   authorization; no database transaction remains open during settlement.
3. **Durable replay and freshness — complete and verified.** One-shot authorization
   state and bound human approvals are persisted; the authorizer and executor reject
   stale mandate/approval context before key use. Migration 004 applies and rolls back
   cleanly, and the full real-PostgreSQL suite passes 176/176 tests across 36 suites.
3.5A. **Reviewer authentication — complete and verified.** The decision endpoint
   requires a trusted bearer credential, reviewer identity is server-controlled, the
   dashboard uses a server-only proxy, and the agent has no reviewer credential or
   decision client. The protected dashboard proxy also rejects agent-style calls. The
   full suite passes 183/183 tests across 38 suites.
3.5B. **Database privilege separation — complete and verified.** Separate agent,
   control-plane, and executor PostgreSQL group/login roles enforce authority with
   GRANT/REVOKE. Agent-credential attacks fail with SQLSTATE 42501; the full suite
   passes 191/191 tests across 40 suites.
3.5C. **Mandate immutability/content freshness — complete and verified.** PostgreSQL
   rejects every policy-bearing rewrite of a published version; policy changes require
   a new version. Only one-way lifecycle closure remains mutable. The v17 post-auth
   mutation attack fails before key use, and the full suite passes 194/194 tests.
3.5D. **Concurrent velocity enforcement — complete and verified.** Per-agent
   transaction-count races serialize at reservation time, preserve velocity breach →
   ESCALATE semantics, and require a bound human approval before one retry.
4. **Exact x402 binding — complete and verified.** The executor validates and pins the
   merchant's actual live challenge before key use. A bounded unsigned fetch is
   followed by a fresh trusted-context/clock read; authorization, mandate, approval,
   and reservation expiry are rechecked immediately before the final database CAS.
   The full suite passes 232/232 tests across 45 suites.
5. **Ambiguous settlement reconciliation — complete and verified.** Exact x402
   EIP-3009 correlation is durably committed before transport. A keyless, leased,
   fencing-token worker resolves exact chain-proven settlement or expired-unused
   non-payment, while inconclusive evidence retains capacity. Terminal audit and
   reservation state commit together, and the dashboard displays UNKNOWN and
   RECONCILING explicitly. The full suite passes 249/249 tests across 48 suites.
6. **Complete adversarial suite — not started.** Consolidate the critique's hostile
   cases as repeatable evidence.
7. **Seeded judge-facing sandbox — not started.** Demonstrate shared-mandate and
   adversarial cases without broadening the product.
8. **Demo hardening and freeze — not started.** Run the complete hardened path,
   capture evidence, then freeze.

**Stage-2 Phase 1 Definition of Done:** the agent cannot access the x402 payment key
or import the payer; DENY reaches neither authorizer nor executor; forged, expired,
replayed, and field-mutated authorizations fail before payer construction; all legacy
tests, typecheck, contract compile, and dashboard production build pass; and one
funded Base Sepolia run proves ALLOW and approved ESCALATE through the new executor.
The last live-run item is deliberately not inferred from the older Stage-1 hashes.

---

## Timeline — recomputed against the real date

Bible §10 explicitly instructs: *"recompute the day count against today's actual date and the Aug 14, 9:15 PM GMT+5:30 deadline before committing to a day-by-day schedule. Do not assume the day numbers below are still accurate."*

- **Now:** Friday, Aug 7, 2026, 00:17 IST
- **Stage 1 deadline:** Friday, Aug 14, 2026, 21:29 IST (11:59 PM SGT)
- **Actual remaining at the Aug 7 planning checkpoint: 7 days, 21 hours, 12 minutes.** The Bible was written against 8 days; that count became stale.
- **Self-imposed submission target: Aug 14, 12:00 IST** — a 9-hour, 29-minute buffer. Portal problems at the deadline are a preventable, avoidable way to lose everything.

Stage 2 (on-site at NTU, Aug 21–23) requires a functional prototype and in-person attendance, but only happens if shortlisted. It is **not** planned for here. Stage 1 is the only thing on the clock.

| Day | Focus |
|---|---|
| Fri Aug 7 | Phase 0 (prereqs, repo) + Phase 1 (bare x402 payment) |
| Sat Aug 8 | Phase 2 (Postgres schema) + Phase 3 (Disposition Engine) |
| Sun Aug 9 | Phase 4 (interception wiring) + Phase 5 (audit log + anchor) |
| Mon Aug 10 | Phase 6 (dashboard) |
| Tue Aug 11 | Phase 6 finish + Phase 7 (full demo run-through) |
| Wed Aug 12 | Phase 7 hardening + Phase 9 (architecture diagram) |
| Thu Aug 13 | Phase 8 (backup demo video) + Phase 10 (submission draft) |
| Fri Aug 14 | Buffer, final self-check (Bible §12), **submit by 12:00 IST** |

**Rules for the schedule:** Phases 1–7 are strictly dependency-ordered and must not be run out of order (Bible §10, Rules R9). Phases 8, 9, 10 are submission work and can absorb slippage. If a phase overruns, the cut list is in the "Descope ladder" at the bottom — cut from there, never from Phases 1, 4, or 7.

---

## Phase 0 — Prerequisites and repo skeleton

*Not in Bible §10 explicitly, but Phase 1 cannot start without it.*

**Work**
- pnpm workspace monorepo per `Architecture.md` §4; TypeScript config; `.env.example`.
- `docker-compose.yml` with Postgres 16 (running, not yet schema'd).
- Obtain and verify: a Base Sepolia wallet funded with **testnet USDC** and a little Sepolia ETH; one LLM API key.

**Definition of Done**
- `pnpm install` succeeds from a clean clone; the workspace builds.
- `docker compose up` gives a reachable Postgres.
- The payer wallet's testnet USDC balance is confirmed non-zero by an on-chain read, not assumed.

**Blocker risk (highest in the project):** no funded testnet wallet means Phase 1 cannot complete, and every later phase depends on Phase 1. Resolve this first, before writing any other code.

---

## Phase 1 — Bare x402 testnet payment, zero governance

*Bible §10 step 1: "stand up a bare x402 testnet payment flow end-to-end (agent → rail, **no rules yet**) — prove the payment rail itself works before adding any governance logic on top of it."*

**Work**
- `apps/merchant`: `@x402/express` resource server, one route (`GET /pay/merchant_xyz`), priced in USDC on `eip155:84532`, testnet facilitator `https://x402.org/facilitator`.
- `packages/x402-client`: `@x402/fetch` + `@x402/evm`, signer from the
  executor-only `EXECUTOR_EVM_PRIVATE_KEY` via `viem` (the original shared-key setup
  was superseded by Stage-2 Phase 1).
- A throwaway script that pays that route once and prints the decoded `PAYMENT-RESPONSE`.

**Definition of Done**
> **Phase 1 is done when a bare x402 testnet payment fires successfully with zero governance logic in front of it** — a single command executes a real USDC transfer on Base Sepolia, prints a settlement transaction hash, and that hash is independently verifiable on a Base Sepolia block explorer.

No disposition engine, no database, no mandate, no dashboard exists at this point. If the rail does not work in isolation, nothing built on top of it can.

---

## Phase 2 — Postgres schema

*Bible §10 step 2: "Build the Postgres schema mirroring Sections 7.1–7.5 exactly."*

**Work**
- Migrations for `agent_identity`, `mandate`, `proposed_action`, `audit_log` with the **exact** field names from Bible §7 (Rules R4). Nested `scope`, `controls`, `payload`, `human_review`, `settlement` as JSONB to preserve shape verbatim.
- `packages/core`: zod schemas + TypeScript types generated from the same field names.
- `scripts/seed.ts`: one agent identity (§7.1) and `mandate_001` version 1 (§7.2).

**Definition of Done**
- Migrations apply to a clean database and roll back cleanly.
- Seed inserts the agent and mandate; reading `mandate_001` back and parsing it through the zod schema round-trips with **zero** field renaming or shape loss.
- A query for the active mandate at a given timestamp correctly honours `effective_from` / `effective_to`.

**Open item before seeding:** confirm the seeded numeric values (PRD §4.4 — testnet funding cannot support the Bible's illustrative 1000/500 USDC figures). Schema unchanged either way; only seed values differ.

---

## Phase 3 — Disposition Engine

*Bible §10 step 3: "Implement the Disposition Engine (`evaluate()`) against a hardcoded seed mandate, following the exact check order in Section 7.4."*

**Work**
- `packages/disposition-engine`: pure `evaluate(proposed_action, mandate, counters)`, implementing Bible §7.4's eight branches in exactly that order. Counters injected, never fetched (Architecture §7).
- `packages/controls-repository`: `getActiveMandate()`, `getRollingTotal(24h)`, `getHourlyTxCount()`.
- Unit tests: one per branch.

**Definition of Done**
- Every one of the eight branches in Bible §7.4 has a passing unit test, including the two paths the demo never hits (`time_window`, `velocity`) and the two corrections that must not regress: `scope.currencies` **is** enforced, and **every** return populates `rule` (explicit `null` only for the clean ALLOW).
- Scenario 3 resolves through the mandate's `unknown_counterparty_disposition` field — proven by a test that flips that field to `DENY` in the mandate and observes the disposition change **with no code change**. This is the test that demonstrates a general system rather than a scripted trick.
- The engine package imports nothing from the database, the network, or any LLM. Verified by inspecting its dependency list.
- `evaluate()` called twice with identical inputs returns identical output.

Still no wiring to x402 at this point.

---

## Phase 4 — Wire the engine in front of the x402 call

*Bible §10 step 4: "confirm `DENY`/`ESCALATE` genuinely prevent the HTTP request from being constructed, not just from 'succeeding.'"*

**Work**
- `apps/agent/src/orchestrator.ts` per `Architecture.md` §2.2: fetch mandate → fetch counters → `evaluate()` → branch → only then reach settlement.
- `apps/agent/src/intent-generator.ts`: LLM produces Proposed Action objects (§7.3) from a scenario prompt. The LLM touches nothing else.
- Escalation hold: on `ESCALATE`, the orchestrator awaits a decision before proceeding.

**Definition of Done**
- A test spies on `x402-client.pay` and asserts it is **never invoked** on a `DENY` path, and not invoked on `ESCALATE` until a decision resolves to approved. Observing that the payment "failed" does not satisfy this — the call must never happen.
- `x402-client` is importable only from `apps/executor` and its own standalone rail
  diagnostics; `apps/agent/src/settlement/` contains HTTP clients only.
- No proxy, no global `fetch` patching, no interception after the fact anywhere in the codebase (Bible §6, Rules R6).
- All three dispositions reach their correct terminal state end-to-end from the command line, with settlement occurring only on ALLOW and ESCALATE→approved.

This is the phase that makes the project what it claims to be. It does not get descoped or shortcut.

---

## Phase 5 — Audit log write path

*Bible §10 step 5: "Build the audit log write path (Postgres + testnet hash-write)."*

**Work**
- `packages/audit-log`: write §7.5 records on every disposition, regardless of outcome. Copy `mandate_version` onto the record at decision time.
- `contracts/AuditAnchor.sol` deployed to Base Sepolia; write `keccak256(canonical_json(record))` per record, store the anchor tx hash.
- Settlement details written back on completion; `human_review` written on escalation decisions.

**Definition of Done**
- All three demo scenarios produce audit records whose JSON is field-for-field identical in shape to Bible §7.5 — including `rule_triggered` populated for DENY/ESCALATE and explicitly `null` for the clean ALLOW.
- The ALLOW record carries a real `settlement.tx_hash` verifiable on a block explorer; the DENY record's `settlement` is null.
- Each record has an on-chain anchor tx hash, and re-hashing the stored record reproduces the anchored hash.
- Anchoring is asynchronous: a deliberately broken anchor RPC does not block or fail a disposition. Verified by temporarily pointing the RPC at an invalid URL.

---

## Phase 6 — Compliance dashboard

*Bible §10 step 6: "Build the dashboard: live feed, verdict color-coding, per-record drill-down."*

**Work**
- `apps/api`: REST for audit records + SSE live feed backed by a 1-second Postgres poll + `POST /escalations/:action_id/decision` (the approved Phase 6 descope recorded in `Memory.md`).
- `apps/dashboard` (Next.js) per `Design.md`: live feed table, disposition colour semantics (green=ALLOW, red=DENY, amber=ESCALATE), drill-down view, escalation review action.

**Definition of Done**
- New audit records appear in the live feed within ~1 second of being written, without a manual refresh.
- Colour semantics are correct and consistent with Bible §9 and `Design.md`.
- The DENY row surfaces the rule path `spend_caps.per_transaction_max` visibly in the feed, not only in the drill-down — Bible §9 scenario 2 requires the specific rule that fired to be displayed.
- The drill-down renders the §7.5 object near-directly, including `mandate_version`, `reason`, `rule_triggered`, `human_review`, `settlement`, and the anchor hash. It is a render of that object, not a redesign of it.
- Approving an escalation from the dashboard unblocks the waiting agent and settlement follows.
- The dashboard is legible on a projector at presentation distance.

---

## Phase 7 — Full demo run-through

*Bible §10 step 7: "Full run-through of the exact 3-transaction demo script (Section 9); fix integration bugs."*

**Work**
- `scripts/demo.ts` runs Bible §9's three scenarios in order.
- Pre-stage the ESCALATE approval as a fast, reliable click during the scripted run-through (Bible §9's explicit reliability decision). A genuinely open-ended live pause is a stretch goal only, attempted at the end of Phase 7 if everything else is green.
- Reset script so the demo can be re-run cleanly from a known state.

**Definition of Done**
- The full three-scenario script runs end-to-end **three consecutive times without intervention**, from a clean reset each time. Once is luck; three times is a demo.
- Scenario 1 shows green with a settlement hash within seconds; scenario 2 shows red with the rule path; scenario 3 shows amber, then approval, then settlement, with both the original proposal and the human decision visible on the audit record.
- Total runtime is short enough to present comfortably.
- No step requires spoken narration to cover a gap (Bible §12).

---

## Phase 8 — Backup demo video

*Bible §10 step 8: "Record a backup demo video in case the live demo fails during judging."*

**Final status:** narration exists, but the visual edit was not completed to publication standard. This optional backup was omitted rather than publishing a misleading audio-only demo. Phase 9's architecture diagram and the tracked verified evidence satisfy the Stage 1 supporting-material requirement.

**Definition of Done**
- A screen recording of a complete, successful three-scenario run exists as a file in the repo or a stable link.
- It shows the dashboard reacting in real time and at least one settlement hash legibly on screen.
- It is watchable without narration to make sense of it.

---

## Phase 9 — Architecture diagram

*Bible §10 step 10: the mandatory Stage 1 supporting material.*

**Definition of Done**
- Bible §6's diagram cleaned up for a slide, showing the agent, the pre-execution gate, the three dispositions, the controls repository, x402 settlement, the audit log, and the dashboard.
- The pre-execution position of the Disposition Engine is visually unmistakable — it is the whole idea.
- Exported as an image file suitable for upload.

Scheduled before Phase 10 because it is the one **mandatory** supporting material (Bible §1: at least one of slide deck / screenshot / mockup / prototype / architecture diagram / demo clip). Having it done early means the submission is never blocked on it.

---

## Phase 10 — Stage 1 submission

*Bible §10 step 9: "Write the Stage 1 submission — **do this after the schema and a working build exist**, not before, so the 'technologies used' and 'overview' sections describe what was actually built rather than what was planned."*

**Work** — per the Bible §11 checklist:
- Project Details: title, **Track 1 (Payments and Financial Infrastructure)** as primary, team type, short description.
- Project Overview: the §11 problem framing verbatim in spirit; SAFR's **non-binding status stated explicitly**; scoped to the payments/treasury domain only; KLA Control Plane differentiation stated plainly.
- Supporting Materials: architecture diagram (Phase 9) + verified evidence captures. A demo clip is optional backup material and is included only if it meets the Phase 8 Definition of Done.
- Team Details: names + affiliations for every member; student proof if Student Group.
- Project Link: the GitHub repo.

**Definition of Done**
- Every mandatory Stage 1 component from Bible §1 is present.
- The Bible §12 judging-criteria self-check has been run against the **actual build**, item by item, with each answered honestly.
- No sentence describes SAFR as binding, uses "SAFR requires," or reintroduces the "three layers" phrasing.
- Submitted by **Aug 14, 12:00 IST**.

**Unresolved and needed from the team, not derivable from any document:** team member names, affiliations, and whether we submit as Student Group or Public Group (Bible §1 notes this document does not know the team composition). Student Group requires proof of status for **every** member — worth confirming early, not on Aug 14.

---

## Descope ladder

If time runs short, cut in this order. Never cut Phases 1, 4, or 7 — they are the project.

1. On-chain audit anchoring (Phase 5) → keep Postgres records, drop the anchor, and describe the immutability as designed-but-not-wired rather than claiming it.
2. LLM intent generation (Phase 4) → fall back to fixed Proposed Action fixtures. The LLM is demo colour, not the product; the disposition path is unaffected.
3. WebSocket live feed (Phase 6) → 1-second polling. Visually identical during a demo.
4. Dashboard polish beyond `Design.md`'s core screens.
5. The open-ended live-pause escalation stretch goal — already the plan, per Bible §9.

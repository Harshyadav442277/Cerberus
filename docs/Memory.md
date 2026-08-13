# Memory — SAFR Runtime working log

Working log per `Rules.md` R10. Newest entry at the top. Short and factual.
A cold session should be able to resume from this file plus `SAFR_RUNTIME_PROJECT_BIBLE.md` alone.

**Read order for a cold start:** Bible → `Rules.md` → `Phases.md` (current phase) → this file's top entry.

---

## Current state at a glance

- **Project name:** **CERBERUS** (corrected spelling locked by the project owner on Aug 13), named for the three-headed guardian of Hades. The three heads map to ALLOW, DENY, and ESCALATE; SAFR Runtime remains the technical description.
- **Phase 0:** complete except the funded-wallet check (blocked by B1).
- **Phase 1:** code complete and verified up to the funding boundary. Definition of Done **not met** — needs a funded wallet. See B1.
- **Phase 2:** **complete.** DoD met and verified by `npm run db:verify` (13/13 checks).
- **Phase 3:** **complete.** DoD met — engine purity is machine-verified.
- **Phase 4:** **complete.** DoD met — the interception constraint is proven by test, not asserted.
- **Phase 5:** **code complete, 2 of 4 DoD items met.** Hashing, the write path and the non-blocking guarantee are done and verified; the two on-chain items are blocked by B1 (gas).
- **Phase 6:** **DoD met (verified Aug 7).** API + dashboard live; `--live-escalation` Approve unblocked the agent and settlement was attempted. `npm test` 87/87.
- **Phase 7:** **code complete; disposition DoD met thrice.** `npm run demo:script -- --thrice` passes 3 consecutive clean resets. Settlement-hash half of the DoD is blocked by B1 (same as Phase 1/5).
- **Phase 9:** **complete.** The submission-ready architecture slide is tracked at `docs/assets/safr-architecture-slide.png` and embedded in the README.
- **Post-review hardening (Aug 7):** atomic escalation claim, pay() throw → failed settlement + finalize, Agent page §7.1 fields, drill-down threshold vs actual, Audit Log 24h spend strip.
- **Deadline:** Fri Aug 14, 2026, 21:15 IST. Self-imposed submission target Aug 14, 12:00 IST.
- **Next concrete step:** fund the dedicated payer `0x0fe2676DcBA5aBc648BF46403dCc24BBdF90f824` with Base Sepolia ETH + USDC, then run `npm run phase1:preflight` and `npm run phase1`. In parallel: Phase 8 backup demo video and Phase 10 submission draft.

**Known limitations (sequential §9 demo unaffected — say so in the submission):** concurrent evaluate→settle is not locked; `rolling_window.window` is hardcoded to 24h matching the seed; overnight time-window wrap is unsupported. No auth on the local escalation endpoint is intentional (Rules R2 closed stack).

**Command reference** (run from repo root; scripts call `tsx` directly, no nested pnpm):
`npm run typecheck` · `npm test` · `npm run db:up` · `npm run db:migrate` · `npm run db:migrate:down` · `npm run db:migrate:status` · `npm run db:seed` · `npm run db:verify` · `npm run merchant` · `npm run demo` · `npm run demo:reset` · `npm run demo:script` · `npm run api` · `npm run dashboard` · `npm run audit:verify` · `npm run audit:tamper-demo` · `npm run contracts:compile` · `npm run contracts:deploy` · `npm run phase1:preflight` · `npm run phase1`

`npm run demo` / `demo:script` need `npm run merchant` running. `demo:script -- --thrice` is the Phase 7 DoD check. `demo -- --live-escalation` waits for a dashboard Approve.
Install is the one thing that needs pnpm: `npx --yes pnpm@10.34.5 install`.

**Stack as resolved:** TypeScript/Node 24, pnpm 10 workspaces, Postgres 16 in Docker on host port **5544**, x402 TS SDK **v2.21.0**, Base Sepolia `eip155:84532`, testnet facilitator `https://x402.org/facilitator`.

---

## Blockers

**B1 — No funded Base Sepolia wallet. Blocks the Phase 1 DoD.**
`.env` now holds two fresh **testnet-only** identities generated on Aug 13. Payer: `0x0fe2676DcBA5aBc648BF46403dCc24BBdF90f824`; separate merchant payee: `0xf56e3F3134879156e11EAff78978a270726B661b`. Their private keys remain only in the gitignored, mode-600 `.env`; never send real assets to either wallet.
What is needed: fund the payer with Base Sepolia USDC (https://faucet.circle.com, select Base Sepolia) and Base Sepolia ETH for gas. Aug 13 preflight confirms both balances are zero; every other preflight check passes.
The full payment path is already proven correct except funding (see the Phase 1 entry below).

**B1 also blocks two Phase 5 DoD items** (added Aug 7): deploying `AuditAnchor.sol` and writing anchors both need Sepolia ETH for gas. Digests are computed and stored regardless, so funding the wallet and running `npm run contracts:deploy` is the only remaining work — no code changes. Same rule applies: the submission must not claim records are anchored on chain until one actually is.

**B1 CHECKPOINT — agreed with the project owner, Aug 7. Do not lose this:**
1. **Phase 1's DoD cannot be marked done, and the submission must not claim "live settlement," until a real funded-wallet transaction has actually fired at least once.** No exceptions. Bible section 12 and Rules R11 both forbid narrating over a gap.
2. Later phases may proceed in parallel while funding is pending — settlement is not a dependency of the schema or the engine.
3. **If funding is still blocked on Aug 10** (day 4 of the remaining build), invoke the mocked-settlement fallback (descope ladder). If that happens, label it in this file as an **explicit fallback taken under time pressure**, not a silent substitution, and state plainly in the submission that settlement was mocked.

**B2 — No LLM API key.** Not yet blocking. First needed in Phase 4 for `apps/agent/src/intent-generator.ts`. Descope ladder item 2 replaces it with fixed fixtures if it does not arrive.

**B5 — RESOLVED (Aug 7).** The seeded `time_window` would have DENIED the demo on a weekend.
Bible Section 7.2 sets `allowed_days: ["Mon".."Fri"]`, and the seed originally followed it exactly. Time window is check 4 in the Section 7.4 order, so on a Saturday or Sunday demo scenario 1 resolved to **DENY on rule `time_window`** instead of ALLOW — the engine behaving correctly, the demo looking broken. **Stage 2 judging is Aug 21-23, which spans Saturday Aug 22 and Sunday Aug 23.**
**Resolution, confirmed by the project owner:** seeded `allowed_days` widened to all seven days. Seed-value change only, same category as B4 — no schema field names touched and the `time_window` rule is still fully enforced and unit-tested (two tests cover it, including a Saturday DENY). `npm run db:verify` still prints a WARNING if the seed is ever narrowed to exclude the current day.

**B3 — Team details unknown.** Names, affiliations, Student Group vs. Public Group. Needed for the Stage 1 submission (Phase 10), not for the build. Student Group requires proof of status for every member — worth settling early.

**B4 — RESOLVED (Aug 7).** Seed mandate uses faucet-sized values: `per_transaction_max: 1.00`, `rolling_window.max_total: 3.00`, clean demo payment `0.50`, cap-breach attempt `5.00`. Schema field names are exactly as Bible section 7.2 — only the numeric seed values differ from the Bible's illustrative `1000`/`500`/`3000`, because testnet faucets cannot fund those.

---

## Log

### Aug 13 — local runtime environment restored

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
- `apps/agent/src/settlement/` — the ONLY module outside `packages/x402-client` allowed to import the x402 client.
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

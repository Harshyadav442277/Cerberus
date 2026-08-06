# Memory — SAFR Runtime working log

Working log per `Rules.md` R10. Newest entry at the top. Short and factual.
A cold session should be able to resume from this file plus `SAFR_RUNTIME_PROJECT_BIBLE.md` alone.

**Read order for a cold start:** Bible → `Rules.md` → `Phases.md` (current phase) → this file's top entry.

---

## Current state at a glance

- **Phase 0:** complete except the funded-wallet check (blocked by B1).
- **Phase 1:** code complete and verified up to the funding boundary. Definition of Done **not met** — needs a funded wallet. See B1.
- **Phase 2:** **complete.** DoD met and verified by `npm run db:verify` (13/13 checks).
- **Phase 3:** **complete.** DoD met — `npm run test` is 29/29 green and engine purity is machine-verified.
- **Deadline:** Fri Aug 14, 2026, 21:15 IST. Self-imposed submission target Aug 14, 12:00 IST.
- **Next concrete step:** Phase 4 — wire the engine into the agent's decision path so `evaluate()` is called **before** the x402 request is constructed (Bible Section 6, Rules R6). Needs `apps/agent` with the intent generator (B2 applies) and the orchestrator that calls the Controls Repository, then the engine, then `@safr/x402-client` only on ALLOW. Independently: fund the payer wallet to close out Phase 1.

**Command reference** (run from repo root; scripts call `tsx` directly, no nested pnpm):
`npm run typecheck` · `npm test` · `npm run db:up` · `npm run db:migrate` · `npm run db:migrate:down` · `npm run db:migrate:status` · `npm run db:seed` · `npm run db:verify` · `npm run merchant` · `npm run phase1:preflight` · `npm run phase1`
Install is the one thing that needs pnpm: `npx --yes pnpm@10.34.5 install`.

**Stack as resolved:** TypeScript/Node 24, pnpm 10 workspaces, Postgres 16 in Docker on host port **5544**, x402 TS SDK **v2.21.0**, Base Sepolia `eip155:84532`, testnet facilitator `https://x402.org/facilitator`.

---

## Blockers

**B1 — No funded Base Sepolia wallet. Blocks the Phase 1 DoD.**
`.env` currently holds a **throwaway, unfunded** keypair generated during Phase 1 purely to exercise the code path (`0x8A74081BCa3EEB7Ec50CA23EC80EF42565F54A36`). It holds nothing on any network.
What is needed: replace `EVM_PRIVATE_KEY` (payer) and `EVM_ADDRESS` (merchant payee) in `.env` with the team's real wallet, fund the payer with Base Sepolia USDC (https://faucet.circle.com, select Base Sepolia) and a little Sepolia ETH for gas.
The full payment path is already proven correct except funding (see the Phase 1 entry below).

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

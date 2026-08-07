# SAFR Runtime

Middleware + dashboard that enforces MAS's **SAFR** (Safeguards for Agentic Finance at Runtime) governance pattern in real time, gating an AI agent's stablecoin payments **before** they execute.

An agent proposes a payment. The system evaluates it against a programmable **mandate** (spend caps, counterparty allowlist, time windows, velocity limits) held in the **controls repository**, then issues a **disposition** — `ALLOW`, `DENY`, or `ESCALATE`. The payment only settles over the **x402** protocol if it is allowed, or escalated and then approved by a human. Every proposal and decision is written to an audit log a compliance officer could query.

> SAFR is an industry white paper (Version 1.0) published by the Monetary Authority of Singapore under its BuildFin.ai initiative on July 3, 2026. It is **explicitly non-binding** — MAS states it does not constitute regulatory guidance or supervisory expectations. This project implements only SAFR's first applied domain, agent-assisted payments and treasury operations.

**NTU InnovateX Hackathon 2026 — Track 1: Payments and Financial Infrastructure.**

## Documents

Read in this order. The Bible is the source of truth and overrides everything else.

| File | Purpose |
|---|---|
| [SAFR_RUNTIME_PROJECT_BIBLE.md](docs/SAFR_RUNTIME_PROJECT_BIBLE.md) | Source of truth: concept, schemas, terminology, decision history |
| [PRD.md](docs/PRD.md) | Requirements, users, feature set, scope boundary |
| [Architecture.md](docs/Architecture.md) | Flow, stack, folder structure, the pre-execution interception constraint |
| [Rules.md](docs/Rules.md) | Engineering boundaries (approved stack, frozen schemas, rule-based-only engine) |
| [Phases.md](docs/Phases.md) | Build phases with a Definition of Done each |
| [Design.md](docs/Design.md) | Dashboard visual design |
| [Memory.md](docs/Memory.md) | Working log: current state, decisions, blockers, next step |

## Stack

TypeScript/Node 22+, pnpm workspaces, Postgres 16 (Docker), x402 v2 TS SDK on **Base Sepolia** (`eip155:84532`), Next.js dashboard. The approved stack is closed — see [Rules.md](docs/Rules.md) R2.

## Getting started

Install uses pnpm (run from the npx cache, never installed into the workspace —
see [Memory.md](docs/Memory.md)). Everything else is plain `npm run`.

```bash
# 1. Install the workspace.
npx --yes pnpm@10.34.5 install

# 2. Start Postgres (host port 5544 — 5432 is often already taken).
npm run db:up

# 3. Configure credentials.
cp .env.example .env
#    Set EVM_PRIVATE_KEY (payer) and EVM_ADDRESS (merchant payee).
#    Fund the payer with Base Sepolia USDC: https://faucet.circle.com
#    and a little Sepolia ETH for gas.

# 4. Create the schema and seed the demo agent + mandate.
npm run db:migrate
npm run db:seed

# 5. Check everything.
npm run typecheck
npm test           # engine unit tests + interception enforcement scans
npm run db:verify
```

`db:verify` proves the schema mirrors Bible Section 7 field-for-field: exact column
names, a deep-equality round-trip of the seeded mandate through Postgres and zod, and
correct `effective_from`/`effective_to` handling in `getActiveMandate`.

## Phase 1 — bare x402 payment

Proves the payment rail works in isolation, with **zero** governance logic in front of it, before anything is built on top of it (Bible Section 10, step 1).

```bash
# Terminal 1 — the merchant being paid (x402 resource server).
npm run merchant

# Terminal 2 — check prerequisites, then fire one real testnet payment.
npm run phase1:preflight
npm run phase1
```

`phase1` prints a settlement transaction hash verifiable on
[sepolia.basescan.org](https://sepolia.basescan.org). `phase1:preflight` reports
exactly which prerequisite is missing if it cannot.

## The demo

The three scenarios from Bible Section 9, end to end.

```bash
# Terminal 1 — the merchant being paid.
npm run merchant

# Terminal 2 — agent proposes, engine decides, settlement only if permitted.
npm run demo
npm run demo -- cap_breach                        # one scenario
npm run demo -- new_counterparty --deny-escalation # reviewer rejects
```

Output reports, per scenario, the disposition, the rule that fired, and — the line
that matters — whether x402 was reached at all:

```
Scenario 2 — cap breach   [cap_breach]
  disposition   DENY
  rule          spend_caps.per_transaction_max
  x402 reached  NO — never constructed
```

## The audit trail

Every disposition is written to Postgres as a Bible Section 7.5 record — a refusal is
recorded exactly as carefully as an approval. Once a record reaches its terminal
state, `keccak256` of its canonical JSON is anchored to
[`AuditAnchor.sol`](contracts/AuditAnchor.sol) on Base Sepolia. Only the digest goes
on chain; the record itself never leaves the database.

```bash
npm run audit:verify        # re-hash every stored record, compare to its anchor
npm run audit:tamper-demo   # edit a real record, watch the digest break, roll back
```

`audit:tamper-demo` is the honest version of the immutability claim. It takes a stored
`DENY`, rewrites it to `ALLOW` the way someone covering their tracks would, and shows
the digest no longer reproduces — then rolls the transaction back so the log is
unchanged.

Anchoring is asynchronous and cannot affect a decision: the digest is stored before
any network call, and a slow, broken, or unconfigured RPC leaves the record valid and
the disposition untouched.

To deploy the contract (needs a little Sepolia ETH for gas):

```bash
npm run contracts:compile
npm run contracts:deploy    # prints the address for AUDIT_ANCHOR_ADDRESS in .env
```

Without `AUDIT_ANCHOR_ADDRESS` set, records still get digests and stay verifiable —
they simply sit at `pending` until anchoring is configured.

## Layout

```
packages/
  core/                 shared zod schemas, Bible Section 7
  db/                   Postgres pool, migrations, seed data
  disposition-engine/   pure, rule-based evaluate() — the gate
  controls-repository/  versioned mandate lookup + counters
  x402-client/          the only module that talks to x402
  audit-log/            Section 7.5 writes + canonical hash + on-chain anchor
apps/
  agent/                LLM agent + orchestrator — owns the gate
    src/settlement/     the only place x402-client may be imported
  merchant/             x402 resource server (the payee)
  api/                  dashboard REST + WebSocket        (Phase 6)
  dashboard/            Next.js compliance dashboard      (Phase 6)
contracts/              AuditAnchor.sol + compile and deploy scripts
```

The Disposition Engine is called by the agent's own orchestration code **before it
constructs the x402 request** — never as a proxy in front of x402 traffic. This
pre-execution position is the whole point; see [Architecture.md](docs/Architecture.md) section 2.

It is enforced rather than merely intended. `npm test` scans the repository and fails
if anything outside `apps/agent/src/settlement/` imports the x402 client, or if any
code patches global `fetch`, installs a proxy agent, or otherwise intercepts traffic
after the fact. On a `DENY` the settlement module is never even constructed.

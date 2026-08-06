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
npm test           # 29 Disposition Engine unit tests
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

## Layout

```
packages/
  core/                 shared zod schemas, Bible Section 7
  db/                   Postgres pool, migrations, seed data
  disposition-engine/   pure, rule-based evaluate() — the gate
  controls-repository/  versioned mandate lookup + counters
  x402-client/          the only module that talks to x402
  audit-log/            Postgres writes + on-chain anchor (Phase 5)
apps/
  merchant/             x402 resource server (the payee)
  agent/                LLM agent + orchestrator          (Phase 4)
  api/                  dashboard REST + WebSocket        (Phase 6)
  dashboard/            Next.js compliance dashboard      (Phase 6)
```

The Disposition Engine is called by the agent's own orchestration code **before it
constructs the x402 request** — never as a proxy in front of x402 traffic. This
pre-execution position is the whole point; see [Architecture.md](docs/Architecture.md) section 2.

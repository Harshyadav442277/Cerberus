# CERBERUS

### The three-headed guardian of agentic payments

Cerberus is a pre-execution governance runtime and compliance dashboard for payment-capable AI agents. It gives every proposed payment one of three deterministic dispositions — **ALLOW**, **DENY**, or **ESCALATE** — before an x402 payment request can exist.

In Greek mythology, Cerberus guards a boundary that cannot be crossed unchecked. Here, its three heads represent the three possible outcomes at the boundary between an AI agent's intent and financial execution:

- **ALLOW** — the action is within mandate and may proceed to x402 settlement.
- **DENY** — a hard control is breached; no payment request is constructed.
- **ESCALATE** — the action is held until a human reviewer approves or denies it.

An agent proposes a payment. Cerberus evaluates it against a versioned **mandate** — spend caps, permitted currencies, counterparty policy, time windows, and velocity limits — held in the **controls repository**. Every proposal, disposition, triggered rule, human review, and settlement result is written to an audit log a compliance officer can inspect.

The LLM may generate a payment intent. It never makes the compliance decision. The **Disposition Engine is pure, deterministic, rule-based, and reproducible**.

> SAFR is an industry white paper (Version 1.0) published by the Monetary Authority of Singapore under its BuildFin.ai initiative on July 3, 2026. It is **explicitly non-binding** — MAS states it does not constitute regulatory guidance or supervisory expectations. This project implements only SAFR's first applied domain, agent-assisted payments and treasury operations.

**NTU InnovateX Hackathon 2026 — Track 1: Payments and Financial Infrastructure.**

![Cerberus pre-execution architecture implementing the SAFR runtime pattern](docs/assets/safr-architecture-slide.png)

*Cerberus is the product; SAFR Runtime is the governance pattern it implements.*

## Why it matters

A signing key proves that an agent **can** move money. It does not prove that a particular payment is within the institution's authority, risk limits, or operating mandate.

Cerberus places that missing control point before execution. Clear violations are denied immediately. Ambiguous but potentially legitimate actions are escalated for human judgment. Allowed actions continue to the settlement rail. Every outcome leaves evidence.

## What is working

- All three dispositions run end to end: `ALLOW`, `DENY`, and `ESCALATE`.
- `DENY` is proven to stop execution before authorization, executor, or x402 access.
- `ESCALATE` suspends the agent and resumes only after a human decision.
- The agent has no payment key and no payer import. A separate executor accepts only
  short-lived, signed, one-shot Execution Authorizations bound to the exact proposal,
  mandate version, chain, token, atomic amount, payee, and resource.
- The controls repository enforces versioned mandates and rolling counters.
- The dashboard provides a live audit feed, drill-down, threshold-versus-actual evidence, and one-click review.
- Terminal audit records are canonically hashed and anchored asynchronously to Base Sepolia.
- **119 automated tests**, TypeScript validation, database verification, and the Next.js production build pass.

Live settlement and anchoring are explorer-verifiable: the [bare x402 payment](https://base-sepolia.blockscout.com/tx/0xed51af702ebc263f8296c1fc6cb677928880f4a4dc6eee7a05f69e14e99efab9), [AuditAnchor deployment](https://base-sepolia.blockscout.com/tx/0x2cb059b1671678ae8ade38edca8daaa29f8a9e44b758e60484993f3899cebd08), and [final supervised-run anchor](https://base-sepolia.blockscout.com/tx/0x507858741ff5c381167b2b3b85d2e0bb71ec5052e8327dbd78ca40986db1d191) all succeeded on Base Sepolia. The full two-run transaction manifest is in [submission/EVIDENCE.md](docs/submission/EVIDENCE.md).

Those public transactions prove the Stage-1 rail and governance flow. They predate
the finalist signer-isolation boundary; the hardened path must be rerun before its
live-settlement evidence is claimed. Its code and adversarial tests are complete.

## Documents

Read in this order. The Bible is the source of truth and overrides everything else.

| File | Purpose |
|---|---|
| [SAFR_RUNTIME_PROJECT_BIBLE.md](docs/SAFR_RUNTIME_PROJECT_BIBLE.md) | Source of truth: concept, schemas, terminology, decision history |
| [PRD.md](docs/PRD.md) | Requirements, users, feature set, scope boundary |
| [Architecture.md](docs/Architecture.md) | Flow, stack, folder structure, the pre-execution interception constraint |
| [Rules.md](docs/Rules.md) | Engineering boundaries (approved stack, frozen schemas, rule-based-only engine) |
| [Critique.md](docs/Critique.md) | Approved Stage-2 security critique and fixed hardening order |
| [Phases.md](docs/Phases.md) | Build phases with a Definition of Done each |
| [Design.md](docs/Design.md) | Dashboard visual design |
| [Memory.md](docs/Memory.md) | Working log: current state, decisions, blockers, next step |
| [submission/RUNBOOK.md](docs/submission/RUNBOOK.md) | Cold start to judged demo, and the failure modes actually hit |
| [submission/EVIDENCE.md](docs/submission/EVIDENCE.md) | Verified local and Base Sepolia evidence, transaction manifest, and known limitations |

## Stack

TypeScript/Node 22+, pnpm workspaces, Postgres 16 (Docker), x402 v2 TS SDK on **Base Sepolia** (`eip155:84532`), Next.js dashboard. The approved stack is closed — see [Rules.md](docs/Rules.md) R2.

## Quick start — clone, run, and reproduce the results

The deterministic governance path can be verified without spending testnet assets.
A funded Base Sepolia wallet is required only for reproducing live x402 settlement
and on-chain audit anchoring. No LLM API key is required: the reproducible demo uses
fixed, schema-validated Proposed Action fixtures, and the LLM never participates in
the compliance decision.

### Prerequisites

- Git.
- Node.js **22 or newer** (`node --version`).
- Docker with Compose for the default Postgres setup. Alternatively, use any
  Postgres 16+ instance matching `DATABASE_URL` in `.env.example`.
- Free local ports: `5544` (Postgres), `4021` (merchant), `4050` (API), `4060`
  (isolated executor), and `3000` (dashboard).
- For the full on-chain path only: Base Sepolia USDC and a small amount of Base
  Sepolia ETH. Never use a wallet that holds real assets.

### 1. Clone and install

```bash
git clone https://github.com/Harshyadav442277/Cerberus.git
cd Cerberus
npx --yes pnpm@10.34.5 install
```

The install uses pnpm workspaces through the npx cache; pnpm is not installed into
the repository. All remaining commands are plain `npm run` commands.

### 2. Create the local environment

Linux, macOS, or Git Bash:

```bash
cp .env.example .env
cp .env.agent.example .env.agent
cp .env.executor.example .env.executor
cp .env.authorizer.example .env.authorizer
npm run wallets:new
```

PowerShell:

```powershell
Copy-Item .env.example .env
Copy-Item .env.agent.example .env.agent
Copy-Item .env.executor.example .env.executor
Copy-Item .env.authorizer.example .env.authorizer
npm run wallets:new
```

Copy each generated value into the file named by the command: public addresses into
`.env`, the x402 payment key into `.env.executor`, and the authorization/anchor keys
into `.env.authorizer`. Copy the audit-anchor key into `.env.agent` only when on-chain
anchoring is enabled. All four files are gitignored. Never paste a private key into an
issue, screenshot, commit, shared shell profile, or demo.

You may leave `ANTHROPIC_API_KEY`, `AUDIT_ANCHOR_ADDRESS`, and
`AUDIT_ANCHOR_PRIVATE_KEY` empty in `.env.agent` for local governance verification.

### 3. Start Postgres and initialize the data

```bash
npm run db:up
npm run db:migrate
npm run db:seed
npm run db:verify
```

Expected result: `db:verify` prints **13 `OK` checks** followed by `All checks
passed`, including exact Bible Section 7 columns, lossless zod/Postgres round-trips,
mandate-version boundaries, and the three expected demo dispositions.

If Docker is unavailable, point `DATABASE_URL` at an existing Postgres 16+ instance
on port `5544`; the Windows setup used for the published evidence is documented in
[the operator runbook](docs/submission/RUNBOOK.md).

### 4. Verify the build before starting services

```bash
npm run typecheck
npm test
npm run build --prefix apps/dashboard
npm run contracts:compile
```

Expected result:

- TypeScript exits without errors.
- The test runner reports **119 tests, 26 suites, 119 passed, 0 failed**.
- The Next.js production build completes and lists six application routes.
- `AuditAnchor` compiles successfully and reports 263 bytes of deployable bytecode.

The tests include the structural guarantee that `DENY` reaches neither authorization
nor execution, signer isolation, forged/mutated/expired/replayed authorization
refusal before key use, the deterministic rule order, atomic escalation review,
audit hashing, contract compilation, and all three scripted scenarios.

### 5. Start Cerberus

Keep these four terminals running:

Terminal 1 — x402 merchant:

```bash
npm run merchant
```

Terminal 2 — audit and escalation API:

```bash
npm run api
```

Terminal 3 — isolated payment executor:

```bash
npm run executor
```

Terminal 4 — compliance dashboard:

```bash
npm run dashboard
```

Open <http://localhost:3000>. The sidebar should show `CERBERUS / SAFR Runtime`, the
Audit Log status should become `Live`, and the footer indicators should show Base
Sepolia, Database, and Facilitator.

Optional health check:

```bash
curl http://localhost:4021/health
curl http://localhost:4050/health
curl http://localhost:4060/health
curl -I http://localhost:3000
```

Expected result: merchant `status: ok`, API `ok: true` with `database: up`, executor
role `isolated-payment-executor`, and an HTTP success response from the dashboard.

### 6. Reproduce ALLOW, DENY, and ESCALATE

In a fifth terminal, run the deterministic three-scenario sequence:

```bash
npm run demo:script
```

The command resets the demo state, runs all three proposals, asserts the expected
dispositions, persists their audit records, and waits for asynchronous digest work to
finish. The important output is:

```text
dispositions  ALLOW → DENY → ESCALATE(approved)  ✓
interception  DENY never reached x402           ✓
human_review  persisted on scenario 3           ✓
```

Run the reliability check with three clean resets:

```bash
npm run demo:script -- --thrice
```

Expected final line: `Three consecutive clean runs succeeded.` An unfunded payer can
still reproduce the dispositions and the DENY interception guarantee, but permitted
settlements will not have transaction hashes.

### 7. Reproduce the real human approval hold

With the API and dashboard still running:

```bash
npm run demo -- new_counterparty --live-escalation
```

Then open <http://localhost:3000/escalations>. The agent remains blocked until you
click **Approve** or **Deny**. Approve should unblock the separate agent process,
persist `human_review`, and reach settlement; Deny should leave settlement null.

To run the complete three-scenario script with a real click for scenario 3:

```bash
npm run demo:script -- --live
```

### 8. Reproduce live settlement and on-chain anchoring

This step spends testnet-only assets. Fund the generated executor wallet with
approximately **4 Base Sepolia USDC** for several rehearsals. Fund the separate audit
anchor signer with a small amount of Base Sepolia ETH for deployment and anchors.

- USDC: <https://faucet.circle.com> — select Base Sepolia.
- ETH: <https://www.alchemy.com/faucets/base-sepolia>.

With the merchant running:

```bash
npm run phase1:preflight
npm run phase1
```

Do not proceed until preflight reports every prerequisite as `OK`. `phase1` should
print a transaction hash that resolves on the
[Base Sepolia Blockscout explorer](https://base-sepolia.blockscout.com).

Deploy a fresh audit anchor for your clone:

```bash
npm run contracts:deploy
```

Copy the printed contract address into `.env` and `.env.agent` as
`AUDIT_ANCHOR_ADDRESS`. Also copy `AUDIT_ANCHOR_PRIVATE_KEY` from `.env.authorizer`
to `.env.agent` on this prototype machine. The next agent process will load it; then run:

```bash
npm run demo:script -- --live
npm run audit:verify
```

Expected result after approving scenario 3: ALLOW and approved ESCALATE have distinct
settlement hashes, DENY has no settlement, and `audit:verify` reports **3/3 records
reproduce their digest**, **3/3 anchored on Base Sepolia**, and `No tampering
detected`. Your transaction hashes will differ from the published run; the behavior
and invariants should match [the evidence manifest](docs/submission/EVIDENCE.md).

### 9. Stop the local stack

Stop the merchant, API, and dashboard with `Ctrl+C` in their terminals, then stop the
default Docker database:

```bash
npm run db:stop
```

## Phase 1 — bare x402 payment

Proves the payment rail works in isolation, with **zero** governance logic in front of it, before anything is built on top of it (Bible Section 10, step 1).

```bash
# Terminal 1 — the merchant being paid (x402 resource server).
npm run merchant

# Terminal 2 — check prerequisites, then fire one real testnet payment.
npm run phase1:preflight
npm run phase1
```

`phase1` prints a settlement transaction hash verifiable on the
[Base Sepolia Blockscout explorer](https://base-sepolia.blockscout.com). `phase1:preflight` reports
exactly which prerequisite is missing if it cannot.

## The three-headed demo

The three scenarios from Bible Section 9, end to end.

```bash
# Terminal 1 — the merchant being paid.
npm run merchant

# Terminals 2 and 3 — trusted authorization API and isolated executor.
npm run api
npm run executor

# Terminal 4 — agent proposes, engine decides, settlement only if permitted.
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
state, Cerberus computes `keccak256` of its canonical JSON. When anchoring is
configured, that digest is written to [`AuditAnchor.sol`](contracts/AuditAnchor.sol)
on Base Sepolia. Only the digest goes on chain; the record itself never leaves the
database.

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

## Cerberus compliance dashboard

```bash
# Terminal 1 — API (audit feed + escalation decisions)
npm run api

# Terminal 2 — isolated payment executor
npm run executor

# Terminal 3 — Next.js dashboard at http://localhost:3000
npm run dashboard

# Terminal 4 — hold an escalation for a real Approve click
npm run demo -- new_counterparty --live-escalation
```

The Audit Log shows disposition colour, the rule path on DENY rows, and a live
indicator. Escalations is one-click Approve / Deny with no confirmation dialog.

## Judged demo script (Phase 7)

Bible Section 9 in order, with a pre-staged ESCALATE approval and a clean reset
between attempts:

```bash
npm run merchant          # terminal 1
npm run api               # terminal 2
npm run executor          # terminal 3
npm run demo:script       # terminal 4, one run (resets first)
npm run demo:script -- --thrice   # Phase 7 DoD: three consecutive clean runs
```

Each run asserts ALLOW → DENY (`spend_caps.per_transaction_max`, x402 never
constructed) → ESCALATE approved with `human_review` persisted. Two fresh supervised
runs settled both permitted payments and anchored all three audit outcomes on Base
Sepolia; exact hashes are recorded in [submission/EVIDENCE.md](docs/submission/EVIDENCE.md).

## Layout

```
packages/
  core/                 shared zod schemas, Bible Section 7
  db/                   Postgres pool, migrations, seed data
  disposition-engine/   pure, rule-based evaluate() — the gate
  controls-repository/  versioned mandate lookup + counters
  x402-client/          payer-side x402 implementation, imported only by executor
  execution-authorization/ signed capability schema, hashing, signing, verification
  audit-log/            Section 7.5 writes + canonical hash + on-chain anchor
apps/
  agent/                LLM agent + orchestrator — owns the gate
    src/settlement/     HTTP clients for authorizer and executor; no signer or x402
  executor/             isolated payment-key process; the only payer importer
  merchant/             x402 resource server (the payee)
  api/                  dashboard REST + SSE live feed
  dashboard/            Next.js compliance dashboard
contracts/              AuditAnchor.sol + compile and deploy scripts
```

The Disposition Engine is called by the agent's own orchestration code **before it
constructs the x402 request** — never as a proxy in front of x402 traffic. This
pre-execution position is the whole point; see [Architecture.md](docs/Architecture.md) section 2.

It is enforced rather than merely intended. `npm test` scans the repository and fails
if any app except `apps/executor` imports the payer-side x402 client, if the agent
references a payment-key variable, or if code patches global `fetch`, installs a
proxy agent, or intercepts traffic after the fact. On `DENY`, neither the
authorization client nor executor client is constructed.

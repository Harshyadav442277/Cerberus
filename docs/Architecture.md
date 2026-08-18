# SAFR Runtime — Architecture

**Derived from:** Bible Sections 6, 7, 8.
**Authority:** `SAFR_RUNTIME_PROJECT_BIBLE.md` overrides this document on any conflict.

## Stage 2 finalist hardening amendment

The Bible's pre-execution constraint still governs, but the payment-key boundary is
now stronger:

```text
AI intent
  -> agent orchestrator
  -> deterministic Disposition Engine
  -> audit record
  -> trusted API re-evaluation + signed Execution Authorization
  -> isolated executor verifies every bound field and consumes the authorization
  -> x402 payer constructed
  -> Base Sepolia USDC settlement
```

`apps/agent` no longer imports `@safr/x402-client` and never loads the payment key.
`apps/api` holds only the authorization-signing key and independently re-evaluates the
stored proposal/audit context before signing. `apps/executor` is the only application
that may load `EXECUTOR_EVM_PRIVATE_KEY` or construct the x402 payer.

For this prototype, “isolated” means a separate application process with a separate
environment file and no payment-key import path in the agent. Production resistance
to arbitrary same-host filesystem compromise additionally requires a different
OS/container principal or managed secret boundary; this repository does not falsely
claim that deployment control.

The authorization binds proposal, mandate/version, a real atomic reservation, chain,
token, atomic amount, payee, resource hash, expiry, and nonce. Phase 3 records every
issued capability in `execution_authorization` and consumes it with a database
compare-and-set shared by every executor process. Human decisions are separately
bound to the proposal, mandate version, and expiry; both the authorizer and executor
re-check current authority before key use. The resource hash still covers the
intended HTTP resource; exact live x402 challenge inspection is Phase 4. See
`Critique.md` for the fixed hardening order and claim limits.

---

## 1. System architecture (Bible Section 6, reproduced)

```
┌──────────────┐   proposes action    ┌───────────────────────┐
│  AI Agent    │ ────────────────────►│  Disposition Engine    │
│ (orchestrator│                       │  (SAFR runtime gate)   │
│  intercepts  │                       └───────────────────────┘
│  BEFORE any  │                                 │
│  HTTP call   │                    evaluated against Controls Repository
│  is built)   │                    (mandate: spend caps, counterparty
└──────────────┘                     allowlist, time windows, velocity)
                                                 │
                        ┌────────────────────────┼────────────────────────┐
                        ▼                        ▼                        ▼
                     ALLOW                   ESCALATE                    DENY
              (agent's HTTP call         (held; routed to           (HTTP call
               to x402 endpoint            human reviewer;           never
               is now permitted            resumes on approval)      constructed)
               to fire)
                        │                        │
                        ▼                        ▼
              x402 payment executes     Audit Log records:
              on stablecoin testnet     agent, action, mandate,
                        │               disposition, reviewer (if any),
                        ▼               timestamp
              Audit Log records
              settlement hash
                        │
                        ▼
              ┌─────────────────────┐
              │ Compliance Dashboard │
              │ (live feed, drill-   │
              │  down per record)    │
              └─────────────────────┘
```

---

## 2. The interception constraint — non-negotiable

Reproduced verbatim from Bible Section 6. This is a constraint, not a suggestion.

> **Critical implementation constraint (do not violate this):** The Disposition Engine must be called as a **library/function call or local API call by the agent's own orchestration code, before that code ever constructs the x402 HTTP request** — not as a network proxy sitting in front of x402 traffic. x402's handshake is a thin HTTP-402 challenge/response; trying to intercept and inspect it after the agent's HTTP call has already fired defeats the entire "pre-execution" premise SAFR is built around, and is also more fragile to build in the time available. Simplest correct pattern: the agent script must call `disposition_engine.evaluate(intent)` and only proceeds to build the x402 request if the response is `ALLOW` (or `ESCALATE` → `ALLOW` after human approval).

### 2.1 What this forbids, concretely

- **No** HTTP proxy, reverse proxy, or interceptor sitting in front of x402 traffic.
- **No** monkey-patching `fetch` globally to catch outbound calls.
- **No** wrapping `wrapFetchWithPayment` such that the request object already exists before evaluation.
- **No** "fire and roll back" — a `DENY` must mean the x402 request was never constructed, not that it was constructed and discarded.

### 2.2 The one correct shape

`apps/agent` owns the control flow. The engine is a synchronous gate inside it:

```ts
const action = await proposePaymentIntent(scenario);   // LLM produces Proposed Action (7.3)
const mandate = await controls.getActiveMandate(action.agent_id, action.proposed_at);
const disposition = evaluate(action, mandate, counters); // pure function, no I/O
await audit.record(action, mandate, disposition);

if (disposition.disposition === "DENY") return;          // no request object is ever built
if (disposition.disposition === "ESCALATE") {
  const review = await escalations.awaitDecision(action.action_id);
  if (review.decision !== "approved") return;            // still nothing built
}

// Only reachable on ALLOW, or ESCALATE→approved.
// This is the first line in the whole program that touches x402.
const authorization = await trustedAuthorizer.issue(audit.audit_id);
const settlement = await isolatedExecutor.execute({
  audit_id: audit.audit_id,
  envelope: authorization,
});
await audit.recordSettlement(action.action_id, settlement);
```

**Enforcement:** the payer-side x402 client is importable only from `apps/executor`
(plus standalone rail diagnostics inside its own package). Tests assert that a `DENY`
constructs neither the authorization client nor executor client, and repository scans
fail if any agent file imports x402 or references the payment-key variable.

---

## 3. Stack (Bible Section 8, with the Section 8 choice resolved)

Bible Section 8 permits "Node.js or Python (FastAPI)" for the middleware. **Resolved to TypeScript/Node end-to-end** (confirmed by project owner): one runtime across agent, engine, and the already-locked Next.js dashboard, and the x402 reference SDK is TypeScript-first, which is the lowest-risk path to Phase 1.

| Layer | Choice | Bible basis |
|---|---|---|
| Agent | TypeScript script driving an LLM via API (Anthropic or OpenAI) to emit Proposed Action objects | §8 "a simple LLM-driven script (Claude or GPT via API)" |
| Middleware / rules engine | TypeScript, plain deterministic rule evaluation, **no ML** | §8, §0.6 |
| Payment rail | x402 reference implementation (Coinbase / x402 Foundation), on testnet | §8 |
| Audit log | Postgres for queryable records + hash of each record written to a testnet contract | §8 |
| Dashboard | Next.js, live feed, colour-coded by disposition, drill-down per record | §8 |

### 3.1 Concrete versions and identifiers

- Node.js 22+, pnpm 10, TypeScript, pnpm workspaces monorepo.
- x402 TS SDK v2: `@x402/core`, `@x402/evm`, `@x402/fetch` (agent/payer side), `@x402/express` (merchant/payee side).
- Network: **Base Sepolia**, CAIP-2 `eip155:84532`. Asset: testnet USDC.
- Facilitator: `https://x402.org/facilitator` (testnet only — never reuse for mainnet).
- Signing: `viem`; `EXECUTOR_EVM_PRIVATE_KEY` is loaded only by `apps/executor`.
  `EXECUTION_AUTH_PRIVATE_KEY` is loaded only by the trusted API/control plane.
- Postgres 16 via `docker-compose`.
- Audit anchor contract: a minimal Solidity contract on Base Sepolia, deployed with a `viem` script.

**No additions to this list without checking the Bible first.** Every added technology is added risk against a fixed, close deadline (Bible §8).

### 3.2 A note on the merchant side

x402 is a buyer↔seller HTTP protocol: the payer only pays because a resource server answers with HTTP 402. So the demo needs a payee. `apps/merchant` is a small `@x402/express` resource server exposing one route per demo counterparty. It is demo scaffolding representing the merchant being paid — it contains **no** governance logic. All governance lives in the Disposition Engine, on the agent's side, before the request exists.

---

## 4. Folder structure

Maps 1:1 onto the six components named in the brief: agent script, disposition engine, controls repository store, x402 integration, audit log, dashboard.

```
web3-project/
├── README.md
├── docs/
│   ├── SAFR_RUNTIME_PROJECT_BIBLE.md # source of truth
│   ├── PRD.md  Architecture.md  Rules.md  Phases.md  Design.md
│   └── Memory.md                     # working log, created at start of Phase 1
├── package.json                      # pnpm workspace root
├── pnpm-workspace.yaml
├── docker-compose.yml                # Postgres 16
├── .env.example
│
├── packages/
│   ├── core/                         # shared types + zod schemas, Bible §7.1–7.5
│   │   └── src/schemas/
│   │       ├── agent-identity.ts     # §7.1
│   │       ├── mandate.ts            # §7.2
│   │       ├── proposed-action.ts    # §7.3
│   │       ├── disposition.ts        # ALLOW | DENY | ESCALATE | OBSERVE
│   │       └── audit-log.ts          # §7.5
│   │
│   ├── disposition-engine/           # THE rules engine — pure, deterministic, no I/O
│   │   └── src/
│   │       ├── evaluate.ts           # exact check order from §7.4
│   │       ├── checks/               # scope, spend-caps, counterparty, time-window, velocity
│   │       └── __tests__/            # one test per branch in §7.4
│   │
│   ├── controls-repository/          # mandate store (versioned) + counter reads
│   │   └── src/
│   │       ├── mandate-store.ts      # getActiveMandate(agent_id, at) honours effective_from/to
│   │       └── counters.ts           # getRollingTotal(24h), getHourlyTxCount()
│   │
│   ├── audit-log/                    # write path
│   │   └── src/
│   │       ├── audit-log.ts          # the facade: record(), finalize(), writebacks
│   │       ├── canonical.ts          # canonical_json + keccak256 of a §7.5 record
│   │       ├── anchor.ts             # viem client for AuditAnchor on Base Sepolia
│   │       ├── queue.ts              # asynchronous, non-blocking anchoring
│   │       ├── repository.ts         # the audit_anchor table
│   │       ├── cli/verify-anchors.ts # re-hash every record, compare to its anchor
│   │       └── events.ts             # emits to the dashboard live feed  (Phase 6)
│   │
│   ├── x402-client/                  # payer-side x402 implementation
│   │   └── src/pay.ts                # @x402/fetch + @x402/evm wrapper
│   └── execution-authorization/      # signed one-shot capability + exact field checks
│
├── apps/
│   ├── agent/                        # LLM-driven agent + orchestration (owns the gate)
│   │   └── src/
│   │       ├── intent-generator.ts   # LLM → Proposed Action (§7.3)
│   │       ├── orchestrator.ts       # evaluate() BEFORE settlement — §2 above
│   │       └── settlement/           # HTTP clients only; contains no key or x402 import
│   ├── executor/                     # isolated payment-key process; only x402 importer
│   │
│   ├── merchant/                     # x402 resource server (the payee) — demo scaffolding
│   │   └── src/server.ts             # @x402/express, one route per demo counterparty
│   │
│   ├── api/                          # Express: dashboard REST + authorization control plane
│   │   └── src/routes/{audit,escalations,mandates}.ts
│   │
│   └── dashboard/                    # Next.js compliance dashboard (see Design.md)
│       └── app/
│           ├── page.tsx              # live feed
│           └── audit/[audit_id]/     # drill-down = near-direct render of §7.5
│
├── contracts/                        # a workspace package, so it can declare solc
│   ├── AuditAnchor.sol               # anchor(bytes32) — digest only, no audit content
│   └── src/
│       ├── abi.ts                    # hand-written ABI, asserted equal to solc's
│       ├── compile.ts                # solc in memory; no artifacts on disk
│       └── deploy.ts
│
├── db/migrations/                    # SQL mirroring §7.1–7.5 exactly
└── scripts/
    ├── seed.ts                       # agent identity + mandate_001
    └── demo.ts                       # runs the exact 3-scenario script from §9
```

---

## 5. Application flow

### 5.1 Happy path (Scenario 1 — ALLOW)

```mermaid
sequenceDiagram
    participant LLM
    participant Agent as apps/agent orchestrator
    participant Controls as controls-repository
    participant Engine as disposition-engine
    participant Audit as audit-log
    participant Auth as trusted API authorizer
    participant Exec as isolated executor
    participant X402 as x402-client
    participant Merchant as apps/merchant
    participant Dash as dashboard

    LLM->>Agent: Proposed Action (7.3)
    Agent->>Controls: getActiveMandate(agent_id, proposed_at)
    Controls-->>Agent: mandate v1 (7.2)
    Agent->>Controls: rolling total 24h, hourly tx count
    Agent->>Engine: evaluate(action, mandate, counters)
    Engine-->>Agent: ALLOW, reason=within_mandate, rule=null
    Agent->>Audit: write record (7.5)
    Audit-->>Dash: live feed event (green)
    Agent->>Auth: request authorization(audit_id)
    Auth->>Auth: re-read + re-evaluate stored action
    Auth-->>Agent: signed Execution Authorization
    Agent->>Exec: audit_id + signed authorization
    Exec->>Exec: verify all fields + consume once
    Exec->>X402: pay(stored action)
    X402->>Merchant: GET /pay/merchant_xyz
    Merchant-->>X402: 402 + payment requirements
    X402->>Merchant: retry with signed PAYMENT header
    Merchant-->>X402: 200 + PAYMENT-RESPONSE (tx hash)
    X402-->>Exec: settlement { tx_hash, rail: x402 }
    Exec-->>Agent: settlement
    Agent->>Audit: recordSettlement(tx_hash)
    Audit-->>Dash: live feed update (settlement hash)
```

### 5.2 Blocked path (Scenario 2 — DENY)

Identical up to `evaluate()`. The engine returns `DENY`, `reason=per_transaction_cap_exceeded`, `rule=spend_caps.per_transaction_max`. The orchestrator writes the audit record and **returns**. Neither authorization nor executor client is constructed; the isolated executor and x402 are never reached. The dashboard shows red with the rule path displayed.

### 5.3 Escalation path (Scenario 3 — ESCALATE)

`evaluate()` finds the counterparty is not on the allowlist and returns the disposition **configured in the mandate** (`counterparty_policy.unknown_counterparty_disposition`), with `reason=counterparty_not_on_allowlist`, `rule=counterparty_policy`. This is rule-driven, not a special case — that generality is a Technical Quality requirement (Bible §7.2 design note).

The orchestrator writes the audit record (amber), then blocks awaiting a decision. The dashboard shows the pending escalation; the reviewer approves; `apps/api` records `human_review` (`reviewer_id`, `decision`, `decided_at`, `note`) onto the audit record and resolves the agent's wait. **Only then** may the trusted API issue an Execution Authorization; the isolated executor independently verifies it before constructing the x402 payer.

---

## 6. Data layer

Postgres tables mirror Bible §7.1–7.5 **exactly** — same field names, same nesting where JSONB is appropriate.

- `agent_identity` — §7.1
- `mandate` — §7.2. Nested `scope` and `controls` stored as JSONB to preserve the schema shape verbatim. Uniqueness on `(mandate_id, version)`.
- `proposed_action` — §7.3, `payload` as JSONB.
- `audit_log` — §7.5, with `human_review` and `settlement` as nullable JSONB.

`mandate_version` is copied onto every audit record at decision time, so a later mandate edit cannot retroactively change the record of a past decision (Bible §7.2 design note — this exists specifically to close the judge question "what if the rule changes after a transaction is logged?").

### 6.1 Immutability anchor

`keccak256(canonical_json(record))` → `AuditAnchor.anchor(bytes32)` on Base Sepolia. The returned tx hash is stored alongside the record, in an `audit_anchor` table rather than as columns on `audit_log`, so §7.5 stays exactly as the Bible defines it (Rules R4). This supports the "immutable" claim without a custom chain (Bible §8). Only the digest goes on chain — no amounts, no counterparties, no audit content.

Anchoring is **asynchronous and non-blocking**: a slow or failed anchor must never stall or fail a disposition, since the disposition path is the demo-critical one. The digest is computed and stored *before* the network call, so even a total RPC outage leaves a verifiable hash in Postgres.

**Anchoring happens when a record reaches its terminal state, not on each write.** This corrects an earlier draft of this section. A record is mutated after creation — `human_review` on an escalation, `settlement` when a payment resolves — so anchoring at creation would anchor a digest that the stored record no longer matches, and re-hashing it later would fail. Since "re-hash the stored record and compare" is the entire value of the anchor, it is written once the record can no longer change: immediately for a `DENY`, after settlement for an `ALLOW`, after the reviewer decides for an `ESCALATE`. The record is re-read from Postgres before hashing, so the digest covers exactly the bytes a verifier will see.

---

## 7. Interfaces

```ts
// packages/disposition-engine — pure. No DB, no network, no clock reads.
type DispositionValue = "ALLOW" | "DENY" | "ESCALATE" | "OBSERVE";

interface Disposition {
  disposition: DispositionValue;
  reason: string;
  rule: string | null;   // ALWAYS populated; explicit null only for clean ALLOW
}

interface Counters {          // injected, never fetched by the engine itself
  rolling_total_24h: number;
  hourly_tx_count: number;
}

function evaluate(
  proposed_action: ProposedAction,
  mandate: Mandate,
  counters: Counters,
): Disposition;
```

Counters are injected rather than fetched so the engine stays a pure function — this is what makes it exhaustively unit-testable and genuinely deterministic, which is the Technical Quality claim.

`OBSERVE` is present in the type per Bible §4, but no rule in the seeded mandate emits it and it does not appear in the demo script (see PRD §4.3).

---

## 8. Environment variables

```
DATABASE_URL=postgres://safr:safr@localhost:5544/safr_runtime
EVM_ADDRESS=0x...                  # merchant's receiving address
EXECUTOR_WALLET_ADDRESS=0x...      # public payer address only
EXECUTION_AUTHORIZER_ADDRESS=0x... # public trusted-authorizer address
EVM_RPC_URL=https://sepolia.base.org
X402_FACILITATOR_URL=https://x402.org/facilitator
X402_NETWORK=eip155:84532
AUDIT_ANCHOR_ADDRESS=0x...         # set after Phase 5 deploy
ANTHROPIC_API_KEY=                 # or OPENAI_API_KEY — agent intent generation only

# .env.executor (executor process only)
EXECUTOR_EVM_PRIVATE_KEY=0x...

# .env.authorizer (control-plane / anchor processes only)
EXECUTION_AUTH_PRIVATE_KEY=0x...
AUDIT_ANCHOR_PRIVATE_KEY=0x...
```

**Runtime secret split:** `.env` contains public/shared configuration only;
`.env.agent` is read only by the agent and may contain its LLM and audit-anchor
credentials; `.env.authorizer` contains the Execution Authorization and anchor
signing keys; `.env.executor` contains the x402 payment key. The Stage-1 payment
evidence is complete. A fresh funded run through the hardened executor is still
required before claiming live Phase-1 finalist evidence.

# Rules — Operating Boundaries for the AI Agent on This Project

**Scope:** These rules bind me (the AI) for the remainder of this project.
**Precedence:** `SAFR_RUNTIME_PROJECT_BIBLE.md` > `Rules.md` > `PRD.md` / `Architecture.md` / `Phases.md` / `Design.md` > my own judgment.
**Default posture:** When in doubt, do less and ask. The deadline is close and scope creep is the top risk.

**Stage 2 amendment (18 August 2026):** `Critique.md` is the approved finalist
security-depth specification. It does not replace the Bible's product direction,
terminology, schemas, or rule order; it does supersede prior decisions to defer signer
isolation, concurrency, replay/staleness, exact x402 binding, and settlement
reconciliation. Implement its phases in order without broadening the product.

---

## R0. The Bible is the source of truth

- Before adding anything not explicitly planned, **re-read the relevant Bible section**. Bible §0.7: every architecture decision must trace back to something in that document.
- The trace test, applied before writing any new component: *Does it serve the demo script (§9)? Does it match the schemas (§7)? Does it fit the remaining time?* If not, it is scope creep — cut it.
- Do not re-derive the concept from first principles. Do not "improve" the pitch by drifting toward a different idea.

## R1. Flag conflicts; never resolve them unilaterally

If the Bible conflicts with itself, with these docs, with reality (a library that does not work as assumed), or with something I believe is a better approach:

1. **Stop.**
2. State the conflict explicitly: what the Bible says, what the conflicting reality is, and why they cannot both hold.
3. Present the options and a recommendation.
4. **Wait for a decision.** Do not pick and proceed.

Specifically: if I catch myself thinking "a different approach might work better" — that is the trigger for this rule, not a licence to substitute my judgment.

Conflicts flagged and resolved so far, for the record:
- **OBSERVE disposition** (Bible §4 suggests four; §7.4/§9 use three) → resolved: supported in schema and type, never emitted, absent from the demo. See PRD §4.3.
- **Backend language** (Bible §8 permits Node or Python) → resolved: TypeScript/Node end-to-end.
- **Demo amounts vs. testnet funding** (Bible §7.2/7.3 illustrate 1000/500 USDC; faucets cannot fund that) → resolved: faucet-sized seed values only, with the schema unchanged. See PRD §4.4 and `Memory.md` B4.

## R2. Approved stack — this list is closed

From Bible §8, with the permitted Node-vs-Python choice resolved to Node:

- **Agent:** TypeScript script driving an LLM (Claude or GPT) via API, to emit Proposed Action objects only.
- **Middleware / rules engine:** TypeScript. Plain deterministic rule evaluation.
- **Payment rail:** x402 reference implementation (`@x402/core`, `@x402/evm`, `@x402/fetch`, `@x402/express`), Base Sepolia (`eip155:84532`), testnet facilitator.
- **Audit log:** Postgres, plus a per-record hash written to a Base Sepolia contract.
- **Dashboard:** Next.js, live feed (websocket or polling), colour-coded, per-record drill-down.
- **Supporting:** pnpm workspaces, `viem`, `zod`, `docker-compose` for Postgres, a test runner.

**Forbidden without explicit approval:**

- Substituting any framework "for convenience," "because it's cleaner," or "because I know it better." Bible §8: *"Do not substitute a heavier stack 'to look more impressive' — every added technology is added risk against a fixed, close deadline."*
- Adding an ORM, message queue, Redis, Docker orchestration beyond the Postgres container, GraphQL, a component library beyond a Tailwind-based setup, auth providers, or any hosted SaaS dependency.
- Swapping Postgres for SQLite/in-memory, or Next.js for anything else.
- Mainnet. Testnet only.

Adding a dependency is a decision, not a detail. If it is not in the list above, ask.

## R3. The Disposition Engine is rule-based only

Bible §0.6 and §8. Explainability is the entire value proposition; a black-box undermines the pitch even if it is more impressive as an engineering feat.

**Forbidden inside the disposition logic, without exception:**

- ML models, anomaly detection, risk scoring, statistical thresholds, heuristics that are not explicit mandate fields.
- LLM calls of any kind. The LLM's only job in this system is to **play the agent generating payment intents for the demo**. It never evaluates, judges, explains, or summarises a disposition.
- Any nondeterminism: no `Math.random()`, no unseeded time reads inside the engine (`proposed_at` comes from the action; counters are injected).

**Required:** `evaluate()` is a pure function. Same inputs → same output, always. Every branch is unit-tested.

## R4. Schemas are frozen — Bible §7

**Do not rename, restructure, reorder, "clean up," camelCase, flatten, or add fields to these schemas.** They are the interface contract between every component and the thing a judge will read.

**§7.1 Agent Identity:** `agent_id`, `display_name`, `owner_org`, `created_at`, `wallet_address`, `status`

**§7.2 Mandate:** `mandate_id`, `agent_id`, `version`, `effective_from`, `effective_to`, `status`, `scope` { `action_types`, `currencies` }, `controls` { `spend_caps` { `per_transaction_max`, `rolling_window` { `window`, `max_total` } }, `counterparty_policy` { `mode`, `allowlist`, `unknown_counterparty_disposition` }, `time_window` { `allowed_hours_utc`, `allowed_days` }, `velocity` { `max_transactions_per_hour` } }, `default_disposition_on_breach`, `created_by`, `approved_by`

**§7.3 Proposed Action:** `action_id`, `agent_id`, `action_type`, `proposed_at`, `payload` { `counterparty`, `amount`, `currency`, `purpose`, `reference` }

**§7.5 Audit Log:** `audit_id`, `action_id`, `agent_id`, `mandate_id`, `mandate_version`, `disposition`, `reason`, `rule_triggered`, `evaluated_at`, `human_review` { `reviewer_id`, `decision`, `decided_at`, `note` }, `settlement` { `status`, `tx_hash`, `rail`, `settled_at` }

Fields that look redundant are load-bearing and stay:
- `version` / `effective_from` / `effective_to` — so audit records pin the exact mandate version active at decision time.
- `unknown_counterparty_disposition` — makes the ambiguous demo case rule-driven rather than special-cased.
- `created_by` / `approved_by` — may hold dummy values, but must remain; they gesture at mandates being human-authorized.

Snake_case is the wire and database format. If an internal TypeScript type needs a different shape, that is a mapping layer, and the schema shape is what crosses every boundary and is what the dashboard renders.

## R5. Evaluation order is frozen — Bible §7.4

Implement exactly this order; the order itself is part of the design story:

1. `scope.action_types` → DENY `action_type_out_of_scope`
2. `scope.currencies` → DENY `currency_out_of_scope`
3. `spend_caps.per_transaction_max` → DENY `per_transaction_cap_exceeded`
4. `spend_caps.rolling_window` → DENY `rolling_window_cap_exceeded`
5. `counterparty_policy` → **the mandate's configured** `unknown_counterparty_disposition`, reason `counterparty_not_on_allowlist`
6. `time_window` → DENY `outside_allowed_time_window`
7. `velocity.max_transactions_per_hour` → ESCALATE `velocity_threshold_exceeded`
8. else → ALLOW `within_mandate`, `rule=null`

Unambiguous hard-boundary violations resolve to `DENY` before softer, judgment-based checks resolve to `ESCALATE`. Do not reorder for efficiency or elegance.

**Two corrections already applied upstream — do not reintroduce these bugs (Bible §7.4):**
1. `scope.currencies` **is** checked. Do not drop it as redundant for a USDC-only demo.
2. **Every** return populates `rule` (explicit `null` only for the clean ALLOW). Never leave `rule_triggered` silently null on a triggered path.

## R6. The interception constraint is non-negotiable — Bible §6

The Disposition Engine is called by the agent's own orchestration code **before that code ever constructs the x402 HTTP request**. Never a network proxy in front of x402 traffic. On `DENY`, no request object exists. See `Architecture.md` §2 for what this forbids concretely and how it is enforced and tested.

## R7. Do not resurrect rejected ideas — Bible §3

Off the table: generic agent identity layers (ERC-8004), x402-only middleware, EIP-7702 session-key wallets, dispute resolution / claims engines, remittance apps, and anything structurally resembling **TrafficChain** — speculative tokens, from-scratch multi-system simulations, physical-hardware integration.

Each was rejected after verified web research into a saturated, institutionally-backed space. If one seems tempting, treat it as a **warning sign against the timeline**, not an opportunity.

## R8. Describe SAFR accurately — Bible §0.4, §4

- SAFR is an **industry white paper, Version 1.0** by **MAS** under **BuildFin.ai**, published **July 3, 2026**. Explicitly **non-binding**.
- Write "SAFR proposes…" / "SAFR's framework describes…". Never "SAFR requires…" / "compliance with SAFR mandates…".
- Four pillars: **policy-bound execution, real-time validation, auditability, interoperability.** The phrase "three layers: Intent & Orchestration / Control & Authorisation / Settlement & Audit" is a rejected earlier draft that does not appear in the source material. It was corrected once already. Do not reintroduce it.
- Use **disposition**, **mandate**, **controls repository**, **ALLOW / DENY / ESCALATE**.
- This project implements **only** SAFR's payments-and-treasury domain. Say so; do not imply broader coverage.
- State the KLA Control Plane differentiation explicitly and honestly.

## R9. Build order is dependency-ordered — Bible §10

Prove the payment rail works in isolation **before** adding any governance logic on top of it. Do not start the Disposition Engine while Phase 1 is unproven, and do not build the dashboard against mocked data that has never come from a real audit write. Phases and their Definitions of Done are in `Phases.md`; a phase is not done until its DoD is demonstrated, not asserted.

## R10. Keep `Memory.md` current

From the start of Phase 1, after every meaningful chunk of work, update `Memory.md` with: what was just built; what is working vs. broken; what decision was made and why (especially judgment calls not explicitly in the Bible); the next concrete step. Short and factual — a working log, not documentation prose. It must be sufficient, together with the Bible, for a cold session to resume without re-reading the codebase.

## R11. Honesty about state

Never report a phase as working without having run it. Never fill a demo gap with narration. Bible §12 asks whether the demo works "live, without narration filling gaps" — that standard applies to my status reports too. If something is mocked, stubbed, or passing only in tests, say so in those words.

## R12. Finalist authority boundary

- The agent/application process must never hold or load the x402 payment key.
- Only `apps/executor` may import the payer-side `@safr/x402-client` package.
- ALLOW and approved ESCALATE receive a signed Execution Authorization before the
  isolated executor can construct the payer.
- The executor fails closed on any signature, expiry, replay, proposal, mandate,
  reservation, chain, token, amount, payee, or resource mismatch.
- The Bible Section 7 schemas remain frozen. Execution Authorization and reservation
  state are separate security records; do not add their fields to §7.1–§7.5 objects.
- The eight-phase order in `Critique.md` is fixed. Do not implement later-phase claims
  partially and describe them as complete.

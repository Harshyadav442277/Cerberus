# SAFR Runtime — Project Requirements Document (PRD)

**Derived from:** Bible Sections 1, 2, 9, 11, 12.
**Authority:** `SAFR_RUNTIME_PROJECT_BIBLE.md` overrides this document on any conflict.
**Status:** Scope is closed. Anything not listed under "In Scope" is out of scope.

---

## 1. Product definition

**SAFR Runtime is a middleware + dashboard that enforces MAS's SAFR (Safeguards for Agentic Finance at Runtime) governance pattern in real time, gating an AI agent's stablecoin payments before they execute.**

An agent proposes a payment. The system evaluates it against a programmable **mandate** (spend caps, counterparty allowlist, time windows, velocity limits) held in the **controls repository**. The system issues a **disposition** — `ALLOW`, `DENY`, or `ESCALATE` — and the payment only settles over the **x402** protocol if it is allowed, or escalated and then approved. Every proposal and decision is written to an audit log a compliance officer could query.

**The wedge, stated plainly (Bible Section 5):** *"We built the first version of the SAFR disposition pattern wired directly into x402 stablecoin settlement, live, in a working demo."*

### 1.1 Accuracy constraints on how we describe SAFR

These are correctness requirements, not style preferences. A Singapore-based finance judging panel may know the source paper.

- SAFR is an **industry white paper, Version 1.0**, published by **MAS** jointly with financial institutions and FinTechs under the **BuildFin.ai** initiative, on **July 3, 2026**.
- SAFR is **explicitly non-binding**. MAS states it does not constitute regulatory guidance or supervisory expectations. Write "SAFR proposes…" / "SAFR's framework describes…". Never "SAFR requires…" or "compliance with SAFR mandates…".
- SAFR's four pillars: **policy-bound execution, real-time validation, auditability, interoperability.** Never the rejected "three layers" phrasing.
- SAFR names three applied domains. **This project implements only domain (1): agent-assisted payments and treasury operations.** State this explicitly; do not imply broader coverage.

---

## 2. Target users

| User | Role in the system | What they need from it |
|---|---|---|
| **Compliance officer** at a financial institution (primary) | Authors and approves mandates; reviews escalations; queries the audit log | To prove, per transaction, what the agent proposed, what rule fired, who approved it, and when |
| **Treasury / payment operations owner** (secondary) | Owns the agent that spends | Confidence the agent physically cannot exceed its mandate |
| **Auditor / regulator-facing reviewer** (tertiary) | Reads only | A durable, tamper-evident record of proposal → disposition → settlement |

The dashboard is built for the **compliance officer**. It is an internal control tool for a regulated institution, not a consumer product.

---

## 3. Problem statement

MAS published the SAFR white paper on July 3, 2026, describing how AI agents should be governed at the point of financial action. As of this submission, the only known implementation is enterprise consulting infrastructure (**KLA's Control Plane** — Agent Registry, Policy Builder, Policy Engine, Audit Trail, four dispositions). There is **no open, agent-native implementation wired to a live crypto-native settlement rail.** We built one.

SAFR's own framing says firms are expected to build four things. This is, almost exactly, our feature list:

1. A pre-execution control gate checking proposed actions against mandates/risk limits.
2. A defined trigger and route for human oversight when an action falls outside boundaries.
3. A durable record of what was proposed, approved/blocked, and why, at each decision point.
4. Interoperability across agent frameworks rather than lock-in to one platform.

---

## 4. Feature set

The feature set is derived **strictly** from the three demo scenarios in Bible Section 9 and the schemas in Bible Section 7. Nothing else.

### 4.1 In scope

**F1 — Agent (payment intent generator)**
An LLM-driven script that produces structured **Proposed Action** objects (Bible 7.3) from a scenario prompt. Its only job is to generate believable payment intents. It is not sophisticated and holds no compliance logic.

**F2 — Disposition Engine**
A deterministic, rule-based `evaluate(proposed_action, mandate)` implementing the **exact check order in Bible 7.4**: scope.action_types → scope.currencies → per_transaction_max → rolling_window → counterparty_policy → time_window → velocity → ALLOW. Every return populates `reason` and `rule` (explicit `null` for the clean ALLOW). No ML, no scoring, no LLM judgment.

**F3 — Controls Repository**
Stores versioned **Mandate** records (Bible 7.2) with `version`, `effective_from`, `effective_to`, so an audit record can reference exactly which mandate version was active at decision time. Also serves the rolling-window and velocity counters the engine reads.

**F4 — Pre-execution interception**
The agent's orchestration code calls the Disposition Engine **before it constructs the x402 HTTP request**. On `DENY`, the request is never constructed. This is the non-negotiable constraint from Bible Section 6.

**F5 — x402 settlement**
On `ALLOW` (or `ESCALATE` → approved), the agent fires the x402 payment against a stablecoin testnet and the resulting settlement hash is captured.

**F6 — Human escalation and review**
`ESCALATE` holds the action, routes it to a reviewer in the dashboard, and resumes to settlement on approval. The decision is recorded in `audit_log.human_review` with `reviewer_id`, `decision`, `decided_at`, `note`.

**F7 — Audit log**
Postgres records mirroring Bible 7.5 exactly, plus a hash of each record written to a testnet smart contract to support the "immutable" claim.

**F8 — Compliance dashboard**
Next.js. Live feed of audit records (websocket or polling), colour-coded by disposition (green=ALLOW, red=DENY, amber=ESCALATE), with per-record drill-down. The drill-down is a **near-direct render of the Bible 7.5 audit object**, not a redesign of it.

**F9 — Agent Identity**
Minimal record per Bible 7.1 — just enough to bind an agent to a mandate. Explicitly *not* an ERC-8004 implementation.

### 4.2 Explicitly out of scope

Listed so the boundary is unambiguous, not to invite reconsideration:

- Any ML, anomaly detection, or scoring model in the disposition logic (Bible Section 0.6).
- ERC-8004 / generic agent identity layer, EIP-7702 session keys, dispute resolution or claims engines, remittance features (Bible Section 3 — all rejected).
- Any speculative token, multi-system simulation, or physical-hardware integration (Bible Section 3 — TrafficChain class of risk).
- SAFR's other two applied domains (wealth management/advisory, client engagement).
- Multi-tenant auth, user accounts, mandate-authoring UI, RBAC. Mandates are seeded; `created_by`/`approved_by` are dummy values that stay in the schema.
- Mainnet. Testnet only.

### 4.3 Flagged decision — OBSERVE disposition

Bible Section 4 notes a fourth, lower-stakes disposition (**observe/warn** — log without gating) and says it is "worth including as a fourth disposition option in the build." Bible Sections 7.4 and 9 use only three. **Resolution (confirmed by project owner): `OBSERVE` is supported in the schema and the disposition type, but no rule in the seeded mandate emits it and it does not appear in the demo script.** This honours Section 4 without touching Section 7.4's check order or Section 9's three scenarios.

### 4.4 Flagged decision — demo amounts vs. testnet funding

Bible 7.2/7.3 illustrate a mandate with `per_transaction_max: 1000` and a payment of `amount: 500`. Testnet USDC is faucet-limited and cannot fund payments of that size. **Proposal: keep the schema and field names exactly as written, and set the seeded mandate's numeric values low enough to actually settle on Base Sepolia** (e.g. `per_transaction_max: 1.00`, clean payment `0.50`, cap-breach attempt `5.00`). This changes seed data only — no schema field is renamed, removed, or added. Flagging because the illustrative values come from the Bible; confirm before seeding.

---

## 5. Functional requirements, mapped to the demo script

The demo script in Bible Section 9 **is** the acceptance test. Each scenario below must run end-to-end, live, with no narration filling gaps.

**Scenario 1 — Clean transaction**
Agent proposes paying an allowlisted merchant an amount within the cap → **ALLOW** → x402 fires → dashboard shows green, settlement hash appears within seconds.

**Scenario 2 — Cap breach**
Agent attempts a payment exceeding the per-transaction cap → **DENY** → the x402 call is never constructed → dashboard shows red, displaying the specific rule that fired (`spend_caps.per_transaction_max`).

**Scenario 3 — Ambiguous / new counterparty**
Agent attempts a payment to a counterparty not on the allowlist, under the cap → **ESCALATE** (driven by the mandate's `unknown_counterparty_disposition` field, not a hardcoded branch) → dashboard shows amber → a human playing compliance officer reviews and approves live → x402 fires only after approval → the audit record shows both the original proposal and the human decision.

**Reliability requirement (Bible Section 9):** the judged demo pre-stages the ESCALATE approval as a fast, reliable click during a scripted run-through. A genuinely open-ended live pause is a stretch goal only, attempted near the end of the build if time allows.

---

## 6. Non-functional requirements

- **Determinism.** Identical `(proposed_action, mandate, counter_state)` must always yield an identical disposition. The engine is a pure function; all I/O is injected.
- **Explainability.** Every disposition carries a machine-readable `reason` and the `rule` path that fired. This is the entire value proposition (Bible Section 0.6).
- **Generality over scripting.** The engine must look like a general system, not three scripted tricks. Scenario 3 in particular must resolve through `unknown_counterparty_disposition`, not a special case (Bible 7.2 design note).
- **Latency.** Disposition returned in well under a second; the dashboard visibly reacts in real time during the demo.
- **Auditability.** Every audit record references `mandate_id` **and** `mandate_version`, so a later mandate change cannot retroactively alter the record of a past decision.
- **Reliability over surface area.** Technical Quality (30%) rewards a working prototype, not ambition. A small number of things that fully work beats a large number half-mocked.

---

## 7. Stage 1 submission requirements (Bible Sections 1, 11)

**Deadline: Aug 14, 2026, 9:15 PM GMT+5:30 / 11:59 PM SGT.** Recomputed against the real current date (Aug 7, 2026, 00:17 IST): **7 days and 21 hours remain.**

- **Project Details** — title, track, team type, short description.
- **Project Overview** — problem, solution, key features, target users, technologies used. Must state SAFR's non-binding status. Must use Section 4 terminology. Must state the KLA differentiation explicitly.
- **Supporting Materials (≥1 mandatory)** — the Section 6 architecture diagram cleaned up for a slide, plus a demo clip if the build is far enough along.
- **Team Details** — every member's name and affiliation. If submitting as a Student Group, proof of current student status for every member. *Open item: the team composition and category are unknown to this project's documents and must be confirmed with the actual team.*
- **Project Link** — GitHub repo; optional but recommended.

**Track:** Track 1 (Payments and Financial Infrastructure), primary. Track 2 relevance may be noted in one sentence; do not hedge the primary selection.

Written submission is drafted **after** a working build exists (Bible Section 10, step 9), so "technologies used" describes what was actually built.

---

## 8. Success criteria

Scored against the judging weights in Bible Section 1 and the self-check in Section 12.

- **Technical Quality (30%)** — all three Section 9 scenarios run end-to-end, live, unassisted; the engine is genuinely rule-driven per 7.4, not hardcoded per scenario.
- **Real-World Impact (25%)** — the MAS SAFR publication is cited accurately, correctly scoped to payments/treasury only, with non-binding status stated.
- **Innovation (20%)** — the KLA Control Plane differentiation is stated explicitly.
- **Demo and Presentation (15%)** — the run-through follows the exact three-transaction script with the dashboard visibly reacting in real time.
- **Track Relevance (10%)** — payments/financial-infrastructure framing is explicit and primary, not buried under generic "AI agent" language.

---

## 9. Top risk

**Scope creep.** Given 7 days and 21 hours, it is the single largest threat to the submission. Every proposed addition must trace to the Section 9 demo script or the Section 7 schemas. If it traces to neither, it is cut.

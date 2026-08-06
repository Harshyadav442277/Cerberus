# SAFR Runtime — Project Bible & Build Reference
**Status:** Locked project direction. Do not re-litigate the core concept, track choice, or architecture below unless a hard blocker makes the current plan literally unbuildable in the remaining time — and if that happens, flag it explicitly rather than silently drifting.

**Purpose of this document:** This is the single source of truth for the build. Every decision in here was made deliberately, after checking for prior art, after correcting earlier mistakes, and against the actual hackathon rules. If you (the agent picking this up) are ever unsure what to build next, what terminology to use, or whether an idea is safe to pursue — **come back to this document before deciding anything.** Do not re-derive the concept from first principles. Do not "improve" the pitch by drifting toward a different idea, even if it seems clever in the moment. Treat scope changes as high-risk given the timeline below.

---

## 0. Non-negotiables — read this section every time before making a decision

1. **The hackathon rules are the outer boundary on everything.** Before adding any feature, any content, any submission material — check it against Section 1 below. If it doesn't fit the rules, don't build it, no matter how good it seems.
2. **The deadline is fixed and close.** Stage 1 online submission is due **Aug 14, 2026, 9:15 PM GMT+5:30 (11:59 PM SGT)**. As of this document being written, that is **8 days away**. Do not plan around a 48-hour hackathon-weekend format — that was a mistake made earlier in scoping a different (rejected) idea, and it is not how this event works. There is no in-person building until Stage 2, and Stage 2 only happens if the team is shortlisted.
3. **Do not pivot to a new core idea.** Section 3 explains, in detail, why the current concept (SAFR Runtime) was chosen over four other real candidates, including a fully-scoped alternative ("TrafficChain") that was deliberately rejected. If you find yourself wanting to suggest something "more innovative" or "more impressive," read Section 3 first — it was already checked against real, current prior art via web research, and it already lost to the current idea for specific, documented reasons.
4. **Do not overclaim what SAFR is.** SAFR is an **industry white paper, not binding regulation**. MAS explicitly states it does not constitute regulatory guidance or supervisory expectations. Say "SAFR proposes..." or "SAFR's framework describes..." — never "SAFR requires..." or "compliance with SAFR mandates...". A Singapore-based judging panel may know this paper directly; getting its status wrong is an easy, avoidable, embarrassing error.
5. **Use SAFR's actual vocabulary, not invented paraphrases.** See Section 4 for the corrected terminology. An earlier draft of this project's pitch used "three layers: Intent & Orchestration / Control & Authorisation / Settlement & Audit" — **this phrasing does not appear in the source material and should not be used.** The correct structure is in Section 4. This correction happened once already in this project's history; don't reintroduce the wrong version.
6. **Keep the rules engine rule-based, not ML-based.** This was a deliberate choice (Section 8, Risks). Explainability is the entire value proposition of a compliance system — a black-box ML model undermines the pitch even if it's more "impressive" as an engineering feat. Do not add anomaly detection, scoring models, or LLM-based judgment calls into the disposition logic itself. The LLM's job is to play the *agent* generating intents for the demo, not to be the compliance layer.
7. **Every architecture decision must trace back to something in this document.** If you're about to build something not described here, stop and check: does it serve the demo script (Section 9)? Does it match the schemas (Section 6)? Does it fit inside the 8-day build plan (Section 7)? If not, it's scope creep — cut it.

---

## 1. Hackathon rules — the outer constraints (check every decision against this)

**Event:** NTU InnovateX Hackathon 2026, co-organized by NTU's Centre in Computational Technologies for Finance (CCTF) and SNZ.

**Eligibility:** Participants must be above the legal age of majority in their country of residence. A team is required (not solo). Open to all countries/territories excluding standard exceptions.

**Tracks (must pick one as primary):**
- **Track 1: Payments and Financial Infrastructure** — payment flows, merchant tools, settlement, treasury, remittance, or solutions improving how value moves and financial operations are managed. **← This project's primary track.**
- **Track 2: Web3 Applications, AI Agents and Real-World Use Cases** — AI-powered Web3 applications, agentic workflows, intelligent on-chain tools. This project is also legitimately relevant here, but Track 1 is the stronger, more literal fit — say so in the submission but don't hedge on the primary track choice.

**Team types:**
- *Student Group* — all members must be current students; proof of student status may be required; eligible for dedicated student awards.
- *Public Group* — everyone else, including mixed teams.
(Confirm with the actual team which category applies before submitting — this document doesn't know the team composition.)

**Stage 1 — Online Submission (deadline: Aug 14, 2026, 9:15 PM GMT+5:30 / 11:59 PM SGT):**
Required components, all mandatory unless noted:
- **Project Details** — title, selected track, team type, short description.
- **Project Overview** — the problem, proposed solution, key features, target users, and technologies used.
- **Supporting Materials** — **at least one** of: slide deck, screenshot, mockup, prototype, architecture diagram, demo clip, or other file clearly communicating the idea and progress. A completed product is *not* required at this stage — originality, feasibility, and clear development direction are what's being screened.
- **Team Details** — every team member's name and affiliation. Student Group teams must also provide proof of current student status for every member.
- **Project Link or Repository** — optional but recommended (GitHub repo, prototype link, live demo).

Submissions are screened Aug 15–16, 2026; shortlisted teams notified around Aug 16, 2026.

**Stage 2 — On-Site Final (Aug 21–23, 2026, at NTU, Singapore):** Only for shortlisted teams. Must present a **functional prototype or working demo**, updated materials, and a live presentation. **At least one team member must attend in person.**

**Judging criteria and weights (design every decision to score well here):**
| Criterion | Weight | What it rewards |
|---|---|---|
| Technical Quality | 30% | Quality of implementation, technical depth, reliability, completeness of the *working* prototype — not ambition. |
| Real-World Impact | 25% | Relevance of the problem, practical usefulness, potential for real-world adoption. |
| Innovation | 20% | Originality, creativity, strength of the product concept. |
| Demo and Presentation | 15% | Clarity of the demo, usability, how well the team explains the project's value. |
| Track Relevance | 10% | Fit with the selected track and its intended challenge area. |

**Implication for build priorities:** Technical Quality and Real-World Impact together are 55% of the score. This is why the build plan (Section 7) prioritizes a small number of things that fully work over a large number of things that are half-mocked, and why the concept (Section 3) was chosen specifically because it maps to a real, current, named real-world problem rather than a hypothetical one.

---

## 2. The project, in one paragraph

**SAFR Runtime is a middleware + dashboard that enforces MAS's SAFR (Safeguards for Agentic Finance at Runtime) governance pattern in real time, gating an AI agent's stablecoin payments before they execute.** An agent proposes a payment; the system evaluates it against a programmable "mandate" (spend caps, counterparty allowlist, time windows, velocity limits); the system issues a disposition — `ALLOW`, `DENY`, or `ESCALATE` — and only allows the payment to actually settle over the **x402** protocol if it's allowed or approved. Every proposal and decision is written to an audit log a compliance officer could query. It is, as far as this project's research could determine, the first working implementation of the SAFR pattern wired directly to a live crypto-native payment rail rather than sold as enterprise consulting infrastructure.

---

## 3. Why this idea, and not the alternatives (full decision history — do not re-open)

This project went through several rounds of idea generation and rejection. Each rejection was based on **verified web research**, not guesswork. Do not resurrect any of these without re-verifying — and even then, be very skeptical, because the underlying reason for rejection (a saturated, institutionally-backed space) is unlikely to have changed in days.

### Rejected: generic agent identity layer (ERC-8004-based)
Initially looked like a gap right after ERC-8004 hit mainnet (~Jan/Feb 2026). By the time this was checked (August 2026), it was confirmed saturated: a project called "AgentPass" already ships ERC-8004 identity replacing API keys with contracts/SDK/demo auth server; there's a dedicated $50K "AI Trading Agents Hackathon" built entirely around ERC-8004 trust layers; the Ethereum Foundation is actively running an initiative recruiting builders for exactly this. **Verdict: too crowded, low differentiation, judges likely to have seen near-identical submissions.**

### Rejected: x402 micropayment middleware alone
Also saturated by the time it was checked: teams already shipped things like "Arc Merchant" (autonomous AI agent payments via x402 + Circle Wallets + Arc blockchain), multiple dedicated x402 hackathons exist (Cronos $42K, Aptos, Arc), and by April 2026 there were 165M+ x402 transactions across 69,000+ active agents — production infrastructure, not a gap.

### Rejected: EIP-7702 scoped session-key wallets
Same pattern — a standard, documented architecture with multiple vendors (Openfort, MetaMask, Human.tech, thirdweb) already shipping "valet key" scoped-permission wallets for agents.

### Rejected: agent dispute resolution / claims engine
This looked promising for a moment (identity/payments infra existing doesn't mean "what happens when a deal goes wrong" is solved) — but verification found it's *also* institutionally saturated: the American Arbitration Association launched a "Legal Context Protocol" in June 2026 with Google, IBM, Circle, Stellar, Ava Labs, Cardano, Hedera and a dozen others as founding contributors; "Internet Court," backed by 27 firms including OKX and MetaMask, launched around the same time specifically to resolve AI-agent-to-agent disputes; ERC-8183 (a live draft standard) builds escrow + dispute arbitration directly into agent payments, with BNB Chain shipping the first implementation in March 2026 using UMA's oracle. **Verdict: not a hackathon-scale gap — it's a live institutional arms race.**

### Rejected: cross-border agent-mediated remittance for underbanked users
A reasonable "real-world impact" angle, but crowded — dedicated hackathons already exist specifically around cross-border payments/remittance use cases. Weaker differentiation than the eventual choice.

### Rejected (in detail, because it was a fully fleshed-out competing proposal): "TrafficChain" — an autonomous mobility economy
A teammate/collaborator proposed a detailed alternative: AI-driven delivery vehicles (vans, scooters, robots) using ERC-6551 token-bound accounts to subcontract last-mile deliveries to each other via x402 escrow, plus a second mechanism where commuters trade "priority lane" access through a custom two-token (Burn-and-Mint Equilibrium) system. This was rejected for five concrete reasons, after research and analysis:

1. **Wrong timeline assumption.** It was scoped around a 48-hour on-site hackathon sprint. The actual event is a 9-day (now 8-day) *online* Stage 1 submission — planning around the wrong clock leads to catastrophically misjudging what's achievable.
2. **Scope far exceeds what's buildable.** Its full architecture requires: a SUMO traffic simulator, libp2p mesh networking, zero-knowledge location proofs, NFC/QR physical handoff verification, an automated matching marketplace, two custom smart contracts, and a dual-token economic model — as an from-scratch build. That's roughly 8 hard sub-projects, any one of which failing makes the whole demo look broken or faked, in a category (Technical Quality) worth 30% of the score.
3. **Weak track/judge fit.** The hackathon is co-organized by a university finance research center. TrafficChain is a mobility/logistics idea with token economics attached — it borrows Web3 vocabulary but isn't actually about payments or financial infrastructure the way Track 1 wants.
4. **Invented speculative tokenomics is a red flag, not a strength**, to a finance-literate judging panel — "where does real demand for $ROAD come from beyond this demo" is an immediate, hard-to-answer objection.
5. **It solves a hypothetical problem, not a current, named one.** SAFR Runtime is a direct response to a regulator's white paper published six weeks before the hackathon, in the same jurisdiction as the host institution. TrafficChain responds to no current, specific ask from anyone.

**If anyone suggests reviving TrafficChain, or something structurally similar (a new speculative token, a from-scratch multi-system simulation, anything requiring physical-world hardware integration), treat that as a large red flag against the 8-day timeline and the judging weights above, not as a creative opportunity.**

### Chosen: SAFR Runtime
Selected because, after the same level of scrutiny applied to every rejected idea above, it held up: MAS published the SAFR white paper on **July 3, 2026** — about six weeks before this hackathon's deadline — and as of research done during this project's scoping, the only real prior art is **KLA's "Control Plane"** (see Section 5), which is enterprise consulting/infrastructure, not an open, agent-native system wired to a live crypto payment rail. This is a real, current, narrow, still-open gap — not a new protocol primitive (which would be unbuildable in the time available) and not a purely speculative concept (which would be unconvincing to finance-literate judges).

---

## 4. What SAFR actually says — corrected, source-grounded terminology

**Do not use looser paraphrases of this. Use these terms directly in the submission and in code/schema naming where reasonable.**

- **Full name:** Safeguards for Agentic Finance at Runtime (SAFR).
- **Publisher:** Monetary Authority of Singapore (MAS), jointly with financial institutions and FinTechs, under MAS's **BuildFin.ai** initiative.
- **Published:** July 3, 2026, as an **industry white paper, Version 1.0**.
- **Legal status:** Explicitly **not binding**. MAS states it does not constitute regulatory guidance or supervisory expectations, and does not prescribe or anticipate future regulatory direction. It signals a *likely design standard*, not a rule. **Always describe it this way — never as a compliance requirement or law.**
- **Core mechanism:** SAFR sits **between the agent and the execution environment**. It takes a proposed action and evaluates it **deterministically** against controls to decide whether the action can be **executed**, must be **escalated** for human decision, or must be **rejected**. (Some independent secondary sources also describe a fourth, lower-stakes mode — **observe/warn**, log without gating — worth including as a fourth disposition option in the build even if the primary paper emphasizes three.)
- **Four pillars** (the real structural language — NOT "three layers"): **policy-bound execution, real-time validation, auditability, and interoperability.**
- **Three applied domains named in the paper:** (1) agent-assisted **payments and treasury operations**, (2) **wealth management and advisory document review**, (3) **client engagement** (agents drafting client-facing material within approved content boundaries). **This project implements only domain (1).** Say so explicitly in the submission — don't imply broader coverage than what's built.
- **What firms are expected to build, per the paper's own framing:** a pre-execution control gate checking proposed actions against mandates/risk limits; a defined trigger and route for human oversight when an action falls outside boundaries; a durable record of what was proposed, approved/blocked, and why, at each decision point; and interoperability across agent frameworks/vendors rather than lock-in to one platform. **This is almost exactly this project's feature list — use this framing directly in the "why this matches SAFR" section of the submission.**

---

## 5. Competitive differentiation: KLA "Control Plane"

KLA already sells a commercial "Control Plane" implementing the SAFR pattern: an Agent Registry (→ Agent Identity), Policy Builder (→ Controls Repository), Policy Engine (→ Disposition Engine), and Audit Trail (→ Audit Log), with **four dispositions**: Deny (block), Escalate (require_approval), Auto-Execute (allow), Observe (warn).

**This confirms the vocabulary to use** (adopt "disposition," "mandate," "controls repository" language — it's now the emerging industry standard, not just this project's invention). It does **not** eliminate the opportunity, because KLA's offering is:
- Enterprise infrastructure/consulting sold into regulated financial institutions, not an open or agent-native build.
- Not (as far as verified) wired directly to a live crypto-native settlement rail like x402.
- Not a hackathon-scoped, demoable, open artifact.

**The pitch's explicit wedge:** *"We built the first version of the SAFR disposition pattern wired directly into x402 stablecoin settlement, live, in a working demo."* State this plainly in the submission — it's the honest, defensible differentiation.

---

## 6. System architecture

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

**Critical implementation constraint (do not violate this):** The Disposition Engine must be called as a **library/function call or local API call by the agent's own orchestration code, before that code ever constructs the x402 HTTP request** — not as a network proxy sitting in front of x402 traffic. x402's handshake is a thin HTTP-402 challenge/response; trying to intercept and inspect it after the agent's HTTP call has already fired defeats the entire "pre-execution" premise SAFR is built around, and is also more fragile to build in the time available. Simplest correct pattern: the agent script must call `disposition_engine.evaluate(intent)` and only proceeds to build the x402 request if the response is `ALLOW` (or `ESCALATE` → `ALLOW` after human approval).

---

## 7. Data schemas — build against these exactly

### 7.1 Agent Identity
```json
{
  "agent_id": "agent_treasury_01",
  "display_name": "Treasury Payments Agent",
  "owner_org": "acme_corp",
  "created_at": "2026-08-06T09:00:00Z",
  "wallet_address": "0xA1b2...",
  "status": "active"
}
```
Keep minimal — this is not a full ERC-8004 identity implementation, just enough to bind an agent to a mandate.

### 7.2 Mandate (the Controls Repository record)
```json
{
  "mandate_id": "mandate_001",
  "agent_id": "agent_treasury_01",
  "version": 1,
  "effective_from": "2026-08-06T00:00:00Z",
  "effective_to": null,
  "status": "active",

  "scope": {
    "action_types": ["payment"],
    "currencies": ["USDC"]
  },

  "controls": {
    "spend_caps": {
      "per_transaction_max": 1000,
      "rolling_window": { "window": "24h", "max_total": 3000 }
    },
    "counterparty_policy": {
      "mode": "allowlist",
      "allowlist": ["merchant_xyz", "merchant_abc"],
      "unknown_counterparty_disposition": "ESCALATE"
    },
    "time_window": {
      "allowed_hours_utc": ["00:00-23:59"],
      "allowed_days": ["Mon", "Tue", "Wed", "Thu", "Fri"]
    },
    "velocity": { "max_transactions_per_hour": 10 }
  },

  "default_disposition_on_breach": "DENY",
  "created_by": "compliance_officer_01",
  "approved_by": "compliance_officer_01"
}
```
Design notes to preserve:
- `version` + `effective_from`/`effective_to` exist so audit records can reference exactly which mandate version was active at decision time — keep this even though it adds a little complexity; it closes an obvious judge question ("what if the rule changes after a transaction is logged?").
- `unknown_counterparty_disposition` makes the "ambiguous" demo case rule-driven, not hardcoded/special-cased. This matters for Technical Quality scoring — it should look like a general system, not a scripted trick.
- `created_by`/`approved_by` can be dummy values for the demo but must remain in the schema — they gesture at the idea that mandates themselves are human-authorized, which SAFR treats as important.

### 7.3 Proposed Action
```json
{
  "action_id": "action_00042",
  "agent_id": "agent_treasury_01",
  "action_type": "payment",
  "proposed_at": "2026-08-06T14:32:00Z",
  "payload": {
    "counterparty": "merchant_xyz",
    "amount": 500,
    "currency": "USDC",
    "purpose": "service_fulfillment",
    "reference": "invoice_884"
  }
}
```

### 7.4 Disposition Engine — evaluation order (implement exactly this order; the order itself is part of the design story)
```python
def evaluate(proposed_action, mandate):
    # 1. Scope check: action type (hard boundary)
    if proposed_action.action_type not in mandate.scope.action_types:
        return Disposition("DENY", reason="action_type_out_of_scope",
                            rule="scope.action_types")

    # 1b. Scope check: currency (hard boundary)
    if proposed_action.currency not in mandate.scope.currencies:
        return Disposition("DENY", reason="currency_out_of_scope",
                            rule="scope.currencies")

    # 2. Spend cap checks (hard boundary — unambiguous violations resolve to DENY)
    if proposed_action.amount > mandate.controls.spend_caps.per_transaction_max:
        return Disposition("DENY", reason="per_transaction_cap_exceeded",
                            rule="spend_caps.per_transaction_max")

    rolling_total = get_rolling_total(proposed_action.agent_id, window="24h")
    if rolling_total + proposed_action.amount > mandate.controls.spend_caps.rolling_window.max_total:
        return Disposition("DENY", reason="rolling_window_cap_exceeded",
                            rule="spend_caps.rolling_window")

    # 3. Counterparty check (judgment-based — resolves per mandate's configured disposition)
    if proposed_action.counterparty not in mandate.controls.counterparty_policy.allowlist:
        disposition = mandate.controls.counterparty_policy.unknown_counterparty_disposition
        return Disposition(disposition, reason="counterparty_not_on_allowlist",
                            rule="counterparty_policy")

    # 4. Time window check (hard boundary)
    if not within_allowed_window(proposed_action.proposed_at, mandate.controls.time_window):
        return Disposition("DENY", reason="outside_allowed_time_window",
                            rule="time_window")

    # 5. Velocity check (judgment-based — leans ESCALATE, not DENY)
    if get_hourly_tx_count(proposed_action.agent_id) >= mandate.controls.velocity.max_transactions_per_hour:
        return Disposition("ESCALATE", reason="velocity_threshold_exceeded",
                            rule="velocity.max_transactions_per_hour")

    return Disposition("ALLOW", reason="within_mandate", rule=None)
```
The ordering — unambiguous hard-boundary violations resolve to `DENY` before softer, judgment-based checks resolve to `ESCALATE` — is a deliberate design decision. Mention it explicitly in the written submission; it demonstrates the team understood the difference between a clear violation and an ambiguous case, which is exactly the distinction SAFR's own "execute / escalate / reject" framing is built around.

**Two corrections applied to this pseudocode (do not reintroduce these bugs):**
1. `mandate.scope.currencies` (Section 7.2) is now actually checked — an earlier draft defined this field but never validated against it, which is harmless for a hardcoded-USDC demo but would read as an incompletely-enforced schema to anyone reviewing the code, undercutting Technical Quality.
2. **Every** `Disposition` return now populates `rule=` (or explicit `rule=None` for the clean `ALLOW` case), matching the audit log's evident intent (Section 7.5) that every triggered rule be identifiable. An earlier draft left three paths (scope, time window, velocity) without a `rule` value, which would have silently produced `null` in `audit_log.rule_triggered` for those cases — none of which happen to be hit by the demo script in Section 9, but would be a loose end for anyone extending the system past the three scripted scenarios.

### 7.5 Audit Log record
```json
{
  "audit_id": "audit_00042",
  "action_id": "action_00042",
  "agent_id": "agent_treasury_01",
  "mandate_id": "mandate_001",
  "mandate_version": 1,
  "disposition": "ALLOW",
  "reason": "within_mandate",
  "rule_triggered": null,
  "evaluated_at": "2026-08-06T14:32:00.412Z",
  "human_review": null,
  "settlement": {
    "status": "settled",
    "tx_hash": "0xdeadbeef...",
    "rail": "x402",
    "settled_at": "2026-08-06T14:32:01.100Z"
  }
}
```
For `ESCALATE` cases, populate after the human decides:
```json
"human_review": {
  "reviewer_id": "compliance_officer_01",
  "decision": "approved",
  "decided_at": "2026-08-06T14:35:10Z",
  "note": "Verified merchant_new via out-of-band call"
}
```
Every field a compliance officer would want to see is already in this record — the dashboard's drill-down view should be a near-direct render of this object, not a redesign of it.

---

## 8. Tech stack (chosen to minimize build risk, not to maximize novelty)

- **Agent:** a simple LLM-driven script (Claude or GPT via API) that generates believable payment intents from a scenario prompt. It does not need to be sophisticated — its only job is to produce structured Proposed Action objects.
- **Middleware / rules engine:** Node.js or Python (FastAPI). Plain deterministic rule evaluation — **no ML model here** (see Section 0, point 6).
- **Payment rail:** x402 reference implementation (Coinbase's open-source implementation), run on a testnet.
- **Audit log:** Postgres for full queryable records; write a hash of each record to a testnet smart contract to support the "immutable" claim without needing a full custom chain.
- **Dashboard:** Next.js, with a live feed (websocket or polling) showing the audit log in real time, color-coded by disposition (green=ALLOW, red=DENY, amber=ESCALATE), with drill-down per record.

Do not substitute a heavier stack "to look more impressive" — every added technology is added risk against a fixed, close deadline.

---

## 9. Demo script — build toward this exact sequence

1. **Clean transaction.** Agent proposes paying an allowlisted merchant an amount within the cap → **ALLOW** → x402 fires → dashboard shows green, settlement hash appears within seconds.
2. **Cap breach.** Agent attempts a payment exceeding the per-transaction cap → **DENY** → the x402 call is never constructed → dashboard shows red, with the specific rule that fired (`spend_caps.per_transaction_max`) displayed.
3. **Ambiguous / new counterparty.** Agent attempts a payment to a counterparty not on the allowlist, under the cap → **ESCALATE** → dashboard shows amber, a human (playing compliance officer) reviews and approves live → x402 fires only after approval → audit record shows both the original proposal and the human decision.

**Reliability decision:** For the actual judged demo, **pre-stage the ESCALATE approval as a fast, reliable click during a scripted run-through**, rather than a genuinely open-ended live pause. A live, unscripted pause is a legitimate stretch goal if time allows near the end of the build, but should not be the primary plan — live-demo flakiness during judging is a preventable, low-value risk.

---

## 10. Build plan — recompute against the actual remaining time before starting

The original plan assumed 9 days from a specific starting date; **recompute the day count against today's actual date and the Aug 14, 9:15 PM GMT+5:30 deadline before committing to a day-by-day schedule.** Do not assume the day numbers below are still accurate without checking.

Sequence (in dependency order, not fixed calendar days):
1. Set up repo; stand up a bare x402 testnet payment flow end-to-end (agent → rail, **no rules yet**) — prove the payment rail itself works before adding any governance logic on top of it.
2. Build the Postgres schema mirroring Sections 7.1–7.5 exactly.
3. Implement the Disposition Engine (`evaluate()`) against a hardcoded seed mandate, following the exact check order in Section 7.4.
4. Wire the Disposition Engine in front of the x402 call — confirm `DENY`/`ESCALATE` genuinely prevent the HTTP request from being constructed, not just from "succeeding."
5. Build the audit log write path (Postgres + testnet hash-write).
6. Build the dashboard: live feed, verdict color-coding, per-record drill-down.
7. Full run-through of the exact 3-transaction demo script (Section 9); fix integration bugs.
8. Record a backup demo video in case the live demo fails during judging.
9. Write the Stage 1 submission (Section 11) — **do this after the schema and a working build exist**, not before, so the "technologies used" and "overview" sections describe what was actually built rather than what was planned.
10. Prepare the architecture diagram (Section 6, cleaned up for a slide) as the mandatory Stage 1 supporting material.

---

## 11. Stage 1 submission — content checklist (cross-reference Section 1 rules before finalizing)

- **Track:** Track 1 (Payments and Financial Infrastructure), primary. Optionally note Track 2 relevance in one sentence, but don't hedge the primary selection.
- **Project overview problem framing:** "MAS published the SAFR white paper on July 3, 2026, describing how AI agents should be governed at the point of financial action. As of this submission, the only known implementation is enterprise consulting infrastructure (KLA's Control Plane) — there is no open, agent-native implementation wired to a live crypto-native settlement rail. We built one." Use SAFR's real terminology throughout (Section 4) — do not reintroduce the "three layers" phrasing.
- **Explicitly state SAFR's non-binding status** somewhere in the overview — don't let the submission imply this is a compliance requirement.
- **Supporting material (mandatory, at least one):** the architecture diagram from Section 6, plus a demo clip if the build is far enough along by submission time.
- **Team details:** names + affiliations for every member; proof of student status attached if submitting as a Student Group.
- **Project link:** GitHub repo, include if the build is in a presentable state; optional but strengthens the submission.

---

## 12. Judging-criteria self-check before submitting

Run this checklist against the actual build before finalizing anything:
- **Technical Quality (30%):** Does the demo actually work end-to-end, live, without narration filling gaps? Is the rules engine genuinely rule-driven (Section 7.4) rather than hardcoded per-scenario?
- **Real-World Impact (25%):** Does the submission cite the real MAS SAFR publication accurately (Section 4), correctly scoped to the payments/treasury domain only?
- **Innovation (20%):** Is the KLA differentiation (Section 5) stated explicitly, so judges understand this isn't a copy of existing enterprise tooling?
- **Demo and Presentation (15%):** Does the live run-through follow the exact 3-transaction script (Section 9) clearly, with the dashboard visibly reacting in real time?
- **Track Relevance (10%):** Is the payments/financial-infrastructure framing (Track 1) explicit and primary, not buried under generic "AI agent" language?

---

*End of document. If anything here seems to conflict with newly-discovered information (e.g., a prior-art project that makes this concept no longer viable), flag it explicitly and explain the conflict — do not silently substitute a different idea.*

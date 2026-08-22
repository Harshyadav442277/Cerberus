# Devpost submission copy — NTU InnovateX 2026, Stage 1

Paste-ready technical text for the submission. Fields marked **[TEAM]** need
human-only facts and are intentionally not invented or stored here.

**Deadline: 14 August 2026, 11:59 PM SGT** (= 9:29 PM IST). Internal target: noon IST
the same day. The technical claims below reflect the verified build and live
Base Sepolia evidence; see `EVIDENCE.md` for the complete transaction manifest and
independent verification notes.

---

## 1. Project title

```
Cerberus — a pre-execution governance gate for agent-initiated payments
```

Short form if the field is length-limited:

```
Cerberus
```

**Naming convention — keep it consistent everywhere.** Cerberus is the product;
SAFR Runtime is the governance pattern it implements. Write "Cerberus implements the
pattern SAFR describes", never "Cerberus is SAFR". The three heads map to the three
dispositions: ALLOW, DENY, ESCALATE.

## 2. Short description (tagline)

```
Cerberus is a runtime governance checkpoint that evaluates an AI agent's proposed
stablecoin payment against a machine-readable mandate and resolves it to ALLOW, DENY,
or ESCALATE — before the payment is ever constructed.
```

## 3. Selected track

```
Payments and Financial Infrastructure
```

Rationale if asked: the project sits directly on a payment flow (x402 over Base
Sepolia USDC), implements treasury spend controls, merchant allowlisting, and
settlement, and produces a compliance-grade transaction record. It is payments
infrastructure rather than an agent application — the agent is the thing being
governed, not the product.

## 4. Team type

**[TEAM]** `Student Group` or `Public Group`.

Per the official rules: Student Group requires *every* member to be a current
student with valid proof (student ID or proof of enrolment). Mixed teams, or teams
that cannot verify every member, are classified Public Group. Choosing Student
Group without complete proof risks reclassification, so pick Public Group unless
every member's documentation is in hand.

Note: the Best Student Team Award (USD $1,500) is only open to verified Student
Group teams, and a Student Group taking 1st–3rd in the same track is not also
considered for it.

## 5. Team members' names and affiliations

**[TEAM]** Full legal names + school/company affiliation for each member.

Every person listed must have materially contributed. Git history currently shows
commits from two identities — reconcile that list against the people you actually
list here.

## 6. Primary contact email

**[TEAM]**

---

## 7. Problem statement

```
Financial institutions are moving AI agents from recommending actions to executing
them — initiating payments, moving treasury balances, settling obligations without a
human reviewing each one. The control frameworks these institutions already run were
built for human decision-making: four-eyes checks, batch reconciliation, after-the-fact
transaction monitoring. They assume a human pause that an autonomous agent does not
provide, and they assume review speeds that machine-speed execution outruns.

The gap this creates is specific and structural. Once an agent has constructed and
signed a payment, the decision has already been made; monitoring downstream of that
point can detect a bad payment but cannot prevent it. On a blockchain settlement rail
the problem sharpens further, because settlement is irreversible — there is no
chargeback, no clawback, and no correction window.

The Monetary Authority of Singapore's SAFR white paper (Safeguards for Agentic Finance
at Runtime, Version 1.0, July 2026, published under the BuildFin.ai initiative)
describes this as a runtime governance problem and proposes a checkpoint that sits
between an agent's decision and its execution. SAFR is an industry reference model,
not binding regulation — MAS states explicitly that it does not constitute regulatory
guidance or supervisory expectations. It describes the conditions that should hold,
and deliberately leaves implementation to the deployment context.

What is missing is a working implementation of that checkpoint on a real settlement
rail, where the enforcement can actually be inspected rather than asserted.
```

## 8. Solution overview

```
Cerberus implements SAFR's four runtime components as working middleware in front of a
live stablecoin payment rail, for SAFR's first applied domain: agent-assisted payments
and treasury operations. It is named for the three-headed guardian of a boundary that
cannot be crossed unchecked — the three heads are the three dispositions.

An AI agent proposes a payment as a structured Proposed Action. Before any payment
object exists, that proposal is evaluated against a versioned, machine-readable
mandate — spend caps, counterparty allowlist, time windows, velocity limits — held in
a controls repository. A pure, rule-based Disposition Engine resolves it to ALLOW,
DENY, ESCALATE, or OBSERVE, with the specific rule that fired recorded alongside the
outcome. Only ALLOW, or an ESCALATE a human approved on the dashboard, ever reaches
the x402 settlement path. Every decision — refusals included — is written to a
tamper-evident audit log whose canonical hash is anchored to a contract on Base
Sepolia.

The property that makes this a governance gate rather than a monitoring layer is
positional: the engine is called by the agent's own orchestration code before the x402
request is constructed, never as a proxy in front of payment traffic. On a DENY, the
settlement module is not merely unused — it is never constructed, so nothing capable of
building a payment request comes into existence.

That constraint is enforced by the test suite rather than left as a convention. The
tests scan the repository and fail if anything outside the single permitted settlement
module imports the x402 client, or if any code patches global fetch, installs a proxy
agent, or otherwise intercepts traffic after the fact. The scanner was itself validated
against a deliberate violation to confirm it fires.
```

## 9. Key features

```
• Pre-execution interception, structurally enforced. The Disposition Engine runs
  before the x402 payment is constructed. On DENY the settlement module is never
  instantiated — proven by a test asserting a construction count of zero, not just an
  uncalled function. A repo-wide scan fails the build if the x402 client is imported
  anywhere outside the one permitted module, or if global fetch is patched.

• A deterministic, auditable Disposition Engine. Pure and rule-based, with no LLM in
  the decision path. Identical inputs give identical outputs; the engine reads the
  proposal's own timestamp rather than the wall clock; its only dependency is the
  shared type package. Purity is machine-verified by a test that scans for fetch,
  Date.now, Math.random, process.env, and database access inside the engine.

• Versioned, machine-readable mandates. Spend caps (per-transaction and rolling
  window), counterparty allowlist with a configurable disposition for unknown
  counterparties, time windows, and velocity limits. Mandates are versioned with
  effective-from/effective-to ranges, and each audit record pins the mandate version
  it was decided under, so a later mandate edit cannot retroactively change the record
  of a past decision.

• Human-in-the-loop escalation. ESCALATE holds the action pending review. A compliance
  officer approves or denies from the dashboard; the agent — in a separate process —
  unblocks and settles only on approval. The claim is atomic, so a double-click or a
  race cannot produce two decisions.

• Tamper-evident audit log. Every disposition, including refusals, is written as a
  full record. The canonical JSON hash of each terminal-state record is anchored to a
  contract on Base Sepolia; only the digest goes on chain, never the record. Anchoring
  is asynchronous and cannot affect a disposition — a broken RPC, a hung call, or a
  dead database still leaves the decision valid and the digest stored.

• A demonstrated tamper check, not an asserted one. `audit:tamper-demo` takes a stored
  DENY, rewrites it to ALLOW the way someone covering their tracks would, shows the
  digest no longer reproduces, then rolls the change back.

• Compliance dashboard. Live audit feed with the triggered rule as a first-class
  column, drill-down showing the control threshold against the proposed amount, a
  rolling 24-hour spend strip against the mandate ceiling, one-click escalation
  review, and the active mandate and agent identity as the officer would see them.
```

## 10. Target users

```
• Treasury and payment operations teams deploying agents against real balances, who
  need delegated authority bounded before execution rather than reviewed after it.
• Compliance officers who must reconstruct why an agent-initiated payment was allowed,
  refused, or held — without relying on the agent's own account of what happened.
• Platform and infrastructure teams integrating agent payments over stablecoin rails,
  where settlement is irreversible and pre-execution control is the only control.
```

## 11. Technologies used

```
TypeScript, Node.js 22+, pnpm workspaces (monorepo)
PostgreSQL 16 (Docker) — mandates, proposed actions, audit records, anchor state
x402 protocol, v2 TypeScript SDK — HTTP-native stablecoin payments
Base Sepolia (eip155:84532) — settlement network
USDC on Base Sepolia — settlement asset
Solidity — AuditAnchor.sol, a minimal digest-anchoring contract
viem — chain reads, contract deployment, transaction signing
Next.js + Tailwind CSS — compliance dashboard
Express — dashboard REST API with an SSE live feed, and the x402 merchant server
zod — schema validation for every governance object
node:test — test runner (384 tests, 78 suites)
```

## 12. Sponsor tools, APIs, and infrastructure disclosure

```
• x402 protocol and its v2 TypeScript SDK (@x402/core, @x402/evm, @x402/fetch,
  @x402/express) — used for the actual payment rail: the merchant issues an HTTP 402
  challenge and the agent's settlement module pays it.
• x402 testnet facilitator (https://x402.org/facilitator) — verifies and settles the
  payment. Testnet only; never pointed at a mainnet route.
• Base Sepolia — the settlement network for both USDC transfers and the audit anchor
  contract. Public RPC at https://sepolia.base.org.
• USDC on Base Sepolia (0x036CbD53842c5426634e7929541eC2318f3dCF7e) — the settlement
  asset, obtained from public testnet faucets.
• Anthropic Messages API — an optional path for turning a natural-language treasury
  brief into a structured payment intent. It is deliberately confined to intent
  generation and is never consulted in the decision path. Judged runs use the
  deterministic fixture planner so results are reproducible.

All tools are used under their public terms for testnet/development purposes. No
sponsor relationship is claimed or implied beyond use of publicly available tooling.
```

## 13. Prior-work disclosure

```
The repository was created and all code in it was written during the hackathon
period. The first commit is dated 2 August 2026; submissions opened 27 July 2026.

Pre-existing material used, all publicly available and used as reference or as a
dependency rather than as submitted work:
• The MAS SAFR white paper (Version 1.0, July 2026) — the reference model this project
  implements. Its four components and four dispositions are the paper's; the
  implementation is ours.
• The x402 protocol and its published TypeScript SDK — third-party open-source
  dependencies, used as-is.
• Standard open-source libraries listed under Technologies, used as-is.

No part of this project was substantially completed before the hackathon period.
```

---

## 14. Supporting file

`docs/assets/safr-architecture-slide.png` — 16:9 architecture diagram showing the
pre-execution position of the gate. Already in the repository.

If combining materials into one PDF or ZIP (the rules permit this), include: the
architecture diagram, the evidence screenshots from `EVIDENCE.md`, and this
submission text.

## 15. Links

```
GitHub repository:  https://github.com/Harshyadav442277/Cerberus
Architecture:       https://github.com/Harshyadav442277/Cerberus/blob/main/docs/assets/safr-architecture-slide.png
Evidence manifest:  https://github.com/Harshyadav442277/Cerberus/blob/main/docs/submission/EVIDENCE.md
Stage-1 live x402 payment (pre-signer-isolation history):
                     https://base-sepolia.blockscout.com/tx/0xed51af702ebc263f8296c1fc6cb677928880f4a4dc6eee7a05f69e14e99efab9
AuditAnchor:         https://base-sepolia.blockscout.com/address/0x2D2d857ce3c0d5d666B7e0dB3fE8067d4B4D6Ff7
Stage-1 final audit anchor (history):
                     https://base-sepolia.blockscout.com/tx/0x507858741ff5c381167b2b3b85d2e0bb71ec5052e8327dbd78ca40986db1d191
Hardened ESCALATE settlement, 0.75 USDC (22 Aug 2026):
                     https://base-sepolia.blockscout.com/tx/0x55ba3c22d58a83a1b6093f2e289c544239d4839cd97b008b791d5a6052225469
Hardened ALLOW settlement, 0.5 USDC (22 Aug 2026):
                     https://base-sepolia.blockscout.com/tx/0xfe4d02288ea8882d8b75e520cf627e97d57b04e4f3a3cc81e40b780a36c995fa
Hardened evidence package: https://github.com/Harshyadav442277/Cerberus/tree/main/artifacts/judge-evidence
```

Confirm the repository is **public** before submitting — a 404 on the repo link is a
wasted judging criterion. The repo was renamed from `track-1` to `Cerberus`; GitHub
redirects the old URL, but submit the new one.

Local clones still pointing at the old name will keep working via the redirect. To
update one:

```bash
git remote set-url origin https://github.com/Harshyadav442277/Cerberus.git
```

---

## 16. What NOT to claim

Checked against the Bible's accuracy rules and the review findings. These are the
easy, avoidable errors:

- **Never** write "SAFR requires", "SAFR-compliant", or "complies with SAFR
  regulation". SAFR is a **non-binding industry white paper**. MAS states it does not
  constitute regulatory guidance or supervisory expectations. Write "SAFR proposes",
  "SAFR's framework describes", "implements the pattern SAFR describes". A
  Singapore-based judging panel may know this paper directly.
- **No "first-ever" / "only" / "world's first" claims.** There is adjacent prior art
  in agent-payment tooling. Differentiate on what is actually demonstrable —
  pre-execution enforcement that is structurally tested, mandate-versioned audit
  records, and the tamper demo.
- **Keep live settlement and anchoring claims tied to the explorer evidence.** Real
  transactions now exist and are linked in §15 and `EVIDENCE.md`; do not broaden that
  proof into a production-readiness claim or imply that testnet assets are real funds.
- **Do not claim domains outside payments and treasury.** SAFR describes several; this
  implements one.
- **Do not let the mythology do the technical talking.** The Cerberus framing is a
  memorable name for a real three-outcome design, not an argument. Judges score the
  implementation; lead with the pre-execution gate and the enforcement test, and let
  the name be a label.
- **Do not claim production-readiness.** Known limitations, stated plainly if asked:
  host-level isolation still depends on distinct deployment principals; a used
  EIP-3009 nonce without exact transfer evidence stays UNKNOWN for manual review; the
  hardened-path evidence is one supervised Base Sepolia run set captured on 22 August
  2026 (see `FINAL_FREEZE.md`, `EVIDENCE.md` and `artifacts/judge-evidence/`), not a
  production track record; overnight time-window wrap is unsupported.

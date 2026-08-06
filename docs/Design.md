# SAFR Runtime — Dashboard Visual Design

**Status:** This is the one area the Bible does not fully specify. Bible §8 fixes the stack (Next.js, live feed, colour-coded by disposition, drill-down per record) and Bible §9 fixes the colour semantics (green=ALLOW, red=DENY, amber=ESCALATE). Everything else below is judgment, constrained by the project's actual purpose.

**Authority:** `SAFR_RUNTIME_PROJECT_BIBLE.md` overrides this document on any conflict.

---

## 1. Design principle

This is a **compliance and audit tool for a financial institution**, not a consumer app and not a crypto product. The user is a compliance officer who needs to see, quickly and unambiguously, what an agent proposed, what the system decided, which rule fired, and whether money moved.

The judging panel comes from a university finance research centre (Bible §1). Visual language that reads as crypto-hype actively costs credibility with that audience. So:

**Do:** dense legible data tables, restrained neutral palette, colour used only to carry meaning, monospace for anything a human might need to copy or verify, generous use of plain labels.

**Do not:** gradients, glows, neon, dark-mode-by-default "terminal hacker" aesthetics, animated backgrounds, glassmorphism, token/coin iconography, 3D, confetti or celebratory motion on a successful payment, or any language like "instant," "seamless," "revolutionary."

The visual target is closer to a Bloomberg terminal, a Stripe dashboard, or an internal bank ops console than to a DeFi app.

---

## 2. Colour

### 2.1 Disposition semantics (fixed by Bible §9)

Colour carries meaning here and nowhere else. Nothing decorative may use these hues.

- **ALLOW — green.** `#0F7B3F` text/border, `#E8F5EE` background fill.
- **DENY — red.** `#B4242B` text/border, `#FCEBEC` background fill.
- **ESCALATE — amber.** `#9A6209` text/border, `#FDF3E0` background fill.
- **OBSERVE — slate.** `#4A5568` text/border, `#EEF1F5` background fill. Present for completeness per Bible §4; never emitted in the demo (PRD §4.3).

Dark text on a light tint, with a solid left border on the row. This keeps large tables readable and avoids the "traffic light spreadsheet" look of saturated fills.

### 2.2 Accessibility — colour is never the only signal

Every disposition is shown as a **badge with an uppercase text label** (`ALLOW`, `DENY`, `ESCALATE`) plus its colour. A colour-blind judge, a bad projector, or a compressed demo video must not be able to destroy the meaning. This is a correctness requirement, not a nicety — the entire demo hinges on the audience reading these three states correctly.

### 2.3 Neutrals

- Page background `#FFFFFF`; app chrome and table headers `#F7F8FA`.
- Borders and rules `#E2E5EA` (hairline, 1px).
- Primary text `#1A1D23`; secondary `#5A6270`; tertiary/meta `#8A919E`.
- Accent (links, focus rings, primary action) `#1F4E79` — a conservative institutional navy, deliberately not a crypto blue-purple.

Light mode only. No dark-mode toggle: it is scope, and the demo will be shown on an unknown projector where a light UI is the safer bet.

---

## 3. Typography

- **UI and body:** Inter (or the system UI stack). 14px base, 13px in dense tables.
- **Data, hashes, IDs, rule paths, amounts, timestamps:** JetBrains Mono or `ui-monospace`. Anything a compliance officer might read character by character or copy is monospace. Amounts monospace with tabular figures so decimal points align down a column.
- Weights: 400 body, 500 table headers and labels, 600 page titles. Nothing heavier.
- No letter-spacing tricks, no all-caps beyond the disposition badges and table column headers.

---

## 4. Layout

A fixed left sidebar plus a main content column. No collapsing panels, no drawers, no modals for anything a judge needs to read — modals photograph badly and hide context.

```
┌────────────┬──────────────────────────────────────────────────────────┐
│ SAFR       │  Audit Log                          ● Live               │
│ Runtime    ├──────────────────────────────────────────────────────────┤
│            │  [ALLOW 12] [DENY 3] [ESCALATE 1 pending]  [24h: 2.40]   │
│ Audit Log  ├──────────────────────────────────────────────────────────┤
│ Escalations│  TIME   DISPOSITION  AGENT  COUNTERPARTY  AMT  RULE  TX   │
│ Mandate    │  ─────────────────────────────────────────────────────── │
│ Agent      │ ▎14:32:00  ALLOW     …      merchant_xyz  0.50  —    0x9f│
│            │ ▎14:33:11  DENY      …      merchant_abc  5.00  spend_… │
│            │ ▎14:34:02  ESCALATE  …      merchant_new  0.75  count… │
│ ───────    │                                                          │
│ Base       │                                                          │
│ Sepolia ●  │                                                          │
└────────────┴──────────────────────────────────────────────────────────┘
```

- **Sidebar (220px):** wordmark, four nav items (Audit Log, Escalations, Mandate, Agent), and a footer status strip showing network (`Base Sepolia`), facilitator reachability, and database connection as small dot indicators. During a demo this quietly proves the system is live rather than mocked.
- **Main column:** full width, no max-width constraint — this is a data tool and horizontal space is useful.

---

## 5. Screens

### 5.1 Audit Log (default view — this is the demo screen)

The screen that is on-camera for the whole demo. It must make the three scenarios readable at a glance from the back of a room.

- **Header:** "Audit Log" with a live indicator — a small pulsing dot and the word "Live", plus "last event Ns ago". The one piece of motion in the entire UI, because it is the only place motion carries information.
- **Summary strip:** counts by disposition, and 24-hour rolling spend against the mandate's `max_total` shown as `2.40 / 3.00 USDC` with a thin progress bar. This makes the rolling-window control visible as a live thing rather than an abstract field, and it costs almost nothing to build.
- **Table columns:** Time (monospace, HH:MM:SS) · Disposition (badge) · Agent · Counterparty · Amount (right-aligned, tabular) · Rule Triggered (monospace, `—` when null) · Settlement (short tx hash, monospace, links to the block explorer; `—` when the payment was never constructed).
- **Row treatment:** 3px left border in the disposition colour, tinted background. Newest at the top. A new row enters with a brief 400ms highlight then settles — enough for the eye to catch it during the demo, not enough to be a flourish.
- **Rule Triggered is a first-class column, not hidden in the drill-down.** Bible §9 scenario 2 requires the specific rule that fired to be displayed. Seeing `spend_caps.per_transaction_max` in red on the main screen, without a click, is the single most persuasive moment of the demo.
- **Settlement column for DENY reads `—`,** with hover text "no payment request constructed". Small detail, but it is literally the product claim.
- Row click opens the drill-down.

### 5.2 Record drill-down

Bible §7.5: *"the dashboard's drill-down view should be a near-direct render of this object, not a redesign of it."* Taken literally.

A single page, four stacked labelled sections, each a two-column definition list of `field_name` (monospace, secondary colour) and value:

1. **Decision** — `audit_id`, `action_id`, `disposition` (badge), `reason`, `rule_triggered`, `evaluated_at`
2. **Proposal** — the §7.3 Proposed Action: counterparty, amount, currency, purpose, reference, proposed_at
3. **Mandate at decision time** — `mandate_id`, `mandate_version`, and the specific control that was evaluated, shown as *threshold vs. actual* (e.g. `per_transaction_max: 1.00` / `proposed: 5.00`). Rendering the version prominently is deliberate: it pre-answers "what if the rule changed after this was logged?" (Bible §7.2 design note).
4. **Human Review** — `reviewer_id`, `decision`, `decided_at`, `note`; renders as "None" when null.
5. **Settlement** — `status`, `tx_hash` (explorer link), `rail`, `settled_at`; plus the audit anchor hash and its transaction.

Footer: a "View raw JSON" disclosure showing the literal §7.5 object. Cheap to build, and it lets a technical judge verify in one click that the schema is real and fully populated rather than a UI illusion.

### 5.3 Escalations

Queue of pending `ESCALATE` records, amber-bordered cards, newest first. Each shows the proposal summary, the rule that triggered, and how long it has been waiting (live counter — a compliance queue where the wait time is visible is a realistic detail).

Two actions: **Approve** (solid navy) and **Deny** (outlined red), plus an optional note field pre-fillable with the Bible's example text ("Verified merchant_new via out-of-band call"). Approve is a single click with no confirmation dialog — Bible §9's reliability decision calls for a fast, reliable click during the scripted run-through, and a confirmation step is exactly the kind of avoidable friction that makes a live demo stumble.

On decision, the card resolves in place and the audit log row updates from pending amber to settled.

### 5.4 Mandate

Read-only render of the active §7.2 mandate: scope, each control group in its own labelled block, and the metadata (`version`, `effective_from`, `effective_to`, `status`, `created_by`, `approved_by`). A version chip in the header.

**Read-only is intentional.** A mandate-authoring UI is out of scope (PRD §4.2). Showing `created_by` and `approved_by` as plain fields communicates that mandates are human-authorized without building the authoring flow.

### 5.5 Agent

Read-only render of the §7.1 Agent Identity, plus the live 24h rolling total and hourly transaction count the engine reads. This is the screen that makes the counters real.

---

## 6. Components

- **DispositionBadge** — uppercase label, disposition colour, hairline border, 2px radius. Used everywhere a disposition appears, never restyled per context.
- **Table** — 1px hairline borders, `#F7F8FA` sticky header, 36px rows, no zebra striping (the disposition tint already carries the row's meaning; stripes would fight it).
- **Hash** — truncated middle (`0x9f3a…b21c`), monospace, click-to-copy, external link to the Base Sepolia explorer.
- **FieldRow** — the `field_name` / value pair used throughout the drill-down.
- **StatusDot** — 6px dot for connection indicators; green connected, amber degraded, red down.

Radii 2–4px throughout. Shadows only on the sidebar edge, and only a hairline. Nothing floats.

---

## 7. Motion

Three uses, total:
1. The live indicator's slow pulse.
2. New-row highlight fade, 400ms.
3. Escalation card resolving on decision, 200ms.

No page transitions, no skeleton shimmer, no spinners longer than a moment. Data tools should feel instant and still.

---

## 8. Demo legibility checklist

Verified during Phase 7, since the dashboard's real job is to be readable on someone else's screen:

- Disposition is identifiable from the back of a room, and in a compressed recording.
- The rule path on the DENY row is legible without zooming.
- The settlement hash is legible enough to be visibly real.
- Nothing critical requires hovering — hover states do not exist in a recorded video.
- The whole three-scenario sequence is visible on one screen without scrolling.

---

## 9. Implementation notes

- Tailwind CSS with the palette above as named tokens (`allow`, `deny`, `escalate`, `observe`). Disposition colour is looked up from the token map by the disposition value, never hardcoded per component — so the OBSERVE case renders correctly if it is ever emitted.
- No component library beyond Tailwind (Rules R2). These components are simple enough that a dependency would be added risk, not saved time.
- Server components for initial table load; a small client component subscribes to the live feed. Falls back to 1-second polling per the Phase 6 descope ladder without any visual change.

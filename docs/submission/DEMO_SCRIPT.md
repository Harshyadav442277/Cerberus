# Cerberus — archived demo video narration script and recording plan

Target length **100 seconds** (inside the 90–120s window). Written to be read aloud at
a normal pace; the timings assume roughly 150 words per minute.

The Base Sepolia settlement and anchoring evidence is now verified. This script keeps
only the evidence-backed ending. The narration was recorded, but the visual edit was
not completed to publication standard; retain this document as a reproducible Stage 2
recording plan rather than implying that a finished video exists.

---

## Before you record

1. All three services running (`RUNBOOK.md` section 2), and `npm run demo:reset` so
   the audit log starts empty.
2. Browser at <http://localhost:3000> — dashboard on the Audit Log page.
3. Terminal font large enough to read at 720p. Test by shrinking the player to a
   quarter of the screen; if you cannot read the disposition lines, increase the size.
4. Close notifications, chat apps, and anything that can pop a toast mid-take.
5. Have `npm run demo:script` ready to paste, plus the verified settlement and anchor
   links from `EVIDENCE.md` pre-loaded in a block explorer.

---

## Shot list

| # | Duration | Screen | What must be visible |
|---|---|---|---|
| 1 | 0:00–0:12 | Architecture diagram | The gate sitting before x402 |
| 2 | 0:12–0:30 | Dashboard → Mandate | Spend caps, allowlist, unknown-counterparty policy |
| 3 | 0:30–0:44 | Terminal — scenario 1 | `ALLOW`, then settlement |
| 4 | 0:44–1:00 | Terminal — scenario 2 | `DENY`, rule, **x402 never constructed** |
| 5 | 1:00–1:20 | Dashboard → Escalations → Approve | The human gate, live |
| 6 | 1:20–1:34 | Dashboard → audit drill-down | Threshold vs actual, mandate version, hash |
| 7 | 1:34–1:40 | Block explorer / anchor verify | Verified settlement and anchor transactions |

---

## Narration

### 0:00–0:12 — the problem

> Financial institutions are giving AI agents the ability to move money, not just
> recommend moving it. The controls they already have were built for humans — they
> review after the fact. On a blockchain rail, after the fact is too late, because
> settlement is irreversible.

*On screen: the architecture diagram. Point at the gate between the agent and x402.*

### 0:12–0:30 — the mandate

> SAFR Runtime puts a governance checkpoint in front of execution. This is the
> mandate — machine-readable delegated authority. One USDC per transaction, three USDC
> rolling over 24 hours, two allowlisted counterparties, and anything unknown escalates
> to a human. This is the institution's rulebook, and it is versioned.

*On screen: dashboard → Mandate page.*

### 0:30–0:44 — scenario 1, ALLOW

> The agent proposes a routine supplier payment. Half a USDC, allowlisted merchant,
> inside every cap. The Disposition Engine evaluates it against the mandate and returns
> ALLOW — and only now is the x402 payment constructed.

*On screen: terminal, `npm run demo:script`. Let scenario 1 land.*

### 0:44–1:00 — scenario 2, DENY

> Second proposal: five USDC, against a one USDC per-transaction cap. DENY, on rule
> `spend_caps.per_transaction_max`. And this is the line that matters —
> **x402 never constructed**. The payment object was not built and discarded. It never
> existed. The engine runs before the payment is assembled, and our test suite fails the
> build if any code outside the settlement module can even reach the payment client.

*On screen: hold on the `x402 never constructed` line for a beat. This is the single
most important frame in the video — do not rush it.*

### 1:00–1:20 — scenario 3, ESCALATE

> Third: a counterparty we have never paid. Under the cap, so not a denial — but
> outside the allowlist, so it escalates and the agent blocks. A compliance officer sees
> it here, with the reason and the rule. I approve it. The agent — a separate process —
> unblocks, and only now does it settle.

*On screen: dashboard → Escalations → click Approve → cut back to the terminal
unblocking. Use `npm run demo -- new_counterparty --live-escalation` so this is a real
click, not a scripted pause.*

### 1:20–1:34 — the audit record

> Every disposition is recorded, refusals included. Here is the denial: the control
> threshold against the amount actually proposed, the mandate version it was decided
> under — pinned, so editing the mandate later cannot rewrite this record — and the
> hash of the record itself.

*On screen: dashboard → audit drill-down on the DENY record.*

### 1:34–1:40 — settlement and anchoring

> That hash is anchored to Base Sepolia, and the approved payments settled in real
> USDC. Here they are on-chain. Governed before execution, and provable after it.

*On screen: the verified settlement and final anchor transaction from `EVIDENCE.md`,
then `npm run audit:verify` showing the stored digests reproduce.*

---

## After recording

- [ ] Cut dead time — command startup, page loads, anything over ~1.5s of nothing.
- [ ] Watch it once at quarter size. If any disposition line or rule name is unreadable, re-record that shot larger.
- [ ] Confirm the `x402 never constructed` frame is on screen long enough to read.
- [ ] Upload somewhere that plays **without login** — unlisted YouTube is safest.
- [ ] Open the link in an incognito window and confirm it plays. A private video is the single most common submission failure.
- [ ] Paste the link into Devpost and into `DEVPOST.md` section 15.

---

## If you only have time for one take

Record shots 3, 4, and 5 — ALLOW, DENY with `x402 never constructed`, and the live
escalation approval. Those three carry the entire argument. The diagram and the audit
drill-down can be supporting screenshots instead.

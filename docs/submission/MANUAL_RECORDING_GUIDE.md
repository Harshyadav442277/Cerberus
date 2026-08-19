# Manual Recording Guide

**Why this exists:** automated screen capture and video recording were not available in
the build environment — the browser pane does not composite frames headlessly, so
`computer{action:"screenshot"}` times out and no `.mp4` or `.png` could be produced.
The dashboard *was* driven and verified programmatically (its rendered content is in
`artifacts/final-evidence/database/audit-state.txt`), but pixels could not be captured.

This guide is written so you do not have to design the recording yourself. Follow it
top to bottom. Every command, URL, expected output and filename is given.

**Time required:** about 12 minutes, plus funding time if the wallets are empty.

---

## Before you start

### A. The wallets must be funded and the keys provisioned

If you have not done this yet, stop and complete
[LIVE_EVIDENCE_BLOCKED.md](./LIVE_EVIDENCE_BLOCKED.md) first. Then confirm:

```bash
npm run preflight
```

**Do not begin recording until this prints `Ready for a funded live run.`**

If you are recording *without* funding, that is still worth doing — skip steps 9–12
and record the governance decisions only. Say so on camera: "this run shows the
decision path; the settlement evidence is captured separately." Never imply a payment
settled when it did not.

### B. Start your recorder

| OS | Tool | How |
| --- | --- | --- |
| **Windows** | Xbox Game Bar | `Win + G`, then the Record button, or `Win + Alt + R` |
| **Windows** | OBS Studio | Sources → Display Capture → Start Recording |
| **macOS** | Built in | `Cmd + Shift + 5` → Record Entire Screen |
| **Linux** | OBS / SimpleScreenRecorder | Display capture, 1080p |

Record at **1920×1080**. Put the terminal on the left half and the browser on the
right half so both are visible at once — the whole point is that a refusal in the
terminal appears immediately in the dashboard.

### C. Screenshot tool

- **Windows:** `Win + Shift + S`, then paste into Paint and save as PNG.
- **macOS:** `Cmd + Shift + 4`, then space, then click the window.

Save every screenshot into `artifacts/final-evidence/screenshots/` using the exact
filenames given below. The evidence manifest references these names.

---

## Steps 1–8 — Start the stack (recorder OFF)

Do this before recording. Six terminals, all left running.

### STEP 1 — Database

```bash
npm run db:migrate
```
```bash
npm run db:seed
```

Expected last line: `All checks passed` when you then run `npm run db:verify`.

### STEP 2 — Terminal 1, merchant

```bash
npm run merchant
```

Expected: `CERBERUS merchant listening on http://localhost:4021`

**Leave it open.**

### STEP 3 — Terminal 2, control plane

```bash
npm run api
```

Expected: `CERBERUS API — SAFR Runtime listening on http://127.0.0.1:4050`

Note `127.0.0.1`, not `0.0.0.0`. That is the loopback scoping, and it is worth
pointing at on camera.

**Leave it open.**

### STEP 4 — Terminal 3, isolated executor

```bash
npm run executor
```

Expected:
```
CERBERUS isolated executor listening on http://127.0.0.1:4060
payment key   isolated in executor process
```

**Leave it open.** This is the only process holding the payment key.

### STEP 5 — Terminal 4, dashboard

```bash
npm run dashboard
```

Expected: `Ready in ...` on port 3000.

**Leave it open.**

### STEP 6 — Terminal 5, reconciler

```bash
npm run reconciler
```

**Leave it open.**

### STEP 7 — Terminal 6, anchor worker

```bash
npm run anchor
```

Expected:
```
CERBERUS anchor worker
anchoring     0x2d2d857ce3c0d5d666b7e0db3fe8067d4b4d6ff7
payment key   not present in this process
```

**Leave it open.** Without this, audit digests never reach the chain.

### STEP 8 — Open the dashboard and log in

Open <http://localhost:3000>.

The browser will prompt for HTTP Basic credentials when you visit `/escalations`. Use
the values from `apps/dashboard/.env.local`.

Confirm the page shows **Audit Log** with an empty or previous-run table.

---

## STEP 9 — START RECORDING NOW

Everything from here is on camera.

Open a **seventh** terminal for the demo commands. Keep the dashboard visible.

---

## STEP 10 — Demo 1: the normal case (ALLOW)

Say: *"An AI agent proposes a payment to an approved supplier, inside its budget."*

```bash
npm run demo -- clean
```

**Expected in the terminal:**
```
disposition   ALLOW
reason        within_mandate
x402 reached  yes
settlement    settled  0x...
```

**Expected in the dashboard:** a new green `ALLOW` row appears live, with the
settlement transaction hash.

📸 **Screenshot now:** `03-live-allow.png`

Say: *"That's the easy case. Real USDC moved on Base Sepolia."*

---

## STEP 11 — Demo 2: the agent exceeds its authority (DENY)

Say: *"Now the same agent asks for far more than its mandate allows."*

```bash
npm run demo -- cap_breach
```

**Expected in the terminal:**
```
disposition   DENY
reason        per_transaction_cap_exceeded
rule          spend_caps.per_transaction_max
x402 reached  NO — never constructed
```

**Expected in the dashboard:** a red `DENY` row.

Click it to open the drill-down. It shows:
```
threshold     1
actual        proposed 4
settlement    null — no payment request constructed
```

📸 **Screenshot now:** `04-live-deny.png`

Say the key line: *"There is no failed blockchain transaction here. The payment
authority never existed. Nothing was even constructed to send."*

---

## STEP 12 — Demo 3: business judgment (ESCALATE)

Say: *"Now a supplier the company has never paid before."*

```bash
npm run demo -- new_counterparty
```

The terminal **blocks**, waiting for a human.

**Expected in the dashboard:** an amber `ESCALATE` row, and the Escalations screen
shows one pending item.

📸 **Screenshot now:** `05-escalation-pending.png`

Go to <http://localhost:3000/escalations> and click **Approve**.

📸 **Screenshot now:** `06-escalation-approved.png`

The blocked terminal now continues and settles.

📸 **Screenshot now:** `07-escalate-settled.png`

Say: *"The agent could not approve itself. A human did, and that approval is bound to
this exact proposal under this exact policy version — it cannot be reused for
anything else."*

---

## STEP 13 — Demo 4: assume the AI is already hacked

Say: *"Everything so far assumed the AI was behaving. Now assume it is compromised."*

```bash
npm run adversarial
```

Let it run to the summary.

**Expected final lines:**
```
Attack classes passed:  12/12
Assertions passed:      80
RESULT: PASS
```

📸 **Screenshot now:** `08-adversarial-pass.png`

Then:

```bash
npm run redteam
```

**Expected:**
```
Attack classes passed:  9/9
Assertions passed:      60
RESULT: PASS
```

📸 **Screenshot now:** `09-redteam-pass.png`

Say: *"A compromised agent cannot approve itself, cannot change its mandate, cannot
reuse a capability, cannot reach the payment key, and — this is the one people miss —
cannot even write its own audit record saying the payment succeeded."*

---

## STEP 14 — Demo 5: prove the tests can actually fail

Say: *"A passing security suite proves nothing unless it can fail. So we break each
guard on purpose and check the tests notice."*

```bash
npm run mutation
```

**Expected:**
```
Guards proven detectable: 12/12
Working tree after run: clean (all mutations reverted)
RESULT: PASS
```

📸 **Screenshot now:** `10-mutation-matrix.png`

This is the strongest single slide in the deck. Do not skip it.

---

## STEP 15 — Demo 6: scale

```bash
npm run sandbox -- --seed 42 --agents 50 --actions 1000 --concurrency 25
```

**Expected:**
```
Budget violations       0
Duplicate effects       0
Replay violations       0
RESULT                  PASS
```

📸 **Screenshot now:** `11-sandbox-pass.png`

Say: *"Fifty agents, a thousand payment attempts, twenty-five at a time, sharing
budgets. Zero overspends — and that zero is a SQL query against the database after the
run, not a number the application counted for itself."*

---

## STEP 16 — Demo 7: prove the audit trail against the chain

```bash
npm run audit:verify
```

**Expected:** `VERIFIED` for each record, and:
```
Every anchored record is proven by its own on-chain transaction.
```

📸 **Screenshot now:** `12-audit-verified.png`

Say: *"We don't trust our own database about what's on the chain. This fetches each
anchor transaction from Base Sepolia, checks it went to the right contract, and
compares the digest read from the chain against the one we recomputed."*

---

## STEP 17 — Show the public transactions

Take the transaction hash printed in step 10 and open:

```
https://sepolia.basescan.org/tx/<PASTE THE HASH FROM STEP 10>
```

📸 **Screenshot now:** `13-explorer-settlement.png`

Then the anchor transaction from step 16:

```
https://sepolia.basescan.org/tx/<PASTE THE ANCHOR HASH>
```

📸 **Screenshot now:** `14-explorer-anchor.png`

**If the internet fails:** skip this and say *"the hashes are in the evidence manifest
and can be checked on any Base Sepolia explorer."* Do not stall on camera.

---

## STEP 18 — STOP RECORDING

Save the video as:

```
artifacts/final-evidence/recording/cerberus-final-demo.mp4
```

---

## Step 19 — Record what you captured (recorder OFF)

Update the manifest so the evidence is self-describing:

```bash
npm run evidence:manifest
```

Then verify nothing is missing or empty:

```bash
npm run evidence:verify
```

Finally, paste the real transaction hashes into
`docs/submission/EVIDENCE.md` under **current finalist-hardened evidence** — keeping
the Stage-1 section separately labelled. Do not move a Stage-1 hash into that section.

---

## If something goes wrong on camera

| Symptom | Cause | Do this |
| --- | --- | --- |
| `AGENT_SUSPENDED` | the agent row is `suspended` | `UPDATE agent_identity SET status='active' WHERE agent_id='agent_treasury_01';` |
| `INSUFFICIENT_BUDGET` | earlier runs consumed the rolling window | `npm run demo:reset` |
| Escalation never appears | dashboard not authenticated | reload `/escalations` and enter the Basic credentials |
| Anchors stay `pending` | terminal 6 not running | start `npm run anchor` |
| `OUTCOME_UNKNOWN` on a payment | ambiguous settlement, working as designed | let the reconciler resolve it; say *"it refuses to guess"* — this is a feature worth showing |
| Executor refuses everything | `EXECUTION_AUTHORIZER_ADDRESS` mismatch | `npm run preflight` will name it exactly |

**The `OUTCOME_UNKNOWN` case is not a failure.** If it happens live, use it: it is the
behaviour most systems get wrong.

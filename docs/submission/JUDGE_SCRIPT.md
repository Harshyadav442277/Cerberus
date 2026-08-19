# Judge Script

Written to be understood by someone who does not work in security. Lead with the
problem, not the mechanism.

---

## The opening

> **Imagine giving an AI your company credit card.**

Pause. Let that land.

> The problem isn't whether it *can* pay. Any AI with a private key can pay. The
> problem is what it's allowed to buy, how much it can spend, who it can pay — and
> what happens when the AI gets hacked.

> Cerberus sits between the AI's intent and the payment key. Every payment is
> **allowed, blocked, or sent to a human**. The AI never holds the payment key itself.

Then the part that separates this from a policy engine:

> And we don't only distrust the AI. If the merchant changes the bill after approval,
> or lies about whether the payment succeeded, or the network vanishes halfway
> through — Cerberus still refuses to guess.

---

## J1 — The 20-second pitch

> **Cerberus is a financial authority firewall for autonomous AI agents. An AI can
> propose a payment, but Cerberus decides whether it's allowed, blocked, or needs a
> human. Even if the AI is completely compromised, it never gets unrestricted access
> to the payment key.**

---

## J2 — The 45-second pitch

> Think of an employee with a company credit card. They don't get unlimited spending —
> there's a limit per purchase, a monthly cap, approved suppliers, and some things need
> a manager's sign-off.
>
> AI agents are being given payment keys with none of that. A key proves an agent
> *can* pay. It says nothing about whether the payment was *authorized*.
>
> Cerberus enforces that missing layer at runtime. Every proposed payment is checked
> against a signed policy and comes back **ALLOW**, **DENY**, or **ESCALATE**. The
> agent itself never holds the payment key — a separate isolated process does, and it
> only acts on a signed, single-use, 60-second permission slip bound to that exact
> payment.
>
> We also assume the merchant is hostile. The bill is re-verified against the approval
> immediately before signing, so it can't be changed after the fact. And if the
> merchant claims the payment succeeded, we don't believe it — we check the
> blockchain. If we can't tell whether money moved, we say so and refuse to retry,
> because guessing is how systems double-pay.
>
> This implements the runtime governance checkpoints that Singapore's MAS describes in
> its SAFR pattern for agentic finance.

---

## J3 — Two-minute demo narration

### 1. The normal case

> The agent proposes five dollars to an approved supplier. Within policy. **ALLOW** —
> and that's a real USDC payment on Base Sepolia.

> That's the easy case.

### 2. The agent exceeds its authority

> Same agent, now asking for five hundred. **DENY.**

Then the line that matters most:

> Notice what *isn't* here. There's no failed blockchain transaction. There's no
> reverted payment. The payment authority was never created. Nothing was even
> constructed to send.

### 3. Business judgment

> A supplier the company has never paid before. Not against policy — but not a
> decision an AI should make alone. **ESCALATE.**
>
> The agent is now blocked. A human approves it, and only then does it settle.
>
> The agent could not approve itself. And the approval is bound to this exact payment
> under this exact policy version — it can't be reused for anything else.

### 4. Now assume the AI is already hacked

> Everything so far assumed the AI was behaving. Let's assume it isn't.

> It tries to approve itself — rejected. It replays a permission slip it already used
> — rejected. Twenty compromised agents spend simultaneously against one shared budget
> — the budget holds.
>
> And this one people miss: **it cannot even write its own audit record claiming the
> payment succeeded.** The database refuses. The agent has no permission to write
> settlement, and no access to the key that signs the audit trail onto the blockchain.

### 5. The hostile merchant

> The human approved five dollars. The merchant sends a bill for fifty.
>
> Rejected — before anything is signed. We re-check the merchant's actual bill against
> the approval at the last possible moment.

### 6. The merchant lies about the outcome

> The merchant says the payment failed. Cerberus does **not** assume the money is
> safe — the merchant still holds a signed authorization it could use. So we hold the
> budget and check the chain.
>
> The merchant says it succeeded, with a transaction hash. We don't believe that
> either. We verify the transaction on the blockchain ourselves.

### 7. The network vanishes

> The payment is signed and sent. The response never arrives. Did the money move?
>
> Most systems retry. That's how you pay twice.
>
> Cerberus marks it **OUTCOME_UNKNOWN**, keeps the budget held, and refuses to retry
> until it has read the chain and knows. Exactly one payment happens, or none.

### 8. The proof

> Twelve out of twelve adversarial attack classes. Nine out of nine in the security
> red-team suite. Three hundred and sixty-three automated tests.
>
> And this one is my favourite: **we break each security control on purpose and check
> the tests notice.** Twelve out of twelve. A security test suite that can't fail is
> worse than no tests at all, because it tells you you're safe.
>
> At scale: fifty agents, a thousand payment attempts, twenty-five at once, sharing
> budgets. Zero overspends, zero duplicate payments — and that zero comes from
> querying the database afterwards, not from a number our own code counted.

---

## J4 — Translation table

Use the right-hand column out loud. Keep the left for the written submission.

| What we call it | What to say |
| --- | --- |
| Mandate | the company's spending policy |
| Execution Authorization | a one-use permission slip |
| Isolated executor | the locked cashier — the only one with the key |
| Atomic reservation | reserving the money before anyone else can spend it |
| x402 challenge binding | the merchant can't change the bill after approval |
| `OUTCOME_UNKNOWN` | we don't know if money moved, so we refuse to guess |
| Reconciler | check the bank statement before paying again |
| Audit anchor | a fingerprint of the record, written to a public blockchain |
| Mutation testing | we break it on purpose to prove the alarms work |
| Least-privilege database roles | each part of the system can only touch its own drawer |

**Do not open with** EIP-3009, PostgreSQL advisory locks, capability envelopes, or
fencing tokens. Those are answers to "how", and they only land once the judge already
cares about "why".

---

## J5 — SAFR positioning

Say exactly this:

> SAFR describes runtime governance checkpoints for agentic finance. Cerberus
> implements that pattern and explores how to make it enforceable even when the AI
> itself is compromised.

**Never say:** MAS certified, MAS approved, SAFR compliant, or official SAFR
implementation. None of those is true, and a judge who knows the space will notice.

---

## Answering the hard questions

**"Couldn't the AI just bypass Cerberus?"**
> It has nothing to bypass it *with*. The payment key lives in a separate process the
> agent cannot reach — proven by a test asserting the agent's entire codebase contains
> no payment-key reference and never imports the payment client. Bypassing Cerberus
> means compromising a different process, not the AI.

**"What if someone compromises the whole machine?"**
> Then they've won, and that's true of any single-machine deployment. Our boundary is
> the operating system and the database role. We say so in the limitations rather than
> pretending otherwise.

**"Is this production ready?"**
> No, and I'd distrust anyone who said yes about a hackathon build. Two things
> specifically: we prove a transaction succeeded on-chain but don't wait for
> confirmation depth, and the services are scoped to loopback rather than having
> service-to-service authentication. Both are written down in the README.

**"Why blockchain for the audit log?"**
> Only for a fingerprint. The records stay in PostgreSQL — no amounts, no
> counterparties, nothing personal goes on-chain. Just a hash, so nobody can quietly
> rewrite history afterwards. And we verify it by reading the chain, not by trusting
> our own database's word that it's there.

**"Did you actually pay something?"**
> Real USDC has settled on Base Sepolia through this system, and the transactions are
> public. Be precise about which build produced which transaction — see
> `docs/submission/EVIDENCE.md`, where Stage-1 history and finalist-hardened evidence
> are labelled separately, on purpose.

---

## The closing line

> **We're the project that assumed the AI was already hacked — and the AI still
> couldn't spend outside its authority.**

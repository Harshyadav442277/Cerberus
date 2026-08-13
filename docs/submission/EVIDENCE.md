# Cerberus — evidence manifest

What has actually been produced, what it proves, and what is still outstanding.
Captured 13 August 2026 against the rebuilt local environment.

Regenerate the dashboard shots any time with:

```bash
pwsh -File scripts/capture-evidence.ps1
```

---

## Captured — `docs/assets/evidence/`

| File | Shows | Proves |
|---|---|---|
| `01-audit-log.png` | Feed with ALLOW / DENY / ESCALATE, rule column, 24h spend strip | Every disposition is recorded, refusals included |
| `02-escalations.png` | A live pending escalation with Approve / Deny, rule and reason | The human gate is real and blocking, not decorative |
| `03-mandate.png` | Spend caps, allowlist, unknown-counterparty policy, time window, velocity | Delegated authority is machine-readable and inspectable |
| `04-agent.png` | Agent identity, owner org, wallet address, counters | Agent Identity component per SAFR |
| `05-drilldown-deny-threshold.png` | DENY record: `spend_caps.per_transaction_max`, threshold `1` vs actual `proposed 5`, mandate `v1` | The refusal is explainable to a compliance officer |
| `06-drilldown-escalate-review.png` | ESCALATE record with `human_review` persisted | Human decisions are captured in the record |
| `07-drilldown-allow-settlement.png` | ALLOW record with settlement block and record hash | The full Section 7.5 record shape |

Architecture diagram: `docs/assets/safr-architecture-slide.png` (already in the repo,
embedded in the README).

### Note on `01-audit-log.png`

The live indicator reads "Reconnecting" in this capture. That is an artefact of the
headless screenshot, not a defect: the page holds an SSE connection open, which never
settles inside a headless frame grab. On a real browser it reads **Live** — see the
first frame of the demo video, or just retake this one shot manually. Worth retaking
before submission since a judge may read it as a broken connection.

---

## Verified by execution, not screenshot

These were run and passed; the terminal output is the evidence.

| Check | Command | Result |
|---|---|---|
| Test suite | `npm test` | **91/91**, 21 suites |
| Type safety | `npm run typecheck` | clean |
| Dashboard production build | `npm run build --prefix apps/dashboard` | clean, 6 routes |
| Schema mirrors the spec | `npm run db:verify` | **13/13** |
| Three-scenario demo | `npm run demo:script` | ALLOW → DENY → ESCALATE(approved) |
| Demo reliability | `npm run demo:script -- --thrice` | three consecutive clean runs |
| Live human gate | `npm run demo -- new_counterparty --live-escalation` | dashboard Approve unblocked a **separate agent process**; `human_review` persisted as `approved by compliance_officer_01`; x402 reached |
| Interception constraint | part of `npm test` | on DENY, x402 client construction count is **0** |

The live-escalation run is the strongest single piece of evidence and it is
reproducible on demand. It proves the gate is cross-process, not an in-memory pause.

---

## Outstanding — blocked on funding the payer wallet

These cannot be produced until the payer address holds Base Sepolia ETH and USDC.
See `RUNBOOK.md` section 4.

**Payer address on this machine:** `0x8cD0592123215f5510A5a0774323c765b9DA34e7`

> **Two payer wallets exist.** A second machine was rebuilt the same day with its own
> keypair (`0x0fe2676DcBA5aBc648BF46403dCc24BBdF90f824`). `.env` is gitignored, so
> each machine's private key never left it — a wallet funded on one machine cannot
> settle from the other. **Decide which machine records the demo, fund only that
> wallet, and produce all on-chain evidence there.** Splitting the faucet allowance
> across both leaves neither able to complete a run. See `docs/Memory.md` B1.

| Evidence | Command once funded | Paste result into |
|---|---|---|
| Bare x402 settlement tx hash | `npm run phase1` | below, and `DEVPOST.md` §15 |
| BaseScan settlement screenshot | open `https://sepolia.basescan.org/tx/<hash>` | `docs/assets/evidence/08-basescan-settlement.png` |
| Merchant received test USDC | BaseScan on `0x3EE24C8af00b88828D17E390ed63Eb8A302208c2` | `docs/assets/evidence/09-merchant-balance.png` |
| `AuditAnchor` deployed | `npm run contracts:deploy` | `.env` as `AUDIT_ANCHOR_ADDRESS` |
| Real anchor transaction | re-run `npm run demo:script` after setting the address | below |
| Anchor verification | `npm run audit:verify` | `docs/assets/evidence/10-anchor-verify.png` |

### Slots to fill

```
Settlement tx hash:      ______________________________________
Settlement explorer:     https://sepolia.basescan.org/tx/______
AuditAnchor address:     ______________________________________
AuditAnchor explorer:    https://sepolia.basescan.org/address/______
Anchor tx hash:          ______________________________________
```

Until these are filled, the submission must not claim live settlement or on-chain
anchoring. `DEVPOST.md` §16 has the exact wording to use instead — the honest version
is a strong submission, and an unsupported claim a judge can check is a much worse
outcome than a stated limitation.

---

## Current known limitations, stated plainly

Worth having ready for Q&A rather than being caught by it.

- **Concurrency.** Two simultaneous proposals could both pass the rolling-cap check
  before either settles. The sequential demo path is unaffected. Correct fix is an
  atomic reservation; scoped as a Stage 2 item rather than rushed before the deadline.
- **Rolling window.** `rolling_window.window` is fixed at 24h matching the seeded
  mandate rather than parsed generally.
- **Time windows.** An overnight window that wraps past midnight is unsupported.
- **Auth.** The local escalation endpoint has no authentication. Deliberate — the demo
  stack is closed and local. A shared deployment would need reviewer identity, roles,
  CSRF/origin policy, and least-privilege database users first.
- **Intent generation.** Judged runs use the deterministic fixture planner, not the
  LLM path, so results are reproducible. The LLM path exists and is schema-validated
  identically, but it is not in the decision path either way.

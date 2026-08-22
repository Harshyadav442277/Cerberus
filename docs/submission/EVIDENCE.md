# Cerberus — evidence manifest

**Architecture and features are hard frozen; general code is soft frozen.** Feature
freeze was first declared at `ba5c853`; the freeze policy and the current release SHAs
are in [FINAL_FREEZE.md](FINAL_FREEZE.md), which is authoritative.

> **Read this first.** This file contains evidence from two different builds, and the
> distinction matters.
>
> - **HISTORICAL STAGE-1 EVIDENCE** — the public Base Sepolia transactions below are
>   real, and they prove the x402 rail and the governance flow. They **predate** signer
>   isolation, exact x402 challenge binding, chain-proven settlement and the trusted
>   audit finalizer. They do not demonstrate the finalist-hardened architecture.
> - **CURRENT FINALIST-HARDENED EVIDENCE** — **captured.** The three signers were
>   provisioned into three separate processes and the four headline scenarios were run
>   live against Base Sepolia. Those transactions are in
>   [Current finalist-hardened evidence](#current-finalist-hardened-evidence-live) below,
>   with the full package in
>   [`artifacts/judge-evidence/`](../../artifacts/judge-evidence/). No Stage-1 hash has
>   been moved into that category to stand in for one.
>
> Everything verifiable without a funded wallet — the test suite, adversarial and
> red-team classes, mutation guards and the seeded sandbox — remains in
> [`artifacts/final-evidence/`](../../artifacts/final-evidence/), which is frozen
> historical evidence and is not modified by later runs.

What has actually been produced, what it proves, and the known prototype limitations.
Local evidence was captured on 13 August 2026; Stage-1 live Base Sepolia evidence was
completed and independently re-verified on 14 August 2026. The finalist-hardened live
run set was captured on 22 August 2026 and re-verified read-only the same day.

Regenerate development dashboard shots any time with:

```bash
pwsh -File scripts/capture-evidence.ps1
```

For any future recapture, use strict mode. It refuses to overwrite evidence unless
ALLOW and approved ESCALATE have real settlement hashes, DENY has no settlement, and
all three terminal records have on-chain anchor transaction hashes:

```bash
pwsh -File scripts/capture-evidence.ps1 -Final
```

---

## Captured — `docs/assets/evidence/`

| File | Shows | Proves |
|---|---|---|
| `01-audit-log.png` | Feed with ALLOW / DENY / ESCALATE, rule column, 24h spend strip | Every disposition is recorded, refusals included |
| `03-mandate.png` | Spend caps, allowlist, unknown-counterparty policy, time window, velocity | Delegated authority is machine-readable and inspectable |
| `04-agent.png` | Agent identity, owner org, wallet address, counters | Agent Identity component per SAFR |
| `05-drilldown-deny-threshold.png` | DENY record: `spend_caps.per_transaction_max`, threshold `1` vs actual `proposed 5`, mandate `v1` | The refusal is explainable to a compliance officer |
| `06-drilldown-escalate-review.png` | ESCALATE record with `human_review` persisted | Human decisions are captured in the record |
| `07-drilldown-allow-settlement.png` | ALLOW record with settlement block and record hash | The full Section 7.5 record shape |
| `08-blockscout-settlement.png` | Successful Base Sepolia `transferWithAuthorization` for the bare x402 payment | The live x402 rail settled real testnet USDC |
| `09-blockscout-merchant-balance.png` | Merchant address holding 6.28 Base Sepolia USDC after the verified runs | The payee received the testnet payments |
| `10-blockscout-anchor.png` | Successful `anchor` call to the deployed `AuditAnchor` contract | A final-run audit digest was written on chain |
| `11-blockscout-contract-deployment.png` | Successful contract creation by the configured payer | The anchor contract is actually deployed on Base Sepolia |

Architecture diagram: `docs/assets/safr-architecture-slide.png` (already in the repo,
embedded in the README).

### Note on `01-audit-log.png`

The final image was captured through a real browser after strict validation passed.
It visibly shows **Live**, ALLOW / DENY / ESCALATE, both final settlement hashes, and
the 1.25 / 3.00 USDC rolling-spend strip. The headless capture is deliberately not
used for this page because its open SSE connection prevents Chrome from terminating
reliably.

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

## Current finalist-hardened evidence (live)

Captured on the finalist build, with the payment signer, the execution-authorization
signer and the audit-anchor signer held by three separate processes and three separate
least-privilege database logins. The agent process holds none of them.

**Network:** Base Sepolia (`eip155:84532`)

| Item | Value |
|---|---|
| USDC | [`0x036CbD53842c5426634e7929541eC2318f3dCF7e`](https://base-sepolia.blockscout.com/address/0x036CbD53842c5426634e7929541eC2318f3dCF7e) |
| Executor (payer) | [`0x35820e5cC60F961515EF987C94D4328a82Df38Fc`](https://base-sepolia.blockscout.com/address/0x35820e5cC60F961515EF987C94D4328a82Df38Fc) |
| Merchant `payTo` | [`0xf56e3F3134879156e11EAff78978a270726B661b`](https://base-sepolia.blockscout.com/address/0xf56e3F3134879156e11EAff78978a270726B661b) |
| `AuditAnchor` | [`0x2D2d857ce3c0d5d666B7e0dB3fE8067d4B4D6Ff7`](https://base-sepolia.blockscout.com/address/0x2D2d857ce3c0d5d666B7e0dB3fE8067d4B4D6Ff7) |

### The four headline scenarios

| Scenario | Audit | Governance | Financial outcome | Anchor |
|---|---|---|---|---|
| **DENY** — 5 USDC to `merchant_abc` against a 1 USDC per-transaction ceiling | `audit_84670a33` | `DENY`, `per_transaction_cap_exceeded`, rule `spend_caps.per_transaction_max`; **x402 never constructed** | None. There is no failed blockchain transaction, because payment authority never existed | [`0xfaabd0…9a7aa`](https://base-sepolia.blockscout.com/tx/0xfaabd09ea1829938d7d447b9aa1152743cd2eae62738873b22366eb631e9a7aa) |
| **ESCALATE** — 0.75 USDC to `merchant_new` | `audit_30aa1a70` | `ESCALATE`, `counterparty_not_on_allowlist`, rule `counterparty_policy`; approved by `reviewer:local`; authorization `auth_f70a3e32-35f9-4427-b5e6-a8b1e72f5234` | `SETTLED` — [`0x55ba3c…25469`](https://base-sepolia.blockscout.com/tx/0x55ba3c22d58a83a1b6093f2e289c544239d4839cd97b008b791d5a6052225469), receipt `status = 0x1`, USDC `Transfer` of 750000 atomic (0.75 USDC) executor → merchant | [`0x3d4659…78877`](https://base-sepolia.blockscout.com/tx/0x3d4659c3890b2061eaf04fc4351b83bce5d496c999259e6a8a55a6290be78877) |
| **ALLOW** — 0.5 USDC to `merchant_xyz`, `invoice_884` | `audit_ff45a977` | `ALLOW`, `within_mandate`; authorization `auth_8b204222-ac27-40b9-a5dc-d5a3dc8cb875` | `SETTLED` — [`0xfe4d02…c995fa`](https://base-sepolia.blockscout.com/tx/0xfe4d02288ea8882d8b75e520cf627e97d57b04e4f3a3cc81e40b780a36c995fa), receipt `status = 0x1`, USDC `Transfer` of 500000 atomic (0.5 USDC) executor → merchant | [`0xdb4eed…96368`](https://base-sepolia.blockscout.com/tx/0xdb4eed29be7f44d0c7af7375721047219cf6c74c0f87a08b373938a6b9596368) |
| **Ambiguous signed outcome** — a real incident during the run set, not staged | `audit_0aaac796` | `ALLOW`, `within_mandate`, x402 reached; execution became ambiguous **after signing** | Capacity stayed held; nothing was blindly retried; the keyless reconciler returned `deferred` 17 times; the EIP-3009 authorization expired unused. Terminal state `FAILED`, `settlement_tx` `NULL`, `EIP-3009 authorization expired unused; safe to retry` | [`0x156f3e…d62e3`](https://base-sepolia.blockscout.com/tx/0x156f3ed3e17d65a59ca37593befa8eb47b02dae8b44eafbe5b008318db8d62e3) |

`npm run audit:verify` reports **5/5 anchored records proven on chain** — each record's
digest reproduced and matched against its own anchor transaction.

### Why the ambiguous outcome is the strongest evidence, not the weakest

A merchant's HTTP response is not financial truth. When the response to a signed
execution never resolved, Cerberus did not treat "the merchant said it failed" as proof
that money did not move — it kept the mandate capacity held and refused to retry.

The proof of non-payment is read from the chain, not from the merchant. Calling
`authorizationState(payer, nonce)` on USDC for the reservation's own EIP-3009
authorization returns **false**, and that authorization's `validBefore` has elapsed.
The money did not move, and cannot move under that authorization. That is positive
non-payment evidence.

### Reading the raw logs

The demo CLI prints a generic note that a failed settlement and unanchored records
"are expected until the payer wallet is funded". That wording is stale informational
text carried by the runner and does **not** describe these runs: the payer was funded,
both permitted scenarios settled, and all five records are anchored. The authoritative
facts are the on-chain receipts and the `payment_reservation` rows, both re-read in
`artifacts/judge-evidence/08_final/final-verification.log`. Historical logs are kept
byte-for-byte rather than edited after the fact.

`05_escalate/escalate-raw.log` is the first ESCALATE attempt, which timed out waiting
for a human reviewer. It is retained on purpose: the human gate is a real cross-process
hold, not an in-memory pause. `escalate-final.log` is the approved run.

`06_allow/settlement-receipt.json` shows the transaction *sender* as the x402
facilitator rather than the payer. The USDC `Transfer` log inside that receipt is what
proves value moved from the executor to the merchant.

### The package

`artifacts/judge-evidence/`, organised by phase:

| Directory | Contents |
|---|---|
| `00_environment/`, `01_database/` | Environment, migrations, least-privilege logins, `db:verify` |
| `02_credentials/` | Credential-boundary check: the payment, authorization and anchor signers are absent from the agent process |
| `03_services/` | Runtime health for merchant, control plane, isolated executor, reviewer dashboard, reconciler and anchor worker |
| `04_deny/`, `05_escalate/`, `06_allow/`, `07_unknown/` | Per-scenario terminal output, settlement proof and anchor verification |
| `10_screenshots/`, `11_videos/` | Five screenshots and seven screen recordings covering phases 0–7 |
| `08_final/` | `SHA256SUMS.txt` for the whole package, `evidence-summary.json`, and `final-verification.log` — a read-only re-verification of the database, the credential boundary, both settlement receipts, the unconsumed EIP-3009 authorization and all five anchors |

Verify the package has not changed since capture:

```bash
cd artifacts/judge-evidence && sha256sum -c 08_final/SHA256SUMS.txt
```

The manifest covers every file except itself and `03_services/dashboard.log`, which the
dashboard service was still appending to at packaging time and therefore has no stable
checksum in a live working copy. The snapshot committed to git is the frozen version of
that one file.

`artifacts/final-evidence/` is the earlier frozen evidence set and is deliberately left
untouched by this capture.

---

## HISTORICAL STAGE-1 EVIDENCE — live settlement and on-chain anchoring

**Network:** Base Sepolia (`eip155:84532`)

| Item | Verified value |
|---|---|
| Payer | [`0x8cD0592123215f5510A5a0774323c765b9DA34e7`](https://base-sepolia.blockscout.com/address/0x8cD0592123215f5510A5a0774323c765b9DA34e7) |
| Merchant / payee | [`0x3EE24C8af00b88828D17E390ed63Eb8A302208c2`](https://base-sepolia.blockscout.com/address/0x3EE24C8af00b88828D17E390ed63Eb8A302208c2?tab=tokens) |
| Bare x402 settlement (0.01 USDC) | [`0xed51af702ebc263f8296c1fc6cb677928880f4a4dc6eee7a05f69e14e99efab9`](https://base-sepolia.blockscout.com/tx/0xed51af702ebc263f8296c1fc6cb677928880f4a4dc6eee7a05f69e14e99efab9) |
| `AuditAnchor` contract | [`0x2D2d857ce3c0d5d666B7e0dB3fE8067d4B4D6Ff7`](https://base-sepolia.blockscout.com/address/0x2D2d857ce3c0d5d666B7e0dB3fE8067d4B4D6Ff7) |
| Contract deployment | [`0x2cb059b1671678ae8ade38edca8daaa29f8a9e44b758e60484993f3899cebd08`](https://base-sepolia.blockscout.com/tx/0x2cb059b1671678ae8ade38edca8daaa29f8a9e44b758e60484993f3899cebd08) |

The deployment receipt has `status = 0x1`, creates the configured contract address,
and names the configured payer as deployer. The 236-byte deployed runtime matches the
236-byte runtime compiled from this repository exactly.

### Two fresh supervised runs

Both runs used the DB-backed `--live` escalation port. Each stopped until a real
dashboard Approve click arrived from another process. In both runs, DENY never
constructed the x402 client and therefore has no settlement transaction.

| Run | Outcome | Settlement | Audit anchor |
|---|---|---|---|
| 1 | ALLOW | [`0xe7ee1064b9ca6e08d0d023d6176f982c869947ea44a700cecdf8900d15a02f28`](https://base-sepolia.blockscout.com/tx/0xe7ee1064b9ca6e08d0d023d6176f982c869947ea44a700cecdf8900d15a02f28) | [`0xd6412593f424eebae4c20d8a0b2dab5f6f79fddbdd0392b06536c6c01986bdac`](https://base-sepolia.blockscout.com/tx/0xd6412593f424eebae4c20d8a0b2dab5f6f79fddbdd0392b06536c6c01986bdac) |
| 1 | DENY | none — x402 never constructed | [`0xb2088db7a899fdda8bc706964da1873d5970a17ee1b06dfb00b98633a6cf3bfe`](https://base-sepolia.blockscout.com/tx/0xb2088db7a899fdda8bc706964da1873d5970a17ee1b06dfb00b98633a6cf3bfe) |
| 1 | ESCALATE → approved | [`0xa2a021955a4c95a10dd6ac14681c0add0dae5ed37a2d3c9c554dbe501cd46ec5`](https://base-sepolia.blockscout.com/tx/0xa2a021955a4c95a10dd6ac14681c0add0dae5ed37a2d3c9c554dbe501cd46ec5) | [`0x1cbbab412815ec2ec9cfec6143af5e947ae0beeb900fdbad5df4af5e4769b388`](https://base-sepolia.blockscout.com/tx/0x1cbbab412815ec2ec9cfec6143af5e947ae0beeb900fdbad5df4af5e4769b388) |
| 2 | ALLOW | [`0x426f3acac92e5c41fb2078be649e744342c9ec79284c35c349e1ccc4b8dcebe4`](https://base-sepolia.blockscout.com/tx/0x426f3acac92e5c41fb2078be649e744342c9ec79284c35c349e1ccc4b8dcebe4) | [`0x5a846c2106f420c7e23ac69d68998f8c68ffe4c53b1cc5c2da3d1e001c42f7cc`](https://base-sepolia.blockscout.com/tx/0x5a846c2106f420c7e23ac69d68998f8c68ffe4c53b1cc5c2da3d1e001c42f7cc) |
| 2 | DENY | none — x402 never constructed | [`0xa0528ce1adacb733ccd5b75ec3c762a2492d0efb09973a28beafb122fe05011c`](https://base-sepolia.blockscout.com/tx/0xa0528ce1adacb733ccd5b75ec3c762a2492d0efb09973a28beafb122fe05011c) |
| 2 | ESCALATE → approved | [`0xed859f2458884eb3e57bad5f2779e09f41493c86456e6118ae8d4ead3440a93c`](https://base-sepolia.blockscout.com/tx/0xed859f2458884eb3e57bad5f2779e09f41493c86456e6118ae8d4ead3440a93c) | [`0x507858741ff5c381167b2b3b85d2e0bb71ec5052e8327dbd78ca40986db1d191`](https://base-sepolia.blockscout.com/tx/0x507858741ff5c381167b2b3b85d2e0bb71ec5052e8327dbd78ca40986db1d191) |

All 11 settlement and anchor receipts above were independently read from the public
Base Sepolia RPC and had `status = 0x1`. After run 2, `npm run audit:verify` reported
`3/3 records reproduce their digest`, `3/3 anchored on Base Sepolia`, and `No
tampering detected`. The final Postgres rows retain the complete run-2 transaction
hashes and record digests.

BaseScan presented a Cloudflare interstitial during automated image capture, so the
tracked screenshots and primary links use Base Sepolia Blockscout. Both explorers
resolve the same public chain data; Blockscout is used here because the evidence pages
load without that interstitial.

---

## Current known limitations, stated plainly

Worth having ready for Q&A rather than being caught by it.

- **Concurrency.** Two simultaneous proposals could both pass the rolling-cap check
  before either settles. The sequential demo path is unaffected. Correct fix is an
  atomic reservation; scoped as a Stage 2 item rather than rushed before the deadline.
- **Rolling window.** `rolling_window.window` is fixed at 24h matching the seeded
  mandate rather than parsed generally.
- **Time windows.** An overnight window that wraps past midnight is unsupported.
- **Auth.** *(Historical Stage-1 limitation — since fixed.)* At Stage 1 the local
  escalation endpoint had no authentication. Both the decision endpoint and the
  pending-escalation list are now reviewer-authenticated, reviewer identity comes from
  trusted server configuration rather than the request body, the dashboard reaches
  them through server-side proxies that keep the token out of browser JavaScript, and
  each process holds its own least-privilege database login. See
  [SECURITY_REMEDIATION.md](./SECURITY_REMEDIATION.md).
- **Intent generation.** Judged runs use the deterministic fixture planner, not the
  LLM path, so results are reproducible. The LLM path exists and is schema-validated
  identically, but it is not in the decision path either way.

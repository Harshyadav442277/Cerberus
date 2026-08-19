# Live Evidence — BLOCKED

**Status:** Phase E (fresh hardened live payment evidence) could not be executed
automatically. **Nothing about it has been fabricated.** No transaction hash, block
number, or settlement in this repository comes from the hardened path; every live
hash currently published is labelled Stage-1 history.

Everything else in the finalist build ran and is green. This document is the exact
handoff needed to unblock the live run.

Verify the blocker yourself at any time:

```bash
npm run preflight
```

---

## Why it is blocked

The finalist architecture deliberately splits one Stage-1 key into **three separate
signers, held by three different processes**. That separation is the product — the
agent cannot reach the payment key, and nothing that can pay can also author audit
proof. It also means a live run needs three keys provisioned, and this machine has
none of them.

Preflight result at the time of writing: **3 of 13 checks passed.**

| Check | Result | Detail |
| --- | --- | --- |
| Base Sepolia RPC reachable | **OK** | chain 84532 |
| Database initialised | **OK** | 10 tables in public schema |
| Merchant payee address configured | **OK** | `0x3EE24C8af00b88828D17E390ed63Eb8A302208c2` |
| AuditAnchor contract deployed | *(intermittent)* | verified separately: **236 bytes of code** at `0x2d2d857ce3c0d5d666b7e0db3fe8067d4b4d6ff7`. The public RPC was flapping (`no backend is currently healthy`); the contract is genuinely there. |
| Executor payment signer | **MISSING** | `EXECUTOR_EVM_PRIVATE_KEY` absent from `.env.executor` |
| Execution Authorization signer | **MISSING** | `EXECUTION_AUTH_PRIVATE_KEY` absent from `.env.authorizer` |
| Audit anchor signer | **MISSING** | `AUDIT_ANCHOR_PRIVATE_KEY` absent from `.env.anchor` |
| Signers distinct | **MISSING** | 0 of 3 configured |
| Reviewer credential | **MISSING** | `REVIEWER_API_TOKEN` absent from `.env.authorizer` |
| Merchant / control plane / executor reachable | **NOT RUNNING** | services were not started |

**No agent generated or handled any private key.** Key generation is left to the
operator deliberately: keys should be created by the person who will own them.

### Funds that already exist

| Address | Role | ETH | USDC |
| --- | --- | --- | --- |
| `0x8cD0592123215f5510A5a0774323c765b9DA34e7` | Stage-1 payer (`EVM_PRIVATE_KEY` in root `.env`) | **0.000097** | **13.72** |
| `0x3EE24C8af00b88828D17E390ed63Eb8A302208c2` | configured payee (`EVM_ADDRESS`) | **0** | **6.28** |

USDC is not the problem. **ETH is.** 0.000097 ETH is not enough to anchor audit
records, and the anchor signer will be a brand-new address with zero balance.

---

## What to do — exact steps

### Step 1 — Generate three wallets

```bash
npm run wallets:new
```

This prints three private keys and their addresses. **Keep this terminal private and
close it when finished.** Note down only the three *addresses*; you will paste the
keys into files in step 2.

### Step 2 — Write the credential files

These files are gitignored and must never be committed. Create them in the repository
root.

`.env.executor` — the isolated payment process. This is the only file that may ever
hold the x402 payment key:

```
EXECUTOR_DATABASE_URL=postgres://cerberus_executor_app:<db-password>@localhost:5544/safr_runtime
EXECUTOR_EVM_PRIVATE_KEY=<wallet 1 private key>
```

`.env.authorizer` — the trusted control plane:

```
CONTROL_PLANE_DATABASE_URL=postgres://cerberus_control_app:<db-password>@localhost:5544/safr_runtime
EXECUTION_AUTH_PRIVATE_KEY=<wallet 2 private key>
REVIEWER_API_TOKEN=<generate 32+ random characters>
REVIEWER_ID=compliance_officer_01
```

`.env.anchor` — the trusted anchor worker. This is the only file that may hold the
anchor key:

```
ANCHOR_DATABASE_URL=postgres://cerberus_anchor_app:<db-password>@localhost:5544/safr_runtime
AUDIT_ANCHOR_PRIVATE_KEY=<wallet 3 private key>
AUDIT_ANCHOR_ADDRESS=0x2d2d857ce3c0d5d666b7e0db3fe8067d4b4d6ff7
EVM_RPC_URL=https://sepolia.base.org
```

Then add **wallet 2's address** to the root `.env` so the executor knows which
authorizer to trust:

```
EXECUTION_AUTHORIZER_ADDRESS=<wallet 2 ADDRESS, not its key>
```

Generate the reviewer token with:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

### Step 3 — Fund the wallets

Base Sepolia faucets:

- <https://www.alchemy.com/faucets/base-sepolia>
- <https://faucet.quicknode.com/base/sepolia>
- Circle USDC testnet faucet: <https://faucet.circle.com> (select Base Sepolia)

| Wallet | Needs | Why |
| --- | --- | --- |
| **1 — payer** (`.env.executor`) | **≥ 0.002 ETH** and **≥ 2 USDC** | signs and settles the demo payments |
| **2 — authorizer** (`.env.authorizer`) | **nothing** | it only signs capability envelopes off-chain |
| **3 — anchor** (`.env.anchor`) | **≥ 0.002 ETH** | every audit anchor is an on-chain transaction |

You can move the existing 13.72 USDC from `0x8cD059…34e7` to wallet 1 instead of
using the USDC faucet, but that address has almost no ETH, so fund it with ETH first
or just use the faucet directly on wallet 1.

### Step 4 — Provision the database logins

```bash
npm run db:roles
```

Expected output: five logins — agent, control-plane, executor, reconciler, anchor.

### Step 5 — Re-run the preflight

```bash
npm run preflight
```

**Do not proceed until it prints `Ready for a funded live run.`** It exits non-zero
otherwise. If a check still fails, the line tells you exactly which value is missing.

### Step 6 — Start the six services

Each in its own terminal, left running:

```bash
npm run merchant     # terminal 1 — :4021
```
```bash
npm run api          # terminal 2 — :4050 (loopback)
```
```bash
npm run executor     # terminal 3 — :4060 (loopback, holds the payment key)
```
```bash
npm run dashboard    # terminal 4 — :3000
```
```bash
npm run reconciler   # terminal 5 — keyless chain reconciliation
```
```bash
npm run anchor       # terminal 6 — trusted anchor worker
```

Terminal 6 is new and is **required**: the agent no longer anchors its own records, so
without it digests are stored durably but never reach the chain, and
`npm run audit:verify` will correctly report them UNVERIFIED.

### Step 7 — Run the live evidence capture

```bash
npm run demo -- clean
```
```bash
npm run demo -- cap_breach
```
```bash
npm run demo -- new_counterparty
```

The third blocks awaiting a human decision. Approve it at
<http://localhost:3000/escalations>, or from a separate trusted terminal:

```bash
npm run reviewer:auto
```

### Step 8 — Verify against the chain

```bash
npm run audit:verify
```

This must print `VERIFIED` lines and exit 0. It independently fetches each anchor
transaction's receipt from Base Sepolia, confirms the contract and the `Anchored`
event, and compares the digest **read from the chain** against both the recomputed
and the stored one. It exits non-zero on any mismatch, and treats an RPC failure as
UNVERIFIED rather than a pass.

---

## What proves it worked

After step 8, all of the following must be true:

1. `npm run audit:verify` exits **0** with `VERIFIED` for every anchored record.
2. `payment_reservation.status = 'SETTLED'` with a non-null `settlement_tx` for the
   ALLOW and approved-ESCALATE runs:

   ```bash
   npm run db:verify
   ```

3. The DENY run produced **no** reservation, **no** authorization and **no**
   transaction — the payment authority never existed rather than failing.
4. Each settlement transaction resolves on the explorer:
   `https://sepolia.basescan.org/tx/<tx_hash>`
5. `audit_log.settlement` is non-null for the settled records, written by the
   executor rather than the agent.

Record the resulting hashes in `docs/submission/EVIDENCE.md` under **current
finalist-hardened evidence**, keeping the Stage-1 section separately labelled.

---

## What must not happen

Do not paste a transaction hash from Stage-1 history into the finalist evidence
section. Those transactions are real, but they predate signer isolation, the exact
x402 challenge binding, chain-proven settlement and the trusted audit finalizer —
they do not demonstrate the architecture being claimed. That is precisely why this
document exists instead of a fabricated result.

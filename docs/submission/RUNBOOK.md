# Cerberus — operator runbook, cold start to judged demo

**Feature frozen at `ba5c853` (`ba5c85309be54363ff31ecf9ecc9f6364bdcc29d`).** Bug fixes, demo reliability, wording
and evidence recapture only — no new features.


Everything needed to take this machine from powered-off to a running demo, and the
recovery steps for the failures actually hit during setup.

## Stage-2 signer-isolation addendum — read before running

The public hashes and Windows evidence below remain valid proof of the Stage-1 rail
and governance flow. They were produced before the finalist signer-isolation change
and must not be presented as proof that the new authorization/executor boundary has
settled live. Phase-1 code and adversarial tests are complete; capture a fresh funded
run after applying this setup.

Create the ignored environment files from their examples. `.env` is shared/public,
`.env.agent` is the only file parsed by the agent, `.env.authorizer` holds the
Execution Authorization signer and anchor-deployment key, `.env.executor` alone holds
the x402 payment key, and `.env.reconciler` contains only its least-privilege database
URL plus public RPC URL. If upgrading an old clone, remove `EVM_PRIVATE_KEY` from the
old `.env`; rename it to `EXECUTOR_EVM_PRIVATE_KEY` in `.env.executor`. Generate
separate identities with `npm run wallets:new` if the old key was ever exposed to the
agent process.

The hardened runtime has five long-running services:

```bash
npm run merchant     # :4021
npm run api          # :4050, trusted re-evaluation + authorization signer (loopback)
npm run executor     # :4060, isolated x402 payment key (loopback)
npm run dashboard    # :3000
npm run reconciler   # keyless Base Sepolia EIP-3009 reconciliation worker
npm run anchor       # trusted audit-anchor worker — holds the anchor signer
```

Verify all four health endpoints before running the agent. Atomic reservations and
durable one-shot authorization consumption are implemented and verified against real
PostgreSQL. Live challenge binding and durable `OUTCOME_UNKNOWN` reconciliation are
implemented and verified; the reconciler itself has no HTTP health endpoint, so run
`npm run reconciler -- --once` for an explicit startup/configuration check.

---

## 0. What is already done on the Windows evidence machine

As of 14 August 2026, Harsh's Windows recording/evidence environment is fully rebuilt,
funded, and running. A different clone may have different `.env` values and database
rows; use the public transaction manifest in `EVIDENCE.md` as the durable proof:

- `.env` exists with dedicated Base Sepolia testnet wallets (regenerate with `npm run wallets:new`)
- Postgres 18.6 running on `localhost:5544`, database `safr_runtime`, role `safr`
- Schema migrated (`001_init`, `002_audit_anchor`) and seeded (`agent_treasury_01`, `mandate_001` v1)
- `npm run db:verify` — 13/13
- The Stage-1 snapshot was `npm test` 91/91; the current hardened suite is 260/260
  across 48 suites, with typecheck and dashboard production build clean.
- `npm run adversarial` — 12/12 attack classes, 80 selected assertions
- `npm run redteam` — 9/9 attack classes, 60 assertions (finalist security remediation)
- `npm run mutation` — 12/12 security guards proven detectable
- `npm run sandbox -- --seed 42 --agents 50 --actions 1000 --concurrency 25` — 0 violations
- `npm run preflight` — gates any funded live run; exits non-zero until every
  precondition is met
- `npm run evidence:manifest` then `npm run evidence:verify` — regenerate and validate
  the evidence manifest
- `corepack pnpm audit` — no known vulnerabilities
- Stage-1 evidence used merchant (`:4021`), API (`:4050`), and dashboard (`:3000`).
  Current runs also require the isolated executor (`:4060`) and keyless reconciler.
- `npm run demo:script -- --thrice` — three consecutive clean runs
- bare x402 settlement confirmed on Base Sepolia
- `AuditAnchor` deployed at `0x2D2d857ce3c0d5d666B7e0dB3fE8067d4B4D6Ff7`
- two fresh supervised ALLOW → DENY → ESCALATE runs settled and anchored successfully

There is no remaining external technical blocker and no further product code is
required for the verified demo. Team identity and portal submission state are
human-only facts outside this repository. The optional backup-video narration was
recorded, but its visual edit was not completed to publication standard and is not a
runtime blocker.

---

## 1. Postgres — important deviation from the README

**The README says `npm run db:up` (Docker). That does not work on this machine.**

Docker Desktop's Linux VM is broken here: the engine's init control API never
responds, so every `docker` command returns HTTP 500. The WSL `docker-desktop` distro
fails to mount its filesystems (`getpwuid(0) failed`, `Processing /etc/fstab with
mount -a failed`). Restarting Docker Desktop and `wsl --shutdown` did not clear it.

Postgres is therefore installed **user-locally via scoop** instead, configured to be
byte-identical from the application's point of view — same host, same port 5544, same
role, same database, so `DATABASE_URL` is unchanged and nothing in the code knows the
difference.

### Start Postgres

```bash
pg_ctl -D "C:\Users\hyada\scoop\persist\postgresql\data" -l "C:\Users\hyada\scoop\persist\postgresql\data\server.log" start
```

### Stop Postgres

```bash
pg_ctl -D "C:\Users\hyada\scoop\persist\postgresql\data" stop
```

### Check it is up

```bash
psql -h 127.0.0.1 -p 5544 -U safr -d safr_runtime -c "select 1"
```

### If you ever need to recreate it from scratch

```bash
scoop install postgresql
```

Then set `port = 5544` in `…\scoop\persist\postgresql\data\postgresql.conf`, start the
server, and:

```bash
psql -h 127.0.0.1 -p 5544 -U postgres -d postgres -c "CREATE ROLE safr WITH LOGIN SUPERUSER PASSWORD 'safr';" -c "CREATE DATABASE safr_runtime OWNER safr;"
```

### Repairing Docker instead (optional, not required)

If you want `npm run db:up` back, Docker Desktop needs its Linux VM rebuilt:
Settings → Troubleshoot → **Reset to factory defaults**, or `wsl --unregister
docker-desktop`. **Both delete every container, image, and volume on this machine**,
including the unrelated containers on ports 5432/5433. That is why it was not done
automatically. The demo does not need Docker.

---

## 2. Cold start — full sequence

```bash
# 1. Install (only needed after a clean clone or a dependency change).
corepack enable
pnpm install --frozen-lockfile

# 2. Start Postgres.
pg_ctl -D "C:\Users\hyada\scoop\persist\postgresql\data" -l "C:\Users\hyada\scoop\persist\postgresql\data\server.log" start

# 3. Schema + seed. Safe to re-run; migrations are tracked.
npm run db:migrate
npm run db:seed
npm run db:verify        # expect 13/13
```

Then five terminals:

```bash
npm run merchant         # terminal 1 — :4021, the x402 payee
```

```bash
npm run api              # terminal 2 — :4050, audit feed + escalation decisions
```

```bash
npm run executor         # terminal 3 — :4060, isolated x402 signer
```

```bash
npm run dashboard        # terminal 4 — :3000, compliance dashboard
```

```bash
npm run reconciler       # terminal 5 — keyless ambiguous-outcome recovery
```

Terminal 6 — trusted anchor worker:

```bash
npm run anchor           # terminal 6 — drains the audit-finalization outbox
```

The agent no longer anchors its own audit records: it holds no anchor signer and its
database role has no write privilege on `audit_anchor`. Without this worker running,
terminal records still get a durable digest in Postgres but never reach the chain,
and `npm run audit:verify` will correctly report them as UNVERIFIED rather than
pretending they are anchored. Use `npm run anchor:once` to drain and exit.
```

Reviewer decisions require the same high-entropy `REVIEWER_API_TOKEN` in the API's
`.env.authorizer` and the dashboard server's `apps/dashboard/.env.local`. For the
scripted control plane, also copy it to the ignored `.env.reviewer` file. Never place
it in `.env.agent` or prefix it `NEXT_PUBLIC_`. Set a separate
`REVIEWER_DASHBOARD_PASSWORD` in `apps/dashboard/.env.local`; the browser will prompt
the human reviewer when the protected Escalations screen is opened.

Confirm all four HTTP services, then probe the worker once:

```bash
curl -s http://localhost:4021/health
curl -s http://localhost:4050/health
curl -s http://localhost:4060/health
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/
npm run reconciler -- --once
```

Expect merchant `status: ok`, API `ok: true` with `database: up`, executor role
`isolated-payment-executor`, and dashboard `200`.

---

## 3. Running the demo

```bash
npm run reviewer:auto            # separate trusted terminal; approves one escalation
npm run demo:script              # agent terminal: ALLOW → DENY → ESCALATE(approved)
npm run reviewer:auto -- --count=3 # trusted terminal for the three-run check
npm run demo:script -- --thrice  # the reliability check: three consecutive runs
npm run demo:reset               # wipe audit log, re-seed agent + mandate
```

For the live escalation (a real Approve click on the dashboard):

```bash
npm run demo -- new_counterparty
```

That holds at ESCALATE until someone clicks Approve or Deny on
<http://localhost:3000/escalations>, then settles or stops accordingly. This is the
version worth showing a judge — it proves the human gate is real across processes,
not a scripted pause.

---

## 4. Live Base Sepolia configuration

**Payer address on this machine:**

```
0x8cD0592123215f5510A5a0774323c765b9DA34e7
```

This payer is funded on **Base Sepolia** and is the identity used by the recorded
evidence. Do not switch to the other Aug 13 throwaway wallet. The configured payee is
`0x3EE24C8af00b88828D17E390ed63Eb8A302208c2` and the configured contract is:

```
AUDIT_ANCHOR_ADDRESS=0x2d2d857ce3c0d5d666b7e0db3fe8067d4b4d6ff7
```

Verified public-chain identifiers:

| Item | Transaction / address |
|---|---|
| Bare x402 settlement | `0xed51af702ebc263f8296c1fc6cb677928880f4a4dc6eee7a05f69e14e99efab9` |
| Contract deployment | `0x2cb059b1671678ae8ade38edca8daaa29f8a9e44b758e60484993f3899cebd08` |
| Final ALLOW settlement | `0x426f3acac92e5c41fb2078be649e744342c9ec79284c35c349e1ccc4b8dcebe4` |
| Final ESCALATE settlement | `0xed859f2458884eb3e57bad5f2779e09f41493c86456e6118ae8d4ead3440a93c` |
| Final ESCALATE anchor | `0x507858741ff5c381167b2b3b85d2e0bb71ec5052e8327dbd78ca40986db1d191` |

See `EVIDENCE.md` for both complete supervised-run manifests.

Before another recorded run:

```bash
npm run phase1:preflight
npm run demo:script -- --live
```

The second command blocks on the real dashboard Approve click. After it completes:

```bash
npm run audit:verify
pwsh -File scripts/capture-evidence.ps1 -Final
```

Do **not** redeploy the contract for an ordinary rehearsal. Redeployment changes the
evidence address and spends unnecessary gas. Only top up if preflight reports a low
balance:

| Asset | Why | Where |
|---|---|---|
| Base Sepolia ETH | gas to deploy `AuditAnchor` and write anchors | <https://www.alchemy.com/faucets/base-sepolia> |
| Base Sepolia USDC | the actual payments (needs ~4 USDC for several full runs) | <https://faucet.circle.com> — select Base Sepolia |

Each full demo run spends 1.25 USDC (0.50 on ALLOW + 0.75 on approved
ESCALATE). A tiny amount of ETH covers the three anchor calls.

---

## 5. Failure modes and fixes

| Symptom | Cause | Fix |
|---|---|---|
| `docker` commands return HTTP 500 | Docker Desktop's Linux VM is broken on this machine | Not needed — use the scoop Postgres in section 1 |
| `ECONNREFUSED …:5544` | Postgres is not running | `pg_ctl … start` (section 1) |
| `preflight` fails on merchant | merchant not running | `npm run merchant` |
| `phase1` → `invalid_exact_evm_insufficient_balance` | payer has no USDC | Fund it (section 4). This error means everything except funding is working. |
| `contracts:deploy` → "no Sepolia ETH for gas" | payer has no ETH | Fund it (section 4) |
| Demo shows `settle failed` | payer depleted, wrong network, or facilitator unavailable | Run preflight; top up only the configured payer if needed |
| Dashboard shows "Reconnecting" | API not running, or restarted | `npm run api`, then reload |
| Escalation Approve returns 409 | already decided (double-click or a second reviewer) | Expected — the claim is atomic by design |
| Demo scenario 1 unexpectedly DENIES | seeded `time_window` narrowed | Seed allows all seven days; re-run `npm run db:seed`. `db:verify` warns if the seed excludes today. |

---

## 6. Regenerating evidence

```bash
pwsh -File scripts/capture-evidence.ps1
```

Writes dashboard PNGs to `docs/assets/evidence/`. Requires all three services running
and at least one demo run in the audit log. Use `-Final`; it refuses to capture failed
settlements, missing human approval, or unanchored records.

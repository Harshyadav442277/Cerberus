# Cerberus — Final Evidence

Generated from the artifacts in this directory at commit `98e735c`.
Every number below is read out of a captured log or a machine-written report; none
is restated by hand.

## Verification

| Gate | Result |
| --- | --- |
| Tests | 384 passed, 0 failed, 78 suites |
| Adversarial suite | 12/12 classes, 80 assertions |
| Security red team | 12/12 classes, 70 assertions |
| Mutation matrix | 12/12 guards proven detectable |
| Dependency audit | No known vulnerabilities found |

## Captured commands

| Command | Exit | Log |
| --- | --- | --- |
| `npm run preflight` | 1 | [terminal/e0-preflight.log](./terminal/e0-preflight.log) |
| `npm run adversarial` | 0 | [terminal/gate-adversarial.log](./terminal/gate-adversarial.log) |
| `npm run contracts:compile` | 0 | [terminal/gate-contracts.log](./terminal/gate-contracts.log) |
| `npm run build --prefix apps/dashboard` | 0 | [terminal/gate-dashboard-build.log](./terminal/gate-dashboard-build.log) |
| `npm run db:verify` | 0 | [terminal/gate-db-verify.log](./terminal/gate-db-verify.log) |
| `npm run demo -- clean` | 0 | [terminal/gate-demo-clean.log](./terminal/gate-demo-clean.log) |
| `npm run demo -- cap_breach` | 0 | [terminal/gate-demo-deny.log](./terminal/gate-demo-deny.log) |
| `npm run demo -- new_counterparty` | 0 | [terminal/gate-demo-escalate.log](./terminal/gate-demo-escalate.log) |
| `npm run demo:reset` | 0 | [terminal/gate-demo-reset.log](./terminal/gate-demo-reset.log) |
| `corepack pnpm audit` | 0 | [terminal/gate-dependency-audit.log](./terminal/gate-dependency-audit.log) |
| `env CERBERUS_EVIDENCE_OUTPUT=1 npm run mutation` | 0 | [terminal/gate-mutation.log](./terminal/gate-mutation.log) |
| `npm run redteam` | 0 | [terminal/gate-redteam.log](./terminal/gate-redteam.log) |
| `npm run reviewer:auto -- --decision=approved` | 0 | [terminal/gate-reviewer-auto.log](./terminal/gate-reviewer-auto.log) |
| `env CERBERUS_EVIDENCE_OUTPUT=1 npm run sandbox -- --seed 1337 --agents 50 --actions 1000 --concurrency 25` | 0 | [terminal/gate-sandbox-1337.log](./terminal/gate-sandbox-1337.log) |
| `env CERBERUS_EVIDENCE_OUTPUT=1 npm run sandbox -- --seed 42 --agents 50 --actions 1000 --concurrency 25` | 0 | [terminal/gate-sandbox-42.log](./terminal/gate-sandbox-42.log) |
| `npm test` | 0 | [terminal/gate-tests.log](./terminal/gate-tests.log) |
| `npm run typecheck` | 0 | [terminal/gate-typecheck.log](./terminal/gate-typecheck.log) |

## Seeded sandbox

| Seed | Agents | Actions | Concurrency | ALLOW/DENY/ESCALATE | Throughput | Violations | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1337 | 50 | 1000 | 25 | 863/70/67 | 339.12/s | 0 | PASS |
| 42 | 50 | 1000 | 25 | 884/52/64 | 269.03/s | 0 | PASS |

## Live payment evidence

**BLOCKED.** No fresh funded payment was made on the hardened path, and none has
been fabricated. The blocker and the exact procedure to clear it are in
[LIVE_EVIDENCE_BLOCKED.md](../../docs/submission/LIVE_EVIDENCE_BLOCKED.md).

The preflight that establishes this is captured at
[terminal/e0-preflight.log](./terminal/e0-preflight.log).

## Recordings and screenshots

- `recording/baseline-adversarial.mp4` — 31420 bytes, sha256 `f8f7b2bab2152dbc…`

## Known limitations

- No fresh funded live payment on the hardened path. Phase E is blocked on operator key provisioning and funding.
- A baseline adversarial recording is present; no fresh funded live-payment recording is claimed.
- Settlement proves exact successful chain inclusion, not finality. No confirmation threshold gates the settlement path.
- Sensitive control-plane routes use bearer authentication and restricted browser CORS; loopback binding remains defense in depth. TLS and credential rotation are deployment responsibilities.
- Process isolation is by OS boundary and database role; host-level compromise defeats it.


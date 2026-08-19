# Cerberus — Final Evidence

Generated from the artifacts in this directory at commit `652c2d6`.
Every number below is read out of a captured log or a machine-written report; none
is restated by hand.

## Verification

| Gate | Result |
| --- | --- |
| Tests | 363 passed, 0 failed, 72 suites |
| Adversarial suite | 12/12 classes, 80 assertions |
| Security red team | 9/9 classes, 60 assertions |
| Mutation matrix | 12/12 guards proven detectable |
| Dependency audit | No known vulnerabilities found |

## Captured commands

| Command | Exit | Log |
| --- | --- | --- |
| `npm run adversarial` | 0 | [terminal/baseline-adversarial.log](./terminal/baseline-adversarial.log) |
| `npm run contracts:compile` | 0 | [terminal/baseline-contracts.log](./terminal/baseline-contracts.log) |
| `npm run build --prefix apps/dashboard` | 0 | [terminal/baseline-dashboard-build.log](./terminal/baseline-dashboard-build.log) |
| `npm run db:verify` | 0 | [terminal/baseline-db-verify.log](./terminal/baseline-db-verify.log) |
| `corepack pnpm audit` | 0 | [terminal/baseline-dependency-audit.log](./terminal/baseline-dependency-audit.log) |
| `npm run redteam` | 0 | [terminal/baseline-redteam.log](./terminal/baseline-redteam.log) |
| `npm test` | 0 | [terminal/baseline-tests.log](./terminal/baseline-tests.log) |
| `npm run typecheck` | 0 | [terminal/baseline-typecheck.log](./terminal/baseline-typecheck.log) |
| `npm run preflight` | 1 | [terminal/e0-preflight.log](./terminal/e0-preflight.log) |
| `npm run adversarial` | 0 | [terminal/gate-adversarial.log](./terminal/gate-adversarial.log) |
| `npm run audit:verify` | 1 | [terminal/gate-audit-verify.log](./terminal/gate-audit-verify.log) |
| `npm run contracts:compile` | 0 | [terminal/gate-contracts.log](./terminal/gate-contracts.log) |
| `npm run build --prefix apps/dashboard` | 0 | [terminal/gate-dashboard-build.log](./terminal/gate-dashboard-build.log) |
| `npm run db:verify` | 0 | [terminal/gate-db-verify.log](./terminal/gate-db-verify.log) |
| `corepack pnpm audit` | 0 | [terminal/gate-dependency-audit.log](./terminal/gate-dependency-audit.log) |
| `npm run mutation` | 0 | [terminal/gate-mutation.log](./terminal/gate-mutation.log) |
| `npm run redteam` | 0 | [terminal/gate-redteam.log](./terminal/gate-redteam.log) |
| `npm run sandbox -- --seed 1337 --agents 50 --actions 1000 --concurrency 25` | 0 | [terminal/gate-sandbox-1337.log](./terminal/gate-sandbox-1337.log) |
| `npm run sandbox -- --seed 42 --agents 50 --actions 1000 --concurrency 25` | 0 | [terminal/gate-sandbox-42.log](./terminal/gate-sandbox-42.log) |
| `npm test` | 0 | [terminal/gate-tests.log](./terminal/gate-tests.log) |
| `npm run typecheck` | 0 | [terminal/gate-typecheck.log](./terminal/gate-typecheck.log) |
| `npm run sandbox -- --seed 1337 --agents 50 --actions 1000 --concurrency 25` | 0 | [terminal/sandbox-seed-1337.log](./terminal/sandbox-seed-1337.log) |
| `npm run sandbox -- --seed 42 --agents 50 --actions 1000 --concurrency 25` | 0 | [terminal/sandbox-seed-42.log](./terminal/sandbox-seed-42.log) |

## Seeded sandbox

| Seed | Agents | Actions | Concurrency | ALLOW/DENY/ESCALATE | Throughput | Violations | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1337 | 50 | 1000 | 25 | 863/70/67 | 1030.73/s | 0 | PASS |
| 42 | 50 | 1000 | 25 | 884/52/64 | 944.49/s | 0 | PASS |

## Live payment evidence

**BLOCKED.** No fresh funded payment was made on the hardened path, and none has
been fabricated. The blocker and the exact procedure to clear it are in
[LIVE_EVIDENCE_BLOCKED.md](../../docs/submission/LIVE_EVIDENCE_BLOCKED.md).

The preflight that establishes this is captured at
[terminal/e0-preflight.log](./terminal/e0-preflight.log).

## Recordings and screenshots

**None captured.** Automated screen capture was unavailable in the build
environment — the browser pane does not composite frames headlessly. The
dashboard was still driven and verified programmatically; its rendered content
is in [database/audit-state.txt](./database/audit-state.txt).

To produce them, follow
[MANUAL_RECORDING_GUIDE.md](../../docs/submission/MANUAL_RECORDING_GUIDE.md),
then re-run `npm run evidence:manifest`.

## Known limitations

- No fresh funded live payment on the hardened path. Phase E is blocked on operator key provisioning and funding.
- Automated screen capture was unavailable in the build environment; see docs/submission/MANUAL_RECORDING_GUIDE.md.
- Settlement proves exact successful chain inclusion, not finality. No confirmation threshold gates the settlement path.
- Trusted services are loopback scoped. This is a deployment boundary, not service-to-service authentication.
- Process isolation is by OS boundary and database role; host-level compromise defeats it.


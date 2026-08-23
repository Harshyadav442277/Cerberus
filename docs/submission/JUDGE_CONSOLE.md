# Cerberus Judge Console — finals operations

The Judge Console is a presentation layer over the frozen Cerberus runtime. It adds a
fullscreen `/judge` route, fixed-scenario proxy routes, read-only chain verification,
and one persistent presenter adapter. It does not implement or modify policy,
reservation, authorization, settlement, reconciliation, or audit semantics.

## 1. Architecture

```text
Browser /judge
      |
      v
Vercel Next.js dashboard
  - Basic-authenticated Judge Console
  - allowlisted server routes
  - reviewer credential stays server-side
      |
      +---------------------------> existing Cerberus API (reads + review)
      |
      v
persistent presenter service
  - one active Judge run at a time
  - fixed fixture identifiers only
  - least-privilege agent role
      |
      v
existing @safr/agent runAction
      |
      +--> existing controls/audit adapters and agent DB role
      +--> existing control-plane authorization API
      +--> existing isolated executor --> merchant/x402/Base Sepolia

Existing authorizer: Execution Authorization signer
Existing executor:   payment key
Existing anchor:     audit-anchor signer
Existing reconciler: no signer
```

The presenter invokes `runAction` from `@safr/agent` with the same
`loadEvaluationContext`, `createAuditLog`, `createDbEscalationPort`,
`createAuthorizationPort`, and `createSettlementPort` used by the existing demo CLI.

The browser never holds one request open for settlement. Start returns `run_id` and
the server-constructed `action_id` immediately. The console polls that run ID and the
existing authenticated audit feed. A poll failure retries only the read; it never
calls the start route again.

## 2. Fixed-scenario and duplicate-launch boundary

The only accepted runner identifiers are:

```text
deny-cap-breach
escalate-new-counterparty
allow-valid-payment
```

The runner rejects request bodies and constructs the full existing fixture
server-side. No browser request can set an action ID, amount, counterparty, action
type, mandate, token, network, or payment field.

The presenter process permits one active run globally. A double submit for the same
scenario returns the same job. A different scenario while a job is active returns
`409 RUN_ALREADY_ACTIVE`. A scenario already completed by that presenter process is
returned, never executed again.

This is presentation-level protection only. It adds no reservation, idempotency,
payment, or database semantics to Cerberus. Run exactly one presenter instance for
finals; do not autoscale it.

If a presenter restart loses its volatile run registry, a status read returns
`RUN STATE UNAVAILABLE`. The UI retains the last trusted audit read and offers the
clearly labelled captured evidence. It never infers non-execution, failure, or
non-payment, and it never automatically launches another action.

## 3. Exact changed files

```text
.gitignore
.env.presenter.example
package.json
pnpm-lock.yaml
apps/agent/src/index.ts
apps/dashboard/.env.local.example
apps/dashboard/package.json
apps/dashboard/app/judge/page.tsx
apps/dashboard/components/judge/JudgeConsole.tsx
apps/dashboard/components/judge/judge.module.css
apps/dashboard/app/api/judge/chain/settlement/[auditId]/route.ts
apps/dashboard/app/api/judge/chain/unknown/route.ts
apps/dashboard/app/api/judge/readiness/route.ts
apps/dashboard/app/api/judge/review/[actionId]/[decision]/route.ts
apps/dashboard/app/api/judge/run-status/[runId]/route.ts
apps/dashboard/app/api/judge/runs/[scenario]/route.ts
apps/dashboard/lib/judge-chain-route.ts
apps/dashboard/lib/judge-evidence.ts
apps/dashboard/lib/judge-readiness-route.ts
apps/dashboard/lib/judge-review-route.test.ts
apps/dashboard/lib/judge-review-route.ts
apps/dashboard/lib/judge-runner-route.test.ts
apps/dashboard/lib/judge-runner-route.ts
apps/dashboard/lib/judge-types.ts
apps/presenter/package.json
apps/presenter/src/run-gate.test.ts
apps/presenter/src/run-gate.ts
apps/presenter/src/server.ts
docs/submission/JUDGE_CONSOLE.md
```

The one-line `apps/agent/src/index.ts` change only re-exports the existing
`loadAgentProcessEnv` launcher guard so the presenter can reuse it; it does not alter
the agent or financial runtime.

No file under `artifacts/final-evidence/` or `artifacts/judge-evidence/` is written by
Judge Mode. The console links to the authoritative captured evidence read-only.

## 4. Vercel environment variables — names only

Required:

```text
CERBERUS_API_URL
CERBERUS_PRESENTER_URL
JUDGE_RUNNER_API_TOKEN
REVIEWER_API_TOKEN
REVIEWER_DASHBOARD_USERNAME
REVIEWER_DASHBOARD_PASSWORD
```

Optional read-only RPC override:

```text
BASE_SEPOLIA_RPC_URL
```

Never configure any of these in Vercel:

```text
AGENT_DATABASE_URL
CONTROL_PLANE_DATABASE_URL
EXECUTOR_DATABASE_URL
RECONCILER_DATABASE_URL
ANCHOR_DATABASE_URL
DATABASE_URL
EXECUTION_AUTH_PRIVATE_KEY
EXECUTOR_EVM_PRIVATE_KEY
AUDIT_ANCHOR_PRIVATE_KEY
```

No credential uses a `NEXT_PUBLIC_*` name in the dashboard.

## 5. Persistent presenter environment — names only

Required:

```text
AGENT_DATABASE_URL
EXECUTION_API_TOKEN
NEXT_PUBLIC_API_URL
EXECUTOR_URL
MERCHANT_BASE_URL
JUDGE_RUNNER_API_TOKEN
PRESENTER_PORT
PRESENTER_BIND_HOST
```

Optional public/read-only configuration:

```text
EVM_RPC_URL
AUDIT_ANCHOR_ADDRESS
```

Do not configure the reviewer token or any signer private key in this service. The
presenter deletes signer/reviewer variables at startup as a fail-closed guard.

## 6. Hosted services and network access

Keep the existing persistent Cerberus services running:

```text
control-plane API
isolated executor
merchant/x402 endpoint
PostgreSQL with the existing least-privilege roles
keyless reconciler worker
independent anchor worker
```

Add the presenter as one persistent Node process on the existing Cerberus host or a
single-instance container/VM service such as Railway, Render, or Fly.io. It must reach
the agent-role database, control-plane API, executor, and merchant. Expose it only to
Vercel through TLS and the `JUDGE_RUNNER_API_TOKEN`; an authenticated tunnel or
private ingress is preferable. The runner rejects all requests with a browser
`Origin` header and all requests without its bearer credential.

Vercel needs the HTTPS URLs for the control-plane API and presenter service. The
control-plane API must retain its existing TLS/perimeter policy, reviewer bearer
authentication, and service-to-service access.

## 7. Local run

Install and validate from the repository root:

```bash
corepack pnpm install --frozen-lockfile
npm run typecheck
npm run build --prefix apps/dashboard
```

Prepare the existing Cerberus role/config files using the operator runbook. Copy
`.env.presenter.example` to the ignored `.env.presenter` and provide only the named
runner settings. Start the existing services first:

```bash
npm run merchant
npm run api
npm run executor
npm run reconciler
npm run anchor
```

Then start the fixed runner and dashboard in separate persistent terminals:

```bash
npm run presenter
npm run dashboard
```

Open `/judge` on the dashboard origin and authenticate with the dashboard reviewer
login. The presenter uses the existing agent role; the dashboard uses the existing
reviewer proxy credential.

The repository contains the designed operator-only `npm run demo:reset` mechanism.
Judge Mode never calls or exposes it. If a rehearsal environment must be reset, use
that command only through the existing operator runbook before the finals services
start. It is not part of the on-stage flow and no table is edited by the console.

## 8. Vercel deployment

1. Create a Vercel project for `apps/dashboard` and select the Next.js framework.
2. Use the repository pnpm lockfile. If the project root is `apps/dashboard`, enable
   Vercel's monorepo option to include files outside the root so the workspace
   lockfile is available.
3. Configure only the Vercel variables named above for Production and Preview as
   appropriate. Keep Preview pointed at non-funded/non-finals services.
4. Deploy and open `/judge`; confirm the Basic-auth prompt appears before any route or
   proxy is usable.
5. Confirm `GET /api/judge/readiness` reports the expected live dependencies. Never
   expose the presenter URL without TLS and its bearer boundary.

The deployment needs no private signer key and no database password.

## 9. Finals-day startup checklist

1. Start PostgreSQL and verify existing migrations/roles with the operator runbook.
2. Start merchant, API, executor, reconciler, and anchor worker.
3. Start exactly one persistent presenter instance; disable autoscaling/redeploys for
   the presentation window.
4. Confirm the payer has enough Base Sepolia USDC and native gas for the planned live
   ALLOW and approved ESCALATE settlements.
5. Confirm the Vercel Production variables point to the finals API and presenter.
6. Open `/judge` in the presentation browser, authenticate once, press `F`, and check
   all eight readiness indicators.
7. Run in order: DENY, ESCALATE + APPROVE, ALLOW, UNKNOWN.
8. Do not refresh or redeploy the presenter during a run. If status is lost, use the
   on-screen captured fallback; do not click a new execution.
9. Keep Base Sepolia explorer access available, but the main flow requires no second
   tab.
10. Use `0` for the emergency summary and `7` then “Finish presentation” for the close.

## 10. Scenario behavior

### DENY

Starts the existing `cap_breach` fixture: 5.00 USDC to `merchant_abc`. The real
disposition engine evaluates the active mandate. The console reveals DENY only after
the audit feed reports it and confirms from the returned orchestrator outcome that no
authorization or settlement path was attempted.

### ESCALATE

Starts the existing `new_counterparty` fixture: 0.75 USDC to `merchant_new`. The
persistent orchestrator waits in `createDbEscalationPort`. The console displays the
review surface only after the real audit reports ESCALATE. APPROVE/DENY uses the same
dashboard Basic auth, `REVIEWER_API_TOKEN`, and control-plane decision endpoint as the
existing reviewer flow. The Judge wrapper constructs the fixed reviewer payload
server-side after revalidating the exact pending fixture.

### ALLOW

Starts the existing `clean` fixture: 0.50 USDC to `merchant_xyz`. Observed audit and
reservation states reveal progressively. The final receipt is independently read
from Base Sepolia, and the UI marks `CHAIN VERIFIED LIVE` only when the canonical USDC
Transfer for the audit amount is present in a successful receipt.

### UNKNOWN

Never starts a payment. It presents the authoritative `audit_0aaac796` incident and
performs a live read-only `authorizationState(payer, nonce)` call against canonical
Base Sepolia USDC. `SAFE TO RETRY` is shown only when the authorization is unused and
its validity window is expired. No signer is loaded or permitted.

## 11. Fallback behavior

Live dependency failures produce presentation-safe messages only. No stack, upstream
body, environment value, header, or database information is returned. Each scenario
can switch to `VERIFIED CAPTURED RUN · 22 AUG 2026`, with the authoritative audit,
transaction, anchor, and evidence links. Captured evidence is never labelled live.

UNKNOWN is intentionally captured incident evidence plus a current read-only chain
check. A failed live chain read leaves the captured incident labelled accurately and
does not claim current verification.

## 12. Security review and finals limitations

- Vercel has presentation/reviewer proxy credentials only. No signer or database
  credential enters its environment or browser bundle.
- The presenter has the existing agent DB role and execution API bearer only. It has
  no reviewer credential and no payment, authorizer, or anchor private key.
- Financial fields are fixed in the existing `SCENARIOS` fixtures and are never
  forwarded from a browser request.
- The Judge review route revalidates the exact 0.75-USDC `merchant_new` pending action
  before invoking the existing reviewer endpoint.
- Read-only chain routes accept either the fixed UNKNOWN correlation or an audit ID;
  settlement hashes and amounts are loaded from the trusted API, not request JSON.
- The presenter registry is intentionally volatile and single-instance. Do not
  autoscale or restart it during the finals flow. Loss of registry state is reported
  as unknown presentation state, never financial failure.
- Live ALLOW/approved ESCALATE still depend on hosted-service reachability, funded
  Base Sepolia test wallets, RPC/facilitator health, and finality latency. The captured
  fallback is the explicit insurance path.
- There is no Judge reset of any database table. The only reset is the presentation
  registry (`POST /api/judge/reset` → presenter `/reset`), which refuses while a run is
  active or while a scenario still has live financial state, and otherwise forgets the
  volatile run records so a fixed scenario can be shown again. Rehearse with an
  operator-prepared environment, then restart on the known finals state before opening
  the public URL.

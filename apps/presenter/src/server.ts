/**
 * Finals-only presentation adapter.
 *
 * This process is deliberately separate from the Vercel dashboard and from the
 * trusted reviewer/control-plane process. It can launch exactly the three existing
 * Section 9 fixtures and nothing else. Amounts, counterparties and action types are
 * never accepted from an HTTP body.
 */
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import express from "express";
import type { Outcome } from "@safr/agent";
import type { ProposedAction } from "@safr/core";
import { PresentationRunGate } from "./run-gate.js";

const PORT = Number(process.env.PRESENTER_PORT ?? 4070);
const HOST = process.env.PRESENTER_BIND_HOST?.trim() || "127.0.0.1";
const TOKEN = process.env.JUDGE_RUNNER_API_TOKEN?.trim() || "";

if (TOKEN.length < 32) {
  throw new Error("JUDGE_RUNNER_API_TOKEN must contain at least 32 characters");
}

// Reuse the hostile-agent launcher boundary itself. It installs only the existing
// least-privilege agent database role and scrubs every authority the agent must not
// possess before the presenter can import or invoke the orchestrator.
const agentModule = await import("@safr/agent");
agentModule.loadAgentProcessEnv({ requireDatabase: true });

export const FINALS_SCENARIOS = {
  "deny-cap-breach": "cap_breach",
  "escalate-new-counterparty": "new_counterparty",
  "allow-valid-payment": "clean",
} as const;

export type FinalsScenario = keyof typeof FINALS_SCENARIOS;

interface RunJob {
  run_id: string;
  scenario: FinalsScenario;
  status: "RUNNING" | "COMPLETE" | "FAILED";
  started_at: string;
  finished_at: string | null;
  action: ProposedAction;
  outcome: Outcome | null;
  error: string | null;
}

const runGate = new PresentationRunGate<FinalsScenario, RunJob>();

function isFinalsScenario(value: string): value is FinalsScenario {
  return Object.hasOwn(FINALS_SCENARIOS, value);
}

function equalToken(left: string, right: string): boolean {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}

function authenticate(request: express.Request, response: express.Response): boolean {
  const header = request.header("authorization");
  const presented = header?.startsWith("Bearer ") ? header.slice(7) : "";
  if (!presented || !equalToken(presented, TOKEN)) {
    response.status(401).json({ error: "presenter_auth_required" });
    return false;
  }
  return true;
}

function publicJob(job: RunJob) {
  return {
    run_id: job.run_id,
    scenario: job.scenario,
    status: job.status,
    started_at: job.started_at,
    finished_at: job.finished_at,
    action: job.action,
    outcome: job.outcome
      ? {
          status: job.outcome.status,
          audit: job.outcome.audit ? { audit_id: job.outcome.audit.audit_id } : null,
          settlement: job.outcome.settlement
            ? {
                status: job.outcome.settlement.status,
                tx_hash: job.outcome.settlement.tx_hash,
                rail: job.outcome.settlement.rail,
                settled_at: job.outcome.settlement.settled_at,
              }
            : null,
          authorizationId: job.outcome.authorizationId,
          authorizationAttempted: job.outcome.authorizationAttempted,
          settlementAttempted: job.outcome.settlementAttempted,
        }
      : null,
    error: job.error,
  };
}

async function execute(job: RunJob): Promise<void> {
  try {
    const [agent, controls] = await Promise.all([
      import("@safr/agent"),
      import("@safr/controls-repository"),
    ]);
    job.outcome = await agent.runAction(job.action, {
      controls: { loadEvaluationContext: controls.loadEvaluationContext },
      audit: agent.createAuditLog(),
      escalations: agent.createDbEscalationPort(),
      authorization: agent.createAuthorizationPort,
      settlement: agent.createSettlementPort,
    });
    job.status = "COMPLETE";
  } catch (error) {
    // Do not return stack traces or upstream bodies to the public console.
    console.error("presenter run failed", job.run_id, error);
    job.status = "FAILED";
    job.error = "live_execution_unavailable";
  } finally {
    job.finished_at = new Date().toISOString();
    runGate.finish(job.run_id);
  }
}

async function canRetirePresentationJob(job: RunJob): Promise<boolean> {
  if (job.status === "RUNNING") return false;
  const outcome = job.outcome;
  if (
    job.status === "COMPLETE" &&
    outcome &&
    ["denied", "escalation_denied", "no_mandate", "authorization_failed"].includes(
      outcome.status,
    )
  ) {
    return true;
  }
  if (
    job.status === "COMPLETE" &&
    outcome?.status === "settled" &&
    outcome.settlement?.status === "settled" &&
    Boolean(outcome.settlement.tx_hash)
  ) {
    return true;
  }

  // An ambiguous or failed adapter job is resettable only after durable audit truth
  // positively records settlement or non-payment. The agent/presenter role already
  // has read-only audit access; this adds no reviewer or financial authority.
  const { getAuditLogRecordByActionId } = await import("@safr/db");
  const audit = await getAuditLogRecordByActionId(job.action.action_id);
  return Boolean(
    audit &&
      (audit.disposition === "DENY" ||
        audit.human_review?.decision === "denied" ||
        audit.settlement?.status === "settled" ||
        audit.settlement?.status === "failed"),
  );
}

const app = express();
app.disable("x-powered-by");
app.use((request, response, next) => {
  // This is a service-to-service surface. Browsers never call it directly;
  // Vercel's server-side request intentionally carries no Origin header.
  if (request.header("origin")) {
    response.status(403).json({ error: "browser_origin_forbidden" });
    return;
  }
  if (!authenticate(request, response)) return;
  next();
});
app.use(express.json({ limit: "1kb", strict: true }));

app.get("/health", async (_request, response) => {
  const checks = {
    database: false,
    control_plane: false,
    executor: false,
    merchant: false,
  };

  try {
    const { getPool } = await import("@safr/db");
    await getPool().query("SELECT 1");
    checks.database = true;
  } catch {
    checks.database = false;
  }

  const targets = [
    ["control_plane", process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4050"],
    ["executor", process.env.EXECUTOR_URL ?? "http://localhost:4060"],
    ["merchant", process.env.MERCHANT_BASE_URL ?? "http://localhost:4021"],
  ] as const;
  await Promise.all(
    targets.map(async ([name, base]) => {
      try {
        const result = await fetch(`${base.replace(/\/$/, "")}/health`, {
          signal: AbortSignal.timeout(4_000),
        });
        checks[name] = result.ok;
      } catch {
        checks[name] = false;
      }
    }),
  );

  response.json({
    ok: Object.values(checks).every(Boolean),
    service: "cerberus-presenter",
    checks,
    at: new Date().toISOString(),
  });
});

app.post("/runs/reset", async (request, response) => {
  if (
    request.body !== undefined ||
    (request.headers["content-length"] && Number(request.headers["content-length"]) > 0)
  ) {
    response.status(400).json({ error: "reset_body_not_allowed" });
    return;
  }

  const claim = runGate.beginReset();
  if (claim.kind !== "CHECK") {
    response.status(409).json({ error: "RUN_ALREADY_ACTIVE" });
    return;
  }

  try {
    const resettable = new Set(
      (
        await Promise.all(
          claim.jobs.map(async (job) =>
            (await canRetirePresentationJob(job)) ? job.run_id : null,
          ),
        )
      ).filter((runId): runId is string => runId !== null),
    );
    const result = runGate.completeReset((job) => resettable.has(job.run_id));
    if (result.kind === "UNSAFE") {
      response.status(409).json({ error: "RUN_RESET_UNAVAILABLE" });
      return;
    }
    response.json({ status: "RESET", retired: result.retired });
  } catch {
    runGate.abandonReset();
    response.status(503).json({ error: "RUN_RESET_UNAVAILABLE" });
  }
});

app.post("/runs/:scenario", async (request, response) => {
  const requested = request.params.scenario ?? "";
  if (!isFinalsScenario(requested)) {
    response.status(404).json({ error: "scenario_not_allowed" });
    return;
  }
  if (
    request.body !== undefined ||
    (request.headers["content-length"] && Number(request.headers["content-length"]) > 0)
  ) {
    response.status(400).json({ error: "scenario_body_not_allowed" });
    return;
  }

  // A single process will never create a second financial effect for the same finals
  // button. Repeated clicks return the original job. Run one adapter instance on stage.
  const launch = runGate.decide(requested);
  if (launch.kind === "REUSE") {
    response
      .status(launch.job.status === "RUNNING" ? 202 : 200)
      .json(publicJob(launch.job));
    return;
  }
  if (launch.kind === "CONFLICT") {
    response.status(409).json({
        error: "RUN_ALREADY_ACTIVE",
        run_id: launch.job.run_id,
        scenario: launch.job.scenario,
        status: launch.job.status,
    });
    return;
  }
  if (launch.kind === "PENDING") {
    response.status(409).json({ error: "RUN_ALREADY_ACTIVE" });
    return;
  }
  runGate.claim(requested);

  const scenario = agentModule.SCENARIOS[FINALS_SCENARIOS[requested]];
  if (!scenario) {
    runGate.abandon(requested);
    response.status(503).json({ error: "scenario_fixture_unavailable" });
    return;
  }
  let action: ProposedAction;
  try {
    action = await agentModule
      .createFixtureIntentGenerator()
      .propose(scenario, "agent_treasury_01");
  } catch {
    runGate.abandon(requested);
    response.status(503).json({ error: "scenario_fixture_unavailable" });
    return;
  }
  const job: RunJob = {
    run_id: `run_${randomUUID()}`,
    scenario: requested,
    status: "RUNNING",
    started_at: new Date().toISOString(),
    finished_at: null,
    action,
    outcome: null,
    error: null,
  };
  runGate.accept(job);
  void execute(job);
  response.status(202).json(publicJob(job));
});

app.get("/runs/:runId", (request, response) => {
  const runId = request.params.runId ?? "";
  if (!/^run_[0-9a-f-]{36}$/i.test(runId)) {
    response.status(404).json({ error: "run_not_found" });
    return;
  }
  const job = runGate.get(runId);
  if (!job) {
    response.status(404).json({ error: "run_state_unavailable" });
    return;
  }
  response.json(publicJob(job));
});

app.use((_request, response) => {
  response.status(404).json({ error: "not_found" });
});

app.use(
  (
    _error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    response.status(400).json({ error: "invalid_body" });
  },
);

app.listen(PORT, HOST, () => {
  console.log(`CERBERUS presenter listening on http://${HOST}:${PORT}`);
  console.log(
    "fixed finals scenarios: deny-cap-breach, escalate-new-counterparty, allow-valid-payment",
  );
});

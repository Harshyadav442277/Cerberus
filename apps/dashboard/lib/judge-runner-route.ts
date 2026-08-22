import { NextResponse } from "next/server";
import {
  authenticateReviewerDashboard,
  reviewerLoginRequired,
} from "./reviewer-dashboard-auth";
import type { JudgeRun, JudgeScenarioId } from "./judge-types";

const PRESENTER_URL =
  process.env.CERBERUS_PRESENTER_URL?.trim() || "http://localhost:4070";
const CONTROL_PLANE_API =
  process.env.CERBERUS_API_URL?.trim() || "http://localhost:4050";

const ALLOWED = new Set<JudgeScenarioId>([
  "deny-cap-breach",
  "escalate-new-counterparty",
  "allow-valid-payment",
]);

function authorizeDashboard(request: Request): Response | null {
  const auth = authenticateReviewerDashboard(request);
  if (!auth.configured) {
    return NextResponse.json({ error: "judge_auth_unconfigured" }, { status: 503 });
  }
  return auth.authorized ? null : reviewerLoginRequired();
}

function runnerCredential(): string | null {
  const token = process.env.JUDGE_RUNNER_API_TOKEN?.trim();
  return token && token.length >= 32 ? token : null;
}

function reviewerCredential(): string | null {
  const token = process.env.REVIEWER_API_TOKEN?.trim();
  return token && token.length >= 32 ? token : null;
}

function hasActiveFinancialState(value: unknown): boolean | null {
  if (!value || typeof value !== "object") return null;
  const items = (value as { items?: unknown }).items;
  if (!Array.isArray(items)) return null;
  const activeExecution = new Set([
    "RESERVED",
    "AUTHORIZED",
    "SUBMITTING",
    "OUTCOME_UNKNOWN",
    "RECONCILING",
  ]);
  return items.some((value) => {
    if (!value || typeof value !== "object") return false;
    const item = value as {
      record?: { disposition?: unknown; human_review?: unknown };
      execution?: { status?: unknown } | null;
    };
    const pendingReview =
      item.record?.disposition === "ESCALATE" && item.record.human_review === null;
    return pendingReview || activeExecution.has(String(item.execution?.status ?? ""));
  });
}

function safeReset(value: unknown): { status: "RESET"; retired: number } | null {
  if (!value || typeof value !== "object") return null;
  const reset = value as { status?: unknown; retired?: unknown };
  return reset.status === "RESET" &&
    typeof reset.retired === "number" &&
    Number.isInteger(reset.retired) &&
    reset.retired >= 0
    ? { status: "RESET", retired: reset.retired }
    : null;
}

function safeRun(value: unknown): JudgeRun | null {
  if (!value || typeof value !== "object") return null;
  const run = value as Partial<JudgeRun>;
  if (
    typeof run.run_id !== "string" ||
    !/^run_[0-9a-f-]{36}$/i.test(run.run_id) ||
    !run.scenario ||
    !ALLOWED.has(run.scenario) ||
    !run.status ||
    !["RUNNING", "COMPLETE", "FAILED"].includes(run.status) ||
    !run.action
  ) {
    return null;
  }
  return run as JudgeRun;
}

export function createStartJudgeRunHandler(fetcher: typeof fetch = fetch) {
  return async function startJudgeRun(
    request: Request,
    context: { params: Promise<{ scenario: string }> },
  ): Promise<Response> {
    const denied = authorizeDashboard(request);
    if (denied) return denied;

    const { scenario } = await context.params;
    if (!ALLOWED.has(scenario as JudgeScenarioId)) {
      return NextResponse.json({ error: "scenario_not_allowed" }, { status: 404 });
    }
    const body = await request.text();
    if (body.length > 0) {
      return NextResponse.json({ error: "scenario_body_not_allowed" }, { status: 400 });
    }

    const token = runnerCredential();
    if (!token) {
      return NextResponse.json({ error: "live_execution_unavailable" }, { status: 503 });
    }

    try {
      const upstream = await fetcher(`${PRESENTER_URL}/runs/${scenario}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      const body = await upstream.json().catch(() => null);
      if (upstream.status === 409) {
        return NextResponse.json({ error: "RUN_ALREADY_ACTIVE" }, { status: 409 });
      }
      const run = safeRun(body);
      if (!upstream.ok || !run) {
        return NextResponse.json({ error: "live_execution_unavailable" }, { status: 502 });
      }
      return NextResponse.json(run, {
        status: upstream.status === 202 ? 202 : 200,
        headers: { "cache-control": "no-store" },
      });
    } catch {
      return NextResponse.json({ error: "live_execution_unavailable" }, { status: 503 });
    }
  };
}

export function createJudgeRunStatusHandler(fetcher: typeof fetch = fetch) {
  return async function judgeRunStatus(
    request: Request,
    context: { params: Promise<{ runId: string }> },
  ): Promise<Response> {
    const denied = authorizeDashboard(request);
    if (denied) return denied;
    const { runId } = await context.params;
    if (!/^run_[0-9a-f-]{36}$/i.test(runId)) {
      return NextResponse.json({ error: "run_not_found" }, { status: 404 });
    }
    const token = runnerCredential();
    if (!token) {
      return NextResponse.json({ error: "live_execution_unavailable" }, { status: 503 });
    }
    try {
      const upstream = await fetcher(`${PRESENTER_URL}/runs/${encodeURIComponent(runId)}`, {
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      });
      const body = await upstream.json().catch(() => null);
      if (upstream.status === 404) {
        return NextResponse.json({ error: "run_state_unavailable" }, { status: 409 });
      }
      const run = safeRun(body);
      if (!upstream.ok || !run) {
        return NextResponse.json({ error: "live_execution_unavailable" }, { status: 502 });
      }
      return NextResponse.json(run, { headers: { "cache-control": "no-store" } });
    } catch {
      return NextResponse.json({ error: "live_execution_unavailable" }, { status: 503 });
    }
  };
}

export function createResetJudgeRunsHandler(fetcher: typeof fetch = fetch) {
  return async function resetJudgeRuns(request: Request): Promise<Response> {
    const denied = authorizeDashboard(request);
    if (denied) return denied;
    if ((await request.text()).length > 0) {
      return NextResponse.json({ error: "reset_body_not_allowed" }, { status: 400 });
    }

    const runnerToken = runnerCredential();
    const reviewerToken = reviewerCredential();
    if (!runnerToken || !reviewerToken) {
      return NextResponse.json({ error: "reset_unavailable" }, { status: 503 });
    }

    try {
      // Fail closed if durable read truth shows review, payment, or reconciliation
      // still in progress. This also protects a presenter that has restarted and
      // lost its volatile job map.
      const auditResponse = await fetcher(`${CONTROL_PLANE_API}/audit?limit=500`, {
        headers: { authorization: `Bearer ${reviewerToken}` },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      const auditBody = await auditResponse.json().catch(() => null);
      const active = hasActiveFinancialState(auditBody);
      if (!auditResponse.ok || active === null) {
        return NextResponse.json({ error: "reset_unavailable" }, { status: 503 });
      }
      if (active) {
        return NextResponse.json({ error: "RUN_ALREADY_ACTIVE" }, { status: 409 });
      }

      const upstream = await fetcher(`${PRESENTER_URL}/runs/reset`, {
        method: "POST",
        headers: { authorization: `Bearer ${runnerToken}` },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      const body = await upstream.json().catch(() => null);
      if (upstream.status === 409) {
        const error =
          (body as { error?: unknown } | null)?.error === "RUN_ALREADY_ACTIVE"
            ? "RUN_ALREADY_ACTIVE"
            : "RUN_RESET_UNAVAILABLE";
        return NextResponse.json({ error }, { status: 409 });
      }
      const reset = safeReset(body);
      if (!upstream.ok || !reset) {
        return NextResponse.json({ error: "reset_unavailable" }, { status: 502 });
      }
      return NextResponse.json(reset, { headers: { "cache-control": "no-store" } });
    } catch {
      return NextResponse.json({ error: "reset_unavailable" }, { status: 503 });
    }
  };
}

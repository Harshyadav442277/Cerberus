import { NextResponse } from "next/server";
import { encodeFunctionData, getAddress, parseAbi } from "viem";
import {
  authenticateReviewerDashboard,
  reviewerLoginRequired,
} from "./reviewer-dashboard-auth";
import { JUDGE_EVIDENCE } from "./judge-evidence";
import type { JudgeReadiness, ReadinessCheck } from "./judge-types";

const CONTROL_PLANE_API =
  process.env.CERBERUS_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:4050";
const PRESENTER_URL =
  process.env.CERBERUS_PRESENTER_URL?.trim() || "http://localhost:4070";
const RPC_URL =
  process.env.BASE_SEPOLIA_RPC_URL?.trim() ||
  "https://base-sepolia-rpc.publicnode.com";
const AUTHORIZATION_STATE_DATA = encodeFunctionData({
  abi: parseAbi([
    "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
  ]),
  functionName: "authorizationState",
  args: [
    getAddress(JUDGE_EVIDENCE.unknown.payer),
    JUDGE_EVIDENCE.unknown.nonce,
  ],
});

function check(ready: boolean, readyDetail: string, unavailableDetail: string): ReadinessCheck {
  return {
    status: ready ? "READY" : "UNAVAILABLE",
    detail: ready ? readyDetail : unavailableDetail,
  };
}

function isZeroHex(value: unknown): boolean {
  try {
    return typeof value === "string" && /^0x[0-9a-f]+$/i.test(value) && BigInt(value) === 0n;
  } catch {
    return false;
  }
}

async function json(fetcher: typeof fetch, url: string, init?: RequestInit): Promise<unknown> {
  try {
    const response = await fetcher(url, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok ? response.json() : null;
  } catch {
    return null;
  }
}

async function rpc(
  fetcher: typeof fetch,
  method: string,
  params: readonly unknown[],
): Promise<unknown> {
  const body = await json(fetcher, RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return (body as { result?: unknown } | null)?.result ?? null;
}

export function createJudgeReadinessHandler(fetcher: typeof fetch = fetch) {
  return async function judgeReadiness(request: Request): Promise<Response> {
    const dashboardAuth = authenticateReviewerDashboard(request);
    if (!dashboardAuth.configured) {
      return NextResponse.json({ error: "judge_auth_unconfigured" }, { status: 503 });
    }
    if (!dashboardAuth.authorized) return reviewerLoginRequired();

    const reviewerToken = process.env.REVIEWER_API_TOKEN?.trim() || "";
    const runnerToken = process.env.JUDGE_RUNNER_API_TOKEN?.trim() || "";
    if (reviewerToken.length < 32 || runnerToken.length < 32) {
      return NextResponse.json({ error: "judge_services_unconfigured" }, { status: 503 });
    }
    const reviewerHeaders = { authorization: `Bearer ${reviewerToken}` };
    const runnerHeaders = { authorization: `Bearer ${runnerToken}` };

    const [
      healthValue,
      runnerValue,
      reviewerValue,
      incidentValue,
      chainId,
      anchorReceipt,
      authorizationState,
    ] =
      await Promise.all([
        json(fetcher, `${CONTROL_PLANE_API}/health`),
        json(fetcher, `${PRESENTER_URL}/health`, { headers: runnerHeaders }),
        json(fetcher, `${CONTROL_PLANE_API}/escalations`, { headers: reviewerHeaders }),
        json(fetcher, `${CONTROL_PLANE_API}/audit/${JUDGE_EVIDENCE.unknown.auditId}`, {
          headers: reviewerHeaders,
        }),
        rpc(fetcher, "eth_chainId", []),
        rpc(fetcher, "eth_getTransactionReceipt", [JUDGE_EVIDENCE.unknown.anchorTx]),
        rpc(fetcher, "eth_call", [
          { to: JUDGE_EVIDENCE.contracts.usdc, data: AUTHORIZATION_STATE_DATA },
          "latest",
        ]),
      ]);

    const health = healthValue as
      | { ok?: boolean; database?: string; audit_anchor_configured?: boolean }
      | null;
    const runner = runnerValue as
      | {
          ok?: boolean;
          checks?: {
            database?: boolean;
            control_plane?: boolean;
            executor?: boolean;
            merchant?: boolean;
          };
        }
      | null;
    const incident = incidentValue as
      | { execution?: { status?: string; reconciliation_attempts?: number } }
      | null;
    const anchor = anchorReceipt as { status?: string } | null;

    const apiReady = health?.ok === true && runner?.checks?.control_plane === true;
    const databaseReady =
      health?.database === "up" && runner?.checks?.database === true;
    const reviewerReady =
      Boolean(reviewerValue) && Array.isArray((reviewerValue as { items?: unknown }).items);
    const reconcilerEvidenceReady =
      (incident?.execution?.status === "FAILED" &&
        incident.execution.reconciliation_attempts === 17) ||
      isZeroHex(authorizationState);
    const chainReady = chainId === "0x14a34";
    const anchorReady = anchor?.status === "0x1";

    const checks: JudgeReadiness["checks"] = {
      api: check(apiReady, "policy + control plane reachable", "control plane probe failed"),
      database: check(databaseReady, "control + agent roles reachable", "database probe failed"),
      merchant: check(
        runner?.checks?.merchant === true,
        "health probe passed",
        "merchant probe failed",
      ),
      executor: check(
        runner?.checks?.executor === true,
        "health probe passed",
        "executor probe failed",
      ),
      reviewer: check(
        reviewerReady,
        "authenticated review path reachable",
        "reviewer probe failed",
      ),
      reconciler: check(
        reconcilerEvidenceReady,
        "keyless chain-evidence path reachable",
        "reconciliation evidence unavailable",
      ),
      anchor: check(anchorReady, "known anchor proven on chain", "anchor proof unavailable"),
      chain: check(chainReady, "chain 84532 responding", "Base Sepolia RPC unavailable"),
    };

    return NextResponse.json(
      {
        ok: Object.values(checks).every((item) => item.status === "READY"),
        checked_at: new Date().toISOString(),
        checks,
      } satisfies JudgeReadiness,
      { headers: { "cache-control": "no-store" } },
    );
  };
}

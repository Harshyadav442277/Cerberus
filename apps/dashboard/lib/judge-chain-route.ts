import { NextResponse } from "next/server";
import {
  createPublicClient,
  decodeEventLog,
  formatUnits,
  getAddress,
  http,
  parseAbi,
  parseUnits,
  type Hex,
} from "viem";
import { baseSepolia } from "viem/chains";
import {
  authenticateReviewerDashboard,
  reviewerLoginRequired,
} from "./reviewer-dashboard-auth";
import { JUDGE_EVIDENCE } from "./judge-evidence";
import type { SettlementChainCheck, UnknownChainCheck } from "./judge-types";

const CONTROL_PLANE_API =
  process.env.CERBERUS_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:4050";
const RPC_URL =
  process.env.BASE_SEPOLIA_RPC_URL?.trim() ||
  "https://base-sepolia-rpc.publicnode.com";
const USDC_ABI = parseAbi([
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

function authorize(request: Request): Response | null {
  const auth = authenticateReviewerDashboard(request);
  if (!auth.configured) {
    return NextResponse.json({ error: "judge_auth_unconfigured" }, { status: 503 });
  }
  return auth.authorized ? null : reviewerLoginRequired();
}

function client() {
  return createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) });
}

export function createUnknownChainHandler() {
  return async function unknownChain(request: Request): Promise<Response> {
    const denied = authorize(request);
    if (denied) return denied;
    try {
      const publicClient = client();
      const [consumed, block] = await Promise.all([
        publicClient.readContract({
          address: getAddress(JUDGE_EVIDENCE.contracts.usdc),
          abi: USDC_ABI,
          functionName: "authorizationState",
          args: [
            getAddress(JUDGE_EVIDENCE.unknown.payer),
            JUDGE_EVIDENCE.unknown.nonce as Hex,
          ],
        }),
        publicClient.getBlock(),
      ]);
      const result: UnknownChainCheck = {
        ok: consumed === false && block.timestamp > BigInt(JUDGE_EVIDENCE.unknown.validBefore),
        checked_at: new Date().toISOString(),
        chain_id: baseSepolia.id,
        chain_block: block.number.toString(),
        authorization_consumed: consumed,
        validity_expired: block.timestamp > BigInt(JUDGE_EVIDENCE.unknown.validBefore),
        settlement_transaction: null,
      };
      return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
    } catch {
      return NextResponse.json({ error: "chain_verification_unavailable" }, { status: 503 });
    }
  };
}

export function createSettlementChainHandler(fetcher: typeof fetch = fetch) {
  return async function settlementChain(
    request: Request,
    context: { params: Promise<{ auditId: string }> },
  ): Promise<Response> {
    const denied = authorize(request);
    if (denied) return denied;
    const { auditId } = await context.params;
    if (!/^audit_[0-9a-f]{8}$/i.test(auditId)) {
      return NextResponse.json({ error: "audit_not_allowed" }, { status: 404 });
    }
    const reviewerToken = process.env.REVIEWER_API_TOKEN?.trim() || "";
    if (reviewerToken.length < 32) {
      return NextResponse.json({ error: "chain_verification_unavailable" }, { status: 503 });
    }

    try {
      const auditResponse = await fetcher(
        `${CONTROL_PLANE_API}/audit/${encodeURIComponent(auditId)}`,
        {
          headers: { authorization: `Bearer ${reviewerToken}` },
          cache: "no-store",
          signal: AbortSignal.timeout(8_000),
        },
      );
      const audit = (await auditResponse.json()) as {
        action?: { payload?: { amount?: number } };
        execution?: { settlement_tx?: string };
      };
      const tx = audit.execution?.settlement_tx;
      const amount = audit.action?.payload?.amount;
      if (!auditResponse.ok || !tx || typeof amount !== "number" || !/^0x[0-9a-f]{64}$/i.test(tx)) {
        return NextResponse.json({ error: "settlement_not_available" }, { status: 404 });
      }

      const receipt = await client().getTransactionReceipt({ hash: tx as Hex });
      const expected = parseUnits(String(amount), 6);
      let transfer: SettlementChainCheck["transfer"] = null;
      for (const log of receipt.logs) {
        if (getAddress(log.address) !== getAddress(JUDGE_EVIDENCE.contracts.usdc)) continue;
        try {
          const decoded = decodeEventLog({
            abi: USDC_ABI,
            eventName: "Transfer",
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName !== "Transfer" || decoded.args.value !== expected) continue;
          transfer = {
            from: decoded.args.from,
            to: decoded.args.to,
            amount_atomic: decoded.args.value.toString(),
            amount_usdc: formatUnits(decoded.args.value, 6),
          };
          break;
        } catch {
          // Ignore unrelated logs from the canonical token contract.
        }
      }

      const result: SettlementChainCheck = {
        ok: receipt.status === "success" && transfer !== null,
        checked_at: new Date().toISOString(),
        chain_id: baseSepolia.id,
        receipt: receipt.status === "success" ? "SUCCESS" : "FAILED",
        transaction: tx,
        block_number: receipt.blockNumber.toString(),
        transfer,
      };
      return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
    } catch {
      return NextResponse.json({ error: "chain_verification_unavailable" }, { status: 503 });
    }
  };
}

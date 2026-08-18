/** Agent-side clients for trusted authorization and isolated execution. */
import { SettlementSchema, type Settlement } from "@safr/core";
import {
  SignedExecutionAuthorizationSchema,
  type SignedExecutionAuthorization,
} from "@safr/execution-authorization";
import type { AuthorizationPort, SettlementPort } from "../ports.js";
import { agentEnv } from "../env.js";

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return typeof body?.error === "string" ? body.error : `HTTP ${response.status}`;
}

export function createAuthorizationPort(baseUrl = agentEnv.apiBaseUrl): AuthorizationPort {
  return {
    async issue(auditId: string): Promise<SignedExecutionAuthorization> {
      const response = await fetch(`${baseUrl}/execution-authorizations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ audit_id: auditId }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`authorization refused: ${await errorMessage(response)}`);
      return SignedExecutionAuthorizationSchema.parse(await response.json());
    },
  };
}

export function createSettlementPort(baseUrl = agentEnv.executorBaseUrl): SettlementPort {
  return {
    async pay(request): Promise<Settlement> {
      const response = await fetch(`${baseUrl}/execute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
        // x402 may include a challenge, signature and confirmation round trip.
        signal: AbortSignal.timeout(90_000),
      });
      if (!response.ok) throw new Error(`executor refused: ${await errorMessage(response)}`);
      const body = (await response.json()) as { settlement?: unknown };
      return SettlementSchema.parse(body.settlement);
    },
  };
}

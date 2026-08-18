import { HumanReviewSchema, type HumanReview } from "@safr/core";
import { agentEnv } from "./env.js";
import type { EscalationPort } from "./ports.js";

/**
 * The escalation hold.
 *
 * On ESCALATE the orchestrator awaits a decision here. Until that promise resolves
 * approved, the settlement port is never constructed and no payment exists — the hold
 * is real, not a post-hoc cancellation.
 *
 * Phase 6 replaces the in-memory registry with the dashboard's
 * `POST /escalations/:action_id/decision`. The orchestrator does not change, because
 * it depends on `EscalationPort` rather than on any of this.
 */

export interface EscalationRegistry extends EscalationPort {
  /** Resolves a waiting `awaitDecision`, or pre-loads a decision for one not yet waiting. */
  submitDecision(actionId: string, review: HumanReview): void;
  pending(): string[];
}

export function createEscalationRegistry(): EscalationRegistry {
  const waiting = new Map<string, (review: HumanReview) => void>();
  const preloaded = new Map<string, HumanReview>();

  return {
    async awaitDecision(actionId: string): Promise<HumanReview> {
      const already = preloaded.get(actionId);
      if (already) {
        preloaded.delete(actionId);
        return already;
      }
      return new Promise<HumanReview>((resolve) => {
        waiting.set(actionId, (review) => {
          waiting.delete(actionId);
          resolve(review);
        });
      });
    },

    submitDecision(actionId: string, review: HumanReview): void {
      const resolve = waiting.get(actionId);
      if (resolve) resolve(review);
      else preloaded.set(actionId, review);
    },

    pending(): string[] {
      return [...waiting.keys()];
    },
  };
}

/**
 * Pre-stages a decision through the trusted control plane, without waiting for a human.
 *
 * For automated runs and the scripted demo. Bible Section 9's reliability note prefers
 * a fast, pre-staged approval during judging over an open-ended live pause.
 *
 * It posts to the same endpoint the dashboard uses rather than fabricating a review
 * locally, and that is a security property, not a convenience. An approval is what
 * grants an escalated payment its authority; if this process could mint one, a
 * compromised agent could approve itself and the human-in-the-loop path would be
 * decorative. The control plane is the only writer of approvals, so a pre-staged
 * decision is still subject to the same staleness checks a reviewer's click is.
 *
 * The API is already a hard prerequisite for any settlement — the agent has no payment
 * key and must ask it for an Execution Authorization — so this adds no new dependency.
 */
export function createAutoEscalationPort(
  decision: "approved" | "denied",
  reviewerId = "compliance_officer_01",
  note = "Pre-staged decision for the scripted demo run (Bible Section 9).",
  baseUrl = agentEnv.apiBaseUrl,
): EscalationPort {
  return {
    async awaitDecision(actionId: string): Promise<HumanReview> {
      const response = await fetch(`${baseUrl}/escalations/${actionId}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, reviewer_id: reviewerId, note }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
        throw new Error(
          `escalation decision refused: ${
            typeof body?.error === "string" ? body.error : `HTTP ${response.status}`
          }`,
        );
      }
      const body = (await response.json()) as { human_review?: unknown };
      return HumanReviewSchema.parse(body.human_review);
    },
  };
}

/**
 * Waits for a human decision written through the dashboard API.
 *
 * The agent and the API are separate processes, so the in-memory registry cannot
 * carry the decision. The API writes `human_review` onto the audit row; this port
 * polls that row until it appears. The orchestrator still calls `recordHumanReview`
 * afterwards — an idempotent overwrite of the same JSON.
 */
export function createDbEscalationPort(options: {
  pollMs?: number;
  timeoutMs?: number;
} = {}): EscalationPort {
  const pollMs = options.pollMs ?? 250;
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;

  return {
    async awaitDecision(actionId: string): Promise<HumanReview> {
      const { getAuditLogRecordByActionId } = await import("@safr/db");
      const deadline = Date.now() + timeoutMs;

      while (Date.now() < deadline) {
        const record = await getAuditLogRecordByActionId(actionId);
        if (record?.human_review) return record.human_review;
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }

      throw new Error(
        `Timed out waiting for human review on ${actionId}. Approve or deny it from the dashboard.`,
      );
    },
  };
}

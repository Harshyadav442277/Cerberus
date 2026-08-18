import { HumanReviewSchema, type HumanReview } from "@safr/core";
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
 * Waits for a human decision written through the dashboard API.
 *
 * The agent and the API are separate processes, so the in-memory registry cannot
 * carry the decision. The API writes `human_review` onto the audit row; this port
 * polls that row until it appears. The agent only observes this control-plane write;
 * it has no database authority to create or modify human approval state.
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

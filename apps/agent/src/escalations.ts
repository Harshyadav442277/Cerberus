import type { HumanReview } from "@safr/core";
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
 * Decides immediately without a human.
 *
 * For automated tests and the scripted demo run. Bible Section 9's reliability note
 * prefers a fast, pre-staged approval during judging over an open-ended live pause.
 */
export function createAutoEscalationPort(
  decision: "approved" | "denied",
  reviewerId = "compliance_officer_01",
  note = "Pre-staged decision for the scripted demo run (Bible Section 9).",
): EscalationPort {
  return {
    async awaitDecision(): Promise<HumanReview> {
      return { reviewer_id: reviewerId, decision, decided_at: new Date().toISOString(), note };
    },
  };
}

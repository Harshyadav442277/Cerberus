import type { FeedItem } from "./types";

const ACTIVE_EXECUTION_STATUSES = new Set([
  "RESERVED",
  "AUTHORIZED",
  "SUBMITTING",
  "OUTCOME_UNKNOWN",
  "RECONCILING",
]);

export const RECONCILIATION_PROVED_NON_PAYMENT =
  "RECONCILIATION PROVED NON-PAYMENT";

export function hasActiveJudgeFinancialState(value: unknown): boolean | null {
  if (!value || typeof value !== "object") return null;
  const items = (value as { items?: unknown }).items;
  if (!Array.isArray(items)) return null;

  let active = false;
  for (const value of items) {
    if (!value || typeof value !== "object") return null;
    const item = value as {
      action?: { agent_id?: unknown };
      record?: { disposition?: unknown; human_review?: unknown };
      execution?: { status?: unknown } | null;
    };
    if (
      !item.action ||
      typeof item.action.agent_id !== "string" ||
      !item.record ||
      typeof item.record.disposition !== "string" ||
      !("human_review" in item.record) ||
      !("execution" in item) ||
      (item.execution !== null &&
        (!item.execution || typeof item.execution.status !== "string"))
    ) {
      return null;
    }
    if (item.action.agent_id !== "agent_treasury_01") continue;
    const pendingReview =
      item.record.disposition === "ESCALATE" && item.record.human_review === null;
    if (
      pendingReview ||
      ACTIVE_EXECUTION_STATUSES.has(String(item.execution?.status ?? ""))
    ) {
      active = true;
    }
  }
  return active;
}

export type DurableJudgeTerminal =
  | { kind: "FAILED"; audit: FeedItem }
  | { kind: "SETTLED"; audit: FeedItem; settlementTx: string };

export function durableJudgeTerminal(
  audit: FeedItem | null,
): DurableJudgeTerminal | null {
  const status = audit?.execution?.status;
  if (audit && (status === "FAILED" || status === "EXPIRED")) {
    return { kind: "FAILED", audit };
  }
  const settlementTx = audit?.execution?.settlement_tx;
  if (audit && status === "SETTLED" && settlementTx) {
    return { kind: "SETTLED", audit, settlementTx };
  }
  return null;
}

export async function pollTrustedAudit(options: {
  readAudit: () => Promise<FeedItem | null>;
  onAudit: (audit: FeedItem) => void;
  wait: () => Promise<void>;
  isActive: () => boolean;
}): Promise<DurableJudgeTerminal | null> {
  while (options.isActive()) {
    let audit: FeedItem | null = null;
    try {
      audit = await options.readAudit();
    } catch {
      // A failed read is not evidence of payment failure or non-payment.
    }
    if (audit) {
      options.onAudit(audit);
      const terminal = durableJudgeTerminal(audit);
      if (terminal) return terminal;
    }
    if (!options.isActive()) break;
    await options.wait();
  }
  return null;
}

export function isJudgeResetBlocked(
  states: Array<{
    mode: string;
    reviewBusy: boolean;
    error: string | null;
    run: { status: string } | null;
    audit: FeedItem | null;
  }>,
  unknownBusy: boolean,
): boolean {
  return (
    unknownBusy ||
    states.some(
      (state) =>
        state.mode === "LIVE" ||
        state.reviewBusy ||
        state.error === "run_state_unavailable" ||
        state.error === "RUN_ALREADY_ACTIVE" ||
        state.run?.status === "RUNNING" ||
        hasActiveJudgeFinancialState({ items: state.audit ? [state.audit] : [] }) === true,
    )
  );
}

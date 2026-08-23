import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  durableJudgeTerminal,
  isJudgeResetBlocked,
  pollTrustedAudit,
  RECONCILIATION_PROVED_NON_PAYMENT,
} from "./judge-recovery";
import type { FeedItem, ExecutionState } from "./types";

function audit(
  status: ExecutionState["status"],
  settlementTx: string | null = null,
): FeedItem {
  return {
    action: {
      action_id: "action_known",
      agent_id: "agent_treasury_01",
      action_type: "payment",
      proposed_at: "2026-08-22T23:22:59.000Z",
      payload: {
        counterparty: "merchant_new",
        amount: 0.75,
        currency: "USDC",
        purpose: "service_fulfillment",
        reference: "invoice_883",
      },
    },
    record: {
      audit_id: "audit_known",
      action_id: "action_known",
      agent_id: "agent_treasury_01",
      mandate_id: "mandate_finals_v2",
      mandate_version: 2,
      disposition: "ESCALATE",
      reason: "counterparty_not_on_allowlist",
      rule_triggered: "counterparty_not_on_allowlist",
      evaluated_at: "2026-08-22T23:22:59.000Z",
      human_review: {
        reviewer_id: "reviewer_human",
        decision: "approved",
        decided_at: "2026-08-22T23:23:05.000Z",
        note: "finals review",
      },
      settlement: null,
    },
    execution: {
      reservation_id: "res_known",
      status,
      settlement_tx: settlementTx,
      reconciliation_attempts: 1,
      reconciliation_error: null,
    },
  };
}

function blockingState(item: FeedItem, overrides: Record<string, unknown> = {}) {
  return {
    mode: "UNAVAILABLE",
    reviewBusy: false,
    error: "run_state_unavailable",
    run: { status: "RUNNING" },
    audit: item,
    ...overrides,
  };
}

describe("Judge audit-only recovery", () => {
  it("keeps polling beyond the former three-minute boundary until durable FAILED", async () => {
    let reads = 0;
    let waits = 0;
    const terminal = await pollTrustedAudit({
      readAudit: async () => {
        reads += 1;
        return reads <= 181 ? audit("OUTCOME_UNKNOWN") : audit("FAILED");
      },
      onAudit: () => undefined,
      wait: async () => {
        waits += 1;
      },
      isActive: () => true,
    });

    assert.equal(reads, 182);
    assert.equal(waits, 181);
    assert.equal(terminal?.kind, "FAILED");
  });

  it("keeps RUN STATE UNAVAILABLE blocking while exact-action audit is unresolved", async () => {
    const unknown = audit("OUTCOME_UNKNOWN");
    let reads = 0;
    let active = true;
    const terminal = await pollTrustedAudit({
      readAudit: async () => {
        reads += 1;
        if (reads === 4) active = false;
        return unknown;
      },
      onAudit: () => undefined,
      wait: async () => undefined,
      isActive: () => active,
    });

    assert.equal(terminal, null);
    assert.equal(reads, 4, "audit reads continue after presenter state is unavailable");
    assert.equal(isJudgeResetBlocked([blockingState(unknown)], false), true);
  });

  it("makes durable FAILED terminal and resettable", () => {
    const failed = audit("FAILED");
    assert.equal(durableJudgeTerminal(failed)?.kind, "FAILED");
    assert.equal(
      RECONCILIATION_PROVED_NON_PAYMENT,
      "RECONCILIATION PROVED NON-PAYMENT",
    );
    assert.equal(
      isJudgeResetBlocked(
        [
          blockingState(failed, {
            mode: "ERROR",
            error: "settlement_failed",
            run: { status: "FAILED" },
          }),
        ],
        false,
      ),
      false,
    );
  });

  it("uses durable SETTLED plus transaction as terminal truth and becomes resettable", async () => {
    const tx = `0x${"a".repeat(64)}`;
    const snapshots = [
      audit("OUTCOME_UNKNOWN"),
      audit("RECONCILING"),
      audit("SETTLED", tx),
    ];
    let reads = 0;
    const terminal = await pollTrustedAudit({
      readAudit: async () => snapshots[reads++] ?? snapshots.at(-1)!,
      onAudit: () => undefined,
      wait: async () => undefined,
      isActive: () => true,
    });

    assert.equal(terminal?.kind, "SETTLED");
    assert.equal(terminal?.kind === "SETTLED" && terminal.settlementTx, tx);
    assert.equal(
      isJudgeResetBlocked(
        [
          blockingState(snapshots[2]!, {
            mode: "COMPLETE",
            error: null,
            run: { status: "COMPLETE" },
          }),
        ],
        false,
      ),
      false,
    );
  });

  it("does not treat SETTLED without a transaction as terminal", () => {
    assert.equal(durableJudgeTerminal(audit("SETTLED")), null);
  });

  it("treats EXPIRED as proved non-payment", () => {
    assert.equal(durableJudgeTerminal(audit("EXPIRED"))?.kind, "FAILED");
  });

  it("does not let captured presentation bypass an unresolved financial state", () => {
    const unknown = audit("OUTCOME_UNKNOWN");
    assert.equal(
      isJudgeResetBlocked(
        [blockingState(unknown, { mode: "CAPTURED", error: null })],
        false,
      ),
      true,
    );
    assert.equal(
      isJudgeResetBlocked(
        [
          blockingState(unknown, {
            mode: "CAPTURED",
            error: "RUN_ALREADY_ACTIVE",
            run: null,
            audit: null,
          }),
        ],
        false,
      ),
      true,
    );
  });

  it("has no launch, proposed-action, or reservation operation during recovery", async () => {
    const operations: string[] = [];
    let reads = 0;
    await pollTrustedAudit({
      readAudit: async () => {
        operations.push("GET_AUDIT_FOR_ACTION");
        reads += 1;
        return reads === 1 ? audit("OUTCOME_UNKNOWN") : audit("FAILED");
      },
      onAudit: () => operations.push("OBSERVE_AUDIT"),
      wait: async () => {
        operations.push("WAIT");
      },
      isActive: () => true,
    });

    assert.deepEqual(operations, [
      "GET_AUDIT_FOR_ACTION",
      "OBSERVE_AUDIT",
      "WAIT",
      "GET_AUDIT_FOR_ACTION",
      "OBSERVE_AUDIT",
    ]);
    assert.equal(operations.some((operation) => operation.includes("POST")), false);
    assert.equal(operations.some((operation) => operation.includes("PROPOSE")), false);
    assert.equal(operations.some((operation) => operation.includes("RESERVE")), false);
  });
});

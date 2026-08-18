import { Router } from "express";
import { HumanReviewSchema } from "@safr/core";
import {
  claimHumanDecision,
  getActiveMandate,
  getAuditLogRecord,
  getAuditLogRecordByActionId,
  getProposedAction,
  listPendingEscalations,
} from "@safr/db";
import { hashProposal } from "@safr/execution-authorization";
import { assessApprovalRequest } from "../approval-guard.js";
import { DecisionBodySchema } from "../decision-body.js";
import { liveHub } from "../live.js";

export const escalationsRouter = Router();

/** GET /escalations — pending ESCALATE rows for the Escalations screen. */
escalationsRouter.get("/", async (_req, res, next) => {
  try {
    res.json({ items: await listPendingEscalations() });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /escalations/:actionId/decision
 *
 * Unblocks a waiting agent (createDbEscalationPort polls this write). Approve is a
 * single click with no confirmation — Bible §9 reliability decision.
 *
 * Two races are closed here, not one:
 *
 *  - Two reviewers, or a double-click. The write is `UPDATE … WHERE human_review IS
 *    NULL`, so the loser gets 409 already_decided rather than silently overwriting.
 *  - A stale page. The reviewer is looking at an escalation that was raised under some
 *    mandate version. If an administrator has published a new version since — revoking
 *    the counterparty, tightening a cap — then clicking Approve would grant authority
 *    under rules nobody reviewed. That is refused as stale_approval and has to be
 *    re-evaluated, which is the whole point of having a human in the path.
 */
escalationsRouter.post("/:actionId/decision", async (req, res, next) => {
  try {
    const actionId = req.params.actionId;
    if (!actionId) {
      res.status(400).json({ error: "actionId required" });
      return;
    }

    const body = DecisionBodySchema.parse(req.body);
    const record = await getAuditLogRecordByActionId(actionId);

    if (!record) {
      res.status(404).json({ error: "not_found", message: `No audit record for ${actionId}` });
      return;
    }
    if (record.disposition !== "ESCALATE") {
      res.status(409).json({ error: "not_escalation", disposition: record.disposition });
      return;
    }
    if (record.human_review) {
      res.status(409).json({ error: "already_decided", human_review: record.human_review });
      return;
    }

    const action = await getProposedAction(actionId);
    if (!action) {
      res.status(404).json({ error: "not_found", message: `No proposed action ${actionId}` });
      return;
    }

    const decidedAt = new Date().toISOString();
    const active = await getActiveMandate(record.agent_id, decidedAt);
    const verdict = assessApprovalRequest({
      record,
      current: active ? { mandate_id: active.mandate_id, version: active.version } : null,
      clientMandateVersion: body.mandate_version,
    });
    if (!verdict.ok) {
      res.status(409).json(
        verdict.error === "mandate_revoked"
          ? { error: "mandate_revoked", audit_id: record.audit_id }
          : {
              error: "stale_approval",
              message:
                "The mandate changed since this escalation was raised. Re-evaluate it " +
                "under the current mandate before approving.",
              reviewed_version: verdict.reviewedVersion,
              current_version: verdict.currentVersion,
            },
      );
      return;
    }

    const humanReview = HumanReviewSchema.parse({
      reviewer_id: body.reviewer_id,
      decision: body.decision,
      decided_at: decidedAt,
      note: body.note,
    });

    // The Section 7.5 review and the authority binding are written together, so a
    // decision can never exist without a record of exactly what it authorised.
    const { claimed } = await claimHumanDecision({
      auditId: record.audit_id,
      actionId,
      agentId: record.agent_id,
      proposalHash: hashProposal(action),
      mandateId: verdict.mandateId,
      mandateVersion: verdict.mandateVersion,
      reviewerId: humanReview.reviewer_id,
      decision: humanReview.decision,
      decidedAt,
      humanReview,
    });
    if (!claimed) {
      // Lost the race to another click / reviewer between the null check and the UPDATE.
      const latest = await getAuditLogRecord(record.audit_id);
      res.status(409).json({
        error: "already_decided",
        human_review: latest?.human_review ?? null,
      });
      return;
    }

    liveHub.publish({ record: { ...record, human_review: humanReview }, action });

    const pending = await listPendingEscalations();
    res.json({
      ok: true,
      audit_id: record.audit_id,
      action_id: actionId,
      human_review: humanReview,
      mandate_version: verdict.mandateVersion,
      pending_remaining: pending.length,
    });
  } catch (error) {
    next(error);
  }
});

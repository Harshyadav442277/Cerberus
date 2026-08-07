import { Router } from "express";
import { HumanReviewSchema } from "@safr/core";
import {
  claimAuditHumanReview,
  getAuditLogRecord,
  getAuditLogRecordByActionId,
  getProposedAction,
  listPendingEscalations,
} from "@safr/db";
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
 * The write is atomic: `UPDATE … WHERE human_review IS NULL`. A double-click or a
 * second reviewer gets 409 already_decided instead of silently overwriting.
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

    const humanReview = HumanReviewSchema.parse({
      reviewer_id: body.reviewer_id,
      decision: body.decision,
      decided_at: new Date().toISOString(),
      note: body.note,
    });

    const claimed = await claimAuditHumanReview(record.audit_id, humanReview);
    if (!claimed) {
      // Lost the race to another click / reviewer between the null check and the UPDATE.
      const latest = await getAuditLogRecord(record.audit_id);
      res.status(409).json({
        error: "already_decided",
        human_review: latest?.human_review ?? null,
      });
      return;
    }

    const action = await getProposedAction(actionId);
    if (action) {
      liveHub.publish({
        record: { ...record, human_review: humanReview },
        action,
      });
    }

    const pending = await listPendingEscalations();
    res.json({
      ok: true,
      audit_id: record.audit_id,
      action_id: actionId,
      human_review: humanReview,
      pending_remaining: pending.length,
    });
  } catch (error) {
    next(error);
  }
});

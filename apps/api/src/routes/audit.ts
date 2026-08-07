import { Router } from "express";
import { getAnchor } from "@safr/audit-log";
import {
  countByDisposition,
  getAuditLogRecord,
  getProposedAction,
  listAuditFeed,
} from "@safr/db";
import { liveHub } from "../live.js";

export const auditRouter = Router();

/** GET /audit — newest-first feed for the Audit Log table. */
auditRouter.get("/", async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 100) || 100, 500);
    const since = typeof req.query.since === "string" ? req.query.since : undefined;
    const items = await listAuditFeed({ limit, since });

    const withAnchors = await Promise.all(
      items.map(async (item) => ({
        ...item,
        anchor: await getAnchor(item.record.audit_id),
      })),
    );

    res.json({
      items: withAnchors,
      counts: await countByDisposition(),
    });
  } catch (error) {
    next(error);
  }
});

/** GET /audit/stream — SSE live feed (Design §5.1 / Phases.md Phase 6). */
auditRouter.get("/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  liveHub.subscribe(res);
});

/**
 * GET /audit/:auditId — drill-down payload.
 *
 * Near-direct §7.5 render plus the proposal, mandate version already on the record,
 * and the anchor stored alongside it.
 */
auditRouter.get("/:auditId", async (req, res, next) => {
  try {
    const auditId = req.params.auditId;
    if (!auditId) {
      res.status(400).json({ error: "auditId required" });
      return;
    }

    const record = await getAuditLogRecord(auditId);
    if (!record) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    const action = await getProposedAction(record.action_id);
    const anchor = await getAnchor(auditId);

    res.json({ record, action, anchor });
  } catch (error) {
    next(error);
  }
});

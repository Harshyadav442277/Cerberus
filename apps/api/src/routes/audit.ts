import { Router } from "express";
import { getAnchor } from "@safr/audit-log";
import { getCounters } from "@safr/controls-repository";
import {
  countByDisposition,
  getActiveMandate,
  getAuditLogRecord,
  getMandate,
  getProposedAction,
  listAuditFeed,
} from "@safr/db";
import { liveHub } from "../live.js";

export const auditRouter = Router();

const DEFAULT_AGENT = "agent_treasury_01";

/** GET /audit — newest-first feed for the Audit Log table. */
auditRouter.get("/", async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 100) || 100, 500);
    const since = typeof req.query.since === "string" ? req.query.since : undefined;
    const agentId =
      typeof req.query.agent_id === "string" ? req.query.agent_id : DEFAULT_AGENT;
    const items = await listAuditFeed({ limit, since });

    const withAnchors = await Promise.all(
      items.map(async (item) => ({
        ...item,
        anchor: await getAnchor(item.record.audit_id),
      })),
    );

    const at = new Date().toISOString();
    const [counts, mandate, counters] = await Promise.all([
      countByDisposition(),
      getActiveMandate(agentId, at),
      getCounters(agentId, at),
    ]);

    const maxTotal =
      mandate?.controls.spend_caps.rolling_window.max_total ?? null;

    res.json({
      items: withAnchors,
      counts,
      // Design §5.1 summary strip — live rolling spend against the mandate cap.
      spend: {
        agent_id: agentId,
        rolling_total_24h: counters.rolling_total_24h,
        max_total: maxTotal,
        currency: "USDC",
      },
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
 * Near-direct §7.5 render plus the proposal, the mandate version that was in force
 * (for threshold-vs-actual), and the anchor stored alongside the record.
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

    const [action, anchor, mandate] = await Promise.all([
      getProposedAction(record.action_id),
      getAnchor(auditId),
      getMandate(record.mandate_id, record.mandate_version),
    ]);

    res.json({ record, action, anchor, mandate });
  } catch (error) {
    next(error);
  }
});

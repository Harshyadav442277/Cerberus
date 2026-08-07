import { Router } from "express";
import { getActiveMandate, getAgentIdentity } from "@safr/db";
import { getCounters } from "@safr/controls-repository";

export const mandatesRouter = Router();

/** GET /mandates/active?agent_id=… — read-only §7.2 mandate for the Mandate screen. */
mandatesRouter.get("/active", async (req, res, next) => {
  try {
    const agentId =
      typeof req.query.agent_id === "string" ? req.query.agent_id : "agent_treasury_01";
    const at = typeof req.query.at === "string" ? req.query.at : new Date().toISOString();
    const mandate = await getActiveMandate(agentId, at);
    if (!mandate) {
      res.status(404).json({ error: "no_active_mandate", agent_id: agentId, at });
      return;
    }
    res.json({ mandate });
  } catch (error) {
    next(error);
  }
});

/** GET /agents/:agentId — §7.1 identity + live counters for the Agent screen. */
export const agentsRouter = Router();

agentsRouter.get("/:agentId", async (req, res, next) => {
  try {
    const agentId = req.params.agentId;
    if (!agentId) {
      res.status(400).json({ error: "agentId required" });
      return;
    }
    const agent = await getAgentIdentity(agentId);
    if (!agent) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const at = new Date().toISOString();
    const counters = await getCounters(agentId, at);
    const mandate = await getActiveMandate(agentId, at);
    res.json({ agent, counters, mandate_id: mandate?.mandate_id ?? null });
  } catch (error) {
    next(error);
  }
});

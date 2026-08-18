import { Router } from "express";
import { z } from "zod";
import { loadEvaluationContext } from "@safr/controls-repository";
import {
  bindAuthorization,
  getAuditLogRecord,
  getProposedAction,
  reserveBudget,
} from "@safr/db";
import { apiEnv } from "../env.js";
import {
  AuthorizationIssuanceError,
  createExecutionAuthorizer,
} from "../execution-authorizer.js";

const bodySchema = z.object({ audit_id: z.string().min(1).max(200) }).strict();

function chainId(network: string): number {
  const match = /^eip155:(\d+)$/.exec(network);
  if (!match) return Number.NaN;
  return Number(match[1]);
}

const authorizer = createExecutionAuthorizer({
  context: {
    getAudit: getAuditLogRecord,
    getAction: getProposedAction,
    loadEvaluationContext,
  },
  authorizerPrivateKey: apiEnv.executionAuthPrivateKey,
  reservations: { reserve: reserveBudget, bindAuthorization },
  target: {
    chainId: chainId(apiEnv.network),
    payTo: apiEnv.payTo,
    merchantBaseUrl: apiEnv.merchantBaseUrl,
  },
});

export const executionAuthorizationsRouter = Router();

executionAuthorizationsRouter.post("/", async (req, res, next) => {
  try {
    const { audit_id } = bodySchema.parse(req.body);
    const envelope = await authorizer.issue(audit_id);
    res.status(201).json(envelope);
  } catch (error) {
    if (error instanceof AuthorizationIssuanceError) {
      // 503 is "this control plane is misconfigured"; everything else is a refusal
      // the caller cannot retry its way out of, including a budget that is full.
      const status = error.code === "AUTHORIZER_NOT_CONFIGURED" ? 503 : 409;
      res.status(status).json({ error: error.code });
      return;
    }
    next(error);
  }
});

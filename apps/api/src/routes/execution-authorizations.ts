import { Router } from "express";
import { z } from "zod";
import { loadEvaluationContext } from "@safr/controls-repository";
import {
  bindAuthorization,
  getAgentIdentity,
  getAuditLogRecord,
  getHumanApproval,
  getProposedAction,
  promoteAuditToVelocityEscalation,
  recordIssuedAuthorization,
  reserveBudget,
} from "@safr/db";
import { apiEnv } from "../env.js";
import {
  AuthorizationIssuanceError,
  createExecutionAuthorizer,
} from "../execution-authorizer.js";
import { createExecutionAuth } from "../execution-auth.js";

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
    getApproval: getHumanApproval,
    getAgent: getAgentIdentity,
  },
  authorizerPrivateKey: apiEnv.executionAuthPrivateKey,
  reservations: {
    reserve: reserveBudget,
    bindAuthorization,
    recordIssued: recordIssuedAuthorization,
    promoteVelocityEscalation: promoteAuditToVelocityEscalation,
  },
  target: {
    chainId: chainId(apiEnv.network),
    payTo: apiEnv.payTo,
    merchantBaseUrl: apiEnv.merchantBaseUrl,
  },
});

type ExecutionAuthorizer = Pick<ReturnType<typeof createExecutionAuthorizer>, "issue">;

export function createExecutionAuthorizationsRouter(options: {
  token?: string;
  issuer?: ExecutionAuthorizer;
} = {}): Router {
  const router = Router();
  const token = options.token ?? apiEnv.executionApiToken;
  const issuer = options.issuer ?? authorizer;

  router.post("/", createExecutionAuth(token), async (req, res, next) => {
    try {
      const { audit_id } = bodySchema.parse(req.body);
      const envelope = await issuer.issue(audit_id);
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

  return router;
}

export const executionAuthorizationsRouter = createExecutionAuthorizationsRouter();

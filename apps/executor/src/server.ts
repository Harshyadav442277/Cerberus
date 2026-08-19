import { resolveBindHost } from "@safr/core";
import express from "express";
import { ZodError, z } from "zod";
import {
  AuthorizationError,
  SignedExecutionAuthorizationSchema,
} from "@safr/execution-authorization";
import {
  X402ChallengeError,
  createEip3009ChainReader,
  createX402Payer,
  fetchX402Challenge,
} from "@safr/x402-client";
import {
  dbAuthorizationUseStore,
  dbExecutionContext,
  dbReservations,
} from "./db-context.js";
import { configureExecutorDatabase, executorEnv } from "./env.js";
import {
  createIsolatedExecutor,
  ExecutionRefusedError,
  SettlementOutcomeUnknownError,
} from "./execution.js";

configureExecutorDatabase();

const requestSchema = z
  .object({
    audit_id: z.string().min(1).max(200),
    envelope: SignedExecutionAuthorizationSchema,
  })
  .strict();

const executor = createIsolatedExecutor({
  context: dbExecutionContext,
  reservations: dbReservations,
  useStore: dbAuthorizationUseStore,
  expectedAuthorizer: executorEnv.expectedAuthorizer,
  target: executorEnv.target,
  challengeFetcher: (request) =>
    fetchX402Challenge(request, executorEnv.target.merchantBaseUrl),
  chain: createEip3009ChainReader(executorEnv.x402.rpcUrl),
  payerFactory: () => createX402Payer(executorEnv.x402),
});

const app = express();
app.use(express.json({ limit: "32kb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", role: "isolated-payment-executor", network: executorEnv.x402.network });
});

app.post("/execute", async (req, res, next) => {
  try {
    const input = requestSchema.parse(req.body);
    const settlement = await executor.execute(input);
    res.json({ settlement });
  } catch (error) {
    if (error instanceof SettlementOutcomeUnknownError) {
      res.status(503).json({ error: "OUTCOME_UNKNOWN", signing_key_used: true });
      return;
    }
    if (
      error instanceof AuthorizationError ||
      error instanceof ExecutionRefusedError ||
      error instanceof X402ChallengeError
    ) {
      const replay =
        (error instanceof AuthorizationError && error.code === "AUTHORIZATION_REPLAY") ||
        (error instanceof ExecutionRefusedError && error.code === "RESERVATION_NOT_EXECUTABLE");
      const status = replay ? 409 : 403;
      res.status(status).json({ error: error.code, signing_key_used: false });
      return;
    }
    next(error);
  }
});

app.use(
  (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof ZodError) {
      res.status(400).json({ error: "INVALID_EXECUTION_REQUEST", signing_key_used: false });
      return;
    }
    console.error(error);
    res.status(500).json({ error: "EXECUTOR_FAILURE" });
  },
);

/**
 * Loopback by default — Remediation 6B. This process holds the payment key, so it is
 * the last service that should be reachable from off-host by default. POST /execute
 * still requires a valid signed Execution Authorization; binding to loopback removes
 * the ability of an unauthenticated network client to trigger it at all.
 */
const { host: HOST, exposed } = resolveBindHost(process.env.EXECUTOR_BIND_HOST);

app.listen(executorEnv.port, HOST, () => {
  console.log(`\n  CERBERUS isolated executor listening on http://${HOST}:${executorEnv.port}`);
  if (exposed) {
    console.log("  WARNING       bound beyond loopback via EXECUTOR_BIND_HOST");
  }
  console.log("  payment key   isolated in executor process");
  console.log("  execute       POST /execute\n");
});

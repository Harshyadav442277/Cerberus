import express from "express";
import { ZodError, z } from "zod";
import {
  AuthorizationError,
  SignedExecutionAuthorizationSchema,
} from "@safr/execution-authorization";
import {
  X402ChallengeError,
  createX402Payer,
  fetchX402Challenge,
} from "@safr/x402-client";
import {
  dbAuthorizationUseStore,
  dbExecutionContext,
  dbReservations,
} from "./db-context.js";
import { configureExecutorDatabase, executorEnv } from "./env.js";
import { createIsolatedExecutor, ExecutionRefusedError } from "./execution.js";

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

app.listen(executorEnv.port, () => {
  console.log(`\n  CERBERUS isolated executor listening on http://localhost:${executorEnv.port}`);
  console.log("  payment key   isolated in executor process");
  console.log("  execute       POST /execute\n");
});

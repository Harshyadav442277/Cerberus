/**
 * SAFR Runtime API — dashboard backend.
 *
 *   GET  /health
 *   GET  /audit
 *   GET  /audit/stream          SSE live feed
 *   GET  /audit/:auditId
 *   GET  /escalations
 *   POST /escalations/:actionId/decision
 *   GET  /mandates/active
 *   GET  /agents/:agentId
 *
 * Run: npm run api
 */
import cors from "cors";
import express from "express";
import { ZodError } from "zod";
import { agentsRouter, mandatesRouter } from "./routes/mandates.js";
import { auditRouter } from "./routes/audit.js";
import { escalationsRouter } from "./routes/escalations.js";
import { healthRouter } from "./routes/health.js";
import { executionAuthorizationsRouter } from "./routes/execution-authorizations.js";
import { apiEnv, configureControlPlaneDatabase } from "./env.js";

const PORT = apiEnv.port;
configureControlPlaneDatabase();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "32kb" }));

app.use("/health", healthRouter);
app.use("/audit", auditRouter);
app.use("/escalations", escalationsRouter);
app.use("/mandates", mandatesRouter);
app.use("/agents", agentsRouter);
app.use("/execution-authorizations", executionAuthorizationsRouter);

app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (error instanceof ZodError) {
      res.status(400).json({ error: "invalid_body", details: error.flatten() });
      return;
    }
    console.error(error);
    res.status(500).json({ error: "internal_error", message: (error as Error).message });
  },
);

app.listen(PORT, () => {
  console.log(`\n  CERBERUS API — SAFR Runtime listening on http://localhost:${PORT}`);
  console.log(`  live feed     GET /audit/stream`);
  console.log(`  escalations   POST /escalations/:actionId/decision\n`);
  console.log(`  authorize     POST /execution-authorizations\n`);
});

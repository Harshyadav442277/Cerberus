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
import { resolveBindHost } from "@safr/core";
import cors from "cors";
import express from "express";
import { ZodError } from "zod";
import { agentsRouter, mandatesRouter } from "./routes/mandates.js";
import { auditRouter } from "./routes/audit.js";
import { escalationsRouter } from "./routes/escalations.js";
import { healthRouter } from "./routes/health.js";
import { executionAuthorizationsRouter } from "./routes/execution-authorizations.js";
import { apiEnv, configureControlPlaneDatabase } from "./env.js";
import { createCorsOptions } from "./cors-policy.js";

const PORT = apiEnv.port;
configureControlPlaneDatabase();

const app = express();
app.use(cors(createCorsOptions(apiEnv.corsOrigins)));
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

/**
 * Loopback by default — Remediation 6B.
 *
 * `app.listen(PORT)` binds 0.0.0.0, which publishes this control plane to every
 * interface on the host. All authority-bearing and sensitive read routes require
 * bearer credentials, and browser CORS is allowlisted. Loopback remains an
 * independent defense-in-depth boundary rather than the authentication mechanism.
 *
 * Binding elsewhere is possible but deliberately explicit: an operator who sets
 * API_BIND_HOST has chosen to expose it and remains responsible for TLS, credential
 * rotation and perimeter controls.
 */
const { host: HOST, exposed } = resolveBindHost(process.env.API_BIND_HOST);

app.listen(PORT, HOST, () => {
  console.log(`\n  CERBERUS API — SAFR Runtime listening on http://${HOST}:${PORT}`);
  if (exposed) {
    console.log("  WARNING       bound beyond loopback via API_BIND_HOST");
  }
  console.log(`  live feed     GET /audit/stream`);
  console.log(`  escalations   POST /escalations/:actionId/decision`);
  console.log(`  authorize     POST /execution-authorizations\n`);
});

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
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import cors from "cors";
import express from "express";
import { ZodError } from "zod";
import { agentsRouter, mandatesRouter } from "./routes/mandates.js";
import { auditRouter } from "./routes/audit.js";
import { escalationsRouter } from "./routes/escalations.js";
import { healthRouter } from "./routes/health.js";

loadEnv({ path: resolve(import.meta.dirname, "../../../.env"), quiet: true });

const PORT = Number(process.env.API_PORT ?? 4050);

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

app.use("/health", healthRouter);
app.use("/audit", auditRouter);
app.use("/escalations", escalationsRouter);
app.use("/mandates", mandatesRouter);
app.use("/agents", agentsRouter);

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
});

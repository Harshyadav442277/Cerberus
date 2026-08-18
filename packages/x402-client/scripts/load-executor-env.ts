import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";

// Standalone rail diagnostics are trusted executor processes. Public configuration
// stays in .env; the payment key lives only in the ignored executor environment.
loadDotenv({ path: resolve(import.meta.dirname, "../../../.env"), quiet: true });
loadDotenv({
  path: resolve(import.meta.dirname, "../../../.env.executor"),
  quiet: true,
  override: true,
});

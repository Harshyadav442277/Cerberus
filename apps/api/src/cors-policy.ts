import type { CorsOptions } from "cors";

/** Browser origins allowed to read the loopback control plane. */
export function createCorsOptions(allowedOrigins: readonly string[]): CorsOptions {
  const allowed = new Set(allowedOrigins);
  return {
    origin(origin, callback) {
      // Service-to-service requests do not carry Origin and do not need CORS.
      callback(null, origin === undefined || allowed.has(origin));
    },
  };
}

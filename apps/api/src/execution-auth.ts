import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

function equalSecret(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

/**
 * Authenticates the one service allowed to ask the trusted control plane to mint an
 * execution capability. Policy is still re-evaluated server-side; this credential
 * only closes the unauthenticated authority-triggering surface.
 */
export function createExecutionAuth(token: string): RequestHandler {
  return (req, res, next) => {
    if (token.length < 32) {
      res.status(503).json({ error: "execution_auth_unconfigured" });
      return;
    }

    const header = req.header("authorization");
    if (!header?.startsWith("Bearer ")) {
      res.status(401).json({ error: "execution_auth_required" });
      return;
    }

    const presented = header.slice("Bearer ".length);
    if (!presented || !equalSecret(presented, token)) {
      res.status(403).json({ error: "execution_auth_invalid" });
      return;
    }

    next();
  };
}

import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

export interface ReviewerAuthConfig {
  token: string;
  reviewerId: string;
}

function equalSecret(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

/**
 * Authenticates the trusted reviewer control plane before any authority-state read or
 * write. Reviewer identity comes from trusted server configuration, never the body.
 */
export function createReviewerAuth(config: ReviewerAuthConfig): RequestHandler {
  return (req, res, next) => {
    if (config.token.length < 32 || !config.reviewerId) {
      res.status(503).json({ error: "reviewer_auth_unconfigured" });
      return;
    }

    const header = req.header("authorization");
    if (!header?.startsWith("Bearer ")) {
      res.status(401).json({ error: "reviewer_auth_required" });
      return;
    }

    const presented = header.slice("Bearer ".length);
    if (!presented || !equalSecret(presented, config.token)) {
      res.status(403).json({ error: "reviewer_auth_invalid" });
      return;
    }

    res.locals.reviewerId = config.reviewerId;
    next();
  };
}

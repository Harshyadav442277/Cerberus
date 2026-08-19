import { getAnchor } from "@safr/audit-log";

/**
 * Waits for the trusted anchor worker to finalize a set of records.
 *
 * The agent used to drive anchoring itself. It no longer can: it holds no anchor
 * signer and its database role has no write privilege on `audit_anchor`. All it does
 * now is enqueue a finalization request and observe the result, which is exactly the
 * separation Remediation 3 requires.
 *
 * Waiting is therefore genuinely optional. If no worker is running, this returns
 * after the timeout and the caller reports the records as pending — an honest
 * "not anchored yet", never a fabricated success.
 */
export async function waitForAnchorDigest(
  auditId: string,
  options: { timeoutMs?: number; pollMs?: number } = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const pollMs = options.pollMs ?? 250;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const anchor = await getAnchor(auditId);
    if (anchor?.record_hash) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

/** Waits for every named record, in parallel, under one shared deadline. */
export async function waitForAnchorDigests(
  auditIds: readonly string[],
  options: { timeoutMs?: number; pollMs?: number } = {},
): Promise<void> {
  await Promise.all(auditIds.map((auditId) => waitForAnchorDigest(auditId, options)));
}

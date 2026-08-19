/**
 * Where a trusted service listens — Remediation 6B.
 *
 * `app.listen(port)` binds 0.0.0.0 and publishes a service to every interface on the
 * host. For the control plane that means an unauthenticated network client can
 * trigger authorization issuance; for the executor it means one can trigger the
 * process that holds the payment key. A signed Execution Authorization prevents such
 * a caller from changing an amount, but "cannot change the payment" is not the same
 * as "cannot make the payment happen now".
 *
 * This prototype therefore scopes its trusted service interfaces to loopback, and
 * makes exposing them an explicit operator decision rather than the default.
 */
export const LOOPBACK_HOST = "127.0.0.1";

export interface BindHost {
  host: string;
  /** True when the operator has deliberately bound beyond loopback. */
  exposed: boolean;
}

/**
 * Resolves a service's bind address from its environment variable.
 *
 * Absent, blank, or explicitly loopback all mean loopback. Anything else is treated
 * as a deliberate exposure and reported as such, so the process can say so in its
 * startup banner instead of exposing itself quietly.
 */
export function resolveBindHost(configured: string | undefined): BindHost {
  const host = configured?.trim() || LOOPBACK_HOST;
  const exposed = host !== LOOPBACK_HOST && host !== "localhost" && host !== "::1";
  return { host, exposed };
}

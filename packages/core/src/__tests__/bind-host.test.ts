import { strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import { LOOPBACK_HOST, resolveBindHost } from "../bind-host.js";

/**
 * Attack H — trusted service interfaces are loopback-scoped by default.
 *
 * The failure this prevents is silent: `app.listen(port)` binds 0.0.0.0, and nothing
 * about that looks wrong in a code review or in a local demo. It only shows up when
 * the machine is on a network somebody else is also on.
 */
describe("trusted service bind address", () => {
  it("binds loopback when nothing is configured", () => {
    const resolved = resolveBindHost(undefined);
    strictEqual(resolved.host, LOOPBACK_HOST);
    strictEqual(resolved.exposed, false);
  });

  it("binds loopback for a blank or whitespace value", () => {
    strictEqual(resolveBindHost("").host, LOOPBACK_HOST);
    strictEqual(resolveBindHost("   ").host, LOOPBACK_HOST);
    strictEqual(resolveBindHost("   ").exposed, false);
  });

  it("treats explicit loopback spellings as not exposed", () => {
    for (const host of ["127.0.0.1", "localhost", "::1"]) {
      strictEqual(resolveBindHost(host).exposed, false, `${host} is loopback`);
    }
  });

  it("reports binding to all interfaces as a deliberate exposure", () => {
    // The point is not to forbid it — an operator may have a reverse proxy in front —
    // but that it must be a choice the process announces, never a default.
    const resolved = resolveBindHost("0.0.0.0");
    strictEqual(resolved.host, "0.0.0.0");
    strictEqual(resolved.exposed, true);
  });

  it("reports a specific external address as exposed", () => {
    strictEqual(resolveBindHost("10.0.0.5").exposed, true);
  });
});

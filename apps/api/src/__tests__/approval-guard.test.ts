import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import { assessApprovalRequest } from "../approval-guard.js";

/**
 * The stale-approval race from Critique.md, as a test rather than a comment.
 *
 * A human in the review path is supposed to make the system safer. It becomes a
 * laundering step the moment a click on a page rendered minutes ago can grant
 * authority under rules that changed in between.
 */

const RECORD = { mandate_id: "mandate_001", mandate_version: 17 };

describe("approval request staleness", () => {
  it("accepts a decision made under the mandate still in force", () => {
    deepStrictEqual(
      assessApprovalRequest({
        record: RECORD,
        current: { mandate_id: "mandate_001", version: 17 },
        clientMandateVersion: 17,
      }),
      { ok: true, mandateId: "mandate_001", mandateVersion: 17 },
    );
  });

  it("refuses the 12:04 click after the 12:03 mandate change", () => {
    // 12:01 escalated under v17 · 12:03 administrator publishes v18 · 12:04 Approve.
    const verdict = assessApprovalRequest({
      record: RECORD,
      current: { mandate_id: "mandate_001", version: 18 },
    });
    strictEqual(verdict.ok, false);
    deepStrictEqual(verdict, {
      ok: false,
      error: "stale_approval",
      reviewedVersion: 17,
      currentVersion: 18,
    });
  });

  it("refuses when the reviewer's page reports an older version than the server holds", () => {
    const verdict = assessApprovalRequest({
      record: RECORD,
      current: { mandate_id: "mandate_001", version: 17 },
      clientMandateVersion: 16,
    });
    strictEqual(verdict.ok, false);
    strictEqual(verdict.ok === false && verdict.error, "stale_approval");
  });

  it("refuses when no mandate is in force at all", () => {
    const verdict = assessApprovalRequest({ record: RECORD, current: null });
    strictEqual(verdict.ok, false);
    strictEqual(verdict.ok === false && verdict.error, "mandate_revoked");
  });

  it("refuses a decision under a different mandate entirely", () => {
    const verdict = assessApprovalRequest({
      record: RECORD,
      current: { mandate_id: "mandate_other", version: 17 },
    });
    strictEqual(verdict.ok, false);
    strictEqual(verdict.ok === false && verdict.error, "stale_approval");
  });

  it("accepts when the client does not report a version", () => {
    // Older clients still work; the audit record's own version is the binding check.
    const verdict = assessApprovalRequest({
      record: RECORD,
      current: { mandate_id: "mandate_001", version: 17 },
    });
    strictEqual(verdict.ok, true);
  });
});

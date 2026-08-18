import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DecisionBodySchema } from "../decision-body.js";

describe("escalation decision body", () => {
  it("defaults the Bible §9 example note without accepting reviewer authority", () => {
    const parsed = DecisionBodySchema.parse({ decision: "approved" });
    assert.equal(parsed.note, "Verified merchant_new via out-of-band call");
    assert.equal(parsed.decision, "approved");
    assert.equal("reviewer_id" in parsed, false);
  });

  it("strips a forged reviewer_id from the untrusted body", () => {
    const parsed = DecisionBodySchema.parse({
      decision: "approved",
      reviewer_id: "agent_self_approved",
    });
    assert.equal("reviewer_id" in parsed, false);
  });

  it("accepts deny", () => {
    const parsed = DecisionBodySchema.parse({
      decision: "denied",
      note: "Could not verify counterparty",
    });
    assert.equal(parsed.decision, "denied");
  });

  it("rejects unknown decisions", () => {
    assert.throws(() => DecisionBodySchema.parse({ decision: "maybe" }));
  });
});

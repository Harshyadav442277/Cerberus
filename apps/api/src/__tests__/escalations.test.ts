import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DecisionBodySchema } from "../decision-body.js";

describe("escalation decision body", () => {
  it("defaults reviewer and the Bible §9 example note", () => {
    const parsed = DecisionBodySchema.parse({ decision: "approved" });
    assert.equal(parsed.reviewer_id, "compliance_officer_01");
    assert.equal(parsed.note, "Verified merchant_new via out-of-band call");
    assert.equal(parsed.decision, "approved");
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

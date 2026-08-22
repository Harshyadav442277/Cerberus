import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PresentationRunGate } from "./run-gate";

type Scenario = "deny-cap-breach" | "allow-valid-payment";
interface Job {
  run_id: string;
  scenario: Scenario;
  status: "RUNNING" | "COMPLETE" | "FAILED";
}

describe("finals presentation duplicate-launch gate", () => {
  it("reuses the same run for a double submit", () => {
    const gate = new PresentationRunGate<Scenario, Job>();
    const job: Job = {
      run_id: "run_one",
      scenario: "allow-valid-payment",
      status: "RUNNING",
    };
    gate.claim(job.scenario);
    gate.accept(job);
    assert.deepEqual(gate.decide("allow-valid-payment"), { kind: "REUSE", job });
  });

  it("rejects a different scenario while one run is active", () => {
    const gate = new PresentationRunGate<Scenario, Job>();
    const job: Job = {
      run_id: "run_one",
      scenario: "allow-valid-payment",
      status: "RUNNING",
    };
    gate.claim(job.scenario);
    gate.accept(job);
    assert.deepEqual(gate.decide("deny-cap-breach"), { kind: "CONFLICT", job });
  });

  it("never reruns a completed scenario but permits the next fixed scenario", () => {
    const gate = new PresentationRunGate<Scenario, Job>();
    const allow: Job = {
      run_id: "run_one",
      scenario: "allow-valid-payment",
      status: "RUNNING",
    };
    gate.claim(allow.scenario);
    gate.accept(allow);
    allow.status = "COMPLETE";
    gate.finish(allow.run_id);
    assert.equal(gate.decide("allow-valid-payment").kind, "REUSE");
    assert.equal(gate.decide("deny-cap-breach").kind, "START");
  });

  it("serializes two start requests before either action has been constructed", () => {
    const gate = new PresentationRunGate<Scenario, Job>();
    assert.equal(gate.decide("allow-valid-payment").kind, "START");
    gate.claim("allow-valid-payment");
    assert.equal(gate.decide("deny-cap-breach").kind, "PENDING");
    gate.abandon("allow-valid-payment");
    assert.equal(gate.decide("deny-cap-breach").kind, "START");
  });
});

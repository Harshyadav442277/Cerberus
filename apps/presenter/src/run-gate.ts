/** Presentation-level duplicate-launch protection. It adds no financial semantics. */
export interface GatedRun<Scenario extends string> {
  run_id: string;
  scenario: Scenario;
  status: "RUNNING" | "COMPLETE" | "FAILED";
}

export type StartDecision<Job> =
  | { kind: "START" }
  | { kind: "PENDING" }
  | { kind: "REUSE"; job: Job }
  | { kind: "CONFLICT"; job: Job };

export class PresentationRunGate<
  Scenario extends string,
  Job extends GatedRun<Scenario>,
> {
  private readonly runs = new Map<string, Job>();
  private readonly latestByScenario = new Map<Scenario, string>();
  private activeRunId: string | null = null;
  private pendingScenario: Scenario | null = null;

  decide(scenario: Scenario): StartDecision<Job> {
    const existingId = this.latestByScenario.get(scenario);
    const existing = existingId ? this.runs.get(existingId) : undefined;
    if (existing) return { kind: "REUSE", job: existing };

    if (this.pendingScenario) return { kind: "PENDING" };

    const active = this.activeRunId ? this.runs.get(this.activeRunId) : undefined;
    if (active?.status === "RUNNING") return { kind: "CONFLICT", job: active };
    this.activeRunId = null;
    return { kind: "START" };
  }

  claim(scenario: Scenario): void {
    if (this.pendingScenario || this.activeRunId) {
      throw new Error("presentation run gate accepted a second launch claim");
    }
    this.pendingScenario = scenario;
  }

  abandon(scenario: Scenario): void {
    if (this.pendingScenario === scenario) this.pendingScenario = null;
  }

  accept(job: Job): void {
    const active = this.activeRunId ? this.runs.get(this.activeRunId) : undefined;
    if (active?.status === "RUNNING") {
      throw new Error("presentation run gate accepted a second active run");
    }
    if (this.pendingScenario !== job.scenario) {
      throw new Error("presentation run gate received an unclaimed job");
    }
    this.pendingScenario = null;
    this.runs.set(job.run_id, job);
    this.latestByScenario.set(job.scenario, job.run_id);
    this.activeRunId = job.run_id;
  }

  finish(runId: string): void {
    if (this.activeRunId === runId) this.activeRunId = null;
  }

  get(runId: string): Job | null {
    return this.runs.get(runId) ?? null;
  }
}

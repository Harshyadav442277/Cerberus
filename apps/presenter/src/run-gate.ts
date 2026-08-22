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

export type ResetClaim<Job> =
  | { kind: "CHECK"; jobs: readonly Job[] }
  | { kind: "ACTIVE" }
  | { kind: "PENDING" };

export type ResetDecision =
  | { kind: "RESET"; retired: number }
  | { kind: "UNSAFE" };

export class PresentationRunGate<
  Scenario extends string,
  Job extends GatedRun<Scenario>,
> {
  private readonly runs = new Map<string, Job>();
  private readonly latestByScenario = new Map<Scenario, string>();
  private activeRunId: string | null = null;
  private pendingScenario: Scenario | null = null;
  private resetPending = false;

  decide(scenario: Scenario): StartDecision<Job> {
    if (this.resetPending) return { kind: "PENDING" };
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
    if (this.pendingScenario || this.activeRunId || this.resetPending) {
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

  /**
   * Claims a short presentation-reset window. Financial state is not inspected or
   * mutated here; the caller must positively classify every retained job before it
   * asks the gate to forget those presentation records.
   */
  beginReset(): ResetClaim<Job> {
    if (this.resetPending || this.pendingScenario) return { kind: "PENDING" };
    if ([...this.runs.values()].some((job) => job.status === "RUNNING")) {
      return { kind: "ACTIVE" };
    }
    this.resetPending = true;
    return { kind: "CHECK", jobs: [...this.runs.values()] };
  }

  completeReset(canRetire: (job: Job) => boolean): ResetDecision {
    if (!this.resetPending) {
      throw new Error("presentation run gate has no claimed reset");
    }
    const jobs = [...this.runs.values()];
    if (jobs.some((job) => !canRetire(job))) {
      this.resetPending = false;
      return { kind: "UNSAFE" };
    }
    this.runs.clear();
    this.latestByScenario.clear();
    this.activeRunId = null;
    this.resetPending = false;
    return { kind: "RESET", retired: jobs.length };
  }

  abandonReset(): void {
    this.resetPending = false;
  }
}

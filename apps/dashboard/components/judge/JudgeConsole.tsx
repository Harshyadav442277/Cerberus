"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FeedItem } from "@/lib/types";
import {
  JUDGE_EVIDENCE,
  baseScanTx,
  evidenceLink,
} from "@/lib/judge-evidence";
import type {
  JudgeReadiness,
  JudgeRun,
  JudgeScenario,
  JudgeScenarioId,
  SettlementChainCheck,
  UnknownChainCheck,
} from "@/lib/judge-types";
import styles from "./judge.module.css";

type View =
  | "emergency"
  | "overview"
  | "deny"
  | "escalate"
  | "allow"
  | "unknown"
  | "architecture"
  | "evidence"
  | "close";

interface RunUi {
  run: JudgeRun | null;
  audit: FeedItem | null;
  observations: string[];
  mode: "IDLE" | "LIVE" | "COMPLETE" | "ERROR" | "UNAVAILABLE" | "CAPTURED";
  reviewBusy: boolean;
  error: string | null;
}

const EMPTY_RUN: RunUi = {
  run: null,
  audit: null,
  observations: [],
  mode: "IDLE",
  reviewBusy: false,
  error: null,
};

const SCENARIO_IDS: Record<JudgeScenario, JudgeScenarioId> = {
  deny: "deny-cap-breach",
  escalate: "escalate-new-counterparty",
  allow: "allow-valid-payment",
};

const VIEW_KEYS: Record<string, View> = {
  "0": "emergency",
  "1": "overview",
  "2": "deny",
  "3": "escalate",
  "4": "allow",
  "5": "unknown",
  "6": "architecture",
  "7": "evidence",
};

const SCENARIO_COPY = {
  deny: {
    eyebrow: "CAP BREACH",
    amount: "5.00 USDC",
    counterparty: "merchant_abc",
    expected: "DENY",
    run: "RUN CAP BREACH",
  },
  escalate: {
    eyebrow: "NEW COUNTERPARTY",
    amount: "0.75 USDC",
    counterparty: "merchant_new",
    expected: "ESCALATE",
    run: "RUN NEW COUNTERPARTY",
  },
  allow: {
    eyebrow: "VALID PAYMENT",
    amount: "0.50 USDC",
    counterparty: "merchant_xyz",
    expected: "ALLOW",
    run: "RUN VALID PAYMENT",
  },
} as const;

const TIMELINES: Record<JudgeScenario, { key: string; label: string; sub?: string }[]> = {
  deny: [
    { key: "PROPOSED", label: "PROPOSAL RECEIVED" },
    { key: "POLICY EVALUATION", label: "POLICY EVALUATION" },
    { key: "DENY", label: "DENY" },
  ],
  escalate: [
    { key: "PROPOSED", label: "PROPOSAL RECEIVED" },
    { key: "ESCALATE", label: "ESCALATE" },
    { key: "HUMAN APPROVED", label: "HUMAN APPROVED" },
    { key: "RESERVED", label: "CAPACITY RESERVED", sub: "RESERVED" },
    { key: "AUTHORIZED", label: "EXECUTION AUTHORIZATION", sub: "AUTHORIZED" },
    { key: "SUBMITTING", label: "ISOLATED EXECUTOR", sub: "SUBMITTING" },
    { key: "X402", label: "x402" },
    { key: "OUTCOME_UNKNOWN", label: "OUTCOME UNKNOWN" },
    { key: "RECONCILING", label: "KEYLESS RECONCILER" },
    { key: "SETTLED", label: "BASE SEPOLIA · SETTLED" },
  ],
  allow: [
    { key: "PROPOSED", label: "PROPOSED" },
    { key: "ALLOW", label: "ALLOW" },
    { key: "RESERVED", label: "RESERVED" },
    { key: "AUTHORIZED", label: "AUTHORIZED" },
    { key: "SUBMITTING", label: "SUBMITTING" },
    { key: "OUTCOME_UNKNOWN", label: "OUTCOME UNKNOWN" },
    { key: "RECONCILING", label: "RECONCILING" },
    { key: "SETTLED", label: "SETTLED" },
  ],
};

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function short(value: string | null | undefined, head = 10, tail = 8) {
  if (!value) return "—";
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function observations(run: JudgeRun, audit: FeedItem | null, previous: string[]) {
  const seen = new Set(previous);
  if (run.action) seen.add("PROPOSED");
  if (audit) {
    seen.add("POLICY EVALUATION");
    seen.add(audit.record.disposition);
    if (audit.record.human_review?.decision === "approved") seen.add("HUMAN APPROVED");
    if (audit.record.human_review?.decision === "denied") seen.add("HUMAN DENIED");
    if (audit.execution?.status) seen.add(audit.execution.status);
  }
  if (run.outcome?.authorizationId) seen.add("AUTHORIZED");
  if (run.outcome?.settlementAttempted) seen.add("X402");
  if (run.outcome?.settlement?.status === "settled") seen.add("SETTLED");
  return [...seen];
}

async function responseError(response: Response): Promise<string> {
  const value = (await response.json().catch(() => null)) as { error?: string } | null;
  return value?.error ?? "live_execution_unavailable";
}

export function JudgeConsole() {
  const [view, setView] = useState<View>("overview");
  const [readiness, setReadiness] = useState<JudgeReadiness | null>(null);
  const [readinessBusy, setReadinessBusy] = useState(true);
  const [runs, setRuns] = useState<Record<JudgeScenario, RunUi>>({
    deny: { ...EMPTY_RUN },
    escalate: { ...EMPTY_RUN },
    allow: { ...EMPTY_RUN },
  });
  const [unknownCheck, setUnknownCheck] = useState<UnknownChainCheck | null>(null);
  const [unknownBusy, setUnknownBusy] = useState(false);
  const [settlementChecks, setSettlementChecks] = useState<
    Partial<Record<JudgeScenario, SettlementChainCheck>>
  >({});
  const starting = useRef<Record<JudgeScenario, boolean>>({
    deny: false,
    escalate: false,
    allow: false,
  });

  const loadReadiness = useCallback(async () => {
    setReadinessBusy(true);
    try {
      const response = await fetch("/api/judge/readiness", { cache: "no-store" });
      if (!response.ok) throw new Error("unavailable");
      setReadiness((await response.json()) as JudgeReadiness);
    } catch {
      setReadiness(null);
    } finally {
      setReadinessBusy(false);
    }
  }, []);

  const loadUnknown = useCallback(async () => {
    setUnknownBusy(true);
    try {
      const response = await fetch("/api/judge/chain/unknown", { cache: "no-store" });
      if (!response.ok) throw new Error("unavailable");
      setUnknownCheck((await response.json()) as UnknownChainCheck);
    } catch {
      setUnknownCheck(null);
    } finally {
      setUnknownBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadReadiness();
  }, [loadReadiness]);

  useEffect(() => {
    if (view === "unknown" && !unknownCheck && !unknownBusy) void loadUnknown();
  }, [loadUnknown, unknownBusy, unknownCheck, view]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const selected = VIEW_KEYS[event.key];
      if (selected) {
        event.preventDefault();
        setView(selected);
      } else if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const patchRun = useCallback((scenario: JudgeScenario, change: Partial<RunUi>) => {
    setRuns((current) => ({
      ...current,
      [scenario]: { ...current[scenario], ...change },
    }));
  }, []);

  const monitor = useCallback(
    async (scenario: JudgeScenario, initial: JudgeRun) => {
      let current = initial;
      let seen: string[] = ["PROPOSED"];
      let lastAudit: FeedItem | null = null;
      let failedStatusReads = 0;
      const deadline = Date.now() + 3 * 60 * 1000;
      while (Date.now() < deadline) {
        const runnerStillActive = current.status === "RUNNING";
        const [runResult, feedResult] = await Promise.allSettled([
          runnerStillActive
            ? fetch(`/api/judge/run-status/${encodeURIComponent(current.run_id)}`, {
                cache: "no-store",
              })
            : Promise.resolve(null),
          fetch("/api/runtime/audit?limit=100", { cache: "no-store" }),
        ]);

        if (feedResult.status === "fulfilled" && feedResult.value.ok) {
          const feed = (await feedResult.value.json()) as { items?: FeedItem[] };
          lastAudit =
            feed.items?.find((item) => item.action.action_id === current.action.action_id) ??
            lastAudit;
        }

        let statusRead = !runnerStillActive;
        if (runResult.status === "fulfilled" && runResult.value) {
          if (runResult.value.ok) {
            current = (await runResult.value.json()) as JudgeRun;
            failedStatusReads = 0;
            statusRead = true;
          } else {
            const code = await responseError(runResult.value);
            if (code === "run_state_unavailable") {
              patchRun(scenario, {
                audit: lastAudit,
                mode: "UNAVAILABLE",
                error: code,
              });
              return;
            }
            failedStatusReads += 1;
          }
        } else if (runnerStillActive) {
          failedStatusReads += 1;
        }

        seen = observations(current, lastAudit, seen);
        if (!statusRead) {
          if (failedStatusReads >= 5) {
            patchRun(scenario, {
              audit: lastAudit,
              observations: seen,
              mode: "UNAVAILABLE",
              error: "run_state_unavailable",
            });
            return;
          }
          patchRun(scenario, { audit: lastAudit, observations: seen, mode: "LIVE" });
          await sleep(1_000);
          continue;
        }

        const executionStatus = lastAudit?.execution?.status;
        const reconciledSettlement =
          executionStatus === "SETTLED" && Boolean(lastAudit?.execution?.settlement_tx);
        const reconciliationFailed =
          executionStatus === "FAILED" || executionStatus === "EXPIRED";
        const waitingForReconciliation =
          current.status === "COMPLETE" &&
          current.outcome?.status === "settlement_unknown" &&
          !reconciledSettlement &&
          !reconciliationFailed;
        const unresolved =
          current.status === "COMPLETE" &&
          ((current.outcome?.status === "settlement_unknown" && reconciliationFailed) ||
            current.outcome?.status === "settlement_failed" ||
            current.outcome?.status === "authorization_failed" ||
            current.outcome?.status === "no_mandate");
        patchRun(scenario, {
          run: current,
          audit: lastAudit,
          observations: seen,
          error:
            current.error ??
            (reconciliationFailed
              ? "settlement_failed"
              : unresolved
                ? current.outcome?.status ?? null
                : null),
          mode:
            current.status === "FAILED" || unresolved
              ? "ERROR"
              : waitingForReconciliation
                ? "LIVE"
              : current.status === "COMPLETE"
                  ? "COMPLETE"
                : "LIVE",
        });

        if (current.status !== "RUNNING") {
          if (waitingForReconciliation) {
            await sleep(1_000);
            continue;
          }
          const settlementTx =
            current.outcome?.settlement?.tx_hash ?? lastAudit?.execution?.settlement_tx;
          if (current.status === "COMPLETE" && settlementTx) {
            const auditId = current.outcome?.audit?.audit_id ?? lastAudit?.record.audit_id;
            if (auditId) {
              const verified = await fetch(
                `/api/judge/chain/settlement/${encodeURIComponent(auditId)}`,
                { cache: "no-store" },
              );
              if (verified.ok) {
                const value = (await verified.json()) as SettlementChainCheck;
                setSettlementChecks((checks) => ({ ...checks, [scenario]: value }));
              }
            }
          }
          return;
        }
        await sleep(750);
      }
      patchRun(scenario, { mode: "UNAVAILABLE", error: "run_state_unavailable" });
    },
    [patchRun],
  );

  const startScenario = useCallback(
    async (scenario: JudgeScenario) => {
      if (starting.current[scenario]) return;
      starting.current[scenario] = true;
      patchRun(scenario, {
        run: null,
        audit: null,
        observations: [],
        mode: "LIVE",
        reviewBusy: false,
        error: null,
      });
      setView(scenario);
      try {
        const response = await fetch(`/api/judge/runs/${SCENARIO_IDS[scenario]}`, {
          method: "POST",
          cache: "no-store",
        });
        if (!response.ok) throw new Error(await responseError(response));
        const run = (await response.json()) as JudgeRun;
        patchRun(scenario, { run, observations: ["PROPOSED"] });
        await monitor(scenario, run);
      } catch (error) {
        patchRun(scenario, { mode: "ERROR", error: (error as Error).message });
      } finally {
        starting.current[scenario] = false;
      }
    },
    [monitor, patchRun],
  );

  const review = useCallback(
    async (decision: "approved" | "denied") => {
      const actionId = runs.escalate.run?.action.action_id;
      if (!actionId) return;
      patchRun("escalate", { reviewBusy: true });
      try {
        const response = await fetch(
          `/api/judge/review/${encodeURIComponent(actionId)}/${decision}`,
          { method: "POST", cache: "no-store" },
        );
        if (!response.ok) throw new Error(await responseError(response));
      } catch {
        patchRun("escalate", { mode: "ERROR" });
      } finally {
        patchRun("escalate", { reviewBusy: false });
      }
    },
    [patchRun, runs.escalate.run?.action.action_id],
  );

  const nav = useMemo(
    () => [
      ["1", "Overview", "overview"],
      ["2", "Deny", "deny"],
      ["3", "Escalate", "escalate"],
      ["4", "Allow", "allow"],
      ["5", "Unknown", "unknown"],
      ["6", "Architecture", "architecture"],
      ["7", "Evidence", "evidence"],
    ] as const,
    [],
  );

  return (
    <div className={styles.console} data-view={view}>
      <header className={styles.topbar}>
        <button className={styles.brand} type="button" onClick={() => setView("overview")}>
          <span className={styles.mark}>C</span>
          <span>CERBERUS</span>
        </button>
        <nav className={styles.nav} aria-label="Judge Console sections">
          {nav.map(([key, label, target]) => (
            <button
              key={target}
              type="button"
              className={view === target ? styles.navActive : ""}
              onClick={() => setView(target)}
            >
              <kbd>{key}</kbd> {label}
            </button>
          ))}
        </nav>
        <div className={styles.topActions}>
          <button type="button" onClick={() => setView("emergency")}>
            <kbd>0</kbd> Summary
          </button>
          <button
            type="button"
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              else void document.documentElement.requestFullscreen();
            }}
          >
            <kbd>F</kbd> Fullscreen
          </button>
        </div>
      </header>

      <main className={styles.stage}>
        {view === "overview" && (
          <Overview
            readiness={readiness}
            readinessBusy={readinessBusy}
            onRefresh={loadReadiness}
            onOpen={setView}
          />
        )}
        {view === "deny" && (
          <ScenarioPanel
            scenario="deny"
            state={runs.deny}
            chain={settlementChecks.deny}
            onRun={startScenario}
            onCaptured={() => patchRun("deny", { mode: "CAPTURED" })}
          />
        )}
        {view === "escalate" && (
          <ScenarioPanel
            scenario="escalate"
            state={runs.escalate}
            chain={settlementChecks.escalate}
            onRun={startScenario}
            onReview={review}
            onCaptured={() => patchRun("escalate", { mode: "CAPTURED" })}
          />
        )}
        {view === "allow" && (
          <ScenarioPanel
            scenario="allow"
            state={runs.allow}
            chain={settlementChecks.allow}
            onRun={startScenario}
            onCaptured={() => patchRun("allow", { mode: "CAPTURED" })}
          />
        )}
        {view === "unknown" && (
          <UnknownPanel check={unknownCheck} busy={unknownBusy} onCheck={loadUnknown} />
        )}
        {view === "architecture" && <ArchitecturePanel />}
        {view === "evidence" && <EvidencePanel onClose={() => setView("close")} />}
        {view === "emergency" && <EmergencyPanel onOpen={setView} />}
        {view === "close" && <ClosePanel onRestart={() => setView("overview")} />}
      </main>

      <footer className={styles.footer}>
        <span>RUNTIME FINANCIAL AUTHORITY FOR AI AGENTS</span>
        <span className={styles.footerLive}>
          <i /> BASE SEPOLIA · FINALS CONSOLE
        </span>
      </footer>
    </div>
  );
}

function Overview({
  readiness,
  readinessBusy,
  onRefresh,
  onOpen,
}: {
  readiness: JudgeReadiness | null;
  readinessBusy: boolean;
  onRefresh: () => Promise<void>;
  onOpen: (view: View) => void;
}) {
  return (
    <section className={`${styles.panel} ${styles.overview}`}>
      <div className={styles.overviewLead}>
        <p className={styles.kicker}>CERBERUS</p>
        <h1>Runtime Financial Authority<br />for AI Agents</h1>
        <p className={styles.threat}>ASSUME THE AI IS HOSTILE.</p>
      </div>

      <div className={styles.overviewBody}>
        <Readiness readiness={readiness} busy={readinessBusy} onRefresh={onRefresh} />
        <div className={styles.mandateCard}>
          <div>
            <span className={styles.micro}>CURRENT MANDATE</span>
            <strong>agent_treasury_01</strong>
          </div>
          <dl>
            <div><dt>Per transaction</dt><dd>1.00 USDC</dd></div>
            <div><dt>Rolling 24h</dt><dd>3.00 USDC</dd></div>
            <div><dt>Velocity</dt><dd>10 / hour</dd></div>
            <div><dt>Network</dt><dd>Base Sepolia</dd></div>
          </dl>
        </div>
      </div>

      <div className={styles.scenarioGrid}>
        {(Object.keys(SCENARIO_COPY) as JudgeScenario[]).map((scenario) => {
          const copy = SCENARIO_COPY[scenario];
          return (
            <button
              key={scenario}
              type="button"
              className={`${styles.scenarioCard} ${styles[scenario]}`}
              onClick={() => onOpen(scenario)}
            >
              <span className={styles.micro}>{copy.eyebrow}</span>
              <strong>{copy.amount}</strong>
              <span>{copy.counterparty}</span>
              <em>Expected: {copy.expected}</em>
            </button>
          );
        })}
        <button
          type="button"
          className={`${styles.scenarioCard} ${styles.unknown}`}
          onClick={() => onOpen("unknown")}
        >
          <span className={styles.micro}>AMBIGUOUS OUTCOME</span>
          <strong>REAL INCIDENT</strong>
          <span>audit_0aaac796</span>
          <em>UNKNOWN → reconciliation</em>
        </button>
      </div>
    </section>
  );
}

function Readiness({
  readiness,
  busy,
  onRefresh,
}: {
  readiness: JudgeReadiness | null;
  busy: boolean;
  onRefresh: () => Promise<void>;
}) {
  const labels: [keyof JudgeReadiness["checks"], string][] = [
    ["api", "Cerberus API"],
    ["database", "Database / API"],
    ["merchant", "Merchant"],
    ["executor", "Executor"],
    ["reviewer", "Reviewer"],
    ["reconciler", "Reconciler"],
    ["anchor", "Anchor"],
    ["chain", "Base Sepolia"],
  ];
  return (
    <div className={styles.readiness}>
      <div className={styles.sectionHead}>
        <div>
          <span className={styles.micro}>SYSTEM STATUS</span>
          <h2>DEMO READINESS</h2>
        </div>
        <button type="button" onClick={() => void onRefresh()} disabled={busy}>
          {busy ? "CHECKING" : "RECHECK"}
        </button>
      </div>
      <div className={styles.readinessGrid}>
        {labels.map(([key, label]) => {
          const item = readiness?.checks[key];
          const ready = item?.status === "READY";
          return (
            <div key={key} title={item?.detail}>
              <i className={ready ? styles.ready : styles.unavailable} />
              <span>{label}</span>
              <strong>{busy ? "CHECKING" : item?.status ?? "UNAVAILABLE"}</strong>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ScenarioPanel({
  scenario,
  state,
  chain,
  onRun,
  onReview,
  onCaptured,
}: {
  scenario: JudgeScenario;
  state: RunUi;
  chain?: SettlementChainCheck;
  onRun: (scenario: JudgeScenario) => Promise<void>;
  onReview?: (decision: "approved" | "denied") => Promise<void>;
  onCaptured: () => void;
}) {
  const copy = SCENARIO_COPY[scenario];
  const audit = state.audit;
  const outcome = state.run?.outcome;
  const pendingReview =
    scenario === "escalate" &&
    audit?.record.disposition === "ESCALATE" &&
    audit.record.human_review === null &&
    state.mode === "LIVE";
  const captured = state.mode === "CAPTURED";
  const failed = state.mode === "ERROR";
  const unavailable = state.mode === "UNAVAILABLE";
  const completed = state.mode === "COMPLETE";
  const tx = outcome?.settlement?.tx_hash ?? audit?.execution?.settlement_tx ?? null;

  if (captured) return <CapturedScenario scenario={scenario} />;

  return (
    <section className={`${styles.panel} ${styles.scenarioPanel} ${styles[scenario]}`}>
      <div className={styles.scenarioHeading}>
        <div>
          <span className={styles.micro}>LIVE EXECUTION · FIXED FINALS SCENARIO</span>
          <h1>{copy.eyebrow}</h1>
        </div>
        <div className={styles.proposalAmount}>
          <strong>{copy.amount}</strong>
          <span>→ {copy.counterparty}</span>
        </div>
      </div>

      {state.mode === "IDLE" && (
        <div className={styles.runGate}>
          <p>Expected governance disposition</p>
          <strong>{copy.expected}</strong>
          <button type="button" onClick={() => void onRun(scenario)}>
            {copy.run}
          </button>
          <span>Real engine · real mandate · no browser-supplied financial fields</span>
        </div>
      )}

      {(failed || unavailable) && (
        <div className={styles.failureCard}>
          <span className={styles.micro}>PRESENTATION FALLBACK</span>
          <h2>
            {unavailable
              ? "RUN STATE UNAVAILABLE"
              : state.error === "RUN_ALREADY_ACTIVE"
                ? "RUN ALREADY ACTIVE"
                : state.error === "settlement_unknown"
                  ? "LIVE SETTLEMENT UNRESOLVED"
                  : state.error === "settlement_failed"
                    ? "RECONCILIATION PROVED NON-PAYMENT"
                : "LIVE EXECUTION UNAVAILABLE"}
          </h2>
          <p>
            {unavailable
              ? "The runner did not report failure and no new action was launched. Existing audit reads and captured proof remain authoritative."
              : state.error === "settlement_unknown"
                ? "Cerberus is holding capacity because signed authority crossed the executor boundary. No blind retry will be attempted."
                : state.error === "settlement_failed"
                  ? "The keyless reconciler reached positive non-payment evidence. The live run is safe to retry operationally, but Judge Mode will not launch it again."
              : "No raw upstream error was exposed. The verified hardened-run evidence remains available."}
          </p>
          {audit && (
            <p className={styles.auditLine}>
              LAST TRUSTED AUDIT READ · {audit.record.audit_id} · {audit.record.disposition}
            </p>
          )}
          <button type="button" onClick={onCaptured}>VIEW VERIFIED HARDENED RUN</button>
        </div>
      )}

      {(state.mode === "LIVE" || completed) && (
        <>
          <ObservedTimeline
            items={TIMELINES[scenario]}
            observations={state.observations}
            running={state.mode === "LIVE"}
          />

          {pendingReview && onReview && (
            <div className={styles.reviewSurface}>
              <div>
                <span className={styles.micro}>REAL AUTHENTICATED REVIEW FLOW</span>
                <h2>HUMAN APPROVAL REQUIRED</h2>
                <p>Agent cannot approve this request.</p>
              </div>
              <div className={styles.reviewAmount}>
                <strong>0.75 USDC</strong>
                <span>merchant_new</span>
              </div>
              <div className={styles.reviewActions}>
                <button
                  type="button"
                  disabled={state.reviewBusy}
                  onClick={() => void onReview("approved")}
                >
                  APPROVE
                </button>
                <button
                  type="button"
                  disabled={state.reviewBusy}
                  onClick={() => void onReview("denied")}
                >
                  DENY
                </button>
              </div>
            </div>
          )}

          {scenario === "deny" && audit?.record.disposition === "DENY" && (
            <div className={styles.denyResult}>
              <h2>PAYMENT AUTHORITY NEVER EXISTED.</h2>
              <div className={styles.resultColumns}>
                <dl>
                  <div><dt>Proposed</dt><dd>5.00 USDC</dd></div>
                  <div><dt>Per-tx authority</dt><dd>1.00 USDC</dd></div>
                  <div><dt>Rule</dt><dd>{audit.record.rule_triggered ?? "—"}</dd></div>
                </dl>
                <dl>
                  <div><dt>Execution Authorization</dt><dd>{outcome?.authorizationAttempted ? "ATTEMPTED" : "NOT CREATED"}</dd></div>
                  <div><dt>x402</dt><dd>{outcome?.settlementAttempted ? "REACHED" : "NOT REACHED"}</dd></div>
                  <div><dt>Payment</dt><dd>{outcome?.settlementAttempted ? "ATTEMPTED" : "NOT ATTEMPTED"}</dd></div>
                </dl>
              </div>
              <p className={styles.auditLine}>LIVE AUDIT · {audit.record.audit_id}</p>
            </div>
          )}

          {completed && scenario === "escalate" && outcome?.status === "escalation_denied" && (
            <div className={styles.terminalMessage}>
              <span>HUMAN DENIED</span>
              <strong>NO EXECUTION AUTHORITY CREATED</strong>
            </div>
          )}

          {completed && tx && (
            <SettlementResult scenario={scenario} tx={tx} chain={chain} audit={audit} />
          )}
        </>
      )}
    </section>
  );
}

function ObservedTimeline({
  items,
  observations,
  running,
}: {
  items: { key: string; label: string; sub?: string }[];
  observations: string[];
  running: boolean;
}) {
  const visible = items.filter((item) => observations.includes(item.key));
  return (
    <div className={styles.timelineWrap}>
      <div className={styles.timelineLabel}>
        <span className={styles.livePill}>{running ? "LIVE" : "COMPLETE"}</span>
        <span>BACKEND STATES OBSERVED</span>
      </div>
      <div className={styles.timeline}>
        {visible.map((item, index) => (
          <div className={styles.timelineItem} key={item.key}>
            {index > 0 && <span className={styles.arrow}>→</span>}
            <i />
            <div>
              <strong>{item.label}</strong>
              {item.sub && <span>backend: {item.sub}</span>}
            </div>
          </div>
        ))}
        {running && <span className={styles.waiting}>OBSERVING…</span>}
      </div>
    </div>
  );
}

function SettlementResult({
  scenario,
  tx,
  chain,
  audit,
}: {
  scenario: JudgeScenario;
  tx: string;
  chain?: SettlementChainCheck;
  audit: FeedItem | null;
}) {
  const amount = scenario === "allow" ? "0.500000" : "0.750000";
  return (
    <div className={styles.settlementResult}>
      <div className={styles.settlementHero}>
        <span className={styles.livePill}>LIVE · BASE SEPOLIA</span>
        <h2>SETTLED</h2>
        <strong>{amount} USDC</strong>
      </div>
      <dl>
        <div><dt>Receipt</dt><dd>{chain?.receipt ?? "VERIFYING"}</dd></div>
        <div><dt>USDC Transfer</dt><dd>{chain?.transfer?.amount_usdc ?? amount}</dd></div>
        <div><dt>Transaction</dt><dd><a href={baseScanTx(tx)} target="_blank" rel="noreferrer">{short(tx, 14, 10)}</a></dd></div>
        <div><dt>Payer</dt><dd>{short(chain?.transfer?.from ?? JUDGE_EVIDENCE.identities.payer)}</dd></div>
        <div><dt>Payee</dt><dd>{short(chain?.transfer?.to ?? JUDGE_EVIDENCE.identities.payee)}</dd></div>
        <div><dt>Audit</dt><dd>{audit?.record.audit_id ?? "—"}</dd></div>
      </dl>
      <div className={chain?.ok ? styles.chainVerified : styles.chainPending}>
        <i /> {chain?.ok ? "CHAIN VERIFIED LIVE" : "CHAIN VERIFICATION PENDING"}
      </div>
    </div>
  );
}

function CapturedScenario({ scenario }: { scenario: JudgeScenario }) {
  const copy = SCENARIO_COPY[scenario];
  const evidence = JUDGE_EVIDENCE[scenario];
  const settled = "settlementTx" in evidence ? evidence.settlementTx : null;
  return (
    <section className={`${styles.panel} ${styles.capturedPanel} ${styles[scenario]}`}>
      <span className={styles.capturedPill}>VERIFIED CAPTURED RUN · {JUDGE_EVIDENCE.capturedAt}</span>
      <h1>{copy.expected}</h1>
      <p>{copy.amount} → {copy.counterparty}</p>
      {scenario === "deny" ? (
        <h2>PAYMENT AUTHORITY NEVER EXISTED.</h2>
      ) : (
        <h2>REAL BASE SEPOLIA SETTLEMENT</h2>
      )}
      <dl className={styles.capturedDetails}>
        <div><dt>Audit</dt><dd>{evidence.auditId}</dd></div>
        {settled && <div><dt>Transaction</dt><dd><a href={baseScanTx(settled)} target="_blank" rel="noreferrer">{short(settled)}</a></dd></div>}
        <div><dt>Evidence</dt><dd><a href={evidenceLink(evidence.evidencePath)} target="_blank" rel="noreferrer">OPEN AUTHORITATIVE LOG ↗</a></dd></div>
      </dl>
    </section>
  );
}

function UnknownPanel({
  check,
  busy,
  onCheck,
}: {
  check: UnknownChainCheck | null;
  busy: boolean;
  onCheck: () => Promise<void>;
}) {
  const steps = [
    "SIGNED PAYMENT AUTHORITY",
    "AMBIGUOUS NETWORK OUTCOME",
    "OUTCOME_UNKNOWN",
    "CAPACITY HELD",
    "KEYLESS RECONCILER",
    "17 RECONCILIATION ATTEMPTS",
    "AUTHORIZATION EXPIRED UNUSED",
    "FAILED · SAFE TO RETRY",
  ];
  return (
    <section className={`${styles.panel} ${styles.unknownPanel}`}>
      <div className={styles.unknownLead}>
        <span className={styles.capturedPill}>REAL HARDENED-RUN INCIDENT · audit_0aaac796</span>
        <h1>A NETWORK ERROR IS NOT PROOF<br />THAT MONEY DID NOT MOVE.</h1>
        <p>Captured incident evidence + current read-only Base Sepolia verification.</p>
      </div>
      <div className={styles.unknownBody}>
        <div className={styles.incidentTimeline}>
          {steps.map((step, index) => (
            <div key={step}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{step}</strong>
            </div>
          ))}
        </div>
        <div className={styles.chainCheck}>
          <div className={styles.sectionHead}>
            <div>
              <span className={styles.micro}>NO SIGNER · READ-ONLY eth_call</span>
              <h2>LIVE CHAIN CHECK</h2>
            </div>
            <button type="button" onClick={() => void onCheck()} disabled={busy}>
              {busy ? "CHECKING" : "RECHECK"}
            </button>
          </div>
          <dl>
            <div><dt>Authorization consumed?</dt><dd>{busy ? "…" : check ? (check.authorization_consumed ? "YES" : "NO") : "UNAVAILABLE"}</dd></div>
            <div><dt>Validity window expired?</dt><dd>{busy ? "…" : check ? (check.validity_expired ? "YES" : "NO") : "UNAVAILABLE"}</dd></div>
            <div><dt>Settlement transaction</dt><dd>NONE</dd></div>
            <div><dt>Live chain block</dt><dd>{check?.chain_block ?? "—"}</dd></div>
          </dl>
          <div className={check?.ok ? styles.positiveEvidence : styles.chainPending}>
            <strong>{check?.ok ? "POSITIVE NON-PAYMENT EVIDENCE" : "LIVE CHECK UNAVAILABLE"}</strong>
            <span>{check?.ok ? "SAFE TO RETRY" : "CAPTURED INCIDENT REMAINS VERIFIED"}</span>
          </div>
          <div className={styles.evidenceLinks}>
            <a href={evidenceLink(JUDGE_EVIDENCE.unknown.evidencePath)} target="_blank" rel="noreferrer">INCIDENT LOG ↗</a>
            <a href={baseScanTx(JUDGE_EVIDENCE.unknown.anchorTx)} target="_blank" rel="noreferrer">AUDIT ANCHOR ↗</a>
          </div>
        </div>
      </div>
    </section>
  );
}

function ArchitecturePanel() {
  const core = [
    ["HOSTILE AI", "proposal"],
    ["POLICY", "deterministic evaluation"],
    ["CONTROL PLANE", "reserve + authorize"],
    ["ISOLATED EXECUTOR", "payment key"],
    ["x402 / CHAIN", "exact settlement"],
  ];
  return (
    <section className={`${styles.panel} ${styles.architecturePanel}`}>
      <div className={styles.architectureLead}>
        <span className={styles.micro}>AUTHORITY SEPARATION</span>
        <h1>NO SINGLE COMPONENT<br />GETS ALL THE AUTHORITY.</h1>
      </div>
      <div className={styles.architectureDiagram}>
        <div className={styles.coreFlow}>
          {core.map(([name, detail], index) => (
            <div className={styles.archNode} key={name}>
              {index > 0 && <span className={styles.archArrow}>→</span>}
              <div><strong>{name}</strong><span>{detail}</span></div>
            </div>
          ))}
        </div>
        <div className={styles.sideRoles}>
          <div><i /> HUMAN REVIEWER <span>approval authority</span></div>
          <div><i /> KEYLESS RECONCILER <span>read + resolve</span></div>
          <div><i /> INDEPENDENT ANCHOR SIGNER <span>proof authority</span></div>
        </div>
      </div>
    </section>
  );
}

function EvidencePanel({ onClose }: { onClose: () => void }) {
  const metrics = [
    ["384 / 384", "TESTS PASSING", "78 suites · 0 failed"],
    ["24 / 24", "ADVERSARIAL + RED-TEAM CLASSES", "150 assertions"],
    ["2,000", "CONCURRENT SANDBOX ACTIONS", "2 × 1,000 · 0 invariant violations"],
    ["5 / 5", "TERMINAL AUDITS PROVEN ON CHAIN", "independent on-chain anchors"],
  ];
  return (
    <section className={`${styles.panel} ${styles.evidencePanel}`}>
      <div className={styles.evidenceHeading}>
        <div>
          <span className={styles.micro}>REPOSITORY-BACKED EVIDENCE</span>
          <h1>HARDENED. STRESSED. PROVEN.</h1>
        </div>
        <div><strong>2</strong> REAL BASE SEPOLIA USDC SETTLEMENTS<br /><strong>1</strong> REAL AMBIGUOUS-OUTCOME RECOVERY</div>
      </div>
      <div className={styles.metricGrid}>
        {metrics.map(([value, label, detail]) => (
          <div key={label}>
            <strong>{value}</strong>
            <span>{label}</span>
            <em>{detail}</em>
          </div>
        ))}
      </div>
      <div className={styles.proofGrid}>
        <div>
          <span className={styles.micro}>REAL SETTLEMENTS</span>
          {[JUDGE_EVIDENCE.escalate, JUDGE_EVIDENCE.allow].map((item) => (
            <a key={item.auditId} href={baseScanTx(item.settlementTx)} target="_blank" rel="noreferrer">
              <strong>{item.auditId}</strong><span>{short(item.settlementTx, 12, 10)}</span><b>BASESCAN ↗</b>
            </a>
          ))}
          <a href={evidenceLink("08_final/evidence-summary.json")} target="_blank" rel="noreferrer">
            <strong>EVIDENCE PACK</strong><span>authoritative finals summary</span><b>OPEN ↗</b>
          </a>
        </div>
        <div>
          <span className={styles.micro}>ON-CHAIN AUDIT PROOFS</span>
          {JUDGE_EVIDENCE.anchors.map(([audit, tx]) => (
            <a key={audit} href={baseScanTx(tx)} target="_blank" rel="noreferrer">
              <strong>{audit}</strong><span>{short(tx, 10, 8)}</span><b>PROOF ↗</b>
            </a>
          ))}
        </div>
      </div>
      <button type="button" className={styles.closeButton} onClick={onClose}>FINISH PRESENTATION →</button>
    </section>
  );
}

function EmergencyPanel({ onOpen }: { onOpen: (view: View) => void }) {
  const rows: [string, string, View][] = [
    ["DENY", "authority never created", "deny"],
    ["ESCALATE", "human required", "escalate"],
    ["ALLOW", "real settlement", "allow"],
    ["UNKNOWN", "no blind retry", "unknown"],
    ["AUDIT", "5/5 proven on chain", "evidence"],
  ];
  return (
    <section className={`${styles.panel} ${styles.emergencyPanel}`}>
      <span className={styles.micro}>0 · EMERGENCY SUMMARY</span>
      <h1>THE ENTIRE CERBERUS CASE</h1>
      <div>
        {rows.map(([state, meaning, target]) => (
          <button key={state} type="button" onClick={() => onOpen(target)}>
            <strong>{state}</strong><span>{meaning}</span><b>→</b>
          </button>
        ))}
      </div>
    </section>
  );
}

function ClosePanel({ onRestart }: { onRestart: () => void }) {
  return (
    <section className={`${styles.panel} ${styles.closePanel}`}>
      <p>WE ASSUMED THE AI WAS ALREADY COMPROMISED.</p>
      <h1>CERBERUS DOESN&apos;T MAKE<br />THE AI TRUSTWORTHY.</h1>
      <h2>IT MAKES TRUST UNNECESSARY<br />FOR FINANCIAL AUTHORITY.</h2>
      <button type="button" onClick={onRestart}>RETURN TO CONSOLE</button>
    </section>
  );
}

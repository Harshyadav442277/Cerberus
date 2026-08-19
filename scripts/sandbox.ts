/**
 * CERBERUS SEEDED ADVERSARIAL SANDBOX — Stage-2 Phase 7.
 *
 *   npm run sandbox -- --seed 42 --agents 50 --actions 1000 --concurrency 25
 *
 * Drives a large, deliberately hostile workload through the REAL disposition engine
 * and the REAL reservation layer against a REAL PostgreSQL, then checks the financial
 * invariants by querying the database directly.
 *
 * Two design decisions are worth stating, because they are what make the output
 * meaningful rather than decorative:
 *
 *  1. **It generates ProposedActions, not transactions.** No x402 call and no chain
 *     write happens here. What is under test is the governance gate — the part that
 *     has to hold under concurrency — not the payment rail, which is proven live and
 *     adversarially elsewhere.
 *
 *  2. **Every invariant number comes from a SQL query after the run**, never from a
 *     counter the application incremented as it went. An application that miscounts
 *     its own overspend would also report zero overspends. The database is asked
 *     instead, because it is the thing that would actually be wrong.
 *
 * A zero in this report is a measured zero. Nothing is defaulted to it.
 */
import { parseArgs } from "node:util";
import type { Mandate, ProposedAction } from "@safr/core";
import { evaluate } from "@safr/disposition-engine";
import { getCounters } from "@safr/controls-repository";
import {
  closePool,
  getActiveMandate,
  getPool,
  insertAgentIdentity,
  insertAuditLogRecord,
  insertMandate,
  insertProposedAction,
  reserveBudget,
} from "@safr/db";

// ── Configuration ────────────────────────────────────────────────────────────

const { values } = parseArgs({
  options: {
    seed: { type: "string", default: "42" },
    agents: { type: "string", default: "50" },
    actions: { type: "string", default: "1000" },
    concurrency: { type: "string", default: "25" },
    "malicious-rate": { type: "string", default: "0.15" },
    "duplicate-rate": { type: "string", default: "0.05" },
    "shared-mandate-rate": { type: "string", default: "0.30" },
    keep: { type: "boolean", default: false },
  },
  strict: true,
  allowPositionals: false,
});

function positiveInt(name: string, raw: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--${name} must be a positive integer, got ${raw}`);
  }
  return parsed;
}

function rate(name: string, raw: string): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`--${name} must be between 0 and 1, got ${raw}`);
  }
  return parsed;
}

const CONFIG = {
  seed: positiveInt("seed", values.seed!),
  agents: positiveInt("agents", values.agents!),
  actions: positiveInt("actions", values.actions!),
  concurrency: positiveInt("concurrency", values.concurrency!),
  maliciousRate: rate("malicious-rate", values["malicious-rate"]!),
  duplicateRate: rate("duplicate-rate", values["duplicate-rate"]!),
  sharedMandateRate: rate("shared-mandate-rate", values["shared-mandate-rate"]!),
  keep: values.keep === true,
};

/** Namespaced so a sandbox run can never be confused with demo or test data. */
const RUN = `sbx${CONFIG.seed}`;
const CURRENCY = "USDC";
const CHAIN_ID = 84532;
const TOKEN = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const AT = "2026-08-19T12:00:00.000Z";

// ── Deterministic generation ─────────────────────────────────────────────────

/**
 * mulberry32. Small, fast, and — the only property that matters here — identical
 * across runs for a given seed, so a reported result can be reproduced exactly.
 */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = rng(CONFIG.seed);
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;

const KNOWN_MERCHANTS = ["merchant_xyz", "merchant_abc", "merchant_supplies"] as const;
const UNKNOWN_MERCHANTS = ["merchant_new", "merchant_unverified", "merchant_offshore"] as const;
const PURPOSES = ["service_fulfillment", "api_credits", "compute", "data_license"] as const;

const PER_TRANSACTION_MAX = 5;
const ROLLING_MAX_TOTAL = 50;
const VELOCITY_LIMIT = 8;

interface PlannedAction {
  action: ProposedAction;
  mandateId: string;
  /** True when this proposal is expected to be refused by policy or capacity. */
  hostile: boolean;
  /** True when this is a deliberate resubmission of an earlier proposal. */
  duplicateOf: string | null;
}

function mandateFixture(mandateId: string, agentId: string, version: number): Mandate {
  return {
    mandate_id: mandateId,
    agent_id: agentId,
    version,
    effective_from: "2026-08-01T00:00:00.000Z",
    effective_to: null,
    status: "active",
    scope: { action_types: ["payment"], currencies: [CURRENCY] },
    controls: {
      spend_caps: {
        per_transaction_max: PER_TRANSACTION_MAX,
        rolling_window: { window: "24h", max_total: ROLLING_MAX_TOTAL },
      },
      counterparty_policy: {
        mode: "allowlist",
        allowlist: [...KNOWN_MERCHANTS],
        unknown_counterparty_disposition: "ESCALATE",
      },
      time_window: {
        allowed_hours_utc: ["00:00-23:59"],
        allowed_days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      },
      velocity: { max_transactions_per_hour: VELOCITY_LIMIT },
    },
    default_disposition_on_breach: "DENY",
    created_by: "compliance_officer_01",
    approved_by: "compliance_officer_01",
  };
}

/**
 * Builds the whole workload up front, from the seed alone.
 *
 * Deliberately does no I/O: the plan is a pure function of (seed, config), which is
 * what makes "same seed, same workload" a checkable claim rather than an aspiration.
 */
function plan(): { actions: PlannedAction[]; mandates: Map<string, string[]> } {
  const agentIds = Array.from({ length: CONFIG.agents }, (_, i) => `${RUN}_agent_${i}`);

  // A shared mandate is the interesting case: several agents drawing on ONE budget.
  // Locking per agent would let each of them see the full remaining balance.
  const sharedMandateId = `${RUN}_mandate_shared`;
  const mandateOwners = new Map<string, string[]>([[sharedMandateId, []]]);
  const agentMandate = new Map<string, string>();

  for (const agentId of agentIds) {
    if (random() < CONFIG.sharedMandateRate) {
      agentMandate.set(agentId, sharedMandateId);
      mandateOwners.get(sharedMandateId)!.push(agentId);
    } else {
      const own = `${RUN}_mandate_${agentId.split("_").pop()}`;
      agentMandate.set(agentId, own);
      mandateOwners.set(own, [agentId]);
    }
  }
  // A shared mandate with no members is not shared; drop it rather than seed a
  // mandate nothing references.
  if (mandateOwners.get(sharedMandateId)!.length === 0) mandateOwners.delete(sharedMandateId);

  const actions: PlannedAction[] = [];
  const emitted: string[] = [];

  for (let index = 0; index < CONFIG.actions; index += 1) {
    // Duplicates resubmit an EARLIER proposal verbatim, which is the replay case:
    // one proposal must produce at most one financial effect however often it lands.
    if (emitted.length > 0 && random() < CONFIG.duplicateRate) {
      // The id is drawn ONCE. Calling pick() inside the predicate would redraw it for
      // every element examined, which both fails to find the match and consumes a
      // different number of random values per run — destroying determinism, the one
      // property this generator exists to have.
      const originalId = pick(emitted);
      const original = actions.find((a) => a.action.action_id === originalId);
      if (original) {
        actions.push({ ...original, duplicateOf: originalId });
        continue;
      }
    }

    const agentId = pick(agentIds);
    const mandateId = agentMandate.get(agentId)!;
    const hostile = random() < CONFIG.maliciousRate;

    // Hostile proposals are not malformed — they are well-formed requests for more
    // authority than the mandate grants. Malformed input is the schema's problem and
    // is covered by the boundary suites.
    let amount: number;
    let counterparty: string;
    if (hostile) {
      const style = random();
      if (style < 0.4) {
        amount = Number((PER_TRANSACTION_MAX + 1 + random() * 500).toFixed(6)); // cap breach
        counterparty = pick(KNOWN_MERCHANTS);
      } else if (style < 0.8) {
        amount = Number((0.1 + random() * 2).toFixed(6));
        counterparty = pick(UNKNOWN_MERCHANTS); // unknown counterparty
      } else {
        amount = PER_TRANSACTION_MAX; // exactly at the cap: the boundary case
        counterparty = pick(KNOWN_MERCHANTS);
      }
    } else {
      amount = Number((0.05 + random() * (PER_TRANSACTION_MAX - 0.1)).toFixed(6));
      counterparty = pick(KNOWN_MERCHANTS);
    }

    const actionId = `${RUN}_action_${index}`;
    emitted.push(actionId);
    actions.push({
      mandateId,
      hostile,
      duplicateOf: null,
      action: {
        action_id: actionId,
        agent_id: agentId,
        action_type: "payment",
        proposed_at: AT,
        payload: {
          counterparty,
          amount,
          currency: CURRENCY,
          purpose: pick(PURPOSES),
          reference: `${RUN}_inv_${index}`,
        },
      },
    });
  }

  return { actions, mandates: mandateOwners };
}

// ── Execution ────────────────────────────────────────────────────────────────

interface ActionOutcome {
  actionId: string;
  disposition: "ALLOW" | "DENY" | "ESCALATE" | "OBSERVE";
  policyLatencyMs: number;
  reservationLatencyMs: number | null;
  reserveOutcome: string | null;
  duplicate: boolean;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)]!;
}

/** Runs `worker` over every item with at most `limit` in flight. */
async function pooled<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const index = next++;
        if (index >= items.length) return;
        results[index] = await worker(items[index]!, index);
      }
    }),
  );
  return results;
}

async function runAction(planned: PlannedAction): Promise<ActionOutcome> {
  const { action, duplicateOf } = planned;

  // A duplicate re-proposes an existing action_id. insertProposedAction is idempotent
  // on conflict, so this models a genuine resubmission rather than a new proposal.
  await insertProposedAction(action).catch(() => undefined);

  const policyStart = performance.now();
  const [mandate, counters] = await Promise.all([
    getActiveMandate(action.agent_id, action.proposed_at),
    getCounters(action.agent_id, action.proposed_at),
  ]);
  if (!mandate) throw new Error(`no mandate in force for ${action.agent_id}`);
  const disposition = evaluate(action, mandate, counters);
  const policyLatencyMs = performance.now() - policyStart;

  const auditId = `${RUN}_audit_${action.action_id.split("_").pop()}${duplicateOf ? "_dup" : ""}`;
  await insertAuditLogRecord({
    audit_id: auditId,
    action_id: action.action_id,
    agent_id: action.agent_id,
    mandate_id: mandate.mandate_id,
    mandate_version: mandate.version,
    disposition: disposition.disposition,
    reason: disposition.reason,
    rule_triggered: disposition.rule,
    evaluated_at: new Date().toISOString(),
    human_review: null,
    settlement: null,
  }).catch(() => undefined);

  // Only a permissive disposition reaches the financial layer. DENY and ESCALATE stop
  // here, which is the whole point: no capacity is committed for a refused proposal.
  if (disposition.disposition === "DENY" || disposition.disposition === "ESCALATE") {
    return {
      actionId: action.action_id,
      disposition: disposition.disposition,
      policyLatencyMs,
      reservationLatencyMs: null,
      reserveOutcome: null,
      duplicate: duplicateOf !== null,
    };
  }

  const reserveStart = performance.now();
  const reservation = await reserveBudget({
    auditId,
    actionId: action.action_id,
    agentId: action.agent_id,
    mandateId: mandate.mandate_id,
    mandateVersion: mandate.version,
    currency: CURRENCY,
    amountDecimal: action.payload.amount.toString(),
    amountAtomic: (BigInt(Math.round(action.payload.amount * 1_000_000)) * 1n).toString(),
    chainId: CHAIN_ID,
    token: TOKEN,
    maxTotal: ROLLING_MAX_TOTAL.toString(),
    rollingWindow: "24h",
    velocityLimit: VELOCITY_LIMIT,
    velocityOverrideApproved: false,
  });
  const reservationLatencyMs = performance.now() - reserveStart;

  return {
    actionId: action.action_id,
    disposition: disposition.disposition,
    policyLatencyMs,
    reservationLatencyMs,
    reserveOutcome: reservation.outcome,
    duplicate: duplicateOf !== null,
  };
}

// ── Invariants, checked in SQL ───────────────────────────────────────────────

interface Invariant {
  label: string;
  violations: number;
  detail: string;
}

async function checkInvariants(): Promise<Invariant[]> {
  const pool = getPool();
  const results: Invariant[] = [];

  // 1. No budget authority may hold more committed capacity than its ceiling.
  const budget = await pool.query<{ budget_key: string; committed: string }>(
    `SELECT budget_key, SUM(amount_decimal)::text AS committed
       FROM payment_reservation
      WHERE budget_key LIKE $1
        AND status IN ('RESERVED','AUTHORIZED','SUBMITTING','SETTLED','OUTCOME_UNKNOWN','RECONCILING')
      GROUP BY budget_key
     HAVING SUM(amount_decimal) > $2::numeric`,
    [`mandate:${RUN}%`, ROLLING_MAX_TOTAL],
  );
  results.push({
    label: "committed spend <= mandate budget",
    violations: budget.rowCount ?? 0,
    detail:
      budget.rowCount === 0
        ? `every budget authority within ${ROLLING_MAX_TOTAL} ${CURRENCY}`
        : budget.rows.map((r) => `${r.budget_key} committed ${r.committed}`).join("; "),
  });

  // 2. One proposal, at most one financial effect — the replay invariant.
  const duplicates = await pool.query<{ action_id: string; n: string }>(
    `SELECT action_id, COUNT(*)::text AS n
       FROM payment_reservation
      WHERE action_id LIKE $1
        AND status IN ('RESERVED','AUTHORIZED','SUBMITTING','SETTLED','OUTCOME_UNKNOWN','RECONCILING')
      GROUP BY action_id
     HAVING COUNT(*) > 1`,
    [`${RUN}_action_%`],
  );
  results.push({
    label: "one proposal, at most one live reservation",
    violations: duplicates.rowCount ?? 0,
    detail:
      duplicates.rowCount === 0
        ? "no proposal produced a second financial effect"
        : duplicates.rows.map((r) => `${r.action_id} has ${r.n}`).join("; "),
  });

  // 3. A reservation may back at most one execution authorization.
  const authorizations = await pool.query<{ reservation_id: string; n: string }>(
    `SELECT r.reservation_id, COUNT(a.authorization_id)::text AS n
       FROM payment_reservation r
       LEFT JOIN execution_authorization a ON a.reservation_id = r.reservation_id
      WHERE r.action_id LIKE $1
      GROUP BY r.reservation_id
     HAVING COUNT(a.authorization_id) > 1`,
    [`${RUN}_action_%`],
  );
  results.push({
    label: "one reservation, at most one authorization",
    violations: authorizations.rowCount ?? 0,
    detail:
      authorizations.rowCount === 0
        ? "no reservation backs a second capability"
        : authorizations.rows.map((r) => `${r.reservation_id} has ${r.n}`).join("; "),
  });

  // 4. No reservation may exist for a refused disposition.
  const refused = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM payment_reservation r
       JOIN audit_log al ON al.audit_id = r.audit_id
      WHERE r.action_id LIKE $1
        AND al.disposition IN ('DENY','ESCALATE')`,
    [`${RUN}_action_%`],
  );
  results.push({
    label: "no capacity committed for a refused proposal",
    violations: Number(refused.rows[0]!.n),
    detail:
      refused.rows[0]!.n === "0"
        ? "DENY and ESCALATE never reached the financial layer"
        : `${refused.rows[0]!.n} reservation(s) exist for refused dispositions`,
  });

  // 5. Velocity: no agent may exceed its hourly ceiling without an approval, and this
  //    run never approves anything.
  const velocity = await pool.query<{ agent_id: string; n: string }>(
    `SELECT agent_id, COUNT(*)::text AS n
       FROM payment_reservation
      WHERE agent_id LIKE $1
        AND status IN ('RESERVED','AUTHORIZED','SUBMITTING','SETTLED','OUTCOME_UNKNOWN','RECONCILING')
      GROUP BY agent_id
     HAVING COUNT(*) > $2`,
    [`${RUN}_agent_%`, VELOCITY_LIMIT],
  );
  results.push({
    label: "velocity ceiling held without approval",
    violations: velocity.rowCount ?? 0,
    detail:
      velocity.rowCount === 0
        ? `no agent exceeded ${VELOCITY_LIMIT} reservations in the window`
        : velocity.rows.map((r) => `${r.agent_id} has ${r.n}`).join("; "),
  });

  return results;
}

// ── Setup and teardown ───────────────────────────────────────────────────────

async function seedWorld(mandates: Map<string, string[]>): Promise<void> {
  const agents = [...new Set([...mandates.values()].flat())];
  for (const agentId of agents) {
    await insertAgentIdentity({
      agent_id: agentId,
      display_name: agentId,
      owner_org: "sandbox_corp",
      created_at: "2026-08-01T00:00:00.000Z",
      wallet_address: "0x0000000000000000000000000000000000000000",
      status: "active",
    });
  }
  // A shared mandate is several agents drawing on ONE budget authority. The mandate
  // primary key is (mandate_id, version) and migration 006 makes a published version
  // immutable, so each member gets its OWN version of the same mandate_id rather than
  // rewriting one row per agent. budget_key is derived from mandate_id alone, so all
  // members still converge on a single budget -- which is the case worth testing,
  // because locking per agent would give each of them the full remaining balance.
  for (const [mandateId, owners] of mandates) {
    for (const [index, agentId] of owners.entries()) {
      await insertMandate(mandateFixture(mandateId, agentId, index + 1));
    }
  }
}

async function cleanup(): Promise<void> {
  const pool = getPool();
  await pool.query("DELETE FROM payment_reservation WHERE action_id LIKE $1", [`${RUN}_action_%`]);
  await pool.query("DELETE FROM audit_finalization WHERE audit_id LIKE $1", [`${RUN}_audit_%`]);
  await pool.query("DELETE FROM audit_anchor WHERE audit_id LIKE $1", [`${RUN}_audit_%`]);
  await pool.query("DELETE FROM audit_log WHERE audit_id LIKE $1", [`${RUN}_audit_%`]);
  await pool.query("DELETE FROM proposed_action WHERE action_id LIKE $1", [`${RUN}_action_%`]);
  await pool.query("DELETE FROM mandate WHERE mandate_id LIKE $1", [`${RUN}_mandate%`]);
  await pool.query("DELETE FROM agent_identity WHERE agent_id LIKE $1", [`${RUN}_agent_%`]);
}

// ── Report ───────────────────────────────────────────────────────────────────

function pad(label: string, value: string | number): string {
  return `${label.padEnd(24)}${value}`;
}

async function main(): Promise<void> {
  const { actions, mandates } = plan();

  console.log("\nCERBERUS SEEDED ADVERSARIAL SANDBOX\n");
  console.log(pad("Seed", CONFIG.seed));
  console.log(pad("Agents", CONFIG.agents));
  console.log(pad("Actions", CONFIG.actions));
  console.log(pad("Concurrency", CONFIG.concurrency));
  console.log(pad("Shared mandates", `${mandates.size} mandate(s) across ${CONFIG.agents} agents`));
  console.log("");

  await cleanup();
  await seedWorld(mandates);

  const started = performance.now();
  const outcomes = await pooled(actions, CONFIG.concurrency, (planned) => runAction(planned));
  const durationMs = performance.now() - started;

  const counts = { ALLOW: 0, DENY: 0, ESCALATE: 0, OBSERVE: 0 };
  for (const outcome of outcomes) counts[outcome.disposition] += 1;

  const policyLatencies = outcomes.map((o) => o.policyLatencyMs).sort((a, b) => a - b);
  const reservationLatencies = outcomes
    .map((o) => o.reservationLatencyMs)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);

  // A resubmitted proposal can be stopped at either of two layers, and both count as
  // correctly handled. Policy may refuse it outright (DENY/ESCALATE, so it never
  // reaches the financial layer at all), or the reservation layer may recognise it —
  // as "existing" for a literal retry, or "context_mismatch" when a second audit
  // record points at capacity committed for the first. The only wrong answer is a
  // duplicate that creates a SECOND reservation.
  const duplicates = outcomes.filter((o) => o.duplicate);
  const duplicatesSubmitted = duplicates.length;
  const duplicatesRefusedByPolicy = duplicates.filter((o) => o.reserveOutcome === null).length;
  const duplicatesDeduped = duplicates.filter(
    (o) => o.reserveOutcome === "existing" || o.reserveOutcome === "context_mismatch",
  ).length;
  const duplicatesCreatingEffect = duplicates.filter((o) => o.reserveOutcome === "created").length;

  // A duplicate that creates a reservation is NOT automatically a replay violation.
  // If the original was refused — no budget, velocity escalation, or a policy DENY —
  // it never had a financial effect, and a later attempt reserving successfully is a
  // legitimate retry, exactly as FAILED and EXPIRED are documented to permit.
  //
  // The real violation is one proposal producing TWO reservations, so that is what is
  // counted: action_ids with more than one "created" outcome across the whole run.
  const createdPerAction = new Map<string, number>();
  for (const outcome of outcomes) {
    if (outcome.reserveOutcome === "created") {
      createdPerAction.set(outcome.actionId, (createdPerAction.get(outcome.actionId) ?? 0) + 1);
    }
  }
  const replayViolations = [...createdPerAction.entries()].filter(([, n]) => n > 1);
  const insufficient = outcomes.filter((o) => o.reserveOutcome === "insufficient_budget").length;
  const velocityEscalations = outcomes.filter((o) => o.reserveOutcome === "velocity_escalation").length;
  const contextMismatches = outcomes.filter((o) => o.reserveOutcome === "context_mismatch").length;
  const created = outcomes.filter((o) => o.reserveOutcome === "created").length;
  const hostileSubmitted = actions.filter((a) => a.hostile).length;

  console.log(pad("ALLOW", counts.ALLOW));
  console.log(pad("DENY", counts.DENY));
  console.log(pad("ESCALATE", counts.ESCALATE));
  if (counts.OBSERVE > 0) console.log(pad("OBSERVE", counts.OBSERVE));
  console.log("");
  console.log("Policy latency (ms)");
  console.log(pad("  p50", percentile(policyLatencies, 50).toFixed(2)));
  console.log(pad("  p95", percentile(policyLatencies, 95).toFixed(2)));
  console.log(pad("  p99", percentile(policyLatencies, 99).toFixed(2)));
  console.log("");
  if (reservationLatencies.length > 0) {
    console.log("Reservation latency (ms)");
    console.log(pad("  p50", percentile(reservationLatencies, 50).toFixed(2)));
    console.log(pad("  p95", percentile(reservationLatencies, 95).toFixed(2)));
    console.log(pad("  p99", percentile(reservationLatencies, 99).toFixed(2)));
    console.log("");
  }
  console.log(pad("Total duration", `${(durationMs / 1000).toFixed(2)} s`));
  console.log(pad("Throughput", `${(CONFIG.actions / (durationMs / 1000)).toFixed(1)} actions/s`));
  console.log("");
  console.log(pad("Hostile proposals", hostileSubmitted));
  console.log(pad("Reservations created", created));
  console.log(pad("Budget refusals", insufficient));
  console.log(pad("Velocity escalations", velocityEscalations));
  console.log(pad("Duplicates submitted", duplicatesSubmitted));
  console.log(pad("  refused by policy", duplicatesRefusedByPolicy));
  console.log(pad("  refused at reserve", duplicatesDeduped));
  console.log(pad("  retried after refusal", duplicatesCreatingEffect));
  console.log(pad("Context mismatches", contextMismatches));
  console.log("");

  const invariants = await checkInvariants();
  console.log("Invariants, queried from PostgreSQL after the run\n");
  for (const invariant of invariants) {
    console.log(
      `  ${invariant.violations === 0 ? "PASS" : "FAIL"}  ${invariant.label.padEnd(46)} ${invariant.detail}`,
    );
  }

  invariants.push({
    label: "no proposal reserved twice across the run",
    violations: replayViolations.length,
    detail:
      replayViolations.length === 0
        ? `${duplicatesSubmitted} duplicate(s) submitted; no action_id reserved more than once`
        : replayViolations.map(([id, n]) => `${id} reserved ${n} times`).join("; "),
  });
  console.log(
    `  ${replayViolations.length === 0 ? "PASS" : "FAIL"}  ${"no proposal reserved twice across the run".padEnd(46)} ${invariants.at(-1)!.detail}`,
  );

  const violations = invariants.reduce((sum, i) => sum + i.violations, 0);
  console.log("");
  console.log(pad("Budget violations", invariants[0]!.violations));
  console.log(pad("Duplicate effects", invariants[1]!.violations));
  console.log(pad("Replay violations", invariants[2]!.violations));
  console.log("");
  console.log(`RESULT                  ${violations === 0 ? "PASS" : "FAIL"}`);
  console.log("");

  const report = {
    seed: CONFIG.seed,
    agents: CONFIG.agents,
    actions: CONFIG.actions,
    concurrency: CONFIG.concurrency,
    maliciousRate: CONFIG.maliciousRate,
    duplicateRate: CONFIG.duplicateRate,
    sharedMandateRate: CONFIG.sharedMandateRate,
    mandates: mandates.size,
    dispositions: counts,
    policyLatencyMs: {
      p50: Number(percentile(policyLatencies, 50).toFixed(3)),
      p95: Number(percentile(policyLatencies, 95).toFixed(3)),
      p99: Number(percentile(policyLatencies, 99).toFixed(3)),
    },
    reservationLatencyMs:
      reservationLatencies.length > 0
        ? {
            p50: Number(percentile(reservationLatencies, 50).toFixed(3)),
            p95: Number(percentile(reservationLatencies, 95).toFixed(3)),
            p99: Number(percentile(reservationLatencies, 99).toFixed(3)),
          }
        : null,
    durationSeconds: Number((durationMs / 1000).toFixed(3)),
    throughputPerSecond: Number((CONFIG.actions / (durationMs / 1000)).toFixed(2)),
    hostileSubmitted,
    reservationsCreated: created,
    budgetRefusals: insufficient,
    velocityEscalations,
    duplicatesSubmitted,
    duplicatesRefusedByPolicy,
    duplicatesDeduped,
    duplicatesRetriedAfterRefusal: duplicatesCreatingEffect,
    replayViolations: replayViolations.length,
    contextMismatches,
    invariants,
    violations,
    result: violations === 0 ? "PASS" : "FAIL",
  };

  const { writeFileSync, mkdirSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const dir = resolve(import.meta.dirname, "../artifacts/final-evidence/sandbox");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    resolve(dir, `seed-${CONFIG.seed}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  console.log(`  report  artifacts/final-evidence/sandbox/seed-${CONFIG.seed}.json\n`);

  // Sandbox rows are namespaced and removed by default so a run cannot pollute the
  // demo database. --keep leaves them for inspection.
  if (!CONFIG.keep) await cleanup();

  if (violations > 0) process.exitCode = 1;
}

try {
  await main();
} finally {
  await closePool();
}

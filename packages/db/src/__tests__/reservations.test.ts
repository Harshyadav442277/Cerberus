import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { closePool, getPool } from "../pool.js";
import {
  beginSubmission,
  bindAuthorization,
  committedSpend,
  expireStaleReservations,
  getLiveReservationForAudit,
  getReservation,
  markFailed,
  markOutcomeUnknown,
  markSettled,
  reserveBudget,
  windowHours,
  type ReserveBudgetResult,
} from "../reservations.js";
import {
  AT,
  insertMandate,
  mandateFixture,
  race,
  reserveInput,
  resetFixtures,
  seedAgent,
  seedProposal,
} from "./fixtures.js";

/**
 * Phase 2 — atomic budget reservations, tested against a real PostgreSQL.
 *
 * Every concurrency test below runs its competing requests through `race()`, which
 * pre-warms the connection pool and releases all callers from one barrier, so they
 * genuinely overlap inside the database. None of them is a sequential simulation:
 * deleting the advisory lock from reserveBudget makes tests 1, 2 and 3 fail.
 *
 * The invariant under test, for a (mandate, currency) budget authority:
 *
 *     settled + active reserved <= rolling_window.max_total
 */

const RUN_LABEL = "phase2";
let databaseReachable = false;

before(async () => {
  // Fail loudly, not silently: a skipped concurrency suite would be indistinguishable
  // from a passing one, and "we did not test it" must never read as "it is safe".
  await getPool().query("SELECT 1");
  databaseReachable = true;
  await getPool().query("SELECT 1 FROM payment_reservation LIMIT 1");
});

after(async () => {
  if (databaseReachable) await closePool();
});

beforeEach(async () => {
  await resetFixtures();
});

/** How many times a two-way race is repeated before it is trusted. */
const ROUNDS = 10;

/** Every reservation that still holds capacity, for direct invariant assertions. */
async function activeAmounts(mandateId: string): Promise<number> {
  const total = await committedSpend({ mandateId, currency: "USDC", rollingWindow: "24h", at: AT });
  return Number(total);
}

async function committedAt(mandateId: string, at: string): Promise<number> {
  return Number(await committedSpend({ mandateId, currency: "USDC", rollingWindow: "24h", at }));
}

/** Distinct instant per round, so rounds cannot leak capacity into one another. */
function roundInstant(round: number): string {
  return new Date(Date.parse(AT) + round * 1000).toISOString();
}

async function clearReservations(): Promise<void> {
  await getPool().query("DELETE FROM payment_reservation");
}

function created(results: ReserveBudgetResult[]): ReserveBudgetResult[] {
  return results.filter((r) => r.outcome === "created");
}
describe("atomic budget reservations", () => {
  it("parses the mandate rolling window rather than assuming 24h", () => {
    strictEqual(windowHours("24h"), 24);
    strictEqual(windowHours("7d"), 168);
  });

  // ── 1 ─────────────────────────────────────────────────────────────────────────
  it("lets only one of two concurrent 80s reserve against a budget of 100", async () => {
    await seedAgent("agent_a");
    await insertMandate(mandateFixture({ mandateId: "m_1", agentId: "agent_a", maxTotal: 100 }));

    // Repeated rounds, each on a clean budget. A single two-way race is real but
    // timing-dependent: the two transactions do not always overlap, so one round can
    // pass by luck even with no lock at all. Ten rounds removes that luck — verified
    // by deleting the advisory lock and watching this test fail.
    for (let round = 0; round < ROUNDS; round += 1) {
      const a = await seedProposal({ id: `${RUN_LABEL}_a${round}`, agentId: "agent_a", mandateId: "m_1", amount: 80 });
      const b = await seedProposal({ id: `${RUN_LABEL}_b${round}`, agentId: "agent_a", mandateId: "m_1", amount: 80 });
      const at = roundInstant(round);

      const results = await race(2, (i) =>
        reserveBudget(reserveInput(i === 0 ? a : b, 100, { at })),
      );

      strictEqual(created(results).length, 1, `round ${round}: exactly one reservation may win`);
      deepStrictEqual(
        results.map((r) => r.outcome).sort(),
        ["created", "insufficient_budget"],
        "the loser must be refused for budget, not silently duplicated",
      );
      strictEqual(await committedAt("m_1", at), 80, `round ${round}: budget holds`);
      await clearReservations();
    }
  });

  // ── 2 ─────────────────────────────────────────────────────────────────────────
  it("holds the invariant across 20 concurrent requests of 6 against a budget of 100", async () => {
    await seedAgent("agent_a");
    await insertMandate(mandateFixture({ mandateId: "m_2", agentId: "agent_a", maxTotal: 100 }));
    const proposals = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        seedProposal({ id: `${RUN_LABEL}_burst_${i}`, agentId: "agent_a", mandateId: "m_2", amount: 6 }),
      ),
    );

    const results = await race(20, (i) => reserveBudget(reserveInput(proposals[i]!, 100)));

    const wins = created(results).length;
    // 16 x 6 = 96 fits; a 17th would reach 102. The point is the ceiling, not the count.
    strictEqual(wins, 16);
    const committed = await activeAmounts("m_2");
    strictEqual(committed, wins * 6);
    ok(committed <= 100, `committed ${committed} must never exceed the 100 budget`);
  });

  // ── 3 ─────────────────────────────────────────────────────────────────────────
  it("holds one shared budget when two different agents race the same mandate", async () => {
    await seedAgent("agent_a");
    await seedAgent("agent_b");
    // One corporate mandate, two agents operating under it. Locking per agent_id
    // would give each of them a full view of the budget; locking the mandate does not.
    await insertMandate(mandateFixture({ mandateId: "m_shared", agentId: "agent_a", version: 1, maxTotal: 100 }));
    await insertMandate(mandateFixture({ mandateId: "m_shared", agentId: "agent_b", version: 2, maxTotal: 100 }));

    for (let round = 0; round < ROUNDS; round += 1) {
      const a = await seedProposal({ id: `${RUN_LABEL}_sa${round}`, agentId: "agent_a", mandateId: "m_shared", mandateVersion: 1, amount: 60 });
      const b = await seedProposal({ id: `${RUN_LABEL}_sb${round}`, agentId: "agent_b", mandateId: "m_shared", mandateVersion: 2, amount: 60 });
      const at = roundInstant(round);

      const results = await race(2, (i) =>
        reserveBudget(reserveInput(i === 0 ? a : b, 100, { at })),
      );

      strictEqual(
        created(results).length,
        1,
        `round ${round}: two agents sharing a mandate share one budget`,
      );
      strictEqual(await committedAt("m_shared", at), 60);
      await clearReservations();
    }
  });
});

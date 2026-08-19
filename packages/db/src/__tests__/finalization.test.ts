import { ok, strictEqual } from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { closePool, getPool } from "../pool.js";
import {
  beginSubmission,
  bindAuthorization,
  claimReconciliation,
  recordPaymentAttempt,
  reserveBudget,
} from "../reservations.js";
import {
  claimAuditFinalization,
  deferFinalization,
  getAuditFinalization,
  markFinalizationDone,
  terminalizeSettlement,
} from "../finalization.js";
import { getAuditLogRecord } from "../repository.js";
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
 * Remediation 4 — terminal financial state and terminal audit state are one commit.
 *
 * The failure this suite exists to prevent is not a lost payment. It is a system that
 * moved money and cannot say so in its own audit log: reservation SETTLED, audit
 * settlement NULL, because the process that was supposed to write the second half was
 * the untrusted agent and it never came back.
 */

let databaseReachable = false;

before(async () => {
  await getPool().query("SELECT 1");
  databaseReachable = true;
  await getPool().query("SELECT 1 FROM audit_finalization LIMIT 1");
});

after(async () => {
  if (databaseReachable) await closePool();
});

beforeEach(async () => {
  await resetFixtures();
  await getPool().query("TRUNCATE TABLE audit_finalization CASCADE");
});

const CORRELATION = {
  payer: "0x4444444444444444444444444444444444444444",
  payTo: "0x1111111111111111111111111111111111111111",
  nonce: `0x${"77".repeat(32)}`,
  payloadHash: `0x${"88".repeat(32)}`,
  validBefore: "1800000300",
  submissionBlock: "12345678",
};

/** A reservation carried all the way to SUBMITTING with a persisted payment attempt. */
async function submittingReservation(id: string): Promise<{
  reservationId: string;
  auditId: string;
}> {
  await seedAgent("agent_fin");
  await insertMandate(
    mandateFixture({ mandateId: "mandate_fin", agentId: "agent_fin", maxTotal: 100 }),
  );
  const proposal = await seedProposal({
    id,
    agentId: "agent_fin",
    mandateId: "mandate_fin",
    amount: 1,
  });
  const reserved = await reserveBudget(reserveInput(proposal, 100));
  ok(reserved.outcome === "created");
  const reservationId = reserved.reservation.reservation_id;
  // Every transition takes the fixture instant explicitly: these functions default to
  // the real clock, and the fixture's pre-broadcast TTL is long past in wall time.
  ok(await bindAuthorization(reservationId, `auth_${id}`, AT));
  ok(await beginSubmission(reservationId, `auth_${id}`, AT));
  ok(await recordPaymentAttempt(reservationId, CORRELATION, "2026-08-18T12:02:00.000Z", AT));
  return { reservationId, auditId: proposal.auditId };
}

describe("trusted terminal finalization", () => {
  it("commits reservation, audit and anchor request in one transaction", async () => {
    const { reservationId, auditId } = await submittingReservation("fin1");

    const result = await terminalizeSettlement({
      reservationId,
      outcome: "settled",
      settlementTx: "0xproven",
      from: "SUBMITTING",
      at: AT,
    });

    strictEqual(result.won, true);
    strictEqual(result.auditId, auditId);
    strictEqual(result.auditWritten, true);

    const { rows } = await getPool().query<{ status: string; settlement_tx: string }>(
      "SELECT status, settlement_tx FROM payment_reservation WHERE reservation_id = $1",
      [reservationId],
    );
    strictEqual(rows[0]?.status, "SETTLED");
    strictEqual(rows[0]?.settlement_tx, "0xproven");

    const record = await getAuditLogRecord(auditId);
    strictEqual(record?.settlement?.status, "settled");
    strictEqual(record?.settlement?.tx_hash, "0xproven");

    const job = await getAuditFinalization(auditId);
    strictEqual(job?.status, "PENDING", "the anchor request is durable, not fire-and-forget");
  });

  /**
   * Attack D — the process dies the instant after the terminal commit.
   *
   * There is nothing to simulate about the crash itself: the point is that the commit
   * is self-sufficient. Once it returns, no further call from any process — least of
   * all the agent — is required for the record to be consistent and anchorable.
   */
  it("leaves consistent state when the process dies immediately after committing", async () => {
    const { reservationId, auditId } = await submittingReservation("fin2");

    await terminalizeSettlement({
      reservationId,
      outcome: "settled",
      settlementTx: "0xproven",
      from: "SUBMITTING",
      at: AT,
    });
    // ---- process dies here. No agent callback, no anchor call, nothing. ----

    const { rows } = await getPool().query<{ status: string }>(
      "SELECT status FROM payment_reservation WHERE reservation_id = $1",
      [reservationId],
    );
    strictEqual(rows[0]?.status, "SETTLED", "financial truth is terminal");
    const record = await getAuditLogRecord(auditId);
    strictEqual(record?.settlement?.status, "settled", "audit truth is terminal");
    const job = await getAuditFinalization(auditId);
    ok(job !== null, "the finalization job survives the crash");
    strictEqual(job?.status, "PENDING");
  });

  it("refuses a terminal transition from the wrong state and reports the loss", async () => {
    const { reservationId } = await submittingReservation("fin3");
    await terminalizeSettlement({
      reservationId,
      outcome: "settled",
      settlementTx: "0xfirst",
      from: "SUBMITTING",
      at: AT,
    });

    // The row is SETTLED now, so a second SUBMITTING->SETTLED cannot match.
    const second = await terminalizeSettlement({
      reservationId,
      outcome: "settled",
      settlementTx: "0xsecond",
      from: "SUBMITTING",
      at: AT,
    });
    strictEqual(second.won, false, "a lost compare-and-set is reported, never ignored");

    const { rows } = await getPool().query<{ settlement_tx: string }>(
      "SELECT settlement_tx FROM payment_reservation WHERE reservation_id = $1",
      [reservationId],
    );
    strictEqual(rows[0]?.settlement_tx, "0xfirst", "the first terminal truth stands");
  });

  it("fences a reconciliation worker that no longer holds the lease", async () => {
    const { reservationId } = await submittingReservation("fin4");
    await getPool().query(
      "UPDATE payment_reservation SET status = 'OUTCOME_UNKNOWN' WHERE reservation_id = $1",
      [reservationId],
    );
    const claimed = await claimReconciliation({ at: "2026-08-18T12:05:00.000Z" });
    ok(claimed?.reconciliation_token);

    const stale = await terminalizeSettlement({
      reservationId,
      outcome: "settled",
      settlementTx: "0xstale",
      reconciliationToken: "tok_not_mine",
      from: "RECONCILING",
      at: AT,
    });
    strictEqual(stale.won, false, "a stale worker cannot write a terminal result");

    const fresh = await terminalizeSettlement({
      reservationId,
      outcome: "settled",
      settlementTx: "0xproven",
      reconciliationToken: claimed.reconciliation_token,
      from: "RECONCILING",
      at: AT,
    });
    strictEqual(fresh.won, true, "the lease holder still wins");
  });

  /**
   * Attack F — the direct executor and a reconciliation worker both prove settlement.
   *
   * Both are correct: they read the same chain and reach the same conclusion. Exactly
   * one may write it, or the audit log ends up with two contradictory stories about
   * one payment.
   */
  it("produces one terminal truth when executor and reconciler race", async () => {
    const { reservationId, auditId } = await submittingReservation("fin5");

    // Both routes discover the same settled payment at the same instant.
    const results = await race(2, (index) =>
      terminalizeSettlement({
        reservationId,
        outcome: "settled",
        settlementTx: "0xproven",
        from: "SUBMITTING",
        at: new Date(Date.parse(AT) + index).toISOString(),
      }),
    );

    strictEqual(results.filter((r) => r.won).length, 1, "exactly one transition wins");
    strictEqual(results.filter((r) => !r.won).length, 1, "the loser is told it lost");

    const reservations = await getPool().query<{ status: string; settlement_tx: string }>(
      "SELECT status, settlement_tx FROM payment_reservation WHERE reservation_id = $1",
      [reservationId],
    );
    strictEqual(reservations.rowCount, 1, "one reservation");
    strictEqual(reservations.rows[0]?.status, "SETTLED");
    strictEqual(reservations.rows[0]?.settlement_tx, "0xproven", "one transaction hash");

    const record = await getAuditLogRecord(auditId);
    strictEqual(record?.settlement?.status, "settled", "one audit settlement");

    const jobs = await getPool().query(
      "SELECT 1 FROM audit_finalization WHERE audit_id = $1",
      [auditId],
    );
    strictEqual(jobs.rowCount, 1, "one finalization request, not two");
  });

  it("never rewrites an audit settlement that is already terminal", async () => {
    const { reservationId, auditId } = await submittingReservation("fin6");
    // Something already recorded a terminal result for this record.
    await getPool().query(
      `UPDATE audit_log SET settlement = $2::jsonb WHERE audit_id = $1`,
      [
        auditId,
        JSON.stringify({ status: "settled", tx_hash: "0xearlier", rail: "x402", settled_at: AT }),
      ],
    );

    const result = await terminalizeSettlement({
      reservationId,
      outcome: "settled",
      settlementTx: "0xlater",
      from: "SUBMITTING",
      at: AT,
    });
    strictEqual(result.won, true, "the reservation transition still happened");
    strictEqual(result.auditWritten, false, "but the existing audit truth was not overwritten");

    const record = await getAuditLogRecord(auditId);
    strictEqual(record?.settlement?.tx_hash, "0xearlier");
  });
});

/**
 * Attack E — the anchor worker crashes mid-job.
 *
 * The outbox is only useful if a dead worker's work comes back. These assert the
 * lease mechanics that make that automatic rather than a manual recovery step.
 */
describe("audit finalization outbox recovers from worker crashes", () => {
  async function enqueued(id: string): Promise<string> {
    const { auditId } = await submittingReservation(id);
    await terminalizeSettlement({
      reservationId: (
        await getPool().query<{ reservation_id: string }>(
          "SELECT reservation_id FROM payment_reservation WHERE audit_id = $1",
          [auditId],
        )
      ).rows[0]!.reservation_id,
      outcome: "settled",
      settlementTx: "0xproven",
      from: "SUBMITTING",
      at: AT,
    });
    // The outbox stamps next_attempt_at from the database clock. These tests drive a
    // fixed fixture instant, so move the row onto the same timeline rather than
    // making the lease assertions depend on wall time.
    await getPool().query(
      `UPDATE audit_finalization
          SET next_attempt_at = $2::timestamptz, created_at = $2::timestamptz,
              updated_at = $2::timestamptz
        WHERE audit_id = $1`,
      [auditId, AT],
    );
    return auditId;
  }

  it("lets only one of many concurrent workers claim a job", async () => {
    const auditId = await enqueued("fin7");
    const claims = await race(6, () => claimAuditFinalization({ at: AT }));
    const winners = claims.filter((claim) => claim !== null);
    strictEqual(winners.length, 1, "duplicate workers do not both take the same job");
    strictEqual(winners[0]?.audit_id, auditId);
  });

  it("reclaims a crashed worker's job once its lease expires", async () => {
    await enqueued("fin8");
    const first = await claimAuditFinalization({ at: AT, leaseSeconds: 30 });
    ok(first?.lease_token);
    // ---- worker crashes here, holding the lease ----

    const tooSoon = await claimAuditFinalization({ at: "2026-08-18T12:00:10.000Z" });
    strictEqual(tooSoon, null, "a live lease is respected");

    const afterExpiry = await claimAuditFinalization({ at: "2026-08-18T12:01:00.000Z" });
    ok(afterExpiry, "the job is reclaimed once the lease lapses");
    strictEqual(afterExpiry.attempts, 2, "the retry is counted");

    // The crashed worker comes back and tries to report success it no longer owns.
    strictEqual(
      await markFinalizationDone(afterExpiry.audit_id, first.lease_token),
      false,
      "the fencing token stops the stale worker",
    );
    strictEqual(
      await markFinalizationDone(afterExpiry.audit_id, afterExpiry.lease_token!),
      true,
      "the current lease holder completes the job",
    );
  });

  it("returns a deferred job to the queue and completes it on retry", async () => {
    const auditId = await enqueued("fin9");
    const claimed = await claimAuditFinalization({ at: AT });
    ok(claimed?.lease_token);

    strictEqual(
      await deferFinalization(auditId, claimed.lease_token, "2026-08-18T12:00:30.000Z", "rpc down"),
      true,
    );
    const deferred = await getAuditFinalization(auditId);
    strictEqual(deferred?.status, "PENDING");
    strictEqual(deferred?.last_error, "rpc down");

    strictEqual(
      await claimAuditFinalization({ at: "2026-08-18T12:00:20.000Z" }),
      null,
      "the backoff is respected",
    );
    const retried = await claimAuditFinalization({ at: "2026-08-18T12:00:40.000Z" });
    ok(retried, "the job returns once the backoff elapses");
    strictEqual(await markFinalizationDone(auditId, retried.lease_token!), true);
    strictEqual((await getAuditFinalization(auditId))?.status, "DONE");
  });

  it("does not re-claim a completed job", async () => {
    const auditId = await enqueued("fin10");
    const claimed = await claimAuditFinalization({ at: AT });
    ok(claimed?.lease_token);
    await markFinalizationDone(auditId, claimed.lease_token);

    strictEqual(
      await claimAuditFinalization({ at: "2026-08-18T13:00:00.000Z" }),
      null,
      "DONE is terminal",
    );
  });
});

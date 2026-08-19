-- Stage-2 Phase 6.5 — the hostile agent stops owning final audit truth.
--
-- Until now the untrusted agent process could write audit_log.settlement and both
-- insert and update audit_anchor. That is incompatible with "assume the AI is
-- hostile": a compromised agent could claim a payment settled that the trusted
-- payment system never proved, and could manufacture its own final anchor state.
--
-- The replacement is:
--
--     trusted terminal finalizer  (executor / reconciler, in ONE transaction)
--         -> durable audit_finalization outbox
--             -> trusted anchor worker (holds the anchor signer)
--
-- The agent may still ASK for a record to be finalized, because a DENY never
-- reaches the executor and must still be anchored. That request is deliberately
-- non-authoritative: the agent supplies an audit_id and nothing else. The worker
-- re-reads the stored row and computes the digest itself, so the agent cannot
-- choose what gets anchored, cannot mark anything anchored, and cannot write the
-- anchor row at all.

-- ── The outbox ──────────────────────────────────────────────────────────────
CREATE TABLE audit_finalization (
    audit_id          TEXT        PRIMARY KEY REFERENCES audit_log(audit_id) ON DELETE CASCADE,
    status            TEXT        NOT NULL DEFAULT 'PENDING'
                                  CHECK (status IN ('PENDING', 'ANCHORING', 'DONE', 'FAILED')),
    attempts          INTEGER     NOT NULL DEFAULT 0,
    -- Fencing token, exactly as payment_reservation does for reconciliation. A worker
    -- that lost its lease to a lease-expiry reclaim cannot write a stale result.
    lease_token       TEXT,
    lease_expires_at  TIMESTAMPTZ,
    next_attempt_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error        TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The worker's claim query. Partial index because DONE rows are the overwhelming
-- majority once a demo has run and never need to be scanned again.
CREATE INDEX audit_finalization_claimable
    ON audit_finalization (next_attempt_at)
    WHERE status IN ('PENDING', 'ANCHORING');

-- ── Take final settlement authority away from the agent ─────────────────────
REVOKE UPDATE (settlement) ON audit_log FROM cerberus_agent_role;

-- ── Take final anchor authority away from the agent ─────────────────────────
REVOKE INSERT ON audit_anchor FROM cerberus_agent_role;
REVOKE UPDATE ON audit_anchor FROM cerberus_agent_role;

-- The agent keeps SELECT so the dashboard/CLI can still display anchor state.

-- ── The agent's only remaining finalization power: "please anchor this row" ──
-- One column. It cannot set status, record a hash, or mark anything DONE.
GRANT INSERT (audit_id) ON audit_finalization TO cerberus_agent_role;
GRANT SELECT ON audit_finalization TO cerberus_agent_role;

-- ── The trusted terminal finalizer ──────────────────────────────────────────
-- The executor proves settlement on chain, so it — not the agent — writes the
-- terminal audit result, in the same transaction that settles the reservation.
GRANT UPDATE (settlement) ON audit_log TO cerberus_executor_role;
GRANT INSERT (audit_id) ON audit_finalization TO cerberus_executor_role;
GRANT SELECT ON audit_finalization TO cerberus_executor_role;

-- The control plane finalizes records that never reach the executor.
GRANT INSERT (audit_id) ON audit_finalization TO cerberus_control_plane_role;
GRANT SELECT ON audit_finalization TO cerberus_control_plane_role;

-- ── The trusted anchor worker ───────────────────────────────────────────────
-- This is the only role that may author final audit proof. It holds the anchor
-- signer and has no payment authority, no reviewer authority, and no ability to
-- change financial truth: note the complete absence of payment_reservation and
-- execution_authorization below, and that audit_log is SELECT-only.
DO $anchor$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cerberus_anchor_role') THEN
    CREATE ROLE cerberus_anchor_role NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END
$anchor$;

ALTER ROLE cerberus_anchor_role NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM cerberus_anchor_role;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM cerberus_anchor_role;
GRANT USAGE ON SCHEMA public TO cerberus_anchor_role;

GRANT SELECT ON audit_log, audit_anchor, audit_finalization TO cerberus_anchor_role;
GRANT INSERT ON audit_anchor TO cerberus_anchor_role;
GRANT UPDATE (anchor_tx_hash, status, anchored_at, error) ON audit_anchor TO cerberus_anchor_role;
GRANT UPDATE (status, attempts, lease_token, lease_expires_at, next_attempt_at,
              last_error, updated_at)
  ON audit_finalization TO cerberus_anchor_role;

-- ── Reconciler least privilege (Remediation 7) ──────────────────────────────
-- Previously the reconciler login inherited cerberus_executor_role wholesale, which
-- carried execution-authorization consumption it has no business holding. This role
-- grants only what chain reconciliation actually needs.
DO $reconciler$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cerberus_reconciler_role') THEN
    CREATE ROLE cerberus_reconciler_role NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END
$reconciler$;

ALTER ROLE cerberus_reconciler_role NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM cerberus_reconciler_role;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM cerberus_reconciler_role;
GRANT USAGE ON SCHEMA public TO cerberus_reconciler_role;

-- Reads: enough to correlate a payment and prove its chain outcome.
GRANT SELECT ON payment_reservation, audit_log, proposed_action, mandate, agent_identity
  TO cerberus_reconciler_role;

-- Writes: lease claim/fence, defer, chain-proven settle, expired-unused failure.
-- Deliberately NOT granted: authorization_id (it may not bind capabilities) and
-- every column of execution_authorization (it may not consume them).
GRANT UPDATE (status, settlement_tx, reconcile_after, reconciliation_attempts,
              reconciliation_token, reconciliation_error, updated_at)
  ON payment_reservation TO cerberus_reconciler_role;

-- The reconciler is a trusted terminal finalizer, so it writes terminal audit truth
-- and enqueues finalization — but it can never author the anchor itself.
GRANT UPDATE (settlement) ON audit_log TO cerberus_reconciler_role;
GRANT INSERT (audit_id) ON audit_finalization TO cerberus_reconciler_role;
GRANT SELECT ON audit_finalization TO cerberus_reconciler_role;

-- Phase 2 — atomic budget reservations.
--
-- The Bible Section 7 tables stay exactly as they are (Rules R4). Reservations are
-- not a SAFR record: they are execution/financial state, so they live in their own
-- table the way the Phase 5 anchor does.
--
-- Why this table has to exist at all: before it, remaining budget was derived from
-- audit_log rows that had ALREADY settled. Two concurrent proposals therefore both
-- observed the same headroom and both passed the rolling-window check. Capacity has
-- to be committed at decision time, not discovered at settlement time.

CREATE TABLE payment_reservation (
    reservation_id    TEXT           PRIMARY KEY,

    audit_id          TEXT           NOT NULL REFERENCES audit_log (audit_id),
    action_id         TEXT           NOT NULL REFERENCES proposed_action (action_id),
    agent_id          TEXT           NOT NULL REFERENCES agent_identity (agent_id),

    mandate_id        TEXT           NOT NULL,
    mandate_version   INTEGER        NOT NULL,

    -- The SHARED FINANCIAL AUTHORITY this reservation draws down, which is the
    -- mandate rather than the agent. Two agents governed by one corporate mandate
    -- draw on ONE budget, so locking per agent_id would not hold the invariant.
    budget_key        TEXT           NOT NULL,

    -- Policy-layer currency identity ("USDC"), distinct from the execution-layer
    -- (chain_id, token) pair. Capacity is scoped per currency so a future
    -- multi-currency mandate cannot have unrelated denominations summed together.
    currency          TEXT           NOT NULL,

    -- Money is NUMERIC, never float. amount_decimal is the canonical policy amount
    -- the mandate caps are expressed in; amount_atomic is the exact on-chain amount.
    amount_decimal    NUMERIC(38,18) NOT NULL CHECK (amount_decimal > 0),
    amount_atomic     NUMERIC(78,0)  NOT NULL CHECK (amount_atomic > 0),

    chain_id          INTEGER        NOT NULL,
    token             TEXT           NOT NULL,

    -- RESERVED -> AUTHORIZED -> SUBMITTING -> SETTLED | FAILED | OUTCOME_UNKNOWN.
    -- EXPIRED is reachable ONLY from the two pre-broadcast states.
    status            TEXT           NOT NULL CHECK (status IN (
                          'RESERVED', 'AUTHORIZED', 'SUBMITTING',
                          'SETTLED', 'FAILED', 'OUTCOME_UNKNOWN', 'EXPIRED')),

    -- Bound when the one and only Execution Authorization for this reservation is
    -- issued. Durable, so a restarted or second executor process sees it too.
    authorization_id  TEXT,
    settlement_tx     TEXT,

    -- The instant this reservation's spend is attributed to, for the rolling window.
    counts_at         TIMESTAMPTZ    NOT NULL,
    expires_at        TIMESTAMPTZ    NOT NULL,
    created_at        TIMESTAMPTZ    NOT NULL,
    updated_at        TIMESTAMPTZ    NOT NULL,

    CONSTRAINT payment_reservation_ttl CHECK (expires_at > created_at),

    -- Pins the exact mandate version whose limits authorised this capacity.
    FOREIGN KEY (mandate_id, mandate_version) REFERENCES mandate (mandate_id, version)
);

-- The capacity read inside the budget lock.
CREATE INDEX payment_reservation_budget_idx
    ON payment_reservation (budget_key, currency, counts_at DESC);

-- Idempotency, enforced by the database rather than by application sequencing.
-- SETTLED is in the predicate: a proposal that already moved money can never take a
-- second reservation. FAILED and EXPIRED are not: those are positively-known
-- non-payments, so a legitimate retry is allowed to reserve again.
CREATE UNIQUE INDEX payment_reservation_live_action_idx
    ON payment_reservation (action_id)
 WHERE status IN ('RESERVED', 'AUTHORIZED', 'SUBMITTING', 'SETTLED', 'OUTCOME_UNKNOWN');

CREATE UNIQUE INDEX payment_reservation_live_audit_idx
    ON payment_reservation (audit_id)
 WHERE status IN ('RESERVED', 'AUTHORIZED', 'SUBMITTING', 'SETTLED', 'OUTCOME_UNKNOWN');

-- One reservation may back at most one Execution Authorization, ever. This is what
-- stops "same audit -> AUTH A and AUTH B -> both execute".
CREATE UNIQUE INDEX payment_reservation_authorization_idx
    ON payment_reservation (authorization_id)
 WHERE authorization_id IS NOT NULL;

-- Supports the pre-broadcast TTL sweep.
CREATE INDEX payment_reservation_expiry_idx
    ON payment_reservation (status, expires_at);

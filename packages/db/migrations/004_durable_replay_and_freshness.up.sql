-- Phase 3 — durable replay protection and authority freshness.
--
-- Two things move out of process memory and out of unbound JSON, for the same
-- reason: "the application normally calls it correctly" is not a security property.

-- Authorization consumption, durably.
--
-- Phase 1 tracked used authorizations in a Set inside the executor. That survives
-- neither a restart nor a second executor process, so the one-shot guarantee was
-- only ever as strong as one process's uptime. Consumption is now a compare-and-set
-- on a row, which every executor sees.
CREATE TABLE execution_authorization (
    authorization_id  TEXT        PRIMARY KEY,

    reservation_id    TEXT        NOT NULL REFERENCES payment_reservation (reservation_id),
    audit_id          TEXT        NOT NULL REFERENCES audit_log (audit_id),
    action_id         TEXT        NOT NULL REFERENCES proposed_action (action_id),

    -- The exact proposal and authority this capability was minted against.
    proposal_hash     TEXT        NOT NULL,
    mandate_id        TEXT        NOT NULL,
    mandate_version   INTEGER     NOT NULL,

    nonce             TEXT        NOT NULL,
    expires_at        TIMESTAMPTZ NOT NULL,

    status            TEXT        NOT NULL CHECK (status IN ('ISSUED', 'CONSUMED')),
    issued_at         TIMESTAMPTZ NOT NULL,
    consumed_at       TIMESTAMPTZ,

    FOREIGN KEY (mandate_id, mandate_version) REFERENCES mandate (mandate_id, version),
    CONSTRAINT execution_authorization_consumed_shape
        CHECK ((status = 'CONSUMED') = (consumed_at IS NOT NULL))
);

-- A nonce is one-shot across the whole system, not per process.
CREATE UNIQUE INDEX execution_authorization_nonce_idx
    ON execution_authorization (nonce);

-- One reservation backs one authorization, restated here so the constraint holds
-- even if a caller reaches this table without going through the reservation.
CREATE UNIQUE INDEX execution_authorization_reservation_idx
    ON execution_authorization (reservation_id);

CREATE INDEX execution_authorization_audit_idx
    ON execution_authorization (audit_id);

-- Human approval, bound to what was actually approved.
--
-- Bible Section 7.5 freezes human_review as {reviewer_id, decision, decided_at,
-- note}, and Rules R4 forbids adding fields to it. That record stays exactly as it
-- is and remains the auditable statement that a human decided. This table is the
-- separate question of what that decision was *authority to do*: which proposal,
-- under which mandate version, and for how long.
--
-- Without it, a reviewer looking at a page rendered under mandate v17 can click
-- Approve after v18 has revoked the counterparty, and the approval silently applies
-- to authority nobody reviewed.
CREATE TABLE human_approval (
    audit_id          TEXT        PRIMARY KEY REFERENCES audit_log (audit_id),
    action_id         TEXT        NOT NULL REFERENCES proposed_action (action_id),
    agent_id          TEXT        NOT NULL REFERENCES agent_identity (agent_id),

    -- Binds the exact proposal. A payload edited after approval no longer matches.
    proposal_hash     TEXT        NOT NULL,

    -- Binds the exact authority the reviewer was deciding under.
    mandate_id        TEXT        NOT NULL,
    mandate_version   INTEGER     NOT NULL,

    reviewer_id       TEXT        NOT NULL,
    decision          TEXT        NOT NULL CHECK (decision IN ('approved', 'denied')),
    decided_at        TIMESTAMPTZ NOT NULL,

    -- An approval is not permanent. A decision made hours ago is not evidence that
    -- the reviewer would still make it.
    expires_at        TIMESTAMPTZ NOT NULL,

    FOREIGN KEY (mandate_id, mandate_version) REFERENCES mandate (mandate_id, version),
    CONSTRAINT human_approval_ttl CHECK (expires_at > decided_at)
);

CREATE INDEX human_approval_action_idx ON human_approval (action_id);

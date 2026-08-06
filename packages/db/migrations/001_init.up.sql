-- SAFR Runtime — initial schema.
--
-- Mirrors Bible Sections 7.1, 7.2, 7.3 and 7.5 field-for-field. Field names are
-- frozen (Rules.md R4). Nested objects (scope, controls, payload, human_review,
-- settlement) are stored as JSONB so the schema shape is preserved verbatim rather
-- than flattened into columns.

-- Bible Section 7.1 — Agent Identity.
-- Minimal by design: just enough to bind an agent to a mandate. Not ERC-8004.
CREATE TABLE agent_identity (
    agent_id        TEXT        PRIMARY KEY,
    display_name    TEXT        NOT NULL,
    owner_org       TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL,
    wallet_address  TEXT        NOT NULL,
    status          TEXT        NOT NULL CHECK (status IN ('active', 'suspended'))
);

-- Bible Section 7.2 — Mandate (the Controls Repository record).
--
-- Primary key is (mandate_id, version), not mandate_id alone: multiple versions of
-- the same mandate coexist so an audit record can reference exactly which version
-- was active at decision time.
CREATE TABLE mandate (
    mandate_id                     TEXT        NOT NULL,
    agent_id                       TEXT        NOT NULL REFERENCES agent_identity (agent_id),
    version                        INTEGER     NOT NULL CHECK (version > 0),
    effective_from                 TIMESTAMPTZ NOT NULL,
    effective_to                   TIMESTAMPTZ,
    status                         TEXT        NOT NULL CHECK (status IN ('active', 'superseded', 'revoked')),

    -- { action_types: string[], currencies: string[] }
    scope                          JSONB       NOT NULL,
    -- { spend_caps, counterparty_policy, time_window, velocity }
    controls                       JSONB       NOT NULL,

    default_disposition_on_breach  TEXT        NOT NULL
        CHECK (default_disposition_on_breach IN ('ALLOW', 'DENY', 'ESCALATE', 'OBSERVE')),
    created_by                     TEXT        NOT NULL,
    approved_by                    TEXT        NOT NULL,

    PRIMARY KEY (mandate_id, version),
    CONSTRAINT mandate_effective_range CHECK (effective_to IS NULL OR effective_to > effective_from)
);

-- Supports "which mandate version was active for this agent at this instant".
CREATE INDEX mandate_agent_effective_idx
    ON mandate (agent_id, effective_from DESC, version DESC);

-- Bible Section 7.3 — Proposed Action.
CREATE TABLE proposed_action (
    action_id    TEXT        PRIMARY KEY,
    agent_id     TEXT        NOT NULL REFERENCES agent_identity (agent_id),
    action_type  TEXT        NOT NULL,
    proposed_at  TIMESTAMPTZ NOT NULL,
    -- { counterparty, amount, currency, purpose, reference }
    payload      JSONB       NOT NULL
);

-- Supports the velocity check (transactions per hour for an agent).
CREATE INDEX proposed_action_agent_time_idx
    ON proposed_action (agent_id, proposed_at DESC);

-- Bible Section 7.5 — Audit Log record.
--
-- Written for EVERY disposition, including DENY where no payment was ever
-- constructed. The Phase 5 on-chain anchor hash is intentionally not a column here:
-- it is stored alongside the record in a separate table, keeping this schema exactly
-- as the Bible defines it.
CREATE TABLE audit_log (
    audit_id         TEXT        PRIMARY KEY,
    action_id        TEXT        NOT NULL REFERENCES proposed_action (action_id),
    agent_id         TEXT        NOT NULL REFERENCES agent_identity (agent_id),
    mandate_id       TEXT        NOT NULL,
    mandate_version  INTEGER     NOT NULL,
    disposition      TEXT        NOT NULL
        CHECK (disposition IN ('ALLOW', 'DENY', 'ESCALATE', 'OBSERVE')),
    reason           TEXT        NOT NULL,
    -- Null ONLY for the clean ALLOW. Populated on every triggered path.
    rule_triggered   TEXT,
    evaluated_at     TIMESTAMPTZ NOT NULL,
    -- { reviewer_id, decision, decided_at, note }
    human_review     JSONB,
    -- { status, tx_hash, rail, settled_at }
    settlement       JSONB,

    -- Pins the exact mandate version in force at decision time, so a later mandate
    -- edit cannot retroactively change the record of a past decision.
    FOREIGN KEY (mandate_id, mandate_version) REFERENCES mandate (mandate_id, version)
);

-- Supports the dashboard live feed (newest first).
CREATE INDEX audit_log_evaluated_at_idx ON audit_log (evaluated_at DESC);

-- Supports the rolling 24h spend total per agent.
CREATE INDEX audit_log_agent_evaluated_idx ON audit_log (agent_id, evaluated_at DESC);

-- Supports the Escalations queue.
CREATE INDEX audit_log_disposition_idx ON audit_log (disposition);

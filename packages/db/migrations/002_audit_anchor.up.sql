-- Phase 5 — on-chain immutability anchor.
--
-- Architecture 6.1 stores the anchor "alongside the record", so it is a separate
-- table rather than columns on audit_log. That keeps audit_log exactly as Bible
-- Section 7.5 defines it (Rules R4 forbids adding fields to the frozen schemas) and
-- it also reflects reality: anchoring is asynchronous, so a record legitimately
-- exists before its anchor does.
CREATE TABLE audit_anchor (
    audit_id        TEXT        PRIMARY KEY REFERENCES audit_log (audit_id),

    -- keccak256(canonical_json(record)), 0x-prefixed. Recomputing this from the
    -- stored record is what makes tampering detectable.
    record_hash     TEXT        NOT NULL,

    -- Base Sepolia tx hash of the AuditAnchor.anchor() call. Null while pending or
    -- if anchoring failed — a failed anchor must never invalidate the record itself.
    anchor_tx_hash  TEXT,

    status          TEXT        NOT NULL CHECK (status IN ('pending', 'anchored', 'failed')),
    created_at      TIMESTAMPTZ NOT NULL,
    anchored_at     TIMESTAMPTZ,

    -- Why anchoring failed, kept so a broken RPC is diagnosable after the fact
    -- rather than silently invisible.
    error           TEXT
);

-- Supports "which records still need anchoring", for retries and for the dashboard.
CREATE INDEX audit_anchor_status_idx ON audit_anchor (status);

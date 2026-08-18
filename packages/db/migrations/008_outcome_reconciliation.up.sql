-- Stage-2 Phase 5 — durable reconciliation for ambiguous x402 outcomes.
--
-- The exact EVM x402 scheme signs an EIP-3009 transfer authorization. Its payer and
-- bytes32 nonce are queryable through USDC.authorizationState(payer, nonce), so they
-- are the durable bridge between a lost HTTP response and chain state. Correlation is
-- persisted before the paid request may leave the executor.

ALTER TABLE payment_reservation
  DROP CONSTRAINT payment_reservation_status_check;

ALTER TABLE payment_reservation
  ADD CONSTRAINT payment_reservation_status_check CHECK (status IN (
    'RESERVED', 'AUTHORIZED', 'SUBMITTING', 'SETTLED', 'FAILED',
    'OUTCOME_UNKNOWN', 'RECONCILING', 'EXPIRED'
  ));

ALTER TABLE payment_reservation
  ADD COLUMN payment_payer           TEXT,
  ADD COLUMN payment_nonce           TEXT,
  ADD COLUMN payment_payload_hash    TEXT,
  ADD COLUMN payment_valid_before    BIGINT,
  ADD COLUMN submission_block        BIGINT,
  ADD COLUMN reconcile_after         TIMESTAMPTZ,
  ADD COLUMN reconciliation_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN reconciliation_token    TEXT,
  ADD COLUMN reconciliation_error    TEXT;

ALTER TABLE payment_reservation
  ADD CONSTRAINT payment_reservation_correlation_complete CHECK (
    (payment_payer IS NULL AND payment_nonce IS NULL AND payment_payload_hash IS NULL
      AND payment_valid_before IS NULL AND submission_block IS NULL)
    OR
    (payment_payer IS NOT NULL AND payment_nonce IS NOT NULL
      AND payment_payload_hash IS NOT NULL AND payment_valid_before > 0
      AND submission_block >= 0)
  );

DROP INDEX payment_reservation_live_action_idx;
DROP INDEX payment_reservation_live_audit_idx;

CREATE UNIQUE INDEX payment_reservation_live_action_idx
    ON payment_reservation (action_id)
 WHERE status IN (
   'RESERVED', 'AUTHORIZED', 'SUBMITTING', 'SETTLED',
   'OUTCOME_UNKNOWN', 'RECONCILING'
 );

CREATE UNIQUE INDEX payment_reservation_live_audit_idx
    ON payment_reservation (audit_id)
 WHERE status IN (
   'RESERVED', 'AUTHORIZED', 'SUBMITTING', 'SETTLED',
   'OUTCOME_UNKNOWN', 'RECONCILING'
 );

CREATE INDEX payment_reservation_reconcile_idx
    ON payment_reservation (reconcile_after, updated_at)
 WHERE status IN ('SUBMITTING', 'OUTCOME_UNKNOWN', 'RECONCILING');

-- The isolated executor writes correlation and owns reconciliation transitions. The
-- untrusted agent and control plane receive no new authority.
GRANT UPDATE (
  status, settlement_tx, payment_payer, payment_nonce, payment_payload_hash,
  payment_valid_before, submission_block, reconcile_after,
  reconciliation_attempts, reconciliation_token, reconciliation_error, updated_at
) ON payment_reservation TO cerberus_executor_role;

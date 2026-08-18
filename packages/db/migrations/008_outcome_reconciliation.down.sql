UPDATE payment_reservation
   SET status = 'OUTCOME_UNKNOWN'
 WHERE status = 'RECONCILING';

DROP INDEX IF EXISTS payment_reservation_reconcile_idx;
DROP INDEX payment_reservation_live_action_idx;
DROP INDEX payment_reservation_live_audit_idx;

CREATE UNIQUE INDEX payment_reservation_live_action_idx
    ON payment_reservation (action_id)
 WHERE status IN ('RESERVED', 'AUTHORIZED', 'SUBMITTING', 'SETTLED', 'OUTCOME_UNKNOWN');

CREATE UNIQUE INDEX payment_reservation_live_audit_idx
    ON payment_reservation (audit_id)
 WHERE status IN ('RESERVED', 'AUTHORIZED', 'SUBMITTING', 'SETTLED', 'OUTCOME_UNKNOWN');

ALTER TABLE payment_reservation
  DROP CONSTRAINT payment_reservation_correlation_complete,
  DROP COLUMN payment_payer,
  DROP COLUMN payment_nonce,
  DROP COLUMN payment_payload_hash,
  DROP COLUMN payment_valid_before,
  DROP COLUMN submission_block,
  DROP COLUMN reconcile_after,
  DROP COLUMN reconciliation_attempts,
  DROP COLUMN IF EXISTS reconciliation_token,
  DROP COLUMN reconciliation_error;

ALTER TABLE payment_reservation
  DROP CONSTRAINT payment_reservation_status_check;

ALTER TABLE payment_reservation
  ADD CONSTRAINT payment_reservation_status_check CHECK (status IN (
    'RESERVED', 'AUTHORIZED', 'SUBMITTING',
    'SETTLED', 'FAILED', 'OUTCOME_UNKNOWN', 'EXPIRED'
  ));

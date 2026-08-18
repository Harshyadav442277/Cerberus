REVOKE UPDATE (settlement) ON audit_log FROM cerberus_executor_role;

ALTER TABLE payment_reservation
  DROP CONSTRAINT payment_reservation_correlation_complete;

ALTER TABLE payment_reservation
  DROP COLUMN payment_pay_to;

ALTER TABLE payment_reservation
  ADD CONSTRAINT payment_reservation_correlation_complete CHECK (
    (payment_payer IS NULL AND payment_nonce IS NULL AND payment_payload_hash IS NULL
      AND payment_valid_before IS NULL AND submission_block IS NULL)
    OR
    (payment_payer IS NOT NULL AND payment_nonce IS NOT NULL
      AND payment_payload_hash IS NOT NULL AND payment_valid_before > 0
      AND submission_block >= 0)
  );

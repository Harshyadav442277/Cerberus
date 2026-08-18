-- Stage-2 Phase 5 follow-up: persist the exact EIP-3009 recipient and let the
-- keyless executor-role reconciler atomically write terminal audit settlement.

ALTER TABLE payment_reservation
  DROP CONSTRAINT payment_reservation_correlation_complete;

ALTER TABLE payment_reservation
  ADD COLUMN payment_pay_to TEXT;

ALTER TABLE payment_reservation
  ADD CONSTRAINT payment_reservation_correlation_complete CHECK (
    (payment_payer IS NULL AND payment_pay_to IS NULL AND payment_nonce IS NULL
      AND payment_payload_hash IS NULL AND payment_valid_before IS NULL
      AND submission_block IS NULL)
    OR
    (payment_payer IS NOT NULL AND payment_pay_to IS NOT NULL
      AND payment_nonce IS NOT NULL AND payment_payload_hash IS NOT NULL
      AND payment_valid_before > 0 AND submission_block >= 0)
  );

GRANT UPDATE (payment_pay_to) ON payment_reservation TO cerberus_executor_role;
GRANT UPDATE (settlement) ON audit_log TO cerberus_executor_role;

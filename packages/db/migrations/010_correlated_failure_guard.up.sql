-- Stage-2 Phase 5.1 — a signed EIP-3009 authorization remains executable after a
-- merchant reports failure. Correlated payment attempts may release capacity only
-- after the reconciler proves the authorization expired unused.

CREATE OR REPLACE FUNCTION enforce_correlated_failure_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'FAILED'
     AND OLD.payment_nonce IS NOT NULL
     AND (
       OLD.status <> 'RECONCILING'
       OR OLD.reconciliation_token IS NULL
     ) THEN
    RAISE EXCEPTION
      'correlated payment % may fail only from fenced reconciliation',
      OLD.reservation_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER payment_reservation_correlated_failure_guard
BEFORE UPDATE OF status ON payment_reservation
FOR EACH ROW
EXECUTE FUNCTION enforce_correlated_failure_guard();

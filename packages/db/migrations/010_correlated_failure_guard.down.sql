DROP TRIGGER IF EXISTS payment_reservation_correlated_failure_guard
  ON payment_reservation;
DROP FUNCTION IF EXISTS enforce_correlated_failure_guard();

-- Reverses 011. Restores the pre-remediation agent privileges deliberately, so a
-- down-migration is a genuine rollback rather than a half state.

REVOKE ALL PRIVILEGES ON audit_finalization FROM cerberus_agent_role;
REVOKE ALL PRIVILEGES ON audit_finalization FROM cerberus_control_plane_role;
REVOKE ALL PRIVILEGES ON audit_finalization FROM cerberus_executor_role;
REVOKE ALL PRIVILEGES ON audit_finalization FROM cerberus_anchor_role;
REVOKE ALL PRIVILEGES ON audit_finalization FROM cerberus_reconciler_role;

REVOKE UPDATE (settlement) ON audit_log FROM cerberus_executor_role;
REVOKE UPDATE (settlement) ON audit_log FROM cerberus_reconciler_role;

REVOKE ALL PRIVILEGES ON audit_anchor FROM cerberus_anchor_role;
REVOKE ALL PRIVILEGES ON audit_log FROM cerberus_anchor_role;
REVOKE ALL PRIVILEGES ON payment_reservation FROM cerberus_reconciler_role;
REVOKE ALL PRIVILEGES ON audit_log FROM cerberus_reconciler_role;
REVOKE ALL PRIVILEGES ON proposed_action FROM cerberus_reconciler_role;
REVOKE ALL PRIVILEGES ON mandate FROM cerberus_reconciler_role;
REVOKE ALL PRIVILEGES ON agent_identity FROM cerberus_reconciler_role;
REVOKE USAGE ON SCHEMA public FROM cerberus_anchor_role, cerberus_reconciler_role;

DROP INDEX IF EXISTS audit_finalization_claimable;
DROP TABLE IF EXISTS audit_finalization;

-- Restore the Phase 3.5B agent grants.
GRANT UPDATE (settlement) ON audit_log TO cerberus_agent_role;
GRANT INSERT (audit_id, record_hash, status, created_at) ON audit_anchor TO cerberus_agent_role;
GRANT UPDATE (anchor_tx_hash, status, anchored_at, error) ON audit_anchor TO cerberus_agent_role;

-- Roles are dropped last: nothing may still hold a grant when they go.
DROP ROLE IF EXISTS cerberus_anchor_role;
DROP ROLE IF EXISTS cerberus_reconciler_role;

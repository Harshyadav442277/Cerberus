-- Stage-2 Phase 3.5B — database-enforced process privilege separation.
--
-- These are NOLOGIN group roles. Operator-provisioned login roles inherit exactly one
-- of them; application processes receive only their own login URL. No application
-- process receives the schema-owner/migration credential.

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cerberus_agent_role') THEN
    CREATE ROLE cerberus_agent_role NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cerberus_control_plane_role') THEN
    CREATE ROLE cerberus_control_plane_role NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cerberus_executor_role') THEN
    CREATE ROLE cerberus_executor_role NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END
$roles$;

ALTER ROLE cerberus_agent_role NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE cerberus_control_plane_role NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE cerberus_executor_role NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public
  FROM cerberus_agent_role, cerberus_control_plane_role, cerberus_executor_role;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public
  FROM cerberus_agent_role, cerberus_control_plane_role, cerberus_executor_role;

GRANT USAGE ON SCHEMA public
  TO cerberus_agent_role, cerberus_control_plane_role, cerberus_executor_role;

-- Untrusted agent/orchestration process.
GRANT SELECT ON agent_identity, mandate, proposed_action, audit_log, audit_anchor
  TO cerberus_agent_role;
GRANT INSERT ON proposed_action TO cerberus_agent_role;
GRANT INSERT (
  audit_id, action_id, agent_id, mandate_id, mandate_version,
  disposition, reason, rule_triggered, evaluated_at
) ON audit_log TO cerberus_agent_role;
GRANT UPDATE (settlement) ON audit_log TO cerberus_agent_role;
GRANT INSERT (audit_id, record_hash, status, created_at) ON audit_anchor
  TO cerberus_agent_role;
GRANT UPDATE (anchor_tx_hash, status, anchored_at, error) ON audit_anchor
  TO cerberus_agent_role;

-- Trusted authorizer/reviewer control plane.
GRANT SELECT ON
  agent_identity, mandate, proposed_action, audit_log, audit_anchor,
  payment_reservation, execution_authorization, human_approval
  TO cerberus_control_plane_role;
GRANT UPDATE (human_review) ON audit_log TO cerberus_control_plane_role;
GRANT INSERT ON human_approval TO cerberus_control_plane_role;
GRANT INSERT ON payment_reservation TO cerberus_control_plane_role;
GRANT UPDATE (status, authorization_id, updated_at) ON payment_reservation
  TO cerberus_control_plane_role;
GRANT INSERT ON execution_authorization TO cerberus_control_plane_role;

-- Isolated payment executor.
GRANT SELECT ON
  agent_identity, mandate, proposed_action, audit_log,
  payment_reservation, execution_authorization, human_approval
  TO cerberus_executor_role;
GRANT UPDATE (status, consumed_at) ON execution_authorization TO cerberus_executor_role;
GRANT UPDATE (status, settlement_tx, updated_at) ON payment_reservation
  TO cerberus_executor_role;

-- Future tables are private by default. A later migration must grant each new object
-- deliberately to the process roles that actually need it.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC;

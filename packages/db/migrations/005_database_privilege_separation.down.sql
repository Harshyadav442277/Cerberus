DO $memberships$
DECLARE
  membership RECORD;
BEGIN
  FOR membership IN
    SELECT parent.rolname AS parent_name, member.rolname AS member_name
      FROM pg_auth_members m
      JOIN pg_roles parent ON parent.oid = m.roleid
      JOIN pg_roles member ON member.oid = m.member
     WHERE parent.rolname IN (
       'cerberus_agent_role',
       'cerberus_control_plane_role',
       'cerberus_executor_role'
     )
  LOOP
    EXECUTE format('REVOKE %I FROM %I', membership.parent_name, membership.member_name);
  END LOOP;
END
$memberships$;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public
  FROM cerberus_agent_role, cerberus_control_plane_role, cerberus_executor_role;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public
  FROM cerberus_agent_role, cerberus_control_plane_role, cerberus_executor_role;
REVOKE USAGE ON SCHEMA public
  FROM cerberus_agent_role, cerberus_control_plane_role, cerberus_executor_role;

DROP ROLE IF EXISTS cerberus_agent_role;
DROP ROLE IF EXISTS cerberus_control_plane_role;
DROP ROLE IF EXISTS cerberus_executor_role;

-- PostgreSQL's pre-hardening local-development default.
GRANT USAGE, CREATE ON SCHEMA public TO PUBLIC;

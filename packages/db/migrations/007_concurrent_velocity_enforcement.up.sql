-- Stage-2 Phase 3.5D — trusted recording of transaction-time velocity escalation.
--
-- The untrusted agent can insert the evaluator's initial audit fields, but only the
-- control plane performs the serialized reservation check. Give that process the
-- narrow authority needed to strengthen ALLOW/OBSERVE into ESCALATE after a race.

GRANT UPDATE (disposition, reason, rule_triggered) ON audit_log
  TO cerberus_control_plane_role;

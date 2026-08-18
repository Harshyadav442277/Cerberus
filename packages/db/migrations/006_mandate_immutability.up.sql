-- Stage-2 Phase 3.5C — published mandate content is immutable by version.
--
-- Every row is published: the frozen schema has active/superseded/revoked states,
-- but no draft state. Policy edits therefore require a new version. Only the two
-- one-way lifecycle changes needed to close authority remain legal.

CREATE FUNCTION enforce_published_mandate_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.mandate_id                    IS DISTINCT FROM NEW.mandate_id
     OR OLD.version                    IS DISTINCT FROM NEW.version
     OR OLD.agent_id                   IS DISTINCT FROM NEW.agent_id
     OR OLD.effective_from             IS DISTINCT FROM NEW.effective_from
     OR OLD.scope                      IS DISTINCT FROM NEW.scope
     OR OLD.controls                   IS DISTINCT FROM NEW.controls
     OR OLD.default_disposition_on_breach IS DISTINCT FROM NEW.default_disposition_on_breach
     OR OLD.created_by                 IS DISTINCT FROM NEW.created_by
     OR OLD.approved_by                IS DISTINCT FROM NEW.approved_by THEN
    RAISE EXCEPTION 'published mandate %.v% policy content is immutable; publish a new version',
      OLD.mandate_id, OLD.version
      USING ERRCODE = '23514',
            CONSTRAINT = 'mandate_published_content_immutable';
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status
     AND NOT (OLD.status = 'active' AND NEW.status IN ('superseded', 'revoked')) THEN
    RAISE EXCEPTION 'mandate %.v% lifecycle status cannot move from % to %',
      OLD.mandate_id, OLD.version, OLD.status, NEW.status
      USING ERRCODE = '23514',
            CONSTRAINT = 'mandate_lifecycle_monotonic';
  END IF;

  IF OLD.effective_to IS DISTINCT FROM NEW.effective_to
     AND NOT (OLD.effective_to IS NULL AND NEW.effective_to IS NOT NULL) THEN
    RAISE EXCEPTION 'mandate %.v% effective_to can only be set once',
      OLD.mandate_id, OLD.version
      USING ERRCODE = '23514',
            CONSTRAINT = 'mandate_lifecycle_monotonic';
  END IF;

  RETURN NEW;
END
$function$;

CREATE TRIGGER mandate_published_content_immutable
  BEFORE UPDATE ON mandate
  FOR EACH ROW
  EXECUTE FUNCTION enforce_published_mandate_immutability();

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE FUNCTION public.phase_league__cascade_archive()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_mode text;
BEGIN
  v_mode := public.phase_storage_mode();
  IF v_mode = 'phase' THEN
    UPDATE public.league_phases SET archived = NEW.archived
      WHERE season_id = NEW.id AND archived IS DISTINCT FROM NEW.archived;
  ELSIF v_mode IS DISTINCT FROM 'legacy' AND current_user <> 'postgres' THEN
    RAISE EXCEPTION 'phase_storage_not_ready' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.phase_league__cascade_archive() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_league__cascade_archive() TO service_role;

CREATE TRIGGER trg_phase_league_cascade_archive
AFTER UPDATE OF archived ON public.seasons
FOR EACH ROW EXECUTE FUNCTION public.phase_league__cascade_archive();
COMMIT;

-- Teams linked to a COMPLETED match are immutable (lead ruling round 5; spec §7, docs/teambuilder-editor.md).
--
-- A team row linked to a match (teams.match_id) whose status is 'completed' is a public roster (spec §7 visibility):
-- it feeds the world aces, item usage and EPB participation. The API refuses a participant's rewrite or delete with a
-- catalogued 409 (team_match_completed; PATCH/DELETE /api/teams/[id], POST /api/match-prep), and this migration makes
-- the database refuse it too, so no other write path can bypass the rule:
--
-- 1. Trigger teams_completed_match_lock (BEFORE UPDATE OR DELETE ON teams): changing the roster of such a row
--    (pokemon, import_source, name, player_id, tournament_id, season_id) or deleting it raises P0001
--    TEAM_MATCH_COMPLETED, unless the write is an admin correction (2). The match row is read FOR SHARE, so a write
--    racing the match's completion waits for it and then sees 'completed'.
--    Not guarded, on purpose:
--      * metadata that does not change the roster: library publication, share links, locked, updated_at;
--      * match_id: the admin match reset unlinks the rows (cleanMatchChildren) while the match is still completed,
--        and a match delete nulls it through teams_match_id_fkey (ON DELETE SET NULL);
--      * writes made by a referential action or another trigger (pg_trigger_depth() > 1): a player delete cascades
--        to their teams (teams_player_id_fkey ON DELETE CASCADE); the delete route pre-checks the competitive
--        references, and a player with a completed match cannot be deleted anyway (matches keep them NOT NULL);
--      * rows linked to a match in any other status, and rows with no match (planned and personal teams).
-- 2. Admin corrections: team_correct_update and team_correct_delete set the transaction-local flag
--    poketools.team_correction = 'on' and write in the same transaction, so the trigger lets exactly that write
--    through. Only the server calls them, after its live admin guard (the API decides who is an admin; the
--    database cannot). Nothing else sets the flag.
--
-- Deploy order: this migration before the code that calls the two functions (docs/teambuilder-editor.md).
-- RLS unchanged; the functions are revoked from PUBLIC/anon/authenticated and granted to service_role.
BEGIN;

-- 1. The lock ─────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.teams_completed_match_lock() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_status public.match_status;
BEGIN
  IF OLD.match_id IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.pokemon IS NOT DISTINCT FROM OLD.pokemon
     AND NEW.import_source IS NOT DISTINCT FROM OLD.import_source
     AND NEW.name IS NOT DISTINCT FROM OLD.name
     AND NEW.player_id IS NOT DISTINCT FROM OLD.player_id
     AND NEW.tournament_id IS NOT DISTINCT FROM OLD.tournament_id
     AND NEW.season_id IS NOT DISTINCT FROM OLD.season_id THEN
    RETURN NEW;                                                     -- metadata only (library, share, pointer, lock)
  END IF;
  IF pg_trigger_depth() > 1 THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;        -- a referential action or another trigger
  END IF;
  IF current_setting('poketools.team_correction', true) IS NOT DISTINCT FROM 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;        -- an admin correction (team_correct_*)
  END IF;
  SELECT m.status INTO v_status FROM public.matches m WHERE m.id = OLD.match_id FOR SHARE;
  IF v_status = 'completed' THEN
    RAISE EXCEPTION 'TEAM_MATCH_COMPLETED' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('team_id', OLD.id, 'match_id', OLD.match_id)::text;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

DROP TRIGGER IF EXISTS trg_teams_completed_match_lock ON public.teams;
CREATE TRIGGER trg_teams_completed_match_lock
  BEFORE UPDATE OR DELETE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.teams_completed_match_lock();

REVOKE ALL ON FUNCTION public.teams_completed_match_lock() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.teams_completed_match_lock() IS
  'Trigger: a team row linked to a completed match keeps its roster and is not deleted (P0001 TEAM_MATCH_COMPLETED) '
  'unless the write is an admin correction (team_correct_update / team_correct_delete). Lead ruling round 5.';

-- 2. Admin corrections ────────────────────────────────────────────────────────────────────────────────────────────────
-- Rewrites one team's roster. p_name NULL keeps the current name. Returns false when no row has that id.
CREATE OR REPLACE FUNCTION public.team_correct_update(
  p_team_id uuid, p_pokemon jsonb, p_import_source public.team_import_source, p_name text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_n integer;
BEGIN
  IF p_team_id IS NULL OR p_pokemon IS NULL OR jsonb_typeof(p_pokemon) IS DISTINCT FROM 'array'
     OR p_import_source IS NULL THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'pokemon')::text;
  END IF;
  PERFORM set_config('poketools.team_correction', 'on', true);
  UPDATE public.teams
     SET pokemon = p_pokemon, import_source = p_import_source, name = COALESCE(p_name, name)
   WHERE id = p_team_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM set_config('poketools.team_correction', 'off', true);
  RETURN v_n > 0;
END $$;

-- Deletes one team. Returns false when no row has that id.
CREATE OR REPLACE FUNCTION public.team_correct_delete(p_team_id uuid) RETURNS boolean
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_n integer;
BEGIN
  IF p_team_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'team_id')::text;
  END IF;
  PERFORM set_config('poketools.team_correction', 'on', true);
  DELETE FROM public.teams WHERE id = p_team_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM set_config('poketools.team_correction', 'off', true);
  RETURN v_n > 0;
END $$;

REVOKE ALL ON FUNCTION public.team_correct_update(uuid, jsonb, public.team_import_source, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_correct_update(uuid, jsonb, public.team_import_source, text) TO service_role;
COMMENT ON FUNCTION public.team_correct_update(uuid, jsonb, public.team_import_source, text) IS
  'Admin correction: rewrites a team roster even when the team is linked to a completed match. Server-only, called '
  'after the live admin guard. Lead ruling round 5.';

REVOKE ALL ON FUNCTION public.team_correct_delete(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_correct_delete(uuid) TO service_role;
COMMENT ON FUNCTION public.team_correct_delete(uuid) IS
  'Admin correction: deletes a team even when it is linked to a completed match. Server-only, called after the live '
  'admin guard. Lead ruling round 5.';

COMMIT;

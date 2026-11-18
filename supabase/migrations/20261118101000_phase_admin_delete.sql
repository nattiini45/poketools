BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE FUNCTION public.phase_admin_delete(p_season_id uuid, p_phase_id uuid, p_confirm boolean)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_name text;
  v_format_stage_key text;
  v_player_ids uuid[];
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_season_id::text));
  PERFORM 1 FROM public.seasons WHERE id = p_season_id FOR KEY SHARE;
  SELECT name, format_stage_key INTO v_name, v_format_stage_key
    FROM public.league_phases WHERE season_id = p_season_id AND id = p_phase_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PHASE_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF v_format_stage_key IS NOT NULL THEN RAISE EXCEPTION 'format_phase_owned' USING ERRCODE = 'P0001'; END IF;
  IF p_confirm IS DISTINCT FROM true AND EXISTS (
    SELECT 1 FROM public.phase_rounds WHERE phase_id = p_phase_id
  ) THEN RAISE EXCEPTION 'PHASE_DELETE_CONFIRM_REQUIRED' USING ERRCODE = 'P0001'; END IF;
  IF EXISTS (SELECT 1 FROM public.phase_teams WHERE phase_id = p_phase_id) THEN
    RAISE EXCEPTION 'PHASE_DELETE_TEAMS_LINKED' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.league_phases
      WHERE season_id = p_season_id AND id <> p_phase_id
        AND (enrollment_source_phase_id = p_phase_id OR jsonb_path_exists(
          enrollment_source, '$.contributions[*] ? (@.source_phase_id == $source)',
          jsonb_build_object('source', p_phase_id::text)
        ))
  ) THEN RAISE EXCEPTION 'PHASE_DELETE_ENROLLMENT_SOURCE' USING ERRCODE = 'P0001'; END IF;

  SELECT coalesce(array_agg(player_id ORDER BY player_id), '{}') INTO v_player_ids
    FROM (
      SELECT player_id FROM public.phase_participants WHERE phase_id = p_phase_id
      UNION SELECT player_1_id FROM public.phase_matches WHERE phase_id = p_phase_id
      UNION SELECT player_2_id FROM public.phase_matches WHERE phase_id = p_phase_id
    ) players;

  DELETE FROM public.phase_cast_sessions WHERE phase_id = p_phase_id;
  UPDATE public.cast_sessions SET phase_id = NULL, phase_match_id = NULL WHERE phase_id = p_phase_id;
  DELETE FROM public.league_phases WHERE season_id = p_season_id AND id = p_phase_id;
  RETURN jsonb_build_object('name', v_name, 'player_ids', to_jsonb(v_player_ids));
END $$;

REVOKE ALL ON FUNCTION public.phase_admin_delete(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_admin_delete(uuid, uuid, boolean) TO service_role;
COMMIT;

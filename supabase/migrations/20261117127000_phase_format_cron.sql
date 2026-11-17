BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.phase_format_forfeit_complete(
  p_season_id uuid, p_match_id uuid, p_expected_status public.match_status,
  p_player_1_id uuid, p_player_2_id uuid, p_winner_id uuid, p_expected_revision bigint
) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE v_phase uuid; v_rows integer;
BEGIN
  IF p_match_id IS NULL OR p_expected_status IS NULL OR p_player_1_id IS NULL OR p_player_2_id IS NULL
    OR p_winner_id IS NULL OR p_expected_status NOT IN ('scheduled', 'in_progress')
    OR p_winner_id NOT IN (p_player_1_id, p_player_2_id) OR p_player_1_id = p_player_2_id THEN
    RAISE EXCEPTION 'invalid_op' USING ERRCODE = 'P0001', DETAIL = '{"op":"forfeit"}';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_season_id::text));
  PERFORM public.format__assert_season_open(p_season_id);
  PERFORM public.format__check_revision(p_season_id, p_expected_revision);
  IF NOT EXISTS (SELECT 1 FROM public.season_formats f WHERE f.season_id = p_season_id AND f.engine = 'kit') THEN
    RAISE EXCEPTION 'format_context_stale' USING ERRCODE = 'P0001';
  END IF;
  SELECT p.id INTO v_phase FROM public.league_phases p
    JOIN public.phase_matches m ON m.phase_id = p.id
    WHERE m.id = p_match_id AND p.season_id = p_season_id AND p.status = 'active'
    FOR NO KEY UPDATE OF p;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.phase_matches m
    SET status = 'completed', finalized_at = NULL, winner_id = p_winner_id,
      date_played = now(), confirmed_at = now(), auto_confirm_at = NULL
    WHERE m.id = p_match_id AND m.phase_id = v_phase AND m.status = p_expected_status
      AND m.player_1_id = p_player_1_id AND m.player_2_id = p_player_2_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END $$;

REVOKE ALL ON FUNCTION public.phase_format_forfeit_complete(uuid,uuid,public.match_status,uuid,uuid,uuid,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_format_forfeit_complete(uuid,uuid,public.match_status,uuid,uuid,uuid,bigint) TO service_role;
COMMIT;

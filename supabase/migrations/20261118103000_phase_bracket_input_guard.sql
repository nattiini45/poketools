BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE FUNCTION public.phase_bracket_write_guarded(
  p_phase_id uuid, p_expected_status public.phase_status, p_replace boolean, p_rounds jsonb,
  p_matches jsonb, p_current_round integer, p_expected_updated_at timestamptz, p_expected_seeds jsonb,
  p_expected_revision bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_season uuid;
  v_phase public.league_phases%ROWTYPE;
  v_seeds jsonb;
  v_expected_seeds jsonb;
BEGIN
  SELECT season_id INTO v_season FROM public.league_phases WHERE id = p_phase_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(v_season::text));
  PERFORM 1 FROM public.seasons WHERE id = v_season FOR KEY SHARE;
  IF p_expected_revision IS NOT NULL THEN
    PERFORM public.format__check_revision(v_season, p_expected_revision);
  END IF;
  SELECT * INTO v_phase FROM public.league_phases WHERE id = p_phase_id AND season_id = v_season FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_phase.status IS DISTINCT FROM p_expected_status THEN
    RAISE EXCEPTION 'tournament_status_changed' USING ERRCODE = 'P0001';
  END IF;
  IF v_phase.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'phase_bracket_inputs_changed' USING ERRCODE = 'P0001';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.player_id), '[]'::jsonb)
    INTO v_seeds FROM (
      SELECT player_id, seed, starting_bracket FROM public.phase_participants WHERE phase_id = p_phase_id
    ) s;
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.player_id), '[]'::jsonb)
    INTO v_expected_seeds FROM jsonb_to_recordset(p_expected_seeds)
      AS s(player_id uuid, seed integer, starting_bracket text);
  IF v_seeds IS DISTINCT FROM v_expected_seeds THEN
    RAISE EXCEPTION 'phase_bracket_inputs_changed' USING ERRCODE = 'P0001';
  END IF;
  RETURN public.phase_bracket_write(p_phase_id, p_expected_status, p_replace, p_rounds, p_matches, p_current_round);
END $$;

REVOKE ALL ON FUNCTION public.phase_bracket_write_guarded(uuid, public.phase_status, boolean, jsonb, jsonb, integer, timestamptz, jsonb, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_bracket_write_guarded(uuid, public.phase_status, boolean, jsonb, jsonb, integer, timestamptz, jsonb, bigint) TO service_role;
COMMIT;

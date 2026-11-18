BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE FUNCTION public.phase_scouting_claim(
  p_phase_id uuid, p_match_id uuid, p_player_id uuid, p_model_id text,
  p_has_user_team boolean, p_daily_limit integer,
  p_expected_id uuid DEFAULT NULL, p_expected_status text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_match public.phase_matches;
  v_artifact public.phase_match_prep_analyses;
  v_allowance jsonb;
  v_constraint text;
BEGIN
  IF public.phase_storage_mode() IS DISTINCT FROM 'phase' THEN
    RAISE EXCEPTION 'phase_storage_not_ready' USING ERRCODE = 'P0001';
  END IF;
  IF p_player_id IS NULL OR p_daily_limit IS NULL OR
     (p_expected_id IS NOT NULL AND (p_expected_status IS NULL OR p_expected_status NOT IN ('pending', 'completed', 'failed'))) OR
     (p_expected_id IS NULL AND p_expected_status IS NOT NULL) THEN
    RAISE EXCEPTION 'invalid_phase_scouting_claim' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.league_phases WHERE id = p_phase_id FOR KEY SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('kind', 'match_not_found'); END IF;
  SELECT * INTO v_match FROM public.phase_matches
    WHERE id = p_match_id AND phase_id = p_phase_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('kind', 'match_not_found'); END IF;
  IF p_player_id IS DISTINCT FROM v_match.player_1_id AND p_player_id IS DISTINCT FROM v_match.player_2_id THEN
    RETURN jsonb_build_object('kind', 'not_participant');
  END IF;
  PERFORM 1 FROM public.phase_participants WHERE phase_id = p_phase_id AND player_id = p_player_id FOR KEY SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('kind', 'not_participant'); END IF;
  IF v_match.status <> 'scheduled' THEN
    RETURN jsonb_build_object('kind', 'unscheduled', 'status', v_match.status);
  END IF;

  SELECT * INTO v_artifact FROM public.phase_match_prep_analyses
    WHERE match_id = p_match_id AND player_id = p_player_id FOR UPDATE;
  IF v_artifact.id IS DISTINCT FROM p_expected_id OR v_artifact.status IS DISTINCT FROM p_expected_status THEN
    RETURN jsonb_build_object('kind', 'lost');
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_player_id::text, 419006));
  v_allowance := public.check_and_record_ai_generation(p_player_id, 'match-prep-analysis', p_daily_limit);
  IF (v_allowance ->> 'allowed')::boolean IS NOT TRUE THEN
    RETURN jsonb_build_object('kind', 'limited', 'limit', v_allowance -> 'limit');
  END IF;

  IF p_expected_id IS NOT NULL THEN
    DELETE FROM public.phase_match_prep_analyses
      WHERE id = p_expected_id AND match_id = p_match_id AND player_id = p_player_id AND status = p_expected_status;
    IF NOT FOUND THEN RAISE EXCEPTION 'phase_scouting_claim_changed' USING ERRCODE = 'P0001'; END IF;
  END IF;
  INSERT INTO public.phase_match_prep_analyses (match_id, player_id, model_id, has_user_team, status)
    VALUES (p_match_id, p_player_id, p_model_id, p_has_user_team, 'pending') RETURNING * INTO v_artifact;
  RETURN jsonb_build_object('kind', 'claimed', 'artifact', to_jsonb(v_artifact));
EXCEPTION WHEN unique_violation THEN
  GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
  IF v_constraint = 'phase_match_prep_analyses_match_id_player_id_key' THEN
    RETURN jsonb_build_object('kind', 'lost');
  END IF;
  RAISE;
END $$;

REVOKE ALL ON FUNCTION public.phase_scouting_claim(uuid, uuid, uuid, text, boolean, integer, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_scouting_claim(uuid, uuid, uuid, text, boolean, integer, uuid, text) TO service_role;

COMMIT;

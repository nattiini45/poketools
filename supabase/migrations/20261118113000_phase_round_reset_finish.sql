BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE FUNCTION public.phase_round_reset_finish(
  p_season_id uuid, p_phase_id uuid, p_round_id uuid, p_expected_updated_at timestamptz,
  p_expected_status public.round_status, p_downstream_ids uuid[]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_archived boolean;
  v_round public.phase_rounds;
  v_match_ids uuid[];
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_season_id::text));
  PERFORM 1 FROM public.seasons WHERE id = p_season_id FOR KEY SHARE;
  SELECT archived INTO v_archived FROM public.league_phases
    WHERE id = p_phase_id AND season_id = p_season_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PHASE_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF public.phase_storage_mode() IS DISTINCT FROM 'phase' THEN
    RAISE EXCEPTION 'phase_storage_not_ready' USING ERRCODE = 'P0001';
  END IF;
  IF v_archived THEN RAISE EXCEPTION 'phase_round_reset_archived' USING ERRCODE = 'P0001'; END IF;

  SELECT * INTO v_round FROM public.phase_rounds
    WHERE id = p_round_id AND phase_id = p_phase_id FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'round_not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_round.updated_at IS DISTINCT FROM p_expected_updated_at OR v_round.status IS DISTINCT FROM p_expected_status THEN
    RAISE EXCEPTION 'round_status_changed' USING ERRCODE = 'P0001';
  END IF;

  SELECT ARRAY(
    SELECT id FROM public.phase_matches
    WHERE phase_id = p_phase_id AND (round_id = p_round_id OR id = ANY(p_downstream_ids))
    ORDER BY id FOR UPDATE NOWAIT
  ) INTO v_match_ids;
  IF EXISTS (
    SELECT 1 FROM public.phase_matches WHERE id = ANY(v_match_ids) AND (
      status <> 'scheduled' OR winner_id IS NOT NULL OR submitter_id IS NOT NULL OR date_played IS NOT NULL
      OR auto_confirm_at IS NOT NULL OR confirmed_at IS NOT NULL OR finalized_at IS NOT NULL
    )
  ) OR EXISTS (SELECT 1 FROM public.phase_games WHERE match_id = ANY(v_match_ids))
    OR EXISTS (SELECT 1 FROM public.phase_match_outcomes WHERE match_id = ANY(v_match_ids))
    OR EXISTS (SELECT 1 FROM public.phase_rating_history WHERE match_id = ANY(v_match_ids)) THEN
    RAISE EXCEPTION 'phase_round_reset_games_remaining' USING ERRCODE = 'P0001';
  END IF;

  IF v_round.status <> 'pending' THEN
    UPDATE public.phase_rounds SET status = 'pending'
      WHERE id = p_round_id AND phase_id = p_phase_id AND status = p_expected_status
      RETURNING * INTO STRICT v_round;
  END IF;
  RETURN jsonb_build_object('round', to_jsonb(v_round));
END $$;

REVOKE ALL ON FUNCTION public.phase_round_reset_finish(uuid, uuid, uuid, timestamptz, public.round_status, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_round_reset_finish(uuid, uuid, uuid, timestamptz, public.round_status, uuid[]) TO service_role;
COMMIT;

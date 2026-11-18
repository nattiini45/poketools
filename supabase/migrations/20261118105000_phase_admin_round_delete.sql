BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE FUNCTION public.phase_admin_round_delete(
  p_season_id uuid, p_phase_id uuid, p_round_id uuid, p_expected_updated_at timestamptz, p_confirm boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_phase public.league_phases;
  v_round public.phase_rounds;
  v_match_ids uuid[];
  v_current_round integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_season_id::text));
  PERFORM 1 FROM public.seasons WHERE id = p_season_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'season_not_found' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO v_phase FROM public.league_phases
    WHERE id = p_phase_id AND season_id = p_season_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PHASE_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF public.phase_storage_mode() IS DISTINCT FROM 'phase' THEN
    RAISE EXCEPTION 'phase_storage_not_ready' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_round FROM public.phase_rounds
    WHERE id = p_round_id AND phase_id = p_phase_id FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'round_not_found' USING ERRCODE = 'P0001'; END IF;
  IF p_confirm IS DISTINCT FROM true THEN RAISE EXCEPTION 'phase_round_delete_confirm_required' USING ERRCODE = 'P0001'; END IF;
  IF v_round.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'phase_round_delete_changed' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.phase_rounds WHERE phase_id = p_phase_id AND bracket_side IS NOT NULL) THEN
    RAISE EXCEPTION 'STRUCTURE_ELIM_ROUND_DELETE' USING ERRCODE = 'P0001';
  END IF;
  IF v_phase.format_stage_key IS NOT NULL OR v_phase.stage_spec IS NOT NULL
    OR v_phase.archived OR v_phase.status = 'completed' OR v_round.status = 'completed' THEN
    RAISE EXCEPTION 'phase_round_delete_locked' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.phase_rounds WHERE phase_id = p_phase_id AND round_number > v_round.round_number)
    OR EXISTS (
      SELECT 1 FROM public.league_phases
        WHERE season_id = p_season_id AND id <> p_phase_id
          AND (enrollment_source_phase_id = p_phase_id OR jsonb_path_exists(
            enrollment_source, '$.contributions[*] ? (@.source_phase_id == $source)',
            jsonb_build_object('source', p_phase_id::text)
          ))
    ) THEN
    RAISE EXCEPTION 'phase_round_delete_dependent' USING ERRCODE = 'P0001';
  END IF;

  SELECT ARRAY(
    SELECT id FROM public.phase_matches WHERE phase_id = p_phase_id AND round_id = p_round_id
      ORDER BY id FOR UPDATE NOWAIT
  ) INTO v_match_ids;

  IF EXISTS (
    SELECT 1 FROM public.phase_matches WHERE id = ANY(v_match_ids) AND (
      status <> 'scheduled' OR winner_id IS NOT NULL OR submitter_id IS NOT NULL OR date_played IS NOT NULL
      OR auto_confirm_at IS NOT NULL OR confirmed_at IS NOT NULL OR finalized_at IS NOT NULL
    )
  ) OR EXISTS (SELECT 1 FROM public.phase_games WHERE match_id = ANY(v_match_ids))
    OR EXISTS (SELECT 1 FROM public.phase_match_outcomes WHERE match_id = ANY(v_match_ids))
    OR EXISTS (SELECT 1 FROM public.phase_aggregate_jobs WHERE match_id = ANY(v_match_ids))
    OR EXISTS (SELECT 1 FROM public.phase_rating_history WHERE match_id = ANY(v_match_ids))
    OR EXISTS (SELECT 1 FROM public.player_streaks WHERE last_phase_match_id = ANY(v_match_ids)) THEN
    RAISE EXCEPTION 'phase_round_delete_results' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM public.phase_teams WHERE match_id = ANY(v_match_ids))
    OR EXISTS (SELECT 1 FROM public.teams WHERE phase_match_id = ANY(v_match_ids))
    OR EXISTS (SELECT 1 FROM public.phase_match_prep_teams WHERE match_id = ANY(v_match_ids)) THEN
    RAISE EXCEPTION 'phase_round_delete_teams' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.phase_matches WHERE id = ANY(v_match_ids)
      AND (notes <> '' OR scheduled_at IS NOT NULL OR social_image_url IS NOT NULL
        OR bracket_side IS NOT NULL OR bracket_pos IS NOT NULL)
  ) OR EXISTS (SELECT 1 FROM public.phase_reports WHERE phase_id = p_phase_id AND round_id = p_round_id)
    OR EXISTS (SELECT 1 FROM public.phase_match_proposals WHERE match_id = ANY(v_match_ids))
    OR EXISTS (SELECT 1 FROM public.phase_match_analyses WHERE match_id = ANY(v_match_ids))
    OR EXISTS (SELECT 1 FROM public.phase_match_prep_analyses WHERE match_id = ANY(v_match_ids))
    OR EXISTS (SELECT 1 FROM public.phase_match_evolution_snapshots WHERE match_id = ANY(v_match_ids))
    OR EXISTS (SELECT 1 FROM public.phase_epb_animation_views WHERE match_id = ANY(v_match_ids))
    OR EXISTS (SELECT 1 FROM public.phase_broadcast_moments WHERE match_id = ANY(v_match_ids))
    OR EXISTS (SELECT 1 FROM public.phase_cast_sessions WHERE match_id = ANY(v_match_ids))
    OR EXISTS (SELECT 1 FROM public.cast_sessions WHERE phase_match_id = ANY(v_match_ids))
    OR EXISTS (SELECT 1 FROM public.agent_suggestions WHERE phase_match_id = ANY(v_match_ids))
    OR EXISTS (
      SELECT 1 FROM public.format_challenges
        WHERE phase_match_id = ANY(v_match_ids) OR (league_phase_id = p_phase_id AND round = v_round.round_number)
    ) THEN
    RAISE EXCEPTION 'phase_round_delete_linked' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.phase_rounds WHERE id = p_round_id AND phase_id = p_phase_id;
  SELECT coalesce(max(round_number), 0) INTO v_current_round FROM public.phase_rounds
    WHERE phase_id = p_phase_id AND round_number <= v_phase.current_round;
  UPDATE public.league_phases SET current_round = v_current_round
    WHERE id = p_phase_id AND season_id = p_season_id AND current_round IS DISTINCT FROM v_current_round;
  RETURN jsonb_build_object('name', v_round.name, 'round_number', v_round.round_number, 'matches', cardinality(v_match_ids));
END $$;

REVOKE ALL ON FUNCTION public.phase_admin_round_delete(uuid, uuid, uuid, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_admin_round_delete(uuid, uuid, uuid, timestamptz, boolean) TO service_role;
COMMIT;

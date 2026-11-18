BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE FUNCTION public.phase_bracket_repair(
  p_season_id uuid, p_phase_id uuid, p_expected_updated_at timestamptz,
  p_expected_seeds jsonb, p_expected_rounds jsonb, p_expected_matches jsonb, p_slots jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_phase public.league_phases;
  v_slot record;
  v_actual jsonb;
  v_expected jsonb;
  v_created integer := 0;
  v_updated integer := 0;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_season_id::text));
  PERFORM 1 FROM public.seasons WHERE id = p_season_id FOR KEY SHARE;
  SELECT * INTO v_phase FROM public.league_phases WHERE id = p_phase_id AND season_id = p_season_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PHASE_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF public.phase_storage_mode() IS DISTINCT FROM 'phase' THEN
    RAISE EXCEPTION 'phase_storage_not_ready' USING ERRCODE = 'P0001';
  END IF;
  IF v_phase.archived OR v_phase.status = 'completed' OR v_phase.bracket_type NOT IN ('single_elim', 'double_elim')
    OR v_phase.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'phase_bracket_repair_changed' USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1 FROM public.phase_rounds WHERE phase_id = p_phase_id ORDER BY id FOR SHARE NOWAIT;
  PERFORM 1 FROM public.phase_matches WHERE phase_id = p_phase_id ORDER BY id FOR UPDATE NOWAIT;
  PERFORM 1 FROM public.phase_participants p JOIN public.players pl ON pl.id = p.player_id
    WHERE p.phase_id = p_phase_id ORDER BY pl.id FOR SHARE OF pl NOWAIT;

  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.player_id), '[]'::jsonb) INTO v_actual FROM (
    SELECT p.player_id, pl.name, p.seed, p.starting_bracket FROM public.phase_participants p
    JOIN public.players pl ON pl.id = p.player_id WHERE p.phase_id = p_phase_id
  ) s;
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.player_id), '[]'::jsonb) INTO v_expected
    FROM jsonb_to_recordset(p_expected_seeds) s(player_id uuid, name text, seed integer, starting_bracket text);
  IF v_actual IS DISTINCT FROM v_expected THEN RAISE EXCEPTION 'phase_bracket_repair_changed' USING ERRCODE = 'P0001'; END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id), '[]'::jsonb) INTO v_actual FROM (
    SELECT id, round_number, bracket_side, status FROM public.phase_rounds WHERE phase_id = p_phase_id
  ) r;
  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id), '[]'::jsonb) INTO v_expected
    FROM jsonb_to_recordset(p_expected_rounds) r(id uuid, round_number integer, bracket_side text, status public.round_status);
  IF v_actual IS DISTINCT FROM v_expected THEN RAISE EXCEPTION 'phase_bracket_repair_changed' USING ERRCODE = 'P0001'; END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.id), '[]'::jsonb) INTO v_actual FROM (
    SELECT m.id, m.updated_at, EXISTS (SELECT 1 FROM public.phase_games g WHERE g.match_id = m.id) AS has_games
    FROM public.phase_matches m WHERE phase_id = p_phase_id
  ) m;
  SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.id), '[]'::jsonb) INTO v_expected
    FROM jsonb_to_recordset(p_expected_matches) m(id uuid, updated_at timestamptz, has_games boolean);
  IF v_actual IS DISTINCT FROM v_expected THEN RAISE EXCEPTION 'phase_bracket_repair_changed' USING ERRCODE = 'P0001'; END IF;

  FOR v_slot IN SELECT * FROM jsonb_to_recordset(p_slots)
    s(match_id uuid, round_id uuid, bracket_side text, bracket_pos integer, player_1_id uuid, player_2_id uuid) LOOP
    IF v_slot.bracket_side IS NULL OR v_slot.bracket_pos IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM public.phase_rounds WHERE id = v_slot.round_id AND phase_id = p_phase_id
          AND status <> 'completed' AND bracket_side = v_slot.bracket_side
      ) OR v_slot.player_1_id = v_slot.player_2_id
      OR (SELECT count(*) FROM public.phase_participants WHERE phase_id = p_phase_id
        AND player_id IN (v_slot.player_1_id, v_slot.player_2_id)) <> 2 THEN
      RAISE EXCEPTION 'phase_bracket_repair_changed' USING ERRCODE = 'P0001';
    END IF;
    IF v_slot.match_id IS NULL THEN
      INSERT INTO public.phase_matches (phase_id, round_id, bracket_side, bracket_pos, player_1_id, player_2_id)
      VALUES (p_phase_id, v_slot.round_id, v_slot.bracket_side, v_slot.bracket_pos, v_slot.player_1_id, v_slot.player_2_id)
      ON CONFLICT (round_id, bracket_side, bracket_pos) WHERE bracket_pos IS NOT NULL DO NOTHING;
      IF NOT FOUND THEN RAISE EXCEPTION 'phase_bracket_repair_changed' USING ERRCODE = 'P0001'; END IF;
      v_created := v_created + 1;
    ELSE
      IF EXISTS (
        SELECT 1 FROM public.phase_matches WHERE id = v_slot.match_id AND (
          notes <> '' OR scheduled_at IS NOT NULL OR social_image_url IS NOT NULL OR winner_id IS NOT NULL
          OR submitter_id IS NOT NULL OR date_played IS NOT NULL OR auto_confirm_at IS NOT NULL
          OR confirmed_at IS NOT NULL OR finalized_at IS NOT NULL
        )
      ) OR EXISTS (SELECT 1 FROM public.phase_teams WHERE match_id = v_slot.match_id)
        OR EXISTS (SELECT 1 FROM public.teams WHERE phase_match_id = v_slot.match_id)
        OR EXISTS (SELECT 1 FROM public.phase_match_prep_teams WHERE match_id = v_slot.match_id)
        OR EXISTS (SELECT 1 FROM public.phase_match_proposals WHERE match_id = v_slot.match_id)
        OR EXISTS (SELECT 1 FROM public.phase_match_analyses WHERE match_id = v_slot.match_id)
        OR EXISTS (SELECT 1 FROM public.phase_match_prep_analyses WHERE match_id = v_slot.match_id)
        OR EXISTS (SELECT 1 FROM public.phase_match_evolution_snapshots WHERE match_id = v_slot.match_id)
        OR EXISTS (SELECT 1 FROM public.phase_match_outcomes WHERE match_id = v_slot.match_id)
        OR EXISTS (SELECT 1 FROM public.phase_aggregate_jobs WHERE match_id = v_slot.match_id)
        OR EXISTS (SELECT 1 FROM public.phase_rating_history WHERE match_id = v_slot.match_id)
        OR EXISTS (SELECT 1 FROM public.player_streaks WHERE last_phase_match_id = v_slot.match_id)
        OR EXISTS (SELECT 1 FROM public.phase_epb_animation_views WHERE match_id = v_slot.match_id)
        OR EXISTS (SELECT 1 FROM public.phase_broadcast_moments WHERE match_id = v_slot.match_id)
        OR EXISTS (SELECT 1 FROM public.phase_cast_sessions WHERE match_id = v_slot.match_id)
        OR EXISTS (SELECT 1 FROM public.cast_sessions WHERE phase_match_id = v_slot.match_id)
        OR EXISTS (SELECT 1 FROM public.agent_suggestions WHERE phase_match_id = v_slot.match_id)
        OR EXISTS (SELECT 1 FROM public.format_challenges WHERE phase_match_id = v_slot.match_id) THEN
        RAISE EXCEPTION 'phase_bracket_repair_linked' USING ERRCODE = 'P0001';
      END IF;
      UPDATE public.phase_matches
        SET player_1_id = v_slot.player_1_id, player_2_id = v_slot.player_2_id
        WHERE id = v_slot.match_id AND phase_id = p_phase_id AND round_id = v_slot.round_id
          AND bracket_side = v_slot.bracket_side AND bracket_pos = v_slot.bracket_pos AND status = 'scheduled'
          AND NOT EXISTS (SELECT 1 FROM public.phase_games WHERE match_id = v_slot.match_id);
      IF NOT FOUND THEN RAISE EXCEPTION 'phase_bracket_repair_changed' USING ERRCODE = 'P0001'; END IF;
      v_updated := v_updated + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('slots_materialized', v_created, 'slots_updated', v_updated);
END $$;

REVOKE ALL ON FUNCTION public.phase_bracket_repair(uuid, uuid, timestamptz, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_bracket_repair(uuid, uuid, timestamptz, jsonb, jsonb, jsonb, jsonb) TO service_role;
COMMIT;

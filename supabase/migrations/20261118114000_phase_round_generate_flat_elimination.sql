BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.phase_round_generate(
  p_season_id uuid, p_phase_id uuid, p_round_id uuid, p_name text, p_round_number integer, p_best_of integer,
  p_bye_player_ids uuid[], p_matches jsonb, p_deadline timestamptz, p_expected_updated_at timestamptz,
  p_inputs jsonb, p_replacement_groups jsonb DEFAULT NULL, p_expected_revision bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_phase public.league_phases%ROWTYPE;
  v_round public.phase_rounds%ROWTYPE;
  v_group jsonb;
  v_group_id uuid;
  v_result jsonb;
  v_current jsonb;
  v_flat_elimination boolean;
  v_previous public.phase_rounds%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_season_id::text));
  SELECT jsonb_build_object('start_date', start_date, 'format_type', format_type)
    INTO v_current FROM public.seasons WHERE id = p_season_id FOR SHARE;
  IF v_current IS DISTINCT FROM p_inputs -> 'season' THEN RAISE EXCEPTION 'phase_round_inputs_changed' USING ERRCODE = 'P0001'; END IF;
  IF p_expected_revision IS NOT NULL THEN
    PERFORM public.format__check_revision(p_season_id, p_expected_revision);
  END IF;
  SELECT * INTO v_phase FROM public.league_phases WHERE id = p_phase_id AND season_id = p_season_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001'; END IF;
  IF public.phase_storage_mode() IS DISTINCT FROM 'phase' THEN
    RAISE EXCEPTION 'phase_storage_not_ready' USING ERRCODE = 'P0001';
  END IF;
  IF v_phase.status = 'completed' THEN RAISE EXCEPTION 'rounds_phase_completed' USING ERRCODE = 'P0001'; END IF;
  v_flat_elimination := v_phase.bracket_type IN ('single_elim', 'double_elim');
  IF v_phase.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'phase_round_inputs_changed' USING ERRCODE = 'P0001';
  END IF;
  IF v_flat_elimination AND v_phase.archived THEN
    RAISE EXCEPTION 'phase_bracket_archived' USING ERRCODE = 'P0001';
  END IF;
  v_current := jsonb_build_object(
    'status', v_phase.status, 'current_round', v_phase.current_round, 'bracket_type', v_phase.bracket_type,
    'stage_spec', v_phase.stage_spec, 'name', v_phase.name, 'bo_overrides', v_phase.bo_overrides, 'best_of_default', v_phase.best_of_default
  );
  IF v_current IS DISTINCT FROM p_inputs -> 'phase' THEN RAISE EXCEPTION 'phase_round_inputs_changed' USING ERRCODE = 'P0001'; END IF;

  PERFORM 1 FROM public.phase_rounds WHERE phase_id = p_phase_id ORDER BY id FOR SHARE NOWAIT;
  PERFORM 1 FROM public.phase_matches WHERE phase_id = p_phase_id ORDER BY id FOR SHARE NOWAIT;
  PERFORM 1 FROM public.phase_groups WHERE phase_id = p_phase_id ORDER BY id FOR SHARE NOWAIT;
  PERFORM 1 FROM public.season_groups WHERE season_id = p_season_id ORDER BY id FOR SHARE NOWAIT;
  PERFORM 1 FROM public.phase_participants p JOIN public.players pl ON pl.id = p.player_id
    WHERE p.phase_id = p_phase_id ORDER BY pl.id FOR SHARE OF pl NOWAIT;

  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id), '[]'::jsonb) INTO v_current FROM (
    SELECT id, round_number, status, bye_player_ids, pairings_generated, bracket_side
    FROM public.phase_rounds WHERE phase_id = p_phase_id
  ) r;
  IF v_current IS DISTINCT FROM p_inputs -> 'rounds' THEN RAISE EXCEPTION 'phase_round_inputs_changed' USING ERRCODE = 'P0001'; END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.id), '[]'::jsonb) INTO v_current FROM (
    SELECT id, round_id, status, winner_id, player_1_id, player_2_id FROM public.phase_matches WHERE phase_id = p_phase_id
  ) m;
  IF v_current IS DISTINCT FROM p_inputs -> 'matches' THEN RAISE EXCEPTION 'phase_round_inputs_changed' USING ERRCODE = 'P0001'; END IF;

  IF v_flat_elimination THEN
    IF EXISTS (SELECT 1 FROM public.phase_rounds WHERE phase_id = p_phase_id AND bracket_side IS NOT NULL)
      OR EXISTS (SELECT 1 FROM public.phase_matches WHERE phase_id = p_phase_id AND (bracket_side IS NOT NULL OR bracket_pos IS NOT NULL)) THEN
      RAISE EXCEPTION 'BRACKET_V2_MANAGED' USING ERRCODE = 'P0001';
    END IF;
    SELECT * INTO v_previous FROM public.phase_rounds
      WHERE phase_id = p_phase_id AND round_number = v_phase.current_round;
    IF NOT FOUND OR v_phase.current_round < 1 OR v_previous.status <> 'completed'
      OR p_round_number IS DISTINCT FROM v_phase.current_round + 1
      OR EXISTS (
        SELECT 1 FROM public.phase_matches m JOIN public.phase_rounds r ON (r.phase_id, r.id) = (m.phase_id, m.round_id)
        WHERE r.phase_id = p_phase_id AND r.round_number <= v_phase.current_round AND m.status <> 'completed'
      )
      OR p_replacement_groups IS NOT NULL OR p_bye_player_ids IS DISTINCT FROM '{}'::uuid[] THEN
      RAISE EXCEPTION 'phase_round_inputs_changed' USING ERRCODE = 'P0001';
    END IF;
    IF p_round_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.phase_rounds
      WHERE phase_id = p_phase_id AND id = p_round_id AND round_number = p_round_number) THEN
      RAISE EXCEPTION 'phase_round_inputs_changed' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT coalesce(jsonb_agg(CASE WHEN v_flat_elimination THEN to_jsonb(p) ELSE to_jsonb(p) - 'starting_bracket' END ORDER BY p.id), '[]'::jsonb) INTO v_current FROM (
    SELECT pl.id, pl.name, p.seed, p.starting_bracket FROM public.phase_participants p JOIN public.players pl ON pl.id = p.player_id
    WHERE p.phase_id = p_phase_id
  ) p;
  IF v_current IS DISTINCT FROM p_inputs -> 'participants' THEN RAISE EXCEPTION 'phase_round_inputs_changed' USING ERRCODE = 'P0001'; END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY g.group_number), '[]'::jsonb) INTO v_current FROM (
    SELECT g.id, g.name, g.group_number, g.season_group_id,
      coalesce((SELECT jsonb_agg(jsonb_build_object('player_id', m.player_id, 'seed', m.seed) ORDER BY m.seed, m.player_id)
                FROM public.phase_group_members m WHERE m.group_id = g.id), '[]'::jsonb) AS members
    FROM public.phase_groups g WHERE g.phase_id = p_phase_id
  ) g;
  IF v_current IS DISTINCT FROM p_inputs -> 'groups' THEN RAISE EXCEPTION 'PHASE_GROUPS_STALE' USING ERRCODE = 'P0001'; END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY g.sort_order), '[]'::jsonb) INTO v_current FROM (
    SELECT g.id, g.name, g.sort_order,
      coalesce((SELECT jsonb_agg(m.player_id ORDER BY m.player_id)
                FROM public.season_group_members m WHERE m.group_id = g.id), '[]'::jsonb) AS player_ids
    FROM public.season_groups g WHERE g.season_id = p_season_id
  ) g;
  IF v_current IS DISTINCT FROM p_inputs -> 'league_groups' THEN RAISE EXCEPTION 'PHASE_GROUPS_STALE' USING ERRCODE = 'P0001'; END IF;

  IF p_replacement_groups IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.phase_rounds WHERE phase_id = p_phase_id) THEN
      RAISE EXCEPTION 'PHASE_GROUPS_STALE' USING ERRCODE = 'P0001';
    END IF;
    DELETE FROM public.phase_groups WHERE phase_id = p_phase_id;
    FOR v_group IN SELECT value FROM jsonb_array_elements(p_replacement_groups) LOOP
      INSERT INTO public.phase_groups (phase_id, season_id, name, group_number, season_group_id)
        VALUES (p_phase_id, p_season_id, v_group ->> 'name', (v_group ->> 'group_number')::integer,
                (v_group ->> 'season_group_id')::uuid) RETURNING id INTO v_group_id;
      INSERT INTO public.phase_group_members (phase_id, group_id, player_id, seed)
        SELECT p_phase_id, v_group_id, m.player_id, m.seed
        FROM jsonb_to_recordset(v_group -> 'members') AS m(player_id uuid, seed integer);
    END LOOP;
  END IF;

  v_result := public.phase_round_write(p_phase_id, p_round_id, p_name, p_round_number, p_best_of,
                                      p_bye_player_ids, p_matches, p_expected_revision);
  IF p_round_id IS NOT NULL OR p_deadline IS NOT NULL THEN
    UPDATE public.phase_rounds
      SET pairings_generated = true, deadline = coalesce(deadline, p_deadline)
      WHERE id = (v_result -> 'round' ->> 'id')::uuid AND phase_id = p_phase_id
      RETURNING * INTO STRICT v_round;
    v_result := jsonb_set(v_result, '{round}', to_jsonb(v_round));
  END IF;
  RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.phase_round_generate(uuid, uuid, uuid, text, integer, integer, uuid[], jsonb, timestamptz, timestamptz, jsonb, jsonb, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_round_generate(uuid, uuid, uuid, text, integer, integer, uuid[], jsonb, timestamptz, timestamptz, jsonb, jsonb, bigint) TO service_role;
COMMIT;

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.phase_participants_replace(p_phase_id uuid, p_entries jsonb) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array' THEN
    RAISE EXCEPTION 'invalid_entries' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.phase__lock(p_phase_id);
  IF EXISTS (SELECT 1 FROM public.phase_rounds WHERE phase_id = p_phase_id)
     AND EXISTS (
       SELECT 1 FROM public.phase_group_members m WHERE m.phase_id = p_phase_id
       AND NOT EXISTS (
         SELECT 1 FROM jsonb_to_recordset(p_entries) AS e(player_id uuid) WHERE e.player_id = m.player_id
       )
     ) THEN
    RAISE EXCEPTION 'PHASE_GROUP_ROSTER_SCHEDULED' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.league_phases WHERE id = p_phase_id AND bracket_type IN ('single_elim', 'double_elim'))
     AND EXISTS (SELECT 1 FROM public.phase_rounds WHERE phase_id = p_phase_id)
     AND (
       EXISTS (
         SELECT player_id FROM public.phase_participants WHERE phase_id = p_phase_id
         EXCEPT
         SELECT player_id FROM jsonb_to_recordset(p_entries) AS e(player_id uuid)
       ) OR EXISTS (
         SELECT player_id FROM jsonb_to_recordset(p_entries) AS e(player_id uuid)
         EXCEPT
         SELECT player_id FROM public.phase_participants WHERE phase_id = p_phase_id
       )
     ) THEN
    RAISE EXCEPTION 'PHASE_ELIMINATION_ROSTER_LOCKED' USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public.phase_participants p WHERE p.phase_id = p_phase_id
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_entries) AS e(player_id uuid) WHERE e.player_id = p.player_id
    );
  UPDATE public.phase_participants SET seed = NULL WHERE phase_id = p_phase_id AND seed IS NOT NULL;
  INSERT INTO public.phase_participants (phase_id, player_id, seed)
    SELECT p_phase_id, e.player_id, e.seed FROM jsonb_to_recordset(p_entries) AS e(player_id uuid, seed integer)
    ON CONFLICT (phase_id, player_id) DO UPDATE SET seed = EXCLUDED.seed;
END $$;

CREATE OR REPLACE FUNCTION public.phase_participant_edit(p_phase_id uuid, p_player_id uuid, p_add boolean) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF p_add IS NULL THEN RAISE EXCEPTION 'invalid_op' USING ERRCODE = 'P0001'; END IF;
  PERFORM public.phase__lock(p_phase_id);
  IF NOT p_add
     AND EXISTS (SELECT 1 FROM public.phase_rounds WHERE phase_id = p_phase_id)
     AND EXISTS (SELECT 1 FROM public.phase_group_members WHERE phase_id = p_phase_id AND player_id = p_player_id) THEN
    RAISE EXCEPTION 'PHASE_GROUP_ROSTER_SCHEDULED' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.league_phases WHERE id = p_phase_id AND bracket_type IN ('single_elim', 'double_elim'))
     AND EXISTS (SELECT 1 FROM public.phase_rounds WHERE phase_id = p_phase_id) THEN
    RAISE EXCEPTION 'PHASE_ELIMINATION_ROSTER_LOCKED' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.phase_enrollment_freeze(p_phase_id);
  IF p_add THEN
    INSERT INTO public.phase_participants (phase_id, player_id) VALUES (p_phase_id, p_player_id);
  ELSE
    DELETE FROM public.phase_participants WHERE phase_id = p_phase_id AND player_id = p_player_id;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.phase_admin_replace_groups(
  p_season_id uuid, p_phase_id uuid, p_groups jsonb, p_expected_seeds jsonb
) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_group jsonb;
  v_group_id uuid;
  v_group_number integer := 0;
  v_seeds jsonb;
  v_expected_seeds jsonb;
BEGIN
  IF jsonb_typeof(p_groups) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid_entries' USING ERRCODE = 'P0001'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_season_id::text));
  PERFORM 1 FROM public.seasons WHERE id = p_season_id FOR KEY SHARE;
  PERFORM 1 FROM public.league_phases WHERE id = p_phase_id AND season_id = p_season_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PHASE_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF EXISTS (SELECT 1 FROM public.season_groups WHERE season_id = p_season_id) THEN
    RAISE EXCEPTION 'PHASE_GROUPS_LEAGUE_MANAGED' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.phase_rounds WHERE phase_id = p_phase_id) THEN
    RAISE EXCEPTION 'PHASE_GROUPS_ROUNDS_EXIST' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_array_length(p_groups) > 0 THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('player_id', player_id, 'seed', seed) ORDER BY player_id), '[]'::jsonb)
      INTO v_seeds FROM public.phase_participants WHERE phase_id = p_phase_id AND seed IS NOT NULL;
    SELECT coalesce(jsonb_agg(jsonb_build_object('player_id', player_id, 'seed', seed) ORDER BY player_id), '[]'::jsonb)
      INTO v_expected_seeds FROM jsonb_to_recordset(p_expected_seeds) AS e(player_id uuid, seed integer);
    IF v_seeds IS DISTINCT FROM v_expected_seeds THEN RAISE EXCEPTION 'GROUP_SLOT_CHANGED' USING ERRCODE = 'P0001'; END IF;
    IF jsonb_array_length(v_seeds) < jsonb_array_length(p_groups) THEN
      RAISE EXCEPTION 'PHASE_GROUPS_INSUFFICIENT_SEEDS' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  DELETE FROM public.phase_groups WHERE phase_id = p_phase_id;
  FOR v_group IN SELECT value FROM jsonb_array_elements(p_groups) LOOP
    v_group_number := v_group_number + 1;
    INSERT INTO public.phase_groups (phase_id, season_id, name, group_number)
      VALUES (p_phase_id, p_season_id, v_group ->> 'name', v_group_number) RETURNING id INTO v_group_id;
    INSERT INTO public.phase_group_members (phase_id, group_id, player_id, seed)
      SELECT p_phase_id, v_group_id, m.player_id::uuid, m.seed::integer
      FROM jsonb_array_elements_text(v_group -> 'members') WITH ORDINALITY AS m(player_id, seed);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.phase_group_member_move(
  p_phase_id uuid, p_from_group uuid, p_to_group uuid, p_player_id uuid, p_seed integer
) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_season_id uuid;
BEGIN
  v_season_id := public.phase__lock(p_phase_id);
  IF EXISTS (SELECT 1 FROM public.season_groups WHERE season_id = v_season_id) THEN
    RAISE EXCEPTION 'PHASE_GROUPS_LEAGUE_MANAGED' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.phase_rounds WHERE phase_id = p_phase_id) THEN
    RAISE EXCEPTION 'PHASE_GROUPS_ROUNDS_EXIST' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.phase_group_members SET group_id = p_to_group, seed = p_seed
    WHERE phase_id = p_phase_id AND group_id = p_from_group AND player_id = p_player_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'GROUP_SLOT_CHANGED' USING ERRCODE = 'P0001'; END IF;
END $$;

REVOKE ALL ON FUNCTION public.phase_participants_replace(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_participants_replace(uuid, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.phase_participant_edit(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_participant_edit(uuid, uuid, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.phase_admin_replace_groups(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_admin_replace_groups(uuid, uuid, jsonb, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.phase_group_member_move(uuid, uuid, uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_group_member_move(uuid, uuid, uuid, uuid, integer) TO service_role;

COMMIT;

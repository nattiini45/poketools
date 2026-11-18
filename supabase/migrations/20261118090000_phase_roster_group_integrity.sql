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
  DELETE FROM public.phase_participants p WHERE p.phase_id = p_phase_id
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_entries) AS e(player_id uuid) WHERE e.player_id = p.player_id
    );
  UPDATE public.phase_participants SET seed = NULL WHERE phase_id = p_phase_id AND seed IS NOT NULL;
  INSERT INTO public.phase_participants (phase_id, player_id, seed)
    SELECT p_phase_id, e.player_id, e.seed FROM jsonb_to_recordset(p_entries) AS e(player_id uuid, seed integer)
    ON CONFLICT (phase_id, player_id) DO UPDATE SET seed = EXCLUDED.seed, starting_bracket = EXCLUDED.starting_bracket;
END $$;

CREATE OR REPLACE FUNCTION public.phase_enrollment_replace(
  p_phase_id uuid, p_entries jsonb, p_source jsonb, p_expected_synced_at text, p_force boolean DEFAULT false
) RETURNS boolean
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_current jsonb;
BEGIN
  PERFORM public.phase__lock(p_phase_id);
  IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array' THEN
    RAISE EXCEPTION 'invalid_entries' USING ERRCODE = 'P0001';
  END IF;
  SELECT t.enrollment_source INTO v_current FROM public.league_phases t WHERE t.id = p_phase_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tournament_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF (v_current ->> 'synced_at') IS DISTINCT FROM p_expected_synced_at THEN
    RETURN false;
  END IF;
  IF NOT coalesce(p_force, false) THEN
    IF coalesce(v_current ->> 'frozen', 'false') = 'true' THEN
      RAISE EXCEPTION 'enrollment_frozen' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM public.phase_rounds r WHERE r.phase_id = p_phase_id) THEN
      RAISE EXCEPTION 'enrollment_rounds_exist' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  PERFORM public.phase_participants_replace(p_phase_id, p_entries);
  UPDATE public.league_phases
     SET enrollment_source = CASE
           WHEN v_current IS NULL THEN p_source
           ELSE p_source || jsonb_build_object('frozen', coalesce(v_current ->> 'frozen', 'false') = 'true')
         END
   WHERE id = p_phase_id;
  RETURN true;
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
  PERFORM public.phase_enrollment_freeze(p_phase_id);
  IF p_add THEN
    INSERT INTO public.phase_participants (phase_id, player_id) VALUES (p_phase_id, p_player_id);
  ELSE
    DELETE FROM public.phase_participants WHERE phase_id = p_phase_id AND player_id = p_player_id;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.phase_participants_replace(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.phase_enrollment_replace(uuid, jsonb, jsonb, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.phase_participant_edit(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_participants_replace(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.phase_enrollment_replace(uuid, jsonb, jsonb, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.phase_participant_edit(uuid, uuid, boolean) TO service_role;

COMMIT;

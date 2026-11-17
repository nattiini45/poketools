BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE FUNCTION public.phase_matches_delete_scheduled(p_match_ids uuid[])
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_phase_ids uuid[];
  v_round_ids uuid[];
  v_locked_ids uuid[] := '{}';
  v_phase_id uuid;
  v_match public.phase_matches;
  v_deleted integer;
BEGIN
  IF p_match_ids IS NULL OR array_position(p_match_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'phase_matches_delete_scheduled requires non-null match ids' USING ERRCODE = '22004';
  END IF;
  SELECT array_agg(DISTINCT m.phase_id), array_agg(DISTINCT m.round_id)
    INTO v_phase_ids, v_round_ids
    FROM public.phase_matches m WHERE m.id = ANY(p_match_ids);
  IF v_phase_ids IS NULL THEN RETURN 0; END IF;

  FOR v_phase_id IN SELECT x FROM unnest(v_phase_ids) AS t(x) ORDER BY x LOOP
    PERFORM public.phase__lock(v_phase_id);
  END LOOP;
  PERFORM 1 FROM public.phase_rounds r WHERE r.id = ANY(v_round_ids) ORDER BY r.id FOR UPDATE;
  FOR v_match IN SELECT m.* FROM public.phase_matches m WHERE m.id = ANY(p_match_ids) ORDER BY m.id FOR UPDATE LOOP
    IF NOT (v_match.phase_id = ANY(v_phase_ids)) OR NOT (v_match.round_id = ANY(v_round_ids)) THEN
      RAISE EXCEPTION 'phase_match_delete_changed' USING ERRCODE = 'P0001';
    END IF;
    v_locked_ids := array_append(v_locked_ids, v_match.id);
  END LOOP;

  IF EXISTS (SELECT 1 FROM public.phase_matches m WHERE m.id = ANY(v_locked_ids) AND m.status <> 'scheduled')
    OR EXISTS (SELECT 1 FROM public.phase_games g WHERE g.match_id = ANY(v_locked_ids)) THEN
    RAISE EXCEPTION 'phase_match_delete_changed' USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public.phase_matches m WHERE m.id = ANY(v_locked_ids);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END $$;

REVOKE ALL ON FUNCTION public.phase_matches_delete_scheduled(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_matches_delete_scheduled(uuid[]) TO service_role;

COMMENT ON FUNCTION public.phase_matches_delete_scheduled(uuid[]) IS
  'Delete only scheduled, game-free native matches after ordered phase, round and match locks. Any changed row still present refuses the entire batch; missing IDs are idempotent. Prior application team release is a separate request and cannot be rolled back on refusal.';

COMMIT;

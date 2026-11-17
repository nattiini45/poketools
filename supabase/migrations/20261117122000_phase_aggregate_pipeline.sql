BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.aggregates ADD CONSTRAINT aggregates_no_native_phase_scope CHECK (scope_type <> 'phase');
ALTER TABLE public.player_aggregates ADD CONSTRAINT player_aggregates_no_native_phase_scope CHECK (scope_type <> 'phase');

CREATE OR REPLACE FUNCTION public.enqueue_phase_aggregate_job(
  p_game_id uuid, p_phase_id uuid, p_season_id uuid, p_processing boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_match_id uuid;
  v_id uuid;
BEGIN
  SELECT g.match_id INTO v_match_id FROM public.phase_games g
    JOIN public.phase_matches m ON m.id = g.match_id
    JOIN public.league_phases p ON p.id = m.phase_id
    WHERE g.id = p_game_id AND m.phase_id = p_phase_id AND p.season_id = p_season_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Phase aggregate job owner mismatch or game missing' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.phase_aggregate_jobs (game_id, match_id, phase_id, season_id, operation, status, attempts)
    VALUES (p_game_id, v_match_id, p_phase_id, p_season_id, 'increment',
      CASE WHEN p_processing THEN 'processing' ELSE 'pending' END, CASE WHEN p_processing THEN 1 ELSE 0 END)
    RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_phase_aggregate_jobs_for_game(p_game_id uuid)
RETURNS integer LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.phase_aggregate_jobs SET status = 'cancelled', updated_at = now()
    WHERE game_id = p_game_id AND status IN ('pending', 'processing');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.phase_aggregate_deltas(
  p_phase_id uuid, p_season_id uuid, p_exclude_all_time boolean,
  p_aggregate_deltas jsonb, p_player_deltas jsonb, p_rollback boolean DEFAULT false
) RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  d jsonb;
  shared_aggregates jsonb;
  native_aggregates jsonb;
  shared_players jsonb;
  native_players jsonb;
BEGIN
  IF jsonb_typeof(p_aggregate_deltas) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_player_deltas) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Phase aggregate deltas must be arrays' USING ERRCODE = '22023';
  END IF;
  FOR d IN SELECT value FROM jsonb_array_elements(p_aggregate_deltas || p_player_deltas)
  LOOP
    IF ((d->>'scope_type' = 'phase' AND (d->>'scope_id')::uuid = p_phase_id)
      OR (d->>'scope_type' = 'league' AND (d->>'scope_id')::uuid = p_season_id)
      OR (d->>'scope_type' = 'all_time' AND d->>'scope_id' IS NULL AND NOT p_exclude_all_time)) IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Phase aggregate delta owner mismatch' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  SELECT coalesce(jsonb_agg(value ORDER BY value->>'scope_type', value->>'scope_id', value->>'pokemon_name'), '[]')
    INTO shared_aggregates FROM jsonb_array_elements(p_aggregate_deltas) WHERE value->>'scope_type' <> 'phase';
  SELECT coalesce(jsonb_agg(value ORDER BY value->>'scope_id', value->>'pokemon_name'), '[]')
    INTO native_aggregates FROM jsonb_array_elements(p_aggregate_deltas) WHERE value->>'scope_type' = 'phase';
  SELECT coalesce(jsonb_agg(value ORDER BY value->>'scope_type', value->>'scope_id', value->>'pokemon_name', value->>'player_id'), '[]')
    INTO shared_players FROM jsonb_array_elements(p_player_deltas) WHERE value->>'scope_type' <> 'phase';
  SELECT coalesce(jsonb_agg(value ORDER BY value->>'scope_id', value->>'pokemon_name', value->>'player_id'), '[]')
    INTO native_players FROM jsonb_array_elements(p_player_deltas) WHERE value->>'scope_type' = 'phase';
  IF p_rollback THEN
    PERFORM public.batch_decrement_aggregates(shared_aggregates);
    PERFORM public.batch_decrement_phase_aggregates(native_aggregates);
    PERFORM public.batch_decrement_player_aggregates(shared_players);
    PERFORM public.batch_decrement_phase_player_aggregates(native_players);
  ELSE
    PERFORM public.batch_upsert_aggregates(shared_aggregates);
    PERFORM public.batch_upsert_phase_aggregates(native_aggregates);
    PERFORM public.batch_upsert_player_aggregates(shared_players);
    PERFORM public.batch_upsert_phase_player_aggregates(native_players);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.batch_upsert_phase_aggregates(p_deltas jsonb) RETURNS void
    LANGUAGE plpgsql
    SET search_path = public
    AS $$
DECLARE
  d jsonb;
BEGIN
  FOR d IN SELECT * FROM jsonb_array_elements(p_deltas)
  LOOP
    IF d->>'scope_type' IS DISTINCT FROM 'phase' OR d->>'scope_id' IS NULL THEN
      RAISE EXCEPTION 'Native aggregate delta requires phase scope' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.phase_aggregates (
      phase_id, pokemon_name,
      total_appearances, total_brought, total_led,
      total_kos_dealt, total_koed, total_wins, total_games,
      move_counts, last_updated
    ) VALUES (
      (d->>'scope_id')::uuid,
      d->>'pokemon_name',
      (d->>'appearances')::int,
      (d->>'brought')::int,
      (d->>'led')::int,
      (d->>'kos_dealt')::int,
      (d->>'koed')::int,
      (d->>'wins')::int,
      (d->>'games')::int,
      COALESCE(d->'move_counts', '{}'::jsonb),
      now()
    )
    ON CONFLICT (phase_id, pokemon_name)
    DO UPDATE SET
      total_appearances = phase_aggregates.total_appearances + EXCLUDED.total_appearances,
      total_brought = phase_aggregates.total_brought + EXCLUDED.total_brought,
      total_led = phase_aggregates.total_led + EXCLUDED.total_led,
      total_kos_dealt = phase_aggregates.total_kos_dealt + EXCLUDED.total_kos_dealt,
      total_koed = phase_aggregates.total_koed + EXCLUDED.total_koed,
      total_wins = phase_aggregates.total_wins + EXCLUDED.total_wins,
      total_games = phase_aggregates.total_games + EXCLUDED.total_games,
      move_counts = public.merge_move_counts(phase_aggregates.move_counts, EXCLUDED.move_counts),
      last_updated = now();
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.batch_decrement_phase_aggregates(p_deltas jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  d jsonb;
  v_id uuid;
  v_remaining int;
BEGIN
  FOR d IN SELECT * FROM jsonb_array_elements(p_deltas)
  LOOP
    IF d->>'scope_type' IS DISTINCT FROM 'phase' OR d->>'scope_id' IS NULL THEN
      RAISE EXCEPTION 'Native aggregate delta requires phase scope' USING ERRCODE = '22023';
    END IF;
    v_id := NULL;

    UPDATE public.phase_aggregates SET
      total_appearances = GREATEST(0, total_appearances - (d->>'appearances')::int),
      total_brought = GREATEST(0, total_brought - (d->>'brought')::int),
      total_led = GREATEST(0, total_led - (d->>'led')::int),
      total_kos_dealt = GREATEST(0, total_kos_dealt - (d->>'kos_dealt')::int),
      total_koed = GREATEST(0, total_koed - (d->>'koed')::int),
      total_wins = GREATEST(0, total_wins - (d->>'wins')::int),
      total_games = GREATEST(0, total_games - (d->>'games')::int),
      move_counts = public.subtract_move_counts(move_counts, d->'move_counts'),
      last_updated = now()
    WHERE phase_id = (d->>'scope_id')::uuid
      AND pokemon_name = d->>'pokemon_name'
    RETURNING id, total_appearances INTO v_id, v_remaining;

    IF v_id IS NULL THEN
      CONTINUE;
    END IF;

    IF v_remaining = 0 THEN

      DELETE FROM public.phase_aggregates WHERE id = v_id AND total_appearances = 0;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.batch_upsert_phase_player_aggregates(p_deltas jsonb) RETURNS void
    LANGUAGE plpgsql
    SET search_path = public
    AS $$
DECLARE
  d jsonb;
BEGIN
  FOR d IN SELECT * FROM jsonb_array_elements(p_deltas)
  LOOP
    IF d->>'scope_type' IS DISTINCT FROM 'phase' OR d->>'scope_id' IS NULL THEN
      RAISE EXCEPTION 'Native aggregate delta requires phase scope' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.phase_player_aggregates (
      phase_id, player_id, pokemon_name,
      total_appearances, total_brought, total_led,
      total_kos_dealt, total_koed, total_wins, total_games,
      move_counts, last_updated
    ) VALUES (
      (d->>'scope_id')::uuid,
      (d->>'player_id')::uuid,
      d->>'pokemon_name',
      (d->>'appearances')::int,
      (d->>'brought')::int,
      (d->>'led')::int,
      (d->>'kos_dealt')::int,
      (d->>'koed')::int,
      (d->>'wins')::int,
      (d->>'games')::int,
      COALESCE(d->'move_counts', '{}'::jsonb),
      now()
    )
    ON CONFLICT (phase_id, player_id, pokemon_name)
    DO UPDATE SET
      total_appearances = phase_player_aggregates.total_appearances + EXCLUDED.total_appearances,
      total_brought = phase_player_aggregates.total_brought + EXCLUDED.total_brought,
      total_led = phase_player_aggregates.total_led + EXCLUDED.total_led,
      total_kos_dealt = phase_player_aggregates.total_kos_dealt + EXCLUDED.total_kos_dealt,
      total_koed = phase_player_aggregates.total_koed + EXCLUDED.total_koed,
      total_wins = phase_player_aggregates.total_wins + EXCLUDED.total_wins,
      total_games = phase_player_aggregates.total_games + EXCLUDED.total_games,
      move_counts = public.merge_move_counts(phase_player_aggregates.move_counts, EXCLUDED.move_counts),
      last_updated = now();
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.batch_decrement_phase_player_aggregates(p_deltas jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  d jsonb;
  v_id uuid;
  v_remaining int;
BEGIN
  FOR d IN SELECT * FROM jsonb_array_elements(p_deltas)
  LOOP
    IF d->>'scope_type' IS DISTINCT FROM 'phase' OR d->>'scope_id' IS NULL THEN
      RAISE EXCEPTION 'Native aggregate delta requires phase scope' USING ERRCODE = '22023';
    END IF;
    v_id := NULL;
    UPDATE public.phase_player_aggregates SET
      total_appearances = GREATEST(0, total_appearances - (d->>'appearances')::int),
      total_brought = GREATEST(0, total_brought - (d->>'brought')::int),
      total_led = GREATEST(0, total_led - (d->>'led')::int),
      total_kos_dealt = GREATEST(0, total_kos_dealt - (d->>'kos_dealt')::int),
      total_koed = GREATEST(0, total_koed - (d->>'koed')::int),
      total_wins = GREATEST(0, total_wins - (d->>'wins')::int),
      total_games = GREATEST(0, total_games - (d->>'games')::int),
      move_counts = public.subtract_move_counts(move_counts, d->'move_counts'),
      last_updated = now()
    WHERE phase_id = (d->>'scope_id')::uuid
      AND player_id = (d->>'player_id')::uuid
      AND pokemon_name = d->>'pokemon_name'
    RETURNING id, total_appearances INTO v_id, v_remaining;

    IF v_id IS NULL THEN
      CONTINUE;
    END IF;

    IF v_remaining = 0 THEN
      DELETE FROM public.phase_player_aggregates WHERE id = v_id AND total_appearances = 0;
    END IF;
  END LOOP;
END;
$$;
CREATE OR REPLACE FUNCTION public.apply_phase_aggregate_job(
  p_job_id uuid,
  p_game_id uuid,
  p_aggregate_deltas jsonb,
  p_player_deltas jsonb
) RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_job_game_id uuid;
  v_applied_at timestamptz;
  v_phase_id uuid;
  v_season_id uuid;
  v_exclude boolean;
BEGIN
  IF p_job_id IS NULL OR p_game_id IS NULL THEN
    RAISE EXCEPTION 'apply_phase_aggregate_job: job id and game id are required' USING ERRCODE = '22004';
  END IF;
  IF jsonb_typeof(p_aggregate_deltas) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_player_deltas) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'apply_phase_aggregate_job: deltas must be JSON arrays' USING ERRCODE = '22023';
  END IF;

  UPDATE public.phase_aggregate_jobs
     SET status = 'completed', processed_at = now(), updated_at = now()
   WHERE id = p_job_id AND status = 'processing'
  RETURNING game_id, phase_id, season_id INTO v_job_game_id, v_phase_id, v_season_id;
  IF NOT FOUND THEN
    RETURN 'job_not_processing';
  END IF;
  IF v_job_game_id IS DISTINCT FROM p_game_id THEN

    RAISE EXCEPTION 'apply_phase_aggregate_job: job % belongs to game %, not %', p_job_id, v_job_game_id, p_game_id
      USING ERRCODE = '22023';
  END IF;

  SELECT aggregate_applied_at, exclude_all_time INTO v_applied_at, v_exclude FROM public.phase_games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'game_missing';
  END IF;
  IF v_applied_at IS NOT NULL THEN
    RETURN 'already_applied';
  END IF;

  PERFORM public.phase_aggregate_deltas(v_phase_id, v_season_id, v_exclude, p_aggregate_deltas, p_player_deltas);

  UPDATE public.phase_games SET aggregate_applied_at = now() WHERE id = p_game_id;

  RETURN 'applied';
END;
$$;

CREATE OR REPLACE FUNCTION public.rollback_phase_game_aggregates(
  p_game_id uuid,
  p_expected_applied_at timestamptz,
  p_aggregate_deltas jsonb,
  p_player_deltas jsonb
) RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_applied_at timestamptz;
  v_phase_id uuid;
  v_season_id uuid;
  v_exclude boolean;
BEGIN
  IF p_game_id IS NULL OR p_expected_applied_at IS NULL THEN
    RAISE EXCEPTION 'rollback_phase_game_aggregates: game id and expected marker are required' USING ERRCODE = '22004';
  END IF;
  IF jsonb_typeof(p_aggregate_deltas) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_player_deltas) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'rollback_phase_game_aggregates: deltas must be JSON arrays' USING ERRCODE = '22023';
  END IF;

  SELECT g.aggregate_applied_at, g.exclude_all_time, m.phase_id, p.season_id
    INTO v_applied_at, v_exclude, v_phase_id, v_season_id
    FROM public.phase_games g JOIN public.phase_matches m ON m.id = g.match_id
    JOIN public.league_phases p ON p.id = m.phase_id WHERE g.id = p_game_id FOR UPDATE OF g;
  IF NOT FOUND THEN
    RETURN 'game_missing';
  END IF;

  IF v_applied_at IS NULL THEN
    RETURN 'not_applied';
  END IF;
  IF v_applied_at IS DISTINCT FROM p_expected_applied_at THEN
    RETURN 'marker_changed';
  END IF;

  PERFORM public.phase_aggregate_deltas(v_phase_id, v_season_id, v_exclude, p_aggregate_deltas, p_player_deltas, true);

  UPDATE public.phase_games SET aggregate_applied_at = NULL WHERE id = p_game_id;

  RETURN 'rolled_back';
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_phase_aggregate_jobs(p_limit integer DEFAULT 10)
RETURNS SETOF public.phase_aggregate_jobs
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'Invalid claim limit' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH claimed AS (
    SELECT id
    FROM public.phase_aggregate_jobs
    WHERE status = 'pending'
      AND attempts < max_attempts
    ORDER BY created_at ASC, id ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ),
  updated AS (
    UPDATE public.phase_aggregate_jobs ag
    SET status = 'processing',
        attempts = ag.attempts + 1,
        updated_at = now()
    FROM claimed c
    WHERE ag.id = c.id AND ag.status = 'pending'
    RETURNING ag.*
  )
  SELECT * FROM updated ORDER BY created_at ASC, id ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.reclaim_stale_phase_aggregate_jobs() RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH reclaimed AS (
    UPDATE public.phase_aggregate_jobs
       SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
           last_error = CASE WHEN attempts >= max_attempts
                             THEN 'Processor stopped while processing; attempts exhausted'
                             ELSE last_error END,
           updated_at = now()
     WHERE status = 'processing'
       AND updated_at < now() - INTERVAL '5 minutes'
    RETURNING id
  )
  SELECT count(*)::integer INTO v_count FROM reclaimed;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.phase_aggregate_job_health()
RETURNS TABLE (stranded_pending integer, stale_processing integer)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    (count(*) FILTER (WHERE status = 'pending' AND attempts >= max_attempts))::integer AS stranded_pending,
    (count(*) FILTER (WHERE status = 'processing' AND updated_at < now() - INTERVAL '15 minutes'))::integer
      AS stale_processing
  FROM public.phase_aggregate_jobs
  WHERE status IN ('pending', 'processing');
$$;

REVOKE ALL ON FUNCTION public.enqueue_phase_aggregate_job(uuid, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_phase_aggregate_job(uuid, uuid, uuid, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.cancel_phase_aggregate_jobs_for_game(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_phase_aggregate_jobs_for_game(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.phase_aggregate_deltas(uuid, uuid, boolean, jsonb, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_aggregate_deltas(uuid, uuid, boolean, jsonb, jsonb, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.batch_upsert_phase_aggregates(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.batch_upsert_phase_aggregates(jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.batch_decrement_phase_aggregates(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.batch_decrement_phase_aggregates(jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.batch_upsert_phase_player_aggregates(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.batch_upsert_phase_player_aggregates(jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.batch_decrement_phase_player_aggregates(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.batch_decrement_phase_player_aggregates(jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.apply_phase_aggregate_job(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_phase_aggregate_job(uuid, uuid, jsonb, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.rollback_phase_game_aggregates(uuid, timestamptz, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rollback_phase_game_aggregates(uuid, timestamptz, jsonb, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.claim_phase_aggregate_jobs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_phase_aggregate_jobs(integer) TO service_role;

REVOKE ALL ON FUNCTION public.reclaim_stale_phase_aggregate_jobs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reclaim_stale_phase_aggregate_jobs() TO service_role;

REVOKE ALL ON FUNCTION public.phase_aggregate_job_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_aggregate_job_health() TO service_role;

CREATE OR REPLACE FUNCTION public.get_total_games_in_mixed_scope(p_scope_type public.aggregate_scope, p_scope_id uuid)
RETURNS integer LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN
  IF p_scope_type IS NULL OR (p_scope_type <> 'all_time' AND p_scope_id IS NULL) THEN
    RAISE EXCEPTION 'Aggregate scope and scope id required' USING ERRCODE = '22023';
  END IF;
  RETURN (
    SELECT count(*)::integer FROM (
      SELECT g.id FROM public.phase_games g
      JOIN public.phase_matches m ON m.id = g.match_id
      JOIN public.league_phases p ON p.id = m.phase_id
      WHERE m.status <> 'scheduled' AND (
        (p_scope_type = 'phase' AND m.phase_id = p_scope_id)
        OR (p_scope_type = 'league' AND p.season_id = p_scope_id)
        OR (p_scope_type = 'all_time' AND NOT g.exclude_all_time))
      UNION
      SELECT g.id FROM public.games g
      JOIN public.matches m ON m.id = g.match_id
      JOIN public.tournaments t ON t.id = m.tournament_id
      WHERE m.status <> 'scheduled' AND (
        (p_scope_type = 'tournament' AND t.id = p_scope_id)
        OR (p_scope_type = 'league' AND t.season_id = p_scope_id)
        OR (p_scope_type = 'all_time' AND NOT g.exclude_all_time))
    ) games
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_total_games_in_mixed_scope(public.aggregate_scope, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_total_games_in_mixed_scope(public.aggregate_scope, uuid) TO service_role;

COMMIT;

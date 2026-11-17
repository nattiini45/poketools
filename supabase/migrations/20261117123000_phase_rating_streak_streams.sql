BEGIN;
DROP FUNCTION IF EXISTS public.phase_rating_apply_match_result(uuid, jsonb);
DROP FUNCTION IF EXISTS public.rating_replace_player_streams(uuid, jsonb, jsonb, uuid[]);

CREATE FUNCTION public.phase_match_in_test_season(p_match_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
SELECT coalesce((SELECT s.is_test_season FROM public.phase_matches m
JOIN public.league_phases p ON p.id = m.phase_id
JOIN public.seasons s ON s.id = p.season_id WHERE m.id = p_match_id), false);
$$;
CREATE OR REPLACE FUNCTION public.phase_rating_apply_match_result(
  p_match_id uuid,
  p_players jsonb,
  p_expected_completion jsonb
) RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_entry jsonb;
  v_ids uuid[];
  v_player_id uuid;
  v_key text;
  v_match record;
  v_history_count integer;
  v_current record;
  v_expected jsonb;
  v_expected_winner_id uuid;
  v_expected_confirmed_at timestamptz;
BEGIN
  IF public.phase_storage_mode() IS DISTINCT FROM 'phase' THEN
    RAISE EXCEPTION 'phase_storage_not_ready' USING ERRCODE = 'P0001';
  END IF;
  IF p_match_id IS NULL THEN
    RAISE EXCEPTION 'rating_apply_match_result: p_match_id is required' USING ERRCODE = '22004';
  END IF;
  IF jsonb_typeof(p_expected_completion) IS DISTINCT FROM 'object'
    OR NOT (p_expected_completion ? 'winner_id' AND p_expected_completion ? 'confirmed_at')
    OR jsonb_typeof(p_expected_completion -> 'winner_id') NOT IN ('string', 'null')
    OR jsonb_typeof(p_expected_completion -> 'confirmed_at') NOT IN ('string', 'null') THEN
    RAISE EXCEPTION 'Expected completion needs winner_id and confirmed_at, each a string or null' USING ERRCODE = '22023';
  END IF;
  v_expected_winner_id := (p_expected_completion ->> 'winner_id')::uuid;
  v_expected_confirmed_at := (p_expected_completion ->> 'confirmed_at')::timestamptz;
  IF jsonb_typeof(p_players) IS DISTINCT FROM 'array' OR jsonb_array_length(p_players) <> 2 THEN
    RAISE EXCEPTION 'rating_apply_match_result: p_players must be an array of exactly two entries' USING ERRCODE = '22023';
  END IF;

  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_players)
  LOOP
    IF jsonb_typeof(v_entry) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_entry -> 'player_id') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_entry -> 'state') IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_entry -> 'history') IS DISTINCT FROM 'object'
       OR (v_entry -> 'expected' IS NOT NULL AND jsonb_typeof(v_entry -> 'expected') NOT IN ('object', 'null')) THEN
      RAISE EXCEPTION 'rating_apply_match_result: each entry needs player_id, state, history and expected (object or null)'
        USING ERRCODE = '22023';
    END IF;
    FOREACH v_key IN ARRAY ARRAY['rating', 'rd', 'volatility', 'peak_rating', 'wins', 'losses', 'draws'] LOOP
      IF jsonb_typeof(v_entry -> 'state' -> v_key) IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'rating_apply_match_result: state.% must be a number', v_key USING ERRCODE = '22023';
      END IF;
    END LOOP;
    FOREACH v_key IN ARRAY ARRAY['rating_before', 'rating_after', 'rd_before', 'rd_after', 'opponent_rating'] LOOP
      IF jsonb_typeof(v_entry -> 'history' -> v_key) IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'rating_apply_match_result: history.% must be a number', v_key USING ERRCODE = '22023';
      END IF;
    END LOOP;
    IF jsonb_typeof(v_entry -> 'expected') = 'object' THEN
      FOREACH v_key IN ARRAY ARRAY['rating', 'rd', 'volatility', 'wins', 'losses', 'draws'] LOOP
        IF jsonb_typeof(v_entry -> 'expected' -> v_key) IS DISTINCT FROM 'number' THEN
          RAISE EXCEPTION 'rating_apply_match_result: expected.% must be a number', v_key USING ERRCODE = '22023';
        END IF;
      END LOOP;
    END IF;
    v_ids := v_ids || (v_entry ->> 'player_id')::uuid;
  END LOOP;

  IF v_ids[1] = v_ids[2] THEN
    RAISE EXCEPTION 'rating_apply_match_result: the two entries name the same player' USING ERRCODE = '22023';
  END IF;
  IF (p_players -> 0 -> 'history' ->> 'opponent_id')::uuid IS DISTINCT FROM v_ids[2]
     OR (p_players -> 1 -> 'history' ->> 'opponent_id')::uuid IS DISTINCT FROM v_ids[1] THEN
    RAISE EXCEPTION 'rating_apply_match_result: each history row must name the other entry as opponent'
      USING ERRCODE = '22023';
  END IF;

  FOR v_player_id IN SELECT unnest(v_ids) ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext('rating_replace_player_history'), hashtext(v_player_id::text));
  END LOOP;

  SELECT player_1_id, player_2_id, status, winner_id, confirmed_at INTO v_match FROM public.phase_matches WHERE id = p_match_id FOR SHARE;
  IF NOT FOUND THEN
    RETURN 'match_missing';
  END IF;
  IF NOT ((v_match.player_1_id = v_ids[1] AND v_match.player_2_id = v_ids[2])
       OR (v_match.player_1_id = v_ids[2] AND v_match.player_2_id = v_ids[1])) THEN
    RAISE EXCEPTION 'rating_apply_match_result: players % and % are not the participants of match %',
      v_ids[1], v_ids[2], p_match_id USING ERRCODE = '22023';
  END IF;
  IF v_match.status IS DISTINCT FROM 'completed' THEN
    RETURN 'match_not_completed';
  END IF;
  IF v_match.winner_id IS DISTINCT FROM v_expected_winner_id
     OR v_match.confirmed_at IS DISTINCT FROM v_expected_confirmed_at THEN
    RETURN 'match_changed';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_players) e
    WHERE e -> 'history' ->> 'result' IS DISTINCT FROM CASE
      WHEN v_expected_winner_id IS NULL THEN 'draw'
      WHEN (e ->> 'player_id')::uuid = v_expected_winner_id THEN 'win' ELSE 'loss' END) THEN
    RAISE EXCEPTION 'Rating history result differs from the expected winner' USING ERRCODE = '22023';
  END IF;

  IF public.phase_match_in_test_season(p_match_id) THEN
    RETURN 'skipped_test_season';
  END IF;

  SELECT count(*) INTO v_history_count
    FROM public.phase_rating_history
   WHERE match_id = p_match_id AND player_id = ANY (v_ids);
  IF v_history_count = 2 THEN
    RETURN 'already_applied';
  END IF;
  IF v_history_count = 1 THEN
    RETURN 'history_incomplete';
  END IF;

  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_players)
  LOOP
    v_expected := v_entry -> 'expected';
    SELECT rating, rd, volatility, wins, losses, draws INTO v_current
      FROM public.player_ratings WHERE player_id = (v_entry ->> 'player_id')::uuid;
    IF NOT FOUND THEN
      IF jsonb_typeof(v_expected) = 'object' THEN
        RETURN 'stale';
      END IF;
    ELSIF jsonb_typeof(v_expected) IS DISTINCT FROM 'object'
       OR v_current.rating IS DISTINCT FROM (v_expected ->> 'rating')::numeric
       OR v_current.rd IS DISTINCT FROM (v_expected ->> 'rd')::numeric
       OR v_current.volatility IS DISTINCT FROM (v_expected ->> 'volatility')::numeric
       OR v_current.wins IS DISTINCT FROM (v_expected ->> 'wins')::integer
       OR v_current.losses IS DISTINCT FROM (v_expected ->> 'losses')::integer
       OR v_current.draws IS DISTINCT FROM (v_expected ->> 'draws')::integer THEN
      RETURN 'stale';
    END IF;
  END LOOP;

  INSERT INTO public.player_ratings (
    player_id, rating, rd, volatility, peak_rating, peak_date, wins, losses, draws, last_match_at, updated_at
  )
  SELECT
    (e.value ->> 'player_id')::uuid,
    (e.value -> 'state' ->> 'rating')::numeric,
    (e.value -> 'state' ->> 'rd')::numeric,
    (e.value -> 'state' ->> 'volatility')::numeric,
    (e.value -> 'state' ->> 'peak_rating')::numeric,
    NULLIF(e.value -> 'state' ->> 'peak_date', '')::timestamptz,
    (e.value -> 'state' ->> 'wins')::integer,
    (e.value -> 'state' ->> 'losses')::integer,
    (e.value -> 'state' ->> 'draws')::integer,
    NULLIF(e.value -> 'state' ->> 'last_match_at', '')::timestamptz,
    COALESCE(NULLIF(e.value -> 'state' ->> 'updated_at', '')::timestamptz, now())
  FROM jsonb_array_elements(p_players) AS e(value)
  ON CONFLICT (player_id) DO UPDATE SET
    rating        = EXCLUDED.rating,
    rd            = EXCLUDED.rd,
    volatility    = EXCLUDED.volatility,
    peak_rating   = EXCLUDED.peak_rating,
    peak_date     = EXCLUDED.peak_date,
    wins          = EXCLUDED.wins,
    losses        = EXCLUDED.losses,
    draws         = EXCLUDED.draws,
    last_match_at = EXCLUDED.last_match_at,
    updated_at    = EXCLUDED.updated_at;

  INSERT INTO public.phase_rating_history (
    player_id, match_id, rating_before, rating_after, rd_before, rd_after, opponent_id, opponent_rating, result
  )
  SELECT
    (e.value ->> 'player_id')::uuid,
    p_match_id,
    (e.value -> 'history' ->> 'rating_before')::numeric,
    (e.value -> 'history' ->> 'rating_after')::numeric,
    (e.value -> 'history' ->> 'rd_before')::numeric,
    (e.value -> 'history' ->> 'rd_after')::numeric,
    (e.value -> 'history' ->> 'opponent_id')::uuid,
    (e.value -> 'history' ->> 'opponent_rating')::numeric,
    e.value -> 'history' ->> 'result'
  FROM jsonb_array_elements(p_players) AS e(value);

  RETURN 'applied';
END;
$$;

CREATE FUNCTION public.rating_replace_player_streams(
  p_player_id uuid, p_state jsonb, p_history jsonb, p_expected_history_match_ids uuid[], p_expected_matches jsonb
) RETURNS integer LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_legacy jsonb;
  v_phase jsonb;
  v_count integer;
  v_current jsonb;
  v_expected jsonb;
BEGIN
  IF public.phase_storage_mode() IS DISTINCT FROM 'phase' THEN
    RAISE EXCEPTION 'phase_storage_not_ready' USING ERRCODE = 'P0001';
  END IF;
  IF p_player_id IS NULL OR p_expected_history_match_ids IS NULL THEN
    RAISE EXCEPTION 'Player and history fence are required' USING ERRCODE = '22004';
  END IF;
  IF jsonb_typeof(p_history) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'History must be an array' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_expected_matches) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Expected countable match stream is required' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('rating_replace_player_history'), hashtext(p_player_id::text));
  BEGIN
    LOCK TABLE public.seasons, public.tournaments, public.league_phases IN EXCLUSIVE MODE NOWAIT;
    LOCK TABLE public.matches, public.phase_matches IN SHARE MODE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'Match owners, flags or streams are being changed; retry rating replay' USING ERRCODE = 'PT409';
  END;

  SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.kind, m.match_id), '[]'::jsonb) INTO v_current FROM (
    SELECT 'tournament'::text AS kind, m.id AS match_id, m.player_1_id, m.player_2_id, m.winner_id, m.confirmed_at, m.date_played, m.created_at
      FROM public.matches m JOIN public.tournaments t ON t.id = m.tournament_id
      WHERE t.season_id IS NULL AND m.status = 'completed' AND (m.player_1_id = p_player_id OR m.player_2_id = p_player_id)
        AND NOT EXISTS (SELECT 1 FROM public.phase_matches pm WHERE pm.id = m.id)
    UNION ALL
    SELECT 'phase'::text AS kind, m.id AS match_id, m.player_1_id, m.player_2_id, m.winner_id, m.confirmed_at, m.date_played, m.created_at
      FROM public.phase_matches m JOIN public.league_phases p ON p.id = m.phase_id JOIN public.seasons s ON s.id = p.season_id
      WHERE NOT s.is_test_season AND m.status = 'completed' AND (m.player_1_id = p_player_id OR m.player_2_id = p_player_id)
  ) m;
  SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.kind, m.match_id), '[]'::jsonb) INTO v_expected
    FROM jsonb_to_recordset(p_expected_matches) m(kind text, match_id uuid, player_1_id uuid, player_2_id uuid,
      winner_id uuid, confirmed_at timestamptz, date_played timestamptz, created_at timestamptz);
  IF v_current IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'Countable match stream or completion identity changed after rating replay' USING ERRCODE = 'PT409';
  END IF;
  IF jsonb_array_length(p_history) <> jsonb_array_length(v_current)
    OR EXISTS (SELECT 1 FROM jsonb_to_recordset(p_history) r(match_id uuid, result text)
      LEFT JOIN jsonb_to_recordset(v_current) m(match_id uuid, winner_id uuid) ON m.match_id = r.match_id
      WHERE m.match_id IS NULL OR r.result IS DISTINCT FROM CASE
        WHEN m.winner_id IS NULL THEN 'draw' WHEN m.winner_id = p_player_id THEN 'win' ELSE 'loss' END) THEN
    RAISE EXCEPTION 'Rating history differs from the countable completion stream' USING ERRCODE = 'PT409';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_history) r(player_id uuid, match_id uuid, opponent_id uuid)
    WHERE r.player_id IS DISTINCT FROM p_player_id OR NOT (
      EXISTS (SELECT 1 FROM public.phase_matches m WHERE m.id = r.match_id AND m.status = 'completed'
        AND ((m.player_1_id = p_player_id AND m.player_2_id = r.opponent_id) OR (m.player_2_id = p_player_id AND m.player_1_id = r.opponent_id)))
      OR EXISTS (SELECT 1 FROM public.matches m JOIN public.tournaments t ON t.id = m.tournament_id
        WHERE m.id = r.match_id AND t.season_id IS NULL AND m.status = 'completed'
        AND ((m.player_1_id = p_player_id AND m.player_2_id = r.opponent_id) OR (m.player_2_id = p_player_id AND m.player_1_id = r.opponent_id)))
    )
  ) THEN
    RAISE EXCEPTION 'Rating stream changed or history has invalid participants' USING ERRCODE = 'PT409';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_history) r(match_id uuid) WHERE public.phase_match_in_test_season(r.match_id))
    OR EXISTS (SELECT 1 FROM public.phase_rating_history h JOIN public.phase_matches m ON m.id = h.match_id
      WHERE h.player_id = p_player_id AND m.status = 'completed' AND NOT public.phase_match_in_test_season(m.id)
      AND NOT (h.match_id = ANY(p_expected_history_match_ids))) THEN
    RAISE EXCEPTION 'Phase history or test flag changed after replay' USING ERRCODE = 'PT409';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_history) r(match_id uuid) GROUP BY r.match_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate match in rating history' USING ERRCODE = '23505';
  END IF;
  SELECT coalesce(jsonb_agg(e), '[]'::jsonb) INTO v_phase FROM jsonb_array_elements(p_history) e
    WHERE EXISTS (SELECT 1 FROM public.phase_matches m WHERE m.id = (e->>'match_id')::uuid);
  SELECT coalesce(jsonb_agg(e), '[]'::jsonb) INTO v_legacy FROM jsonb_array_elements(p_history) e
    WHERE NOT EXISTS (SELECT 1 FROM public.phase_matches m WHERE m.id = (e->>'match_id')::uuid);
  PERFORM public.rating_replace_player_history(p_player_id, p_state, v_legacy, p_expected_history_match_ids);
  DELETE FROM public.phase_rating_history WHERE player_id = p_player_id;
  INSERT INTO public.phase_rating_history
    (player_id, match_id, rating_before, rating_after, rd_before, rd_after, opponent_id, opponent_rating, result, recorded_at)
  SELECT p_player_id, r.match_id, r.rating_before, r.rating_after, r.rd_before, r.rd_after, r.opponent_id, r.opponent_rating, r.result, coalesce(r.recorded_at, now())
    FROM jsonb_to_recordset(v_phase) r(match_id uuid, rating_before numeric, rating_after numeric, rd_before numeric, rd_after numeric,
      opponent_id uuid, opponent_rating numeric, result text, recorded_at timestamptz);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count + jsonb_array_length(v_legacy);
END;
$$;

CREATE OR REPLACE FUNCTION public.streaks_replace_player_streams(
  p_player_id uuid,
  p_state jsonb,
  p_expected_match_ids uuid[]
) RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_key text;
  v_current uuid[];
  v_last_match_id uuid;
  v_last_phase_match_id uuid;
BEGIN
  IF public.phase_storage_mode() IS DISTINCT FROM 'phase' THEN
    RAISE EXCEPTION 'phase_storage_not_ready' USING ERRCODE = 'P0001';
  END IF;
  IF p_player_id IS NULL THEN
    RAISE EXCEPTION 'streaks_replace_player: p_player_id is required' USING ERRCODE = '22004';
  END IF;
  IF p_expected_match_ids IS NULL THEN
    RAISE EXCEPTION 'streaks_replace_player: p_expected_match_ids is required' USING ERRCODE = '22004';
  END IF;
  IF jsonb_typeof(p_state) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'streaks_replace_player: p_state must be an object' USING ERRCODE = '22023';
  END IF;
  FOREACH v_key IN ARRAY ARRAY[
    'current_win_streak', 'best_win_streak', 'current_loss_streak', 'best_loss_streak',
    'current_ko_streak', 'best_ko_streak', 'current_flawless_streak', 'best_flawless_streak'
  ] LOOP
    IF jsonb_typeof(p_state -> v_key) IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'streaks_replace_player: state.% must be a number', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF jsonb_typeof(p_state -> 'last_match_id') IS DISTINCT FROM 'null'
     AND jsonb_typeof(p_state -> 'last_match_id') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'streaks_replace_player: state.last_match_id must be a uuid string or null' USING ERRCODE = '22023';
  END IF;
  v_last_match_id := NULLIF(p_state ->> 'last_match_id', '')::uuid;

  v_last_phase_match_id := NULLIF(p_state ->> 'last_phase_match_id', '')::uuid;
  IF v_last_match_id IS NOT NULL AND v_last_phase_match_id IS NOT NULL THEN
    RAISE EXCEPTION 'Streak pointers are mutually exclusive' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('streaks_replace_player'), hashtext(p_player_id::text));

  SELECT coalesce(array_agg(m.id ORDER BY m.id), '{}'::uuid[]) INTO v_current
    FROM (SELECT m.id, m.status, m.player_1_id, m.player_2_id FROM public.matches m JOIN public.tournaments t ON t.id = m.tournament_id WHERE t.season_id IS NULL UNION SELECT id, status, player_1_id, player_2_id FROM public.phase_matches) m
   WHERE m.status = 'completed'
     AND (m.player_1_id = p_player_id OR m.player_2_id = p_player_id);

  IF v_current IS DISTINCT FROM coalesce(
       (SELECT array_agg(DISTINCT e ORDER BY e) FROM unnest(p_expected_match_ids) AS e), '{}'::uuid[]) THEN
    RAISE EXCEPTION 'streaks_replace_player: the completed matches of player % changed after the replay read them', p_player_id
      USING ERRCODE = 'PT409';
  END IF;

  IF jsonb_typeof(p_state -> 'counted_match_ids') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Counted match fence is required' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(array_agg(m.id ORDER BY m.id), '{}'::uuid[]) INTO v_current FROM (
    SELECT m.id FROM public.matches m JOIN public.tournaments t ON t.id = m.tournament_id
      WHERE t.season_id IS NULL AND m.status = 'completed' AND (m.player_1_id = p_player_id OR m.player_2_id = p_player_id)
    UNION
    SELECT m.id FROM public.phase_matches m WHERE m.status = 'completed'
      AND (m.player_1_id = p_player_id OR m.player_2_id = p_player_id) AND NOT public.phase_match_in_test_season(m.id)
  ) m;
  IF v_current IS DISTINCT FROM coalesce((SELECT array_agg(DISTINCT e::uuid ORDER BY e::uuid)
    FROM jsonb_array_elements_text(p_state -> 'counted_match_ids') e), '{}'::uuid[]) THEN
    RAISE EXCEPTION 'Countable stream changed after streak replay' USING ERRCODE = 'PT409';
  END IF;

  INSERT INTO public.player_streaks (
    player_id,
    current_win_streak, best_win_streak,
    current_loss_streak, best_loss_streak,
    current_ko_streak, best_ko_streak,
    current_flawless_streak, best_flawless_streak,
    last_match_id, last_phase_match_id, updated_at
  ) VALUES (
    p_player_id,
    (p_state ->> 'current_win_streak')::integer, (p_state ->> 'best_win_streak')::integer,
    (p_state ->> 'current_loss_streak')::integer, (p_state ->> 'best_loss_streak')::integer,
    (p_state ->> 'current_ko_streak')::integer, (p_state ->> 'best_ko_streak')::integer,
    (p_state ->> 'current_flawless_streak')::integer, (p_state ->> 'best_flawless_streak')::integer,
    v_last_match_id, v_last_phase_match_id, now()
  )
  ON CONFLICT (player_id) DO UPDATE SET
    current_win_streak = EXCLUDED.current_win_streak,
    best_win_streak = EXCLUDED.best_win_streak,
    current_loss_streak = EXCLUDED.current_loss_streak,
    best_loss_streak = EXCLUDED.best_loss_streak,
    current_ko_streak = EXCLUDED.current_ko_streak,
    best_ko_streak = EXCLUDED.best_ko_streak,
    current_flawless_streak = EXCLUDED.current_flawless_streak,
    best_flawless_streak = EXCLUDED.best_flawless_streak,
    last_match_id = EXCLUDED.last_match_id,
    last_phase_match_id = EXCLUDED.last_phase_match_id,
    updated_at = EXCLUDED.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.phase_match_in_test_season(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_match_in_test_season(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.phase_rating_apply_match_result(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_rating_apply_match_result(uuid, jsonb, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.rating_replace_player_streams(uuid, jsonb, jsonb, uuid[], jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rating_replace_player_streams(uuid, jsonb, jsonb, uuid[], jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.streaks_replace_player_streams(uuid, jsonb, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.streaks_replace_player_streams(uuid, jsonb, uuid[]) TO service_role;

COMMIT;

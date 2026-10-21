-- Live rating update of one match in ONE transaction (code review CR-4 residual; lead ruling round 3).
--
-- updateRatings (src/lib/rating/updateRatings.ts), run by match finalize and the gamification backfill, wrote a
-- match's rating change as two PostgREST statements: an upsert of both players' player_ratings rows, then an insert
-- of both rating_history rows. Residuals of that shape:
--   * a failure (or a lost response) between the two left "both ratings, no history": the finalize heal cannot tell
--     it from "never ran", so it stays needs-admin, and a manual retry applied Glicko a second time;
--   * the read of both players' current ratings was not locked: two finalizations sharing a player could both read
--     the same state and the later write lost the earlier one's update;
--   * a chronological rebuild (rating_replace_player_history) could rewrite a player between the live read and the
--     live write, and the live upsert then overwrote the rebuilt curve's state without anything noticing.
--
-- public.rating_apply_match_result(p_match_id, p_players) keeps the Glicko-2 math in TS and makes the write atomic
-- and fenced:
--   1. validates the payload: exactly two entries, distinct player ids that are this match's two participants, each
--      entry's history row names the other entry as opponent, every state/history number present;
--   2. takes the per-player advisory locks rating_replace_player_history takes (same two-key form and namespace), in
--      ascending player-id order, so the live write and a rebuild of either player serialise and two live writes
--      sharing a player cannot deadlock (each takes its two locks in the same global order);
--   3. reads the match row FOR SHARE: a match that is no longer completed (reset meanwhile) gets no rating rows;
--   4. idempotency: when both history rows already exist the call is a no-op ('already_applied'); exactly one row is
--      a damaged history ('history_incomplete', nothing written; the rebuild heals it);
--   5. fence: each player's current player_ratings values (rating, rd, volatility, wins, losses, draws; or "no row")
--      must equal the state the caller computed from (`expected`). numeric(7,2)/numeric(8,6) values round-trip
--      exactly through PostgREST JSON, so a mismatch means another writer changed the player since the read
--      ('stale', nothing written; the caller re-reads and recomputes);
--   6. upserts both player_ratings rows and inserts both rating_history rows, then returns 'applied'.
-- Any error rolls back everything, so the only states a failure can leave are "nothing written" and "all written".
--
-- Outcomes (exhaustive; the TS wrapper throws on anything else):
--   'applied' | 'already_applied' | 'stale' | 'history_incomplete' | 'match_missing' | 'match_not_completed'
--
-- rating_replace_player_history (the rebuild's writer) gains a history fence (L-MATCH round-3 gate minor):
--   A rebuild reads a player's completed matches and their history rows, replays them, and then replaces the
--   player's whole curve. A live apply that committed in between (it takes the same per-player lock, but the rebuild
--   only holds that lock for its WRITE) was silently overwritten: a match the rebuild had read as never rated was
--   replayed against the default opponent, and a match completed after the read lost this player's history row
--   (one-sided). The function now takes p_expected_history_match_ids: the ids of the player's OWN history rows the
--   replay read. Under the player lock it refuses with SQLSTATE 40001 (nothing written) when the player now has a
--   history row for a COMPLETED match outside that set; the TS rebuild re-reads that player and retries. Rows of
--   matches that are no longer completed are ignored by the fence (the replace removes them, as before). The
--   parameter defaults to NULL (no fence) so code deployed before this migration keeps working; the TS caller always
--   passes it. The body is the latest one (20261018130200; no later migration redefined it, and the live local
--   definition was read with pg_get_functiondef first) plus the fence. The 3-argument version is dropped: two
--   overloads would make PostgREST's named-argument resolution ambiguous.
--
-- No table changes; RLS on player_ratings, rating_history and matches is unchanged. Grants: service_role only.
BEGIN;

CREATE OR REPLACE FUNCTION public.rating_apply_match_result(
  p_match_id uuid,
  p_players jsonb
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
BEGIN
  IF p_match_id IS NULL THEN
    RAISE EXCEPTION 'rating_apply_match_result: p_match_id is required' USING ERRCODE = '22004';
  END IF;
  IF jsonb_typeof(p_players) IS DISTINCT FROM 'array' OR jsonb_array_length(p_players) <> 2 THEN
    RAISE EXCEPTION 'rating_apply_match_result: p_players must be an array of exactly two entries' USING ERRCODE = '22023';
  END IF;

  -- 1. Payload validation (before any lock or write).
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

  -- 2. Per-player advisory locks, ascending id order (shared with rating_replace_player_history).
  FOR v_player_id IN SELECT unnest(v_ids) ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext('rating_replace_player_history'), hashtext(v_player_id::text));
  END LOOP;

  -- 3. The match must still be completed, between exactly these two players.
  SELECT player_1_id, player_2_id, status INTO v_match FROM matches WHERE id = p_match_id FOR SHARE;
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

  -- 4. Idempotency on the history rows (read under the locks).
  SELECT count(*) INTO v_history_count
    FROM rating_history
   WHERE match_id = p_match_id AND player_id = ANY (v_ids);
  IF v_history_count = 2 THEN
    RETURN 'already_applied';
  END IF;
  IF v_history_count = 1 THEN
    RETURN 'history_incomplete';
  END IF;

  -- 5. Fence: the stored state must still be the one the caller computed from.
  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_players)
  LOOP
    v_expected := v_entry -> 'expected';
    SELECT rating, rd, volatility, wins, losses, draws INTO v_current
      FROM player_ratings WHERE player_id = (v_entry ->> 'player_id')::uuid;
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

  -- 6. Both ratings and both history rows, one transaction.
  INSERT INTO player_ratings (
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

  -- NOT NULL, the result CHECK and UNIQUE (player_id, match_id) reject a bad row; the whole call then rolls back.
  INSERT INTO rating_history (
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

COMMENT ON FUNCTION public.rating_apply_match_result(uuid, jsonb) IS
  'Atomically write one completed match''s live rating change (both player_ratings rows and both rating_history rows), under the per-player advisory locks shared with rating_replace_player_history, fenced on the stored rating state the caller computed from. Returns applied | already_applied | stale | history_incomplete | match_missing | match_not_completed. Service-role only.';

REVOKE ALL ON FUNCTION public.rating_apply_match_result(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rating_apply_match_result(uuid, jsonb) TO service_role;

DROP FUNCTION IF EXISTS public.rating_replace_player_history(uuid, jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.rating_replace_player_history(
  p_player_id uuid,
  p_state jsonb,
  p_history jsonb,
  p_expected_history_match_ids uuid[] DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_key text;
  v_bad integer;
  v_inserted integer;
  v_unexpected uuid;
BEGIN
  IF p_player_id IS NULL THEN
    RAISE EXCEPTION 'p_player_id is required' USING ERRCODE = '22004';
  END IF;

  IF p_state IS NULL OR jsonb_typeof(p_state) <> 'object' THEN
    RAISE EXCEPTION 'p_state must be a JSON object' USING ERRCODE = '22023';
  END IF;

  FOREACH v_key IN ARRAY ARRAY['rating', 'rd', 'volatility', 'peak_rating', 'wins', 'losses', 'draws'] LOOP
    IF jsonb_typeof(p_state -> v_key) IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'p_state.% must be a number', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF p_history IS NULL OR jsonb_typeof(p_history) <> 'array' THEN
    RAISE EXCEPTION 'p_history must be a JSON array' USING ERRCODE = '22023';
  END IF;

  -- Every history row must be an object that belongs to p_player_id: a rebuild may only rewrite its own player.
  SELECT count(*) INTO v_bad
    FROM jsonb_array_elements(p_history) AS e(row_value)
   WHERE jsonb_typeof(e.row_value) <> 'object'
      OR jsonb_typeof(e.row_value -> 'player_id') IS DISTINCT FROM 'string'
      OR lower(e.row_value ->> 'player_id') <> p_player_id::text;
  IF v_bad > 0 THEN
    RAISE EXCEPTION '% p_history row(s) are not objects for player %', v_bad, p_player_id USING ERRCODE = '22023';
  END IF;

  -- Serialize concurrent replaces of the same player (two-key form; the first key namespaces this function).
  -- rating_apply_match_result takes the same lock before its live write.
  PERFORM pg_advisory_xact_lock(hashtext('rating_replace_player_history'), hashtext(p_player_id::text));

  -- History fence (round 3). Runs after the lock, in a fresh READ COMMITTED snapshot, so a live apply that
  -- committed while this call waited for the lock is visible here.
  IF p_expected_history_match_ids IS NOT NULL THEN
    SELECT h.match_id INTO v_unexpected
      FROM public.rating_history h
      JOIN public.matches m ON m.id = h.match_id
     WHERE h.player_id = p_player_id
       AND m.status = 'completed'
       AND NOT (h.match_id = ANY (p_expected_history_match_ids))
     LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'rating_replace_player_history: player % gained a rating_history row for match % after the replay read it',
        p_player_id, v_unexpected
        USING ERRCODE = '40001';
    END IF;
  END IF;

  INSERT INTO public.player_ratings (
    player_id,
    rating,
    rd,
    volatility,
    peak_rating,
    peak_date,
    wins,
    losses,
    draws,
    last_match_at,
    updated_at
  ) VALUES (
    p_player_id,
    (p_state ->> 'rating')::numeric,
    (p_state ->> 'rd')::numeric,
    (p_state ->> 'volatility')::numeric,
    (p_state ->> 'peak_rating')::numeric,
    NULLIF(p_state ->> 'peak_date', '')::timestamptz,
    (p_state ->> 'wins')::integer,
    (p_state ->> 'losses')::integer,
    (p_state ->> 'draws')::integer,
    NULLIF(p_state ->> 'last_match_at', '')::timestamptz,
    COALESCE(NULLIF(p_state ->> 'updated_at', '')::timestamptz, now())
  )
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

  DELETE FROM public.rating_history
   WHERE player_id = p_player_id;

  -- NOT NULL, the result CHECK and UNIQUE (player_id, match_id) reject a bad row; the whole call then rolls back.
  INSERT INTO public.rating_history (
    player_id,
    match_id,
    rating_before,
    rating_after,
    rd_before,
    rd_after,
    opponent_id,
    opponent_rating,
    result,
    recorded_at
  )
  SELECT
    p_player_id,
    r.match_id,
    r.rating_before,
    r.rating_after,
    r.rd_before,
    r.rd_after,
    r.opponent_id,
    r.opponent_rating,
    r.result,
    COALESCE(r.recorded_at, now())
  FROM jsonb_to_recordset(p_history) AS r(
    match_id uuid,
    rating_before numeric,
    rating_after numeric,
    rd_before numeric,
    rd_after numeric,
    opponent_id uuid,
    opponent_rating numeric,
    result text,
    recorded_at timestamptz
  );
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION public.rating_replace_player_history(uuid, jsonb, jsonb, uuid[]) IS
  'Atomically replace one player''s rating curve: upsert player_ratings, delete and re-insert that player''s rating_history rows (single transaction, per-player advisory lock shared with rating_apply_match_result). Fenced on p_expected_history_match_ids (the player''s own history rows the replay read): a row for a completed match outside it raises 40001 with nothing written. Returns the number of history rows inserted. Service-role only.';

REVOKE ALL ON FUNCTION public.rating_replace_player_history(uuid, jsonb, jsonb, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rating_replace_player_history(uuid, jsonb, jsonb, uuid[]) TO service_role;

COMMIT;

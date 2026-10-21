-- Atomic replace of one player's rating curve (code review H13).
--
-- The chronological rating rebuild (src/lib/rating/updateRatings.ts, rebuildRatingsForPlayer) used to write a player's
-- curve as three separate PostgREST calls: upsert player_ratings, DELETE every rating_history row of the player, then
-- one batch INSERT of the replayed rows. A failure between the delete and the insert left the player with no history
-- at all. Every opponent rebuilt inside that window read the missing rows as "no frozen state", fell back to the
-- initial rating and persisted a wrong curve, and a rerun spread the damage further.
--
-- This migration adds public.rating_replace_player_history, which does all three writes in ONE transaction:
--   * validates the payload (state object with every non-null column, history array whose rows all belong to the
--     player) and raises before writing anything when it is malformed;
--   * takes a transaction-scoped advisory lock per player, so two replaces of the same player serialize instead of
--     interleaving their delete and insert;
--   * upserts player_ratings (ON CONFLICT on uq_player_ratings_player), deletes the player's rating_history rows and
--     inserts the replayed rows with their match-time recorded_at (so the public history keeps its order);
--   * returns the number of history rows inserted, which the caller checks against the payload length.
-- Under READ COMMITTED a concurrent reader now sees either the old or the new complete set, never an empty one.
--
-- No table changes; RLS on player_ratings and rating_history is unchanged (both enabled by the baseline). EXECUTE is
-- granted to service_role only.
BEGIN;

CREATE OR REPLACE FUNCTION public.rating_replace_player_history(
  p_player_id uuid,
  p_state jsonb,
  p_history jsonb
) RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_key text;
  v_bad integer;
  v_inserted integer;
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
  PERFORM pg_advisory_xact_lock(hashtext('rating_replace_player_history'), hashtext(p_player_id::text));

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

COMMENT ON FUNCTION public.rating_replace_player_history(uuid, jsonb, jsonb) IS
  'Atomically replace one player''s rating curve: upsert player_ratings, delete and re-insert that player''s rating_history rows (single transaction, per-player advisory lock). Returns the number of history rows inserted. Service-role only.';

REVOKE ALL ON FUNCTION public.rating_replace_player_history(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rating_replace_player_history(uuid, jsonb, jsonb) TO service_role;

COMMIT;

-- Streak rebuild in ONE fenced write (issue #44).
--
-- recomputeStreaks (src/lib/gamification/streaks.ts) used to zero a player's player_streaks row and then replay
-- every completed match through the incremental updateStreaks, one read-modify-write per match, with no lock:
--   * the row was observably zero while the replay ran, and a failure half way left a partial row;
--   * two finalizations (or a finalize and a rebuild) of one player interleaved their read-modify-writes, so one
--     match's increment could be lost or counted twice.
--
-- public.streaks_replace_player(p_player_id, p_state, p_expected_match_ids) takes the computed row (the TypeScript
-- replay stays the single implementation of the rules) and writes it atomically and fenced:
--   1. validates the payload (nine numbers and an optional last_match_id);
--   2. takes a per-player advisory lock, so two writers of one player serialise (the same two-key form the rating
--      writers use, under its own namespace);
--   3. fence, evaluated after the lock in a fresh READ COMMITTED snapshot: the player's set of COMPLETED matches
--      must equal p_expected_match_ids, the set the replay read. A match that completed (or was reset) after the
--      read raises SQLSTATE PT409 with nothing written; the caller re-reads and replays once more;
--   4. upserts the player's row (one row per player, uq_player_streaks_player).
-- There is no zeroing step: the row goes from its old values to the new ones in one statement.
--
-- The refusal is SQLSTATE PT409 (PostgREST's custom-error form, answered as HTTP 409), not 40001: a 40001
-- raised inside a function never gets an answer from PostgREST: the request hangs until the gateway returns 504 after
-- 60 s (reproduced on the local stack with a function that only raises 40001).
--
-- No table changes; RLS on player_streaks and matches is unchanged. Grants: service_role only.
BEGIN;

CREATE OR REPLACE FUNCTION public.streaks_replace_player(
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
BEGIN
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

  PERFORM pg_advisory_xact_lock(hashtext('streaks_replace_player'), hashtext(p_player_id::text));

  SELECT coalesce(array_agg(m.id ORDER BY m.id), '{}'::uuid[]) INTO v_current
    FROM public.matches m
   WHERE m.status = 'completed'
     AND (m.player_1_id = p_player_id OR m.player_2_id = p_player_id);

  IF v_current IS DISTINCT FROM coalesce(
       (SELECT array_agg(DISTINCT e ORDER BY e) FROM unnest(p_expected_match_ids) AS e), '{}'::uuid[]) THEN
    RAISE EXCEPTION 'streaks_replace_player: the completed matches of player % changed after the replay read them', p_player_id
      USING ERRCODE = 'PT409';
  END IF;

  INSERT INTO public.player_streaks (
    player_id,
    current_win_streak, best_win_streak,
    current_loss_streak, best_loss_streak,
    current_ko_streak, best_ko_streak,
    current_flawless_streak, best_flawless_streak,
    last_match_id, updated_at
  ) VALUES (
    p_player_id,
    (p_state ->> 'current_win_streak')::integer, (p_state ->> 'best_win_streak')::integer,
    (p_state ->> 'current_loss_streak')::integer, (p_state ->> 'best_loss_streak')::integer,
    (p_state ->> 'current_ko_streak')::integer, (p_state ->> 'best_ko_streak')::integer,
    (p_state ->> 'current_flawless_streak')::integer, (p_state ->> 'best_flawless_streak')::integer,
    v_last_match_id, now()
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
    updated_at = EXCLUDED.updated_at;
END;
$$;

COMMENT ON FUNCTION public.streaks_replace_player(uuid, jsonb, uuid[]) IS
  'Atomically replace one player''s player_streaks row with the replayed values, under a per-player advisory lock. Fenced on p_expected_match_ids (the player''s completed matches the replay read): a different completed set raises PT409 with nothing written. Service-role only.';

REVOKE ALL ON FUNCTION public.streaks_replace_player(uuid, jsonb, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.streaks_replace_player(uuid, jsonb, uuid[]) TO service_role;

COMMIT;

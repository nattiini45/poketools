-- Aggregate rollback: atomic, fenced and race-free (L-MATCH round-2 gate majors; lead ruling round 3).
--
-- Before this migration the synchronous rollback of one game (admin edit, delete, match reset; see
-- src/lib/pkmn/game-pipeline.ts) sent THREE requests: batch_decrement_aggregates and
-- batch_decrement_player_aggregates in parallel, then a separate UPDATE clearing games.aggregate_applied_at.
--   * Nothing fenced them: two concurrent edits or deletes of one game both read the marker as set and both
--     decremented, so the game was subtracted twice and added once. A partial failure (one decrement committed,
--     the other or the marker clear failed, or a response was lost) made a retry decrement again.
--   * Both decrement bodies read total_appearances WITHOUT a row lock and then wrote the stale value back
--     absolutely (or deleted the row when that stale value reached 0). Two decrements of one row lost one; a
--     decrement overlapping a queue apply (batch_upsert_*, relative) could overwrite its increment or delete the
--     whole row. resetMatch rolls a match's games back in parallel, and games of one match share Pokemon rows.
--
-- This migration:
--   batch_decrement_aggregates / batch_decrement_player_aggregates
--       Same signatures, same delta format (built in TS by buildGameAggregateDeltas), same clamping at 0 and the
--       same delete-at-zero rule, but race-free: ONE relative UPDATE ... RETURNING per delta (the UPDATE takes the
--       row lock and re-evaluates against the latest committed version under READ COMMITTED), then the row is
--       deleted only when the count it RETURNED is 0, re-checked in the DELETE's own WHERE, while this
--       transaction still holds the row lock. No value computed from an unlocked read is ever written.
--       The previous bodies are the baseline ones (20260608100000; search_path pinned by 20260608100003), and
--       no later migration redefined them; the live local definitions were read with pg_get_functiondef before
--       this file was written.
--   rollback_game_aggregates(p_game_id, p_expected_applied_at, p_aggregate_deltas, p_player_deltas)
--       Decrements both aggregate tables AND clears games.aggregate_applied_at in ONE transaction, fenced on the
--       marker, under the game row lock (FOR UPDATE, the same lock apply_aggregate_job takes, so an apply and a
--       rollback of one game serialise).
--       The fence is the exact marker value the caller read together with the battle stats it built the deltas
--       from. Every path that changes a game's stats first clears the marker (editGame, delete), and every apply
--       sets a fresh now(), so "marker still equals what I read" proves the deltas describe what was counted.
--       Outcomes (exhaustive; the TS wrapper throws on anything else):
--         'rolled_back'     the marker matched: both tables decremented, marker cleared
--         'not_applied'     the marker is NULL (never applied, or already rolled back, e.g. a retry after a lost
--                           response, or a concurrent rollback that won): nothing changed (idempotent)
--         'marker_changed'  the marker is set but differs from the caller's: the game was re-applied after the
--                           caller read it (a concurrent edit); nothing changed, the caller must re-read
--         'game_missing'    the game row is gone: nothing changed
--       Any error rolls back all writes, so a failure leaves the counts and the marker exactly as they were.
--       Lock order: game row, then aggregates rows, then player_aggregates rows, each in the deltas' sort order
--       (scope_type, scope_id, pokemon_name, player_id), the same order apply_aggregate_job uses, so concurrent
--       applies and rollbacks of games that share rows cannot deadlock.
--
-- No table changes; RLS on aggregates, player_aggregates and games is unchanged. Grants: service_role only
-- (20261008081443_close_public_api_roles.sql). CREATE OR REPLACE keeps the decrement functions' (already closed)
-- ACL; restated anyway.
BEGIN;

CREATE OR REPLACE FUNCTION public.batch_decrement_aggregates(p_deltas jsonb)
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
    v_id := NULL;
    -- Relative write under the row lock: a concurrent decrement or increment of this row is applied on top of
    -- the latest committed version, never overwritten.
    UPDATE aggregates SET
      total_appearances = GREATEST(0, total_appearances - (d->>'appearances')::int),
      total_brought = GREATEST(0, total_brought - (d->>'brought')::int),
      total_led = GREATEST(0, total_led - (d->>'led')::int),
      total_kos_dealt = GREATEST(0, total_kos_dealt - (d->>'kos_dealt')::int),
      total_koed = GREATEST(0, total_koed - (d->>'koed')::int),
      total_wins = GREATEST(0, total_wins - (d->>'wins')::int),
      total_games = GREATEST(0, total_games - (d->>'games')::int),
      move_counts = subtract_move_counts(move_counts, d->'move_counts'),
      last_updated = now()
    WHERE scope_type = (d->>'scope_type')::aggregate_scope
      AND COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid) =
          COALESCE((d->>'scope_id')::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
      AND pokemon_name = d->>'pokemon_name'
    RETURNING id, total_appearances INTO v_id, v_remaining;

    IF v_id IS NULL THEN
      CONTINUE; -- no row for this key (never counted, or already removed): nothing to subtract
    END IF;

    IF v_remaining = 0 THEN
      -- This transaction holds the row lock since the UPDATE; the WHERE re-checks the count anyway.
      DELETE FROM aggregates WHERE id = v_id AND total_appearances = 0;
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.batch_decrement_aggregates(jsonb) IS
  'Subtract per-Pokemon deltas from aggregates (clamped at 0); a row whose appearances reach 0 is deleted. Race-free: one relative UPDATE ... RETURNING per delta under the row lock. Used inside rollback_game_aggregates. Service-role only.';

CREATE OR REPLACE FUNCTION public.batch_decrement_player_aggregates(p_deltas jsonb)
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
    v_id := NULL;
    UPDATE player_aggregates SET
      total_appearances = GREATEST(0, total_appearances - (d->>'appearances')::int),
      total_brought = GREATEST(0, total_brought - (d->>'brought')::int),
      total_led = GREATEST(0, total_led - (d->>'led')::int),
      total_kos_dealt = GREATEST(0, total_kos_dealt - (d->>'kos_dealt')::int),
      total_koed = GREATEST(0, total_koed - (d->>'koed')::int),
      total_wins = GREATEST(0, total_wins - (d->>'wins')::int),
      total_games = GREATEST(0, total_games - (d->>'games')::int),
      move_counts = subtract_move_counts(move_counts, d->'move_counts'),
      last_updated = now()
    WHERE scope_type = (d->>'scope_type')::aggregate_scope
      AND COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid) =
          COALESCE((d->>'scope_id')::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
      AND player_id = (d->>'player_id')::uuid
      AND pokemon_name = d->>'pokemon_name'
    RETURNING id, total_appearances INTO v_id, v_remaining;

    IF v_id IS NULL THEN
      CONTINUE;
    END IF;

    IF v_remaining = 0 THEN
      DELETE FROM player_aggregates WHERE id = v_id AND total_appearances = 0;
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.batch_decrement_player_aggregates(jsonb) IS
  'Subtract per-player, per-Pokemon deltas from player_aggregates (clamped at 0); a row whose appearances reach 0 is deleted. Race-free: one relative UPDATE ... RETURNING per delta under the row lock. Used inside rollback_game_aggregates. Service-role only.';

CREATE OR REPLACE FUNCTION public.rollback_game_aggregates(
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
BEGIN
  IF p_game_id IS NULL OR p_expected_applied_at IS NULL THEN
    RAISE EXCEPTION 'rollback_game_aggregates: game id and expected marker are required' USING ERRCODE = '22004';
  END IF;
  IF jsonb_typeof(p_aggregate_deltas) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_player_deltas) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'rollback_game_aggregates: deltas must be JSON arrays' USING ERRCODE = '22023';
  END IF;

  -- 1. Game row lock first (same as apply_aggregate_job): applies and rollbacks of one game serialise here, and
  --    the second one sees the first one's marker.
  SELECT aggregate_applied_at INTO v_applied_at FROM games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'game_missing';
  END IF;

  -- 2. Fence on the marker the caller's deltas were built under.
  IF v_applied_at IS NULL THEN
    RETURN 'not_applied';
  END IF;
  IF v_applied_at IS DISTINCT FROM p_expected_applied_at THEN
    RETURN 'marker_changed';
  END IF;

  -- 3. Decrements (fixed table order: aggregates, then player_aggregates).
  PERFORM batch_decrement_aggregates(p_aggregate_deltas);
  PERFORM batch_decrement_player_aggregates(p_player_deltas);

  -- 4. Marker, in the same transaction as the decrements.
  UPDATE games SET aggregate_applied_at = NULL WHERE id = p_game_id;

  RETURN 'rolled_back';
END;
$$;

COMMENT ON FUNCTION public.rollback_game_aggregates(uuid, timestamptz, jsonb, jsonb) IS
  'Atomically subtract one game''s aggregate deltas (built in TS by buildGameAggregateDeltas) from aggregates and player_aggregates and clear games.aggregate_applied_at, fenced on the game row lock and on the marker equalling p_expected_applied_at. Returns rolled_back | not_applied | marker_changed | game_missing. Service-role only.';

REVOKE ALL ON FUNCTION
  public.batch_decrement_aggregates(jsonb),
  public.batch_decrement_player_aggregates(jsonb),
  public.rollback_game_aggregates(uuid, timestamptz, jsonb, jsonb)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.batch_decrement_aggregates(jsonb),
  public.batch_decrement_player_aggregates(jsonb),
  public.rollback_game_aggregates(uuid, timestamptz, jsonb, jsonb)
TO service_role;

COMMIT;

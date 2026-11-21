-- PostgREST never answers a 40001 raised inside a function: the request hangs until the gateway times out
-- after 60 s (measured on the local stack; see 20261102130000_streaks_replace_player.sql). Every refusal a
-- PostgREST caller must see therefore uses the custom-error form PT409, answered as HTTP 409. This migration
-- re-defines the two remaining fences that still raised 40001: the rating-history fence (test-league row and
-- unexpected completed row) and the guest-claim fence. Bodies are verbatim except ERRCODE.

BEGIN;

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
  v_test_match uuid;
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

  -- Test leagues stay out of ratings (20261019130000): a history row for a test-league match means the caller
  -- replayed against a flag that changed since its read. Refused as stale (PT409, nothing written): the TS
  -- rebuild re-reads the flag and the history and replays again.
  SELECT r.match_id INTO v_test_match
    FROM jsonb_to_recordset(p_history) AS r(match_id uuid)
   WHERE public.match_in_test_season(r.match_id)
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'rating_replace_player_history: player % history names match %, which belongs to a test league (kept out of ratings)',
      p_player_id, v_test_match
      USING ERRCODE = 'PT409';
  END IF;

  -- History fence (round 3). Runs after the lock, in a fresh READ COMMITTED snapshot, so a live apply that
  -- committed while this call waited for the lock is visible here. Rows of test-league matches are ignored: the
  -- replay never reads those matches, and the replace below deletes them.
  IF p_expected_history_match_ids IS NOT NULL THEN
    SELECT h.match_id INTO v_unexpected
      FROM public.rating_history h
      JOIN public.matches m ON m.id = h.match_id
     WHERE h.player_id = p_player_id
       AND m.status = 'completed'
       AND NOT (h.match_id = ANY (p_expected_history_match_ids))
       AND NOT public.match_in_test_season(h.match_id)
     LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'rating_replace_player_history: player % gained a rating_history row for match % after the replay read it',
        p_player_id, v_unexpected
        USING ERRCODE = 'PT409';
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
  'Atomically replace one player''s rating curve: upsert player_ratings, delete and re-insert that player''s rating_history rows (single transaction, per-player advisory lock shared with rating_apply_match_result). Fenced on p_expected_history_match_ids (the player''s own history rows the replay read;

CREATE OR REPLACE FUNCTION public.claim_guest_player(
  p_guest_id uuid,
  p_source_id uuid
) RETURNS public.players
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_guest public.players;
  v_source public.players;
  v_claimed public.players;
  v_ref record;
  v_referenced boolean;
BEGIN
  IF p_guest_id IS NULL OR p_source_id IS NULL THEN
    RAISE EXCEPTION 'p_guest_id and p_source_id are required' USING ERRCODE = '22004';
  END IF;
  IF p_guest_id = p_source_id THEN
    RAISE EXCEPTION 'Guest and source account must be different players' USING ERRCODE = '22023';
  END IF;

  -- Lock both rows in id order so two concurrent claims touching the same rows serialize.
  PERFORM 1 FROM public.players WHERE id IN (p_guest_id, p_source_id) ORDER BY id FOR UPDATE;

  SELECT * INTO v_guest FROM public.players WHERE id = p_guest_id;
  IF NOT FOUND OR NOT v_guest.is_guest THEN
    RAISE EXCEPTION 'Target player % is not a guest account', p_guest_id USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_source FROM public.players WHERE id = p_source_id;
  IF NOT FOUND OR v_source.is_guest THEN
    RAISE EXCEPTION 'Source player % is not a registered account', p_source_id USING ERRCODE = '22023';
  END IF;
  IF v_source.discord_id IS NULL AND v_source.auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Source player % has no linked identity', p_source_id USING ERRCODE = '22023';
  END IF;
  -- A banned or suspended source would hand its identity to an 'active' guest row and drop its
  -- ban_reason / suspended_until with the DELETE below, silently lifting the sanction.
  IF v_source.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Source player % is not in good standing (status %)', p_source_id, v_source.status
      USING ERRCODE = '55000';
  END IF;

  -- The DELETE below must not cascade into (or null out) the source's own rows: refuse while any
  -- CASCADE / SET NULL / SET DEFAULT reference still holds one. The source row is locked FOR UPDATE,
  -- so no new referencing row can commit until this transaction ends.
  FOR v_ref IN
    SELECT n.nspname AS ref_schema, cl.relname AS ref_table, a.attname AS ref_column
      FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = cl.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f'
       AND c.confrelid = 'public.players'::regclass
       AND c.confdeltype IN ('c', 'n', 'd')
       AND NOT EXISTS (SELECT 1 FROM public.player_claim_disposable_refs d WHERE d.table_ref = c.conrelid)
     ORDER BY n.nspname, cl.relname, a.attname
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.%I WHERE %I = $1)',
                   v_ref.ref_schema, v_ref.ref_table, v_ref.ref_column)
      INTO v_referenced
      USING p_source_id;
    IF v_referenced THEN
      RAISE EXCEPTION 'Source player % still owns rows in %.% (%)', p_source_id,
        v_ref.ref_schema, v_ref.ref_table, v_ref.ref_column
        USING ERRCODE = '23503';
    END IF;
  END LOOP;

  -- Delete first: frees the unique identity keys. 23503 here (a NO ACTION reference) aborts the whole claim.
  DELETE FROM public.players WHERE id = p_source_id;

  UPDATE public.players
     SET discord_id = v_source.discord_id,
         auth_user_id = v_source.auth_user_id,
         is_guest = false
   WHERE id = p_guest_id
     AND is_guest
  RETURNING * INTO v_claimed;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Guest player % changed during the claim', p_guest_id USING ERRCODE = 'PT409';
  END IF;

  RETURN v_claimed;
END;
$$;

COMMENT ON FUNCTION public.claim_guest_player(uuid, uuid) IS
  'Atomically move the Discord / Auth identity of a fresh registered player onto a guest row (is_guest -> false) and delete the source row. Raises 23503 when the source is still referenced (including rows its delete would cascade into) and 55000 when the source is banned or suspended. Service-role only.';

REVOKE ALL ON FUNCTION public.rating_replace_player_history(uuid, jsonb, jsonb, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rating_replace_player_history(uuid, jsonb, jsonb, uuid[]) TO service_role;

REVOKE ALL ON FUNCTION public.claim_guest_player(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_guest_player(uuid, uuid) TO service_role;

COMMIT;

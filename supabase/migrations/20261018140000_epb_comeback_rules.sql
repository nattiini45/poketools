-- Evolution Point Buy: Comeback Token rules (per-line comeback rate, first-half earning, no carried-over stock).
--
--   epb_spend_comeback_tokens   replaced (same signature as 20261012025134_epb_token_rpcs.sql):
--     * No carried-over comeback stock: the balance is p_earned_total − Σ epb_comeback_token_spends.amount. The one-shot
--       epb_token_grants (grant_type 'kill_token') are no longer subtracted (twin: comebackSpentTotal in
--       src/lib/draft/progress-engine.ts). A precondition below refuses the migration while any such grant row exists:
--       those grants were applied as kill_tokens progress, so dropping the subtraction would count them twice.
--     * Per-line comeback rate: each allocation may carry `ratio` (integer 1..10, default 1) = Comeback Tokens per
--       1 progress point on that line. The server computes it from the format pack (comebackTokensPerProgressOf in
--       src/lib/draft/special-rules.ts: the pack's participation-line rate, else 1); the client body cannot set it
--       (comebackSpendSchema is strict). `count` stays in tokens: epb_comeback_token_spends.amount = tokens and the
--       balance is in tokens; the tracker gets count / ratio progress (source 'kill_token'). A count that is not a
--       multiple of its ratio is refused before any write: COMEBACK_TOKENS_NOT_MULTIPLE, DETAIL {ratio}.
--     * Earning only in the first half needs no SQL change: the earned total is computed in TS
--       (computeEarnedComebackTokens, the pack's epb.comeback.earnWindow) and passed in, as before (BR-5).
--     * The replay branch changes for the no-carried-over-stock rule too: its balance_after is p_earned_total − Σ spends (it no longer
--       subtracts the kill_token grants either), the same balance as a first call.
--     Unchanged: the spend window (COMEBACK_NOT_YET), allocation validation, ownership (TRACKER_NOT_OWNED), the season
--     advisory lock and the draft__log row.
--
--   epb_token_grants: CHECK epb_token_grants_no_kill_token. The legacy grant writer epb_grant_and_apply_tokens
--     (20260728000000) still accepts p_grant_type 'kill_token'; a grant written after this migration would add progress
--     that nothing subtracts any more (counted twice). The constraint refuses every new kill_token grant, from any
--     writer. It is valid at once: the precondition below has just proved that no such row exists.
--
-- Deploy order (release checklist): (1) run `select count(*) from epb_token_grants where grant_type = 'kill_token'`
-- and expect 0 (the precondition aborts the migration otherwise); (2) apply this migration; (3) deploy the app release
-- that sends `ratio`. An older function ignores the key and would apply a participation-line spend 1:1. The function
-- keeps accepting allocations without `ratio` (rate 1).
-- No column or type changes, so src/types/database.ts is unchanged. Grants are re-stated: service_role only.
BEGIN;

-- Precondition (no carried-over comeback stock): no legacy one-shot Comeback grant may exist when its subtraction is removed.
DO $$
DECLARE v_rows bigint;
BEGIN
  SELECT count(*) INTO v_rows FROM public.epb_token_grants WHERE grant_type = 'kill_token';
  IF v_rows > 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = format('epb_comeback_rules: %s legacy kill_token grant row(s) exist in epb_token_grants; removing their '
                       'subtraction from the Comeback balance would count them twice (no carried-over comeback stock). Resolve them first.', v_rows),
      ERRCODE = 'P0001';
  END IF;
END $$;

-- No new legacy Comeback grant, from any writer (no carried-over comeback stock). Validated against the table the precondition just checked.
ALTER TABLE public.epb_token_grants
  ADD CONSTRAINT epb_token_grants_no_kill_token CHECK (grant_type <> 'kill_token');

CREATE OR REPLACE FUNCTION public.epb_spend_comeback_tokens(p_season_id uuid, p_player_id uuid, p_actor_id uuid,
  p_earned_total integer, p_allocations jsonb, p_client_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_open boolean; v_requested integer := 0; v_spent integer; v_balance integer; v_alloc jsonb; v_line text;
        v_count integer; v_ratio integer; v_progress integer := 0; v_tracker public.evolution_tracker;
        v_tracker_ids jsonb := '[]'::jsonb; v_pool uuid;
BEGIN
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'client_request_id')::text;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_season_id::text));

  -- replay
  IF EXISTS (SELECT 1 FROM public.epb_comeback_token_spends
              WHERE season_id = p_season_id AND player_id = p_player_id AND client_request_id = p_client_request_id) THEN
    SELECT COALESCE(sum(amount) FILTER (WHERE client_request_id = p_client_request_id), 0), COALESCE(sum(amount), 0)
      INTO v_requested, v_spent
      FROM public.epb_comeback_token_spends WHERE season_id = p_season_id AND player_id = p_player_id;
    RETURN jsonb_build_object('spent', v_requested, 'balance_after', GREATEST(0, COALESCE(p_earned_total, 0) - v_spent),
                              'replay', true);
  END IF;

  v_open := EXISTS (SELECT 1 FROM public.draft_pools WHERE season_id = p_season_id AND kind = 'redraft' AND phase = 'complete')
         OR COALESCE((SELECT comeback_spend_open FROM public.format_rules WHERE season_id = p_season_id), false);
  IF NOT v_open THEN RAISE EXCEPTION 'COMEBACK_NOT_YET' USING ERRCODE = 'P0001'; END IF;

  -- Shape checks. PostgreSQL does not promise left-to-right OR evaluation, so every cast sits behind its type test:
  -- the array test is its own IF, and each element is checked in a CASE (evaluated in order), so a non-numeric
  -- count or ratio is INVALID_CONFIG, never a cast error.
  IF p_allocations IS NULL OR jsonb_typeof(p_allocations) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'allocations')::text;
  END IF;
  IF jsonb_array_length(p_allocations) < 1
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_allocations) a
                 WHERE CASE
                         WHEN jsonb_typeof(a) IS DISTINCT FROM 'object' THEN true
                         WHEN jsonb_typeof(a->'line_id') IS DISTINCT FROM 'string' THEN true
                         WHEN jsonb_typeof(a->'count') IS DISTINCT FROM 'number' THEN true
                         WHEN (a->>'count')::numeric <> trunc((a->>'count')::numeric)
                              OR (a->>'count')::numeric NOT BETWEEN 1 AND 20 THEN true
                         WHEN NOT (a ? 'ratio') THEN false
                         WHEN jsonb_typeof(a->'ratio') IS DISTINCT FROM 'number' THEN true
                         ELSE (a->>'ratio')::numeric <> trunc((a->>'ratio')::numeric)
                              OR (a->>'ratio')::numeric NOT BETWEEN 1 AND 10
                       END)
     OR (SELECT count(*) FROM jsonb_array_elements(p_allocations)) <>
        (SELECT count(DISTINCT a->>'line_id') FROM jsonb_array_elements(p_allocations) a) THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'allocations')::text;
  END IF;

  -- Per-line comeback rate: whole progress points only (tokens on a line must be a multiple of its rate); checked before any write.
  SELECT COALESCE((a->>'ratio')::numeric::int, 1) INTO v_ratio FROM jsonb_array_elements(p_allocations) a
   WHERE (a->>'count')::numeric::int % COALESCE((a->>'ratio')::numeric::int, 1) <> 0
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'COMEBACK_TOKENS_NOT_MULTIPLE' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('ratio', v_ratio)::text;
  END IF;

  SELECT sum((a->>'count')::numeric::int) INTO v_requested FROM jsonb_array_elements(p_allocations) a;
  -- spent = Σ spends in tokens; no legacy kill_token grant stock (no carried-over comeback stock; twin of comebackSpentTotal in TS)
  SELECT COALESCE(sum(amount), 0) INTO v_spent FROM public.epb_comeback_token_spends
   WHERE season_id = p_season_id AND player_id = p_player_id;
  v_balance := COALESCE(p_earned_total, 0) - v_spent;
  IF v_balance < v_requested THEN
    RAISE EXCEPTION 'COMEBACK_BALANCE_SHORT' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('balance', GREATEST(v_balance, 0))::text;
  END IF;

  FOR v_alloc IN SELECT a FROM jsonb_array_elements(p_allocations) AS a LOOP
    v_line := v_alloc->>'line_id';
    v_count := (v_alloc->>'count')::numeric::int;
    v_ratio := COALESCE((v_alloc->>'ratio')::numeric::int, 1);
    SELECT * INTO v_tracker FROM public.evolution_tracker
     WHERE season_id = p_season_id AND player_id = p_player_id AND line_id = v_line FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'TRACKER_NOT_OWNED' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('line_id', v_line)::text;
    END IF;
    -- The ledger keeps tokens; the tracker gets progress.
    INSERT INTO public.epb_comeback_token_spends (season_id, player_id, line_id, tracker_id, amount, client_request_id, created_by)
    VALUES (p_season_id, p_player_id, v_line, v_tracker.id, v_count, p_client_request_id, p_actor_id);
    PERFORM public.epb_apply_progress(v_tracker.id, 'kill_token', v_count / v_ratio, NULL, 'Comeback Token', p_actor_id);
    v_progress := v_progress + v_count / v_ratio;
    v_tracker_ids := v_tracker_ids || to_jsonb(v_tracker.id);
  END LOOP;

  v_pool := COALESCE(
    (SELECT id FROM public.draft_pools WHERE season_id = p_season_id AND kind = 'redraft' AND phase <> 'cancelled' LIMIT 1),
    (SELECT id FROM public.draft_pools WHERE season_id = p_season_id AND kind = 'initial'));
  PERFORM public.draft__log(p_season_id, v_pool, p_actor_id,
    CASE WHEN p_actor_id IS NOT DISTINCT FROM p_player_id THEN 'player' ELSE 'admin' END, 'comeback_spent',
    p_player_id => p_player_id,
    p_after => jsonb_build_object('allocations', p_allocations, 'balance_after', v_balance - v_requested,
                                  'progress', v_progress),
    p_client_request_id => p_client_request_id);
  -- Stage changes are applied by TS right after (recheckEpbStages), as for every other progress write.
  RETURN jsonb_build_object('spent', v_requested, 'balance_after', v_balance - v_requested, 'progress', v_progress,
                            'tracker_ids', v_tracker_ids, 'replay', false);
END $$;

COMMENT ON FUNCTION public.epb_spend_comeback_tokens(uuid, uuid, uuid, integer, jsonb, uuid) IS
  'Spend Comeback Tokens on own lines under the season lock (BR-5): balance = p_earned_total (TS, inside the pack earn window) - sum of epb_comeback_token_spends (tokens; no carried-over kill_token grant stock). Each allocation {line_id, count, ratio?}: count tokens buy count / ratio progress (ratio 1..10, default 1: the per-line comeback rate); a count that is not a multiple of its ratio raises COMEBACK_TOKENS_NOT_MULTIPLE. Service-role only.';

REVOKE ALL ON FUNCTION
  public.epb_spend_comeback_tokens(uuid, uuid, uuid, integer, jsonb, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.epb_spend_comeback_tokens(uuid, uuid, uuid, integer, jsonb, uuid)
TO service_role;

COMMIT;

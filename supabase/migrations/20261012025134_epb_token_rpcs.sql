-- EPB token RPCs and the trade-execution replacement (EvoLiga draft tool, Prompt 7; draft-backend §6.9–§6.10,
-- package B-RPC, migration M7).
--
--   epb_purchase_draft_token     one Draft Kill Token per request (BR-4): 3 points, max 2 per player, max 1 per line,
--                                never triggers an evolution. Refusal order = draftKillLineRefusal in src/lib/draft/tokens.ts:
--                                window → player limit → line limit → points → owned → fully evolved → would evolve.
--   epb_spend_comeback_tokens    Comeback Tokens (BR-5): balance = earned (TS, from completed matches) − Σ spends
--                                − legacy one-shot kill_token grants (epb_token_grants), re-checked here under the
--                                season lock; open after the redraft or by the admin switch.
--   epb_set_comeback_spend_open  that admin switch.
--   epb_execute_trade_request    replaced (§6.10): initial-pool budget via epb__season_remaining_points, branch-exact
--                                free-line check by line_id, new trackers carry line_id and put the transferred amount into
--                                transferred_evo_progress (never real_kills, SPEC:776-785), and the source trackers are
--                                deleted BEFORE the new ones are inserted (the (season, line_id) unique index of M1).
--                                Its legacy error texts are unchanged: the consent route maps them to errors/draft-legacy.
-- Conventions as in M5. Every function here takes the per-season advisory lock.
--
-- Placeholder version: renamed to the recorded version at apply time (APPLY package). Not applied by B-RPC.
BEGIN;

CREATE OR REPLACE FUNCTION public.epb_purchase_draft_token(p_season_id uuid, p_player_id uuid, p_actor_id uuid, p_line_id text,
  p_next_threshold integer, p_client_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_existing public.epb_draft_token_purchases; v_initial public.draft_pools; v_rules public.format_rules;
        v_closed boolean; v_owned integer; v_line_has boolean; v_remaining integer; v_tracker public.evolution_tracker;
        v_after public.evolution_tracker; v_purchase_id uuid;
BEGIN
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'client_request_id')::text;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_season_id::text));

  -- replay: the same request id returns the first purchase
  SELECT * INTO v_existing FROM public.epb_draft_token_purchases
   WHERE season_id = p_season_id AND player_id = p_player_id AND client_request_id = p_client_request_id;
  IF FOUND THEN
    RETURN jsonb_build_object('purchase_id', v_existing.id, 'tracker_id', v_existing.tracker_id, 'line_id', v_existing.line_id,
      'points_spent', v_existing.points_spent, 'replay', true);
  END IF;

  SELECT * INTO v_rules FROM public.format_rules WHERE season_id = p_season_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'format_rules')::text;
  END IF;

  -- 1. window (critique B10; twin of draftKillTokenWindow): open after the initial draft, until the explicit cutoff or,
  --    without one, until the first completed match of the season (owner ruling).
  SELECT * INTO v_initial FROM public.draft_pools WHERE season_id = p_season_id AND kind = 'initial';
  IF NOT FOUND OR v_initial.phase <> 'complete' THEN
    RAISE EXCEPTION 'TOKEN_WINDOW_CLOSED' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('window', 'before')::text;
  END IF;
  IF v_initial.token_purchase_closes_at IS NOT NULL THEN
    v_closed := now() >= v_initial.token_purchase_closes_at;
  ELSE
    v_closed := EXISTS (SELECT 1 FROM public.matches m JOIN public.tournaments t ON t.id = m.tournament_id
                         WHERE t.season_id = p_season_id AND m.status = 'completed');
  END IF;
  IF v_closed THEN
    RAISE EXCEPTION 'TOKEN_WINDOW_CLOSED' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('window', 'closed')::text;
  END IF;

  -- 2. player limit (purchases + legacy one-shot grant tokens)
  v_owned := (SELECT count(*) FROM public.epb_draft_token_purchases WHERE season_id = p_season_id AND player_id = p_player_id)
           + COALESCE((SELECT sum(token_count) FROM public.epb_token_grants
                        WHERE season_id = p_season_id AND player_id = p_player_id AND grant_type = 'draft_token'), 0);
  IF v_owned >= v_rules.draft_token_max THEN
    RAISE EXCEPTION 'TOKEN_PLAYER_LIMIT' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('max', v_rules.draft_token_max)::text;
  END IF;

  -- 3. line limit (a purchase on this line, or legacy draft tokens already on its tracker)
  v_line_has := EXISTS (SELECT 1 FROM public.epb_draft_token_purchases
                         WHERE season_id = p_season_id AND player_id = p_player_id AND line_id = p_line_id)
             OR EXISTS (SELECT 1 FROM public.evolution_tracker
                         WHERE season_id = p_season_id AND player_id = p_player_id AND line_id = p_line_id
                           AND draft_tokens >= v_rules.draft_token_max_per_line);
  IF v_line_has THEN RAISE EXCEPTION 'TOKEN_LINE_LIMIT' USING ERRCODE = 'P0001'; END IF;

  -- 4. unspent points
  v_remaining := COALESCE(public.epb__season_remaining_points(p_season_id, p_player_id), 0);
  IF v_remaining < v_rules.draft_token_ratio THEN
    RAISE EXCEPTION 'TOKEN_POINTS_SHORT' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('needed', v_rules.draft_token_ratio, 'remaining', v_remaining)::text;
  END IF;

  -- 5. owned line, 6. fully evolved, 7. may never trigger an evolution (progress read under the lock)
  SELECT * INTO v_tracker FROM public.evolution_tracker
   WHERE season_id = p_season_id AND player_id = p_player_id AND line_id = p_line_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRACKER_NOT_OWNED' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('line_id', p_line_id)::text;
  END IF;
  IF p_next_threshold IS NULL THEN RAISE EXCEPTION 'LINE_FULLY_EVOLVED' USING ERRCODE = 'P0001'; END IF;
  IF v_tracker.total_kos + 1 >= p_next_threshold THEN
    RAISE EXCEPTION 'TOKEN_WOULD_EVOLVE' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('next', p_next_threshold, 'progress', v_tracker.total_kos)::text;
  END IF;

  INSERT INTO public.epb_draft_token_purchases (season_id, player_id, line_id, tracker_id, points_spent, client_request_id, created_by)
  VALUES (p_season_id, p_player_id, p_line_id, v_tracker.id, v_rules.draft_token_ratio, p_client_request_id, p_actor_id)
  RETURNING id INTO v_purchase_id;
  v_after := public.epb_apply_progress(v_tracker.id, 'draft_token', 1, NULL, 'Draft Kill Token', p_actor_id);
  PERFORM public.draft__log(p_season_id, v_initial.id, p_actor_id,
    CASE WHEN p_actor_id IS NOT DISTINCT FROM p_player_id THEN 'player' ELSE 'admin' END, 'token_purchased',
    p_player_id => p_player_id, p_line_id => p_line_id,
    p_after => jsonb_build_object('purchase_id', v_purchase_id, 'points_spent', v_rules.draft_token_ratio,
                                  'progress', v_after.total_kos),
    p_client_request_id => p_client_request_id);
  RETURN jsonb_build_object('purchase_id', v_purchase_id, 'tracker_id', v_tracker.id, 'line_id', p_line_id,
    'points_spent', v_rules.draft_token_ratio, 'progress', v_after.total_kos,
    'remaining_points', v_remaining - v_rules.draft_token_ratio, 'replay', false);
END $$;

CREATE OR REPLACE FUNCTION public.epb_spend_comeback_tokens(p_season_id uuid, p_player_id uuid, p_actor_id uuid,
  p_earned_total integer, p_allocations jsonb, p_client_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_open boolean; v_requested integer := 0; v_spent integer; v_balance integer; v_alloc jsonb; v_line text;
        v_count integer; v_tracker public.evolution_tracker; v_tracker_ids jsonb := '[]'::jsonb; v_pool uuid;
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
    v_spent := v_spent + COALESCE((SELECT sum(token_count) FROM public.epb_token_grants
                                    WHERE season_id = p_season_id AND player_id = p_player_id AND grant_type = 'kill_token'), 0);
    RETURN jsonb_build_object('spent', v_requested, 'balance_after', GREATEST(0, COALESCE(p_earned_total, 0) - v_spent),
                              'replay', true);
  END IF;

  v_open := EXISTS (SELECT 1 FROM public.draft_pools WHERE season_id = p_season_id AND kind = 'redraft' AND phase = 'complete')
         OR COALESCE((SELECT comeback_spend_open FROM public.format_rules WHERE season_id = p_season_id), false);
  IF NOT v_open THEN RAISE EXCEPTION 'COMEBACK_NOT_YET' USING ERRCODE = 'P0001'; END IF;

  IF p_allocations IS NULL OR jsonb_typeof(p_allocations) <> 'array' OR jsonb_array_length(p_allocations) < 1
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_allocations) a
                 WHERE jsonb_typeof(a->'line_id') IS DISTINCT FROM 'string' OR jsonb_typeof(a->'count') IS DISTINCT FROM 'number'
                    OR (a->>'count')::numeric <> trunc((a->>'count')::numeric) OR (a->>'count')::numeric NOT BETWEEN 1 AND 20)
     OR (SELECT count(*) FROM jsonb_array_elements(p_allocations)) <>
        (SELECT count(DISTINCT a->>'line_id') FROM jsonb_array_elements(p_allocations) a) THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'allocations')::text;
  END IF;
  SELECT sum((a->>'count')::int) INTO v_requested FROM jsonb_array_elements(p_allocations) a;
  -- spent = Σ spends + legacy one-shot kill_token distributions (epb_token_grants; twin of comebackSpentTotal in TS)
  SELECT COALESCE(sum(amount), 0) INTO v_spent FROM public.epb_comeback_token_spends
   WHERE season_id = p_season_id AND player_id = p_player_id;
  v_spent := v_spent + COALESCE((SELECT sum(token_count) FROM public.epb_token_grants
                                  WHERE season_id = p_season_id AND player_id = p_player_id AND grant_type = 'kill_token'), 0);
  v_balance := COALESCE(p_earned_total, 0) - v_spent;
  IF v_balance < v_requested THEN
    RAISE EXCEPTION 'COMEBACK_BALANCE_SHORT' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('balance', GREATEST(v_balance, 0))::text;
  END IF;

  FOR v_alloc IN SELECT a FROM jsonb_array_elements(p_allocations) AS a LOOP
    v_line := v_alloc->>'line_id';
    v_count := (v_alloc->>'count')::int;
    SELECT * INTO v_tracker FROM public.evolution_tracker
     WHERE season_id = p_season_id AND player_id = p_player_id AND line_id = v_line FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'TRACKER_NOT_OWNED' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('line_id', v_line)::text;
    END IF;
    INSERT INTO public.epb_comeback_token_spends (season_id, player_id, line_id, tracker_id, amount, client_request_id, created_by)
    VALUES (p_season_id, p_player_id, v_line, v_tracker.id, v_count, p_client_request_id, p_actor_id);
    PERFORM public.epb_apply_progress(v_tracker.id, 'kill_token', v_count, NULL, 'Comeback Token', p_actor_id);
    v_tracker_ids := v_tracker_ids || to_jsonb(v_tracker.id);
  END LOOP;

  v_pool := COALESCE(
    (SELECT id FROM public.draft_pools WHERE season_id = p_season_id AND kind = 'redraft' AND phase <> 'cancelled' LIMIT 1),
    (SELECT id FROM public.draft_pools WHERE season_id = p_season_id AND kind = 'initial'));
  PERFORM public.draft__log(p_season_id, v_pool, p_actor_id,
    CASE WHEN p_actor_id IS NOT DISTINCT FROM p_player_id THEN 'player' ELSE 'admin' END, 'comeback_spent',
    p_player_id => p_player_id,
    p_after => jsonb_build_object('allocations', p_allocations, 'balance_after', v_balance - v_requested),
    p_client_request_id => p_client_request_id);
  -- Stage changes are applied by TS right after (recheckEpbStages), as for every other progress write.
  RETURN jsonb_build_object('spent', v_requested, 'balance_after', v_balance - v_requested, 'tracker_ids', v_tracker_ids,
                            'replay', false);
END $$;

CREATE OR REPLACE FUNCTION public.epb_set_comeback_spend_open(p_season_id uuid, p_actor_id uuid, p_open boolean) RETURNS void
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_before boolean; v_pool uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_season_id::text));
  SELECT comeback_spend_open INTO v_before FROM public.format_rules WHERE season_id = p_season_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'format_rules')::text;
  END IF;
  UPDATE public.format_rules SET comeback_spend_open = COALESCE(p_open, false) WHERE season_id = p_season_id;
  v_pool := (SELECT id FROM public.draft_pools WHERE season_id = p_season_id AND kind = 'initial');
  PERFORM public.draft__log(p_season_id, v_pool, p_actor_id, 'admin', 'comeback_spend_opened',
    p_before => jsonb_build_object('open', v_before), p_after => jsonb_build_object('open', COALESCE(p_open, false)));
END $$;

-- §6.10: replaces 20260814182419. Signature, claim/phase checks and error texts unchanged.
CREATE OR REPLACE FUNCTION public.epb_execute_trade_request(
  p_request_id uuid,
  p_swaps jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_req public.redraft_trade_requests;
  v_season uuid;
  v_list uuid;
  v_phase boolean;
  v_swap jsonb;
  v_player uuid;
  v_cost integer;
  v_remaining integer;
  v_new jsonb;
  v_hist jsonb;
  v_from public.evolution_tracker;
  v_from_ids uuid[] := '{}';
  v_line text;
  v_lines text[] := '{}';
  v_transfer integer;
  v_real integer;
  v_new_id uuid;
  v_new_ids jsonb := '[]'::jsonb;
  i integer;
BEGIN
  -- 1. Row-lock the request; derive the season once.
  SELECT * INTO v_req FROM public.redraft_trade_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trade request not found' USING ERRCODE = 'P0001';
  END IF;
  v_season := v_req.season_id;

  -- 2. Serialize with every other draft/redraft/token write of this season.
  PERFORM pg_advisory_xact_lock(hashtext(v_season::text));

  -- 3. Atomic claim: still pending AND both consented.
  IF NOT (v_req.status = 'pending' AND v_req.consent_a AND v_req.consent_b) THEN
    RAISE EXCEPTION 'request_not_executable' USING ERRCODE = 'P0001';
  END IF;

  -- 4. Phase re-check inside the lock.
  SELECT fr.redraft_phase_open INTO v_phase FROM public.format_rules fr WHERE fr.season_id = v_season;
  IF NOT COALESCE(v_phase, false) THEN
    RAISE EXCEPTION 'phase_closed' USING ERRCODE = 'P0001';
  END IF;

  -- 5. Points re-check IN SQL with the one season ledger (initial pool budget; mirrors seasonRemainingPoints).
  FOR v_swap IN SELECT * FROM jsonb_array_elements(p_swaps) LOOP
    v_player := (v_swap->>'player_id')::uuid;
    v_cost := COALESCE((v_swap->'history'->>'points_spent')::integer, 0);
    v_remaining := public.epb__season_remaining_points(v_season, v_player);
    IF v_remaining IS NULL OR v_cost > v_remaining THEN
      RAISE EXCEPTION 'insufficient_points' USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- 6.1 Lock + validate every source tracker.
  FOR v_swap IN SELECT * FROM jsonb_array_elements(p_swaps) LOOP
    SELECT * INTO v_from FROM public.evolution_tracker
     WHERE id = (v_swap->>'from_tracker_id')::uuid AND season_id = v_season AND player_id = (v_swap->>'player_id')::uuid
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Source tracker % not found for this player in this season',
        v_swap->>'from_tracker_id' USING ERRCODE = 'P0001';
    END IF;
    v_from_ids := array_append(v_from_ids, v_from.id);
  END LOOP;

  -- 6.2 Resolve each target line id (payload line_id, else the season list: base + locked stage 3, else a unique base)
  --     and check that the line is free, ignoring lines leaving in this same batch (branch-exact, by line_id).
  SELECT s.point_buy_list_id INTO v_list FROM public.seasons s WHERE s.id = v_season;
  FOR v_swap IN SELECT * FROM jsonb_array_elements(p_swaps) LOOP
    v_new := v_swap->'new_tracker';
    v_line := NULLIF(v_new->>'line_id', '');
    IF v_line IS NULL AND v_list IS NOT NULL THEN
      v_line := (SELECT e.line_id FROM public.point_buy_list_entries e
                  WHERE e.list_version_id = v_list AND e.base_pokemon = v_new->>'base_pokemon'
                    AND e.stage3_pokemon IS NOT DISTINCT FROM NULLIF(v_new->>'locked_stage3_pokemon', '') LIMIT 1);
      IF v_line IS NULL THEN
        v_line := (SELECT min(e.line_id) FROM public.point_buy_list_entries e
                    WHERE e.list_version_id = v_list AND e.base_pokemon = v_new->>'base_pokemon'
                   HAVING count(*) = 1);
      END IF;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.evolution_tracker
       WHERE season_id = v_season AND NOT (id = ANY (v_from_ids))
         AND ((v_line IS NOT NULL AND line_id = v_line)
           OR (v_line IS NULL AND base_pokemon = v_new->>'base_pokemon'))
    ) OR (v_line IS NOT NULL AND v_line = ANY (v_lines)) THEN
      RAISE EXCEPTION 'Line % is already owned by another player',
        COALESCE(v_line, v_new->>'base_pokemon') USING ERRCODE = 'P0001';
    END IF;
    v_lines := array_append(v_lines, v_line);
  END LOOP;

  -- 6.3 History first (it references the still-existing source tracker; the FK is ON DELETE SET NULL).
  FOR v_swap IN SELECT * FROM jsonb_array_elements(p_swaps) LOOP
    v_hist := v_swap->'history';
    INSERT INTO public.redraft_history
      (season_id, player_id, from_tracker_id, to_base_pokemon, to_stage3_pokemon,
       transfer_type, trade_partner_id, missing_kills_transferred, points_spent)
    VALUES
      (v_season,
       (v_swap->>'player_id')::uuid,
       (v_swap->>'from_tracker_id')::uuid,
       v_hist->>'to_base_pokemon',
       v_hist->>'to_stage3_pokemon',
       v_hist->>'transfer_type',
       (v_hist->>'trade_partner_id')::uuid,
       COALESCE((v_hist->>'missing_kills_transferred')::integer, 0),
       COALESCE((v_hist->>'points_spent')::integer, 0));
  END LOOP;

  -- 6.4 Delete the sources BEFORE inserting: a swap A↔B would otherwise hit uq_evolution_tracker_season_line.
  DELETE FROM public.evolution_tracker WHERE id = ANY (v_from_ids);

  -- 6.5 New trackers. The transferred amount is evolution progress only (transferred_evo_progress), never real kills.
  i := 0;
  FOR v_swap IN SELECT * FROM jsonb_array_elements(p_swaps) LOOP
    i := i + 1;
    v_new := v_swap->'new_tracker';
    IF v_new ? 'transferred_evo_progress' THEN
      v_transfer := COALESCE((v_new->>'transferred_evo_progress')::integer, 0);
      v_real := COALESCE((v_new->>'real_kills')::integer, 0);
    ELSE                                                                -- legacy payload: real_kills carried the transfer
      v_transfer := COALESCE((v_new->>'real_kills')::integer, 0);
      v_real := 0;
    END IF;
    INSERT INTO public.evolution_tracker
      (season_id, player_id, base_pokemon, current_form, current_stage,
       total_kos, real_kills, transferred_evo_progress, evolution_points_awarded, locked_stage3_pokemon, line_id)
    VALUES
      (v_season,
       (v_swap->>'player_id')::uuid,
       v_new->>'base_pokemon',
       v_new->>'current_form',
       (v_new->>'current_stage')::integer,
       (v_new->>'total_kos')::integer,
       v_real,
       v_transfer,
       COALESCE((v_new->>'evolution_points_awarded')::integer, 0),
       v_new->>'locked_stage3_pokemon',
       v_lines[i])
    RETURNING id INTO v_new_id;
    v_new_ids := v_new_ids || to_jsonb(v_new_id);
  END LOOP;

  -- 7. Flip status atomically (row lock + step 3 already guarantee it is still pending).
  UPDATE public.redraft_trade_requests
     SET status = 'executed', executed_at = now(), executed_tracker_ids = v_new_ids
   WHERE id = p_request_id AND status = 'pending';

  RETURN v_new_ids;
END;
$$;

COMMENT ON FUNCTION public.epb_execute_trade_request(uuid, jsonb) IS
  'Atomically execute a consented EPB trade request under the season lock: claim (pending AND both consented), re-check redraft_phase_open, re-check each side''s points with epb__season_remaining_points (mirrors seasonRemainingPoints in src/lib/draft/budget.ts), branch-exact free-line check by line_id, history, delete sources, insert new trackers (line_id, transferred_evo_progress), flip to executed. Service-role only.';

REVOKE ALL ON FUNCTION
  public.epb_purchase_draft_token(uuid, uuid, uuid, text, integer, uuid),
  public.epb_spend_comeback_tokens(uuid, uuid, uuid, integer, jsonb, uuid),
  public.epb_set_comeback_spend_open(uuid, uuid, boolean),
  public.epb_execute_trade_request(uuid, jsonb)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.epb_purchase_draft_token(uuid, uuid, uuid, text, integer, uuid),
  public.epb_spend_comeback_tokens(uuid, uuid, uuid, integer, jsonb, uuid),
  public.epb_set_comeback_spend_open(uuid, uuid, boolean),
  public.epb_execute_trade_request(uuid, jsonb)
TO service_role;

COMMIT;

-- Draft Kill Tokens: a line may count as more than one token, at a proportional price.
--
-- A Draft Kill Token is one token against the player's allowance (draft_token_max) and costs draft_token_ratio points
-- for +1 progress. A line can carry a conversion rate (tokens per progress point, supplied by the application from the
-- active format pack): on such a line the one purchase per line counts as `rate` tokens against the allowance and costs
-- `rate` x draft_token_ratio points, and it still adds exactly +1 progress. Every other line uses rate 1, which is the
-- behaviour of before.
--
--   * epb_draft_token_purchases.tokens_used: the tokens one purchase counted for (1..10, default 1 for every existing
--     row). The points of a purchase stay in points_spent, so the budget readers need no change.
--   * epb_purchase_draft_token gains p_tokens_per_progress (default 1, validated 1..10). The player-allowance check
--     compares the tokens already owned (purchases weighted by tokens_used + legacy grant tokens) plus the new rate with
--     draft_token_max; the unspent-points check uses the scaled cost. The window, the line limit (one purchase per
--     line, and the legacy tracker comparison), the owned-line, fully-evolved and would-evolve checks are unchanged,
--     and so is the refusal order.
--
-- Everything else of epb_purchase_draft_token is the definition of 20261018180000_league_groups.sql, verbatim. The
-- signature changes, so the old one is dropped first and the privileges are re-issued (service_role only).
BEGIN;

ALTER TABLE public.epb_draft_token_purchases
  ADD COLUMN tokens_used smallint NOT NULL DEFAULT 1
  CONSTRAINT epb_draft_token_purchases_tokens_used_check CHECK (tokens_used BETWEEN 1 AND 10);

DROP FUNCTION public.epb_purchase_draft_token(uuid, uuid, uuid, text, integer, uuid);

CREATE FUNCTION public.epb_purchase_draft_token(p_season_id uuid, p_player_id uuid, p_actor_id uuid, p_line_id text,
  p_next_threshold integer, p_client_request_id uuid, p_tokens_per_progress integer DEFAULT 1) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_existing public.epb_draft_token_purchases; v_initial public.draft_pools; v_rules public.format_rules;
        v_closed boolean; v_owned integer; v_line_has boolean; v_remaining integer; v_tracker public.evolution_tracker;
        v_after public.evolution_tracker; v_purchase_id uuid; v_cost integer;
BEGIN
  IF p_client_request_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'client_request_id')::text;
  END IF;
  IF p_tokens_per_progress IS NULL OR p_tokens_per_progress < 1 OR p_tokens_per_progress > 10 THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'tokens_per_progress')::text;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_season_id::text));

  -- replay: the same request id returns the first purchase
  SELECT * INTO v_existing FROM public.epb_draft_token_purchases
   WHERE season_id = p_season_id AND player_id = p_player_id AND client_request_id = p_client_request_id;
  IF FOUND THEN
    RETURN jsonb_build_object('purchase_id', v_existing.id, 'tracker_id', v_existing.tracker_id, 'line_id', v_existing.line_id,
      'points_spent', v_existing.points_spent, 'tokens_used', v_existing.tokens_used, 'replay', true);
  END IF;

  SELECT * INTO v_rules FROM public.format_rules WHERE season_id = p_season_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'format_rules')::text;
  END IF;

  -- 1. window (critique B10; twin of draftKillTokenWindow): open after the initial draft, until the explicit cutoff or,
  --    without one, until the first completed match of the season (owner ruling).
  SELECT * INTO v_initial FROM public.draft_pools WHERE season_id = p_season_id AND kind = 'initial'
     AND season_group_id IS NOT DISTINCT FROM public.draft__player_group(p_season_id, p_player_id);
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

  -- 2. player limit (purchases weighted by the tokens each one counted for + legacy one-shot grant tokens): the new
  --    purchase counts as p_tokens_per_progress tokens
  v_owned := (COALESCE((SELECT sum(tokens_used) FROM public.epb_draft_token_purchases
                         WHERE season_id = p_season_id AND player_id = p_player_id), 0)
           + COALESCE((SELECT sum(token_count) FROM public.epb_token_grants
                        WHERE season_id = p_season_id AND player_id = p_player_id AND grant_type = 'draft_token'), 0))::integer;
  IF v_owned + p_tokens_per_progress > v_rules.draft_token_max THEN
    RAISE EXCEPTION 'TOKEN_PLAYER_LIMIT' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('max', v_rules.draft_token_max)::text;
  END IF;

  -- 3. line limit (a purchase on this line, or legacy draft tokens already on its tracker)
  v_line_has := EXISTS (SELECT 1 FROM public.epb_draft_token_purchases
                         WHERE season_id = p_season_id AND player_id = p_player_id AND line_id = p_line_id)
             OR EXISTS (SELECT 1 FROM public.evolution_tracker
                         WHERE season_id = p_season_id AND player_id = p_player_id AND line_id = p_line_id
                           AND draft_tokens >= v_rules.draft_token_max_per_line);
  IF v_line_has THEN RAISE EXCEPTION 'TOKEN_LINE_LIMIT' USING ERRCODE = 'P0001'; END IF;

  -- 4. unspent points (the scaled cost)
  v_cost := p_tokens_per_progress * v_rules.draft_token_ratio;
  v_remaining := COALESCE(public.epb__season_remaining_points(p_season_id, p_player_id), 0);
  IF v_remaining < v_cost THEN
    RAISE EXCEPTION 'TOKEN_POINTS_SHORT' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('needed', v_cost, 'remaining', v_remaining)::text;
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

  INSERT INTO public.epb_draft_token_purchases (season_id, player_id, line_id, tracker_id, points_spent, tokens_used, client_request_id, created_by)
  VALUES (p_season_id, p_player_id, p_line_id, v_tracker.id, v_cost, p_tokens_per_progress, p_client_request_id, p_actor_id)
  RETURNING id INTO v_purchase_id;
  v_after := public.epb_apply_progress(v_tracker.id, 'draft_token', 1, NULL, 'Draft Kill Token', p_actor_id);
  PERFORM public.draft__log(p_season_id, v_initial.id, p_actor_id,
    CASE WHEN p_actor_id IS NOT DISTINCT FROM p_player_id THEN 'player' ELSE 'admin' END, 'token_purchased',
    p_player_id => p_player_id, p_line_id => p_line_id,
    p_after => jsonb_build_object('purchase_id', v_purchase_id, 'points_spent', v_cost, 'tokens_used', p_tokens_per_progress,
                                  'progress', v_after.total_kos),
    p_client_request_id => p_client_request_id);
  RETURN jsonb_build_object('purchase_id', v_purchase_id, 'tracker_id', v_tracker.id, 'line_id', p_line_id,
    'points_spent', v_cost, 'tokens_used', p_tokens_per_progress, 'progress', v_after.total_kos,
    'remaining_points', v_remaining - v_cost, 'replay', false);
END $$;

-- Privileges (service_role only, as before) ──────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.epb_purchase_draft_token(uuid, uuid, uuid, text, integer, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.epb_purchase_draft_token(uuid, uuid, uuid, text, integer, uuid, integer) TO service_role;

COMMIT;

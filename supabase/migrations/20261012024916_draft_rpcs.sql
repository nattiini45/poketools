-- Draft queue engine RPCs (EvoLiga draft tool, Prompts 3–5; draft-backend §5, §6.1–§6.7, package B-RPC, migration M5).
--
-- The queue algorithm lives ONLY here (critique B16). Its worked vectors are
-- src/lib/draft/__tests__/fixtures/queue-vectors.json, replayed against a local stack by the opt-in parity suite
-- (DRAFT_RPC_LIVE_DB=1 npx vitest run src/lib/draft/__tests__/rpc.live-db.test.ts).
--
-- Conventions
--   * Every mutation takes the per-season advisory lock (pg_advisory_xact_lock(hashtext(season_id::text)), the key of
--     epb_execute_trade_request and the redraft phase switch) and then row-locks the pool (draft__lock).
--   * Rule failures: RAISE EXCEPTION '<CODE>' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object(...)::text.
--     <CODE> is a key of src/i18n/messages/errors/draft (or one of INTERNAL_DRAFT_CODES, which surface as a logged 500);
--     DETAIL carries the {placeholders} of the English message plus machine data (src/lib/draft/rpc-errors.ts splits them).
--     src/lib/draft/__tests__/sql-error-codes.test.ts checks both.
--   * Public functions take the acting player id (NULL = system); every shared-state change bumps draft_pools.state_version.
--   * Timeouts resolve lazily (draft__tick / draft__resolve_timeouts) from route handlers and the cron; never from a
--     Server Component render (draft_snapshot(..., p_tick := false), critique B9).
--   * draft__tick calls redraft__publish_locked, which M6 defines (plpgsql resolves it at call time).
--
-- Service-role only: SET search_path = public on every function; EXECUTE revoked from PUBLIC/anon/authenticated and
-- granted to service_role at the end of this file.
--
-- Placeholder version: renamed to the live-recorded version at apply time (APPLY package). Not applied by B-RPC.
BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Helpers (§6.1)
-- ════════════════════════════════════════════════════════════════════════════

-- Season advisory lock + pool row lock. Every mutating RPC starts here.
CREATE OR REPLACE FUNCTION public.draft__lock(p_pool_id uuid) RETURNS public.draft_pools
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_pool public.draft_pools; v_season uuid;
BEGIN
  SELECT season_id INTO v_season FROM public.draft_pools WHERE id = p_pool_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'POOL_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(v_season::text));          -- same key as epb_execute_trade_request / redraft phase
  SELECT * INTO v_pool FROM public.draft_pools WHERE id = p_pool_id FOR UPDATE;
  RETURN v_pool;
END $$;

-- Append one draft_action_log row in the caller's transaction.
CREATE OR REPLACE FUNCTION public.draft__log(p_season_id uuid, p_pool_id uuid, p_actor_id uuid, p_actor_role text, p_action text,
  p_player_id uuid DEFAULT NULL, p_slot_id uuid DEFAULT NULL, p_pick_id uuid DEFAULT NULL, p_line_id text DEFAULT NULL,
  p_before jsonb DEFAULT NULL, p_after jsonb DEFAULT NULL, p_reason text DEFAULT NULL,
  p_client_request_id uuid DEFAULT NULL, p_is_public boolean DEFAULT true) RETURNS void
LANGUAGE sql SET search_path = public AS $$
  INSERT INTO public.draft_action_log (season_id, draft_pool_id, actor_id, actor_role, action, player_id, slot_id, pick_id,
    line_id, before, after, reason, client_request_id, is_public)
  VALUES (p_season_id, p_pool_id, p_actor_id, p_actor_role, p_action, p_player_id, p_slot_id, p_pick_id,
    p_line_id, p_before, p_after, left(p_reason, 500), p_client_request_id, p_is_public)
$$;

-- Open slots of a player = pending + active + blocked. 0 = out of the queue (SPEC:458-461).
CREATE OR REPLACE FUNCTION public.draft__open_slots(p_pool_id uuid, p_player_id uuid) RETURNS integer
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT count(*)::int FROM public.draft_slots
   WHERE draft_pool_id = p_pool_id AND player_id = p_player_id AND status IN ('pending', 'active', 'blocked')
$$;

-- Budget left in this pool = frozen budget_start − non-void picks of this pool.
CREATE OR REPLACE FUNCTION public.draft__remaining_budget(p_pool_id uuid, p_player_id uuid) RETURNS integer
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT dp.budget_start - COALESCE((SELECT sum(points_spent) FROM public.draft_picks
           WHERE draft_pool_id = p_pool_id AND player_id = p_player_id AND voided_at IS NULL), 0)::int
    FROM public.draft_participants dp WHERE dp.draft_pool_id = p_pool_id AND dp.player_id = p_player_id
$$;

-- Lines this player could legally take now (availability + restrictions + redraft lock), with price.
-- Branch-exact (BR-3): a line is taken when any tracker of the season or any live pick of the pool holds its line_id.
CREATE OR REPLACE FUNCTION public.draft__legal_lines(p_pool_id uuid, p_player_id uuid)
RETURNS TABLE (entry_id uuid, line_id text, price integer) LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT e.id, e.line_id, e.price::int
    FROM public.draft_pools p JOIN public.point_buy_list_entries e ON e.list_version_id = p.list_version_id
   WHERE p.id = p_pool_id
     AND NOT EXISTS (SELECT 1 FROM public.evolution_tracker t WHERE t.season_id = p.season_id AND t.line_id = e.line_id)
     AND NOT EXISTS (SELECT 1 FROM public.draft_picks dp WHERE dp.draft_pool_id = p.id AND dp.line_id = e.line_id AND dp.voided_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM public.draft_line_restrictions r
                      WHERE r.draft_pool_id = p.id AND r.player_id = p_player_id AND r.line_id = e.line_id)
     AND NOT (p.kind = 'redraft' AND p.redraft_lock_no_redraft_lines AND COALESCE((e.special_rules->>'no_redraft')::boolean, false))
$$;

-- The p_slots cheapest legal lines (optionally without one line): how many exist and what they cost together.
-- Twin of minCompletion in src/lib/draft/budget.ts.
CREATE OR REPLACE FUNCTION public.draft__min_completion(p_pool_id uuid, p_player_id uuid, p_slots integer, p_exclude_line text)
RETURNS TABLE (cnt integer, cost integer) LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT count(*)::int, COALESCE(sum(price), 0)::int FROM (
    SELECT l.price FROM public.draft__legal_lines(p_pool_id, p_player_id) l
     WHERE p_exclude_line IS NULL OR l.line_id <> p_exclude_line
     ORDER BY l.price ASC, l.line_id ASC LIMIT GREATEST(p_slots, 0)) s
$$;

-- slotSeconds (§5.1): live → make-up 150 / normal 300 (pool config); slow → ladder stage of the player (both kinds, NQ 25).
CREATE OR REPLACE FUNCTION public.draft__slot_seconds(p_pool public.draft_pools, p_player_id uuid, p_kind text) RETURNS integer
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE v_stage smallint;
BEGIN
  IF p_pool.mode = 'live' THEN
    RETURN CASE WHEN p_kind = 'makeup' THEN COALESCE(p_pool.makeup_seconds, 150) ELSE COALESCE(p_pool.pick_seconds, 300) END;
  END IF;
  SELECT penalty_stage INTO v_stage FROM public.draft_participants WHERE draft_pool_id = p_pool.id AND player_id = p_player_id;
  RETURN p_pool.slow_ladder_seconds[LEAST(COALESCE(v_stage, 0), array_length(p_pool.slow_ladder_seconds, 1) - 1) + 1];
END $$;

-- Season points ledger; MUST mirror seasonRemainingPoints in src/lib/draft/budget.ts:
-- initial budget − non-void picks of non-cancelled pools − legacy grant tokens × ratio − Draft Kill Token purchases
-- − legacy redraft spends + redraft refunds (dropped prices).
CREATE OR REPLACE FUNCTION public.epb__season_remaining_points(p_season_id uuid, p_player_id uuid) RETURNS integer
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT (COALESCE((SELECT point_budget FROM public.draft_pools WHERE season_id = p_season_id AND kind = 'initial'), fr.draft_budget)
    - COALESCE((SELECT sum(dp.points_spent) FROM public.draft_picks dp JOIN public.draft_pools pl ON pl.id = dp.draft_pool_id
                 WHERE pl.season_id = p_season_id AND pl.phase <> 'cancelled' AND dp.player_id = p_player_id AND dp.voided_at IS NULL), 0)
    - COALESCE((SELECT sum(g.token_count) FROM public.epb_token_grants g
                 WHERE g.season_id = p_season_id AND g.player_id = p_player_id AND g.grant_type = 'draft_token'), 0) * fr.draft_token_ratio
    - COALESCE((SELECT sum(x.points_spent) FROM public.epb_draft_token_purchases x
                 WHERE x.season_id = p_season_id AND x.player_id = p_player_id), 0)
    - COALESCE((SELECT sum(rh.points_spent) FROM public.redraft_history rh
                 WHERE rh.season_id = p_season_id AND rh.player_id = p_player_id), 0)
    + COALESCE((SELECT sum(rs.dropped_price) FROM public.redraft_slots rs
                 WHERE rs.season_id = p_season_id AND rs.player_id = p_player_id), 0))::int
  FROM public.format_rules fr WHERE fr.season_id = p_season_id
$$;

-- Integer config value or INVALID_CONFIG {field}. NULL when the key is absent (or JSON null and p_nullable).
CREATE OR REPLACE FUNCTION public.draft__cfg_int(p_cfg jsonb, p_key text, p_min integer, p_max integer, p_nullable boolean DEFAULT false)
RETURNS integer LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE v numeric;
BEGIN
  IF p_cfg IS NULL OR NOT (p_cfg ? p_key) THEN RETURN NULL; END IF;
  IF jsonb_typeof(p_cfg->p_key) = 'null' AND p_nullable THEN RETURN NULL; END IF;
  IF jsonb_typeof(p_cfg->p_key) <> 'number' THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', p_key)::text;
  END IF;
  v := (p_cfg->>p_key)::numeric;
  IF v <> trunc(v) OR v < p_min OR v > p_max THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', p_key)::text;
  END IF;
  RETURN v::int;
END $$;

-- Boolean config value or INVALID_CONFIG {field}; NULL when absent.
CREATE OR REPLACE FUNCTION public.draft__cfg_bool(p_cfg jsonb, p_key text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
BEGIN
  IF p_cfg IS NULL OR NOT (p_cfg ? p_key) THEN RETURN NULL; END IF;
  IF jsonb_typeof(p_cfg->p_key) <> 'boolean' THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', p_key)::text;
  END IF;
  RETURN (p_cfg->>p_key)::boolean;
END $$;

-- Timestamp config value (ISO string or JSON null) or INVALID_CONFIG {field}; NULL when absent or null.
CREATE OR REPLACE FUNCTION public.draft__cfg_ts(p_cfg jsonb, p_key text) RETURNS timestamptz
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE v timestamptz;
BEGIN
  IF p_cfg IS NULL OR NOT (p_cfg ? p_key) OR jsonb_typeof(p_cfg->p_key) = 'null' THEN RETURN NULL; END IF;
  IF jsonb_typeof(p_cfg->p_key) <> 'string' THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', p_key)::text;
  END IF;
  BEGIN
    v := (p_cfg->>p_key)::timestamptz;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', p_key)::text;
  END;
  RETURN v;
END $$;

-- Slow ladder: 1..6 integers, each 30..172800 s; INVALID_CONFIG {field} otherwise. NULL when absent.
CREATE OR REPLACE FUNCTION public.draft__cfg_ladder(p_cfg jsonb) RETURNS integer[]
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE v integer[];
BEGIN
  IF p_cfg IS NULL OR NOT (p_cfg ? 'slow_ladder_seconds') THEN RETURN NULL; END IF;
  IF jsonb_typeof(p_cfg->'slow_ladder_seconds') <> 'array'
     OR jsonb_array_length(p_cfg->'slow_ladder_seconds') NOT BETWEEN 1 AND 6
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_cfg->'slow_ladder_seconds') x
                 WHERE jsonb_typeof(x) <> 'number' OR (x#>>'{}')::numeric <> trunc((x#>>'{}')::numeric)
                    OR (x#>>'{}')::numeric NOT BETWEEN 30 AND 172800) THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'slow_ladder_seconds')::text;
  END IF;
  SELECT array_agg((x#>>'{}')::int ORDER BY o) INTO v
    FROM jsonb_array_elements(p_cfg->'slow_ladder_seconds') WITH ORDINALITY AS t(x, o);
  RETURN v;
END $$;

-- Seats [{player_id, seat, standing_rank?}]: non-empty, seats contiguous 1..n, unique players that exist. SEATS_INVALID otherwise.
CREATE OR REPLACE FUNCTION public.draft__validate_seats(p_seats jsonb) RETURNS integer
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE v_n integer; v_players integer; v_seats integer; v_min integer; v_max integer; v_known integer;
BEGIN
  IF p_seats IS NULL OR jsonb_typeof(p_seats) <> 'array' OR jsonb_array_length(p_seats) < 1
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_seats) e
                 WHERE jsonb_typeof(e) <> 'object' OR jsonb_typeof(e->'seat') IS DISTINCT FROM 'number'
                    OR jsonb_typeof(e->'player_id') IS DISTINCT FROM 'string'
                    OR (e->>'player_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    OR (e->>'seat')::numeric <> trunc((e->>'seat')::numeric)
                    OR (e ? 'standing_rank' AND jsonb_typeof(e->'standing_rank') NOT IN ('number', 'null'))) THEN
    RAISE EXCEPTION 'SEATS_INVALID' USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*), count(DISTINCT (e->>'player_id')::uuid), count(DISTINCT (e->>'seat')::int),
         min((e->>'seat')::int), max((e->>'seat')::int)
    INTO v_n, v_players, v_seats, v_min, v_max
    FROM jsonb_array_elements(p_seats) e;
  SELECT count(*) INTO v_known FROM public.players
   WHERE id IN (SELECT (e->>'player_id')::uuid FROM jsonb_array_elements(p_seats) e);
  IF v_players <> v_n OR v_seats <> v_n OR v_min <> 1 OR v_max <> v_n OR v_known <> v_n OR v_n > 32 THEN
    RAISE EXCEPTION 'SEATS_INVALID' USING ERRCODE = 'P0001';
  END IF;
  RETURN v_n;
END $$;

-- §5.3 activateNext(at). Returns the new current slot id (active or blocked), or NULL when the queue is empty
-- (the pool completes).
CREATE OR REPLACE FUNCTION public.draft__activate_next(p_pool_id uuid, p_at timestamptz) RETURNS uuid
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_pool public.draft_pools; v_slot public.draft_slots; v_open integer; v_rem integer; v_cnt integer; v_cost integer;
        v_secs integer; v_mask smallint;
BEGIN
  SELECT * INTO v_pool FROM public.draft_pools WHERE id = p_pool_id;
  IF EXISTS (SELECT 1 FROM public.draft_slots WHERE draft_pool_id = p_pool_id AND status IN ('active', 'blocked')) THEN
    RAISE EXCEPTION 'ACTIVE_SLOT_EXISTS' USING ERRCODE = 'P0001';                       -- invariant (internal)
  END IF;

  SELECT * INTO v_slot FROM public.draft_slots
   WHERE draft_pool_id = p_pool_id AND status = 'pending' ORDER BY sort_key LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    UPDATE public.draft_pools
       SET phase = 'complete', status = 'complete', ended_at = p_at, paused_at = NULL, paused_by = NULL, pause_reason = NULL,
           updated_at = now()
     WHERE id = p_pool_id;
    UPDATE public.draft_participants SET done_at = COALESCE(done_at, p_at) WHERE draft_pool_id = p_pool_id;
    PERFORM public.draft__log(v_pool.season_id, p_pool_id, NULL, 'system', 'draft_ended',
      p_after => jsonb_build_object('reason', 'queue_empty'));
    RETURN NULL;
  END IF;

  -- A legal pick exists ⇔ the `open` cheapest legal lines fit the remaining budget (§5.3 step 3).
  v_open := public.draft__open_slots(p_pool_id, v_slot.player_id);
  v_rem := COALESCE(public.draft__remaining_budget(p_pool_id, v_slot.player_id), 0);
  SELECT m.cnt, m.cost INTO v_cnt, v_cost FROM public.draft__min_completion(p_pool_id, v_slot.player_id, v_open, NULL) m;
  IF v_cnt < v_open OR v_cost > v_rem THEN
    UPDATE public.draft_slots
       SET status = 'blocked', started_at = p_at, deadline_at = NULL, remaining_ms_at_pause = NULL,
           alert_kind = 'blocked', alert_notified_at = NULL
     WHERE id = v_slot.id;
    UPDATE public.draft_pools
       SET paused_at = COALESCE(paused_at, p_at), pause_reason = 'blocked_slot', updated_at = now()
     WHERE id = p_pool_id;
    PERFORM public.draft__log(v_pool.season_id, p_pool_id, NULL, 'system', 'slot_blocked',
      p_player_id => v_slot.player_id, p_slot_id => v_slot.id,
      p_after => jsonb_build_object('reason', CASE WHEN v_cnt < v_open THEN 'NOT_ENOUGH_LINES' ELSE 'BUDGET_INFEASIBLE' END,
                                    'open_slots', v_open, 'remaining', v_rem, 'available', v_cnt, 'min_cost', v_cost));
    RETURN v_slot.id;
  END IF;

  v_secs := public.draft__slot_seconds(v_pool, v_slot.player_id, v_slot.kind);
  -- Reminder bits already "sent or not applicable": slow → thresholds the timer never reaches; live → none are sent.
  v_mask := CASE WHEN v_pool.mode = 'slow'
                 THEN ((v_secs <= 28800)::int | ((v_secs <= 14400)::int << 1) | ((v_secs <= 3600)::int << 2))::smallint
                 ELSE 7::smallint END;
  UPDATE public.draft_slots
     SET status = 'active', timer_seconds = v_secs, started_at = p_at, extension_seconds = 0,
         deadline_at = CASE WHEN v_pool.paused_at IS NULL THEN p_at + v_secs * interval '1 second' ELSE NULL END,
         remaining_ms_at_pause = CASE WHEN v_pool.paused_at IS NULL THEN NULL ELSE v_secs * 1000 END,
         reminder_mask = v_mask
   WHERE id = v_slot.id;
  RETURN v_slot.id;
END $$;

-- §5.4 resolveTimeouts: loops while the active slot is overdue (max 500 steps). Each step starts the next slot at the
-- previous deadline, so a late resolution replays exactly what a 1 s ticker would have produced (Q10).
CREATE OR REPLACE FUNCTION public.draft__resolve_timeouts(p_pool_id uuid) RETURNS integer
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_pool public.draft_pools; v_a public.draft_slots; v_t public.draft_slots; v_anchor numeric; v_next numeric;
        v_key numeric; v_inplace boolean; v_new uuid; v_stage smallint; v_count integer := 0;
BEGIN
  LOOP
    EXIT WHEN v_count >= 500;
    SELECT * INTO v_pool FROM public.draft_pools WHERE id = p_pool_id;
    EXIT WHEN NOT FOUND OR v_pool.phase <> 'drafting' OR v_pool.paused_at IS NOT NULL;
    SELECT * INTO v_a FROM public.draft_slots
     WHERE draft_pool_id = p_pool_id AND status = 'active' AND deadline_at IS NOT NULL AND deadline_at <= now()
     FOR UPDATE;
    EXIT WHEN NOT FOUND;

    -- 1. the overdue slot is closed at its own deadline
    UPDATE public.draft_slots SET status = 'timed_out', completed_at = v_a.deadline_at WHERE id = v_a.id;
    -- 2. counters; slow mode climbs the ladder (persists, SPEC:646-654)
    UPDATE public.draft_participants
       SET timeout_count = timeout_count + 1,
           penalty_stage = CASE WHEN v_pool.mode = 'slow'
                                THEN LEAST(penalty_stage + 1, array_length(v_pool.slow_ladder_seconds, 1) - 1)
                                ELSE penalty_stage END
     WHERE draft_pool_id = p_pool_id AND player_id = v_a.player_id
     RETURNING penalty_stage INTO v_stage;
    -- 3. T = first pending slot after A of ANOTHER player; the make-up goes directly behind T (double-pick rule,
    --    SPEC:595-608); none → in place behind A (BR-7) with an admin alert.
    SELECT * INTO v_t FROM public.draft_slots
     WHERE draft_pool_id = p_pool_id AND status = 'pending' AND sort_key > v_a.sort_key AND player_id <> v_a.player_id
     ORDER BY sort_key LIMIT 1;
    v_inplace := NOT FOUND;
    v_anchor := CASE WHEN v_inplace THEN v_a.sort_key ELSE v_t.sort_key END;
    SELECT min(sort_key) INTO v_next FROM public.draft_slots WHERE draft_pool_id = p_pool_id AND sort_key > v_anchor;
    v_key := CASE WHEN v_next IS NULL THEN v_anchor + 1 ELSE (v_anchor + v_next) / 2 END;
    -- 4. the make-up slot
    INSERT INTO public.draft_slots (draft_pool_id, player_id, sort_key, round, nominal_pick_number, kind, status,
                                    origin_slot_id, previous_slot_id, timeouts, alert_kind, alert_notified_at)
    VALUES (p_pool_id, v_a.player_id, v_key, v_a.round, v_a.nominal_pick_number, 'makeup', 'pending',
            COALESCE(v_a.origin_slot_id, v_a.id), v_a.id, v_a.timeouts + 1,
            CASE WHEN v_inplace THEN 'inplace_timeout' END, NULL)
    RETURNING id INTO v_new;
    PERFORM public.draft__log(v_pool.season_id, p_pool_id, NULL, 'system', 'timeout',
      p_player_id => v_a.player_id, p_slot_id => v_a.id,
      p_after => jsonb_build_object('slot_id', v_a.id, 'moved_behind_slot_id', CASE WHEN v_inplace THEN NULL ELSE v_t.id END,
                                    'new_slot_id', v_new, 'penalty_stage', v_stage, 'timeouts', v_a.timeouts + 1,
                                    'in_place', v_inplace));
    -- 5. the chain is deterministic: the next slot starts when the previous deadline passed
    PERFORM public.draft__activate_next(p_pool_id, v_a.deadline_at);
    v_count := v_count + 1;
  END LOOP;
  -- 6.
  IF v_count > 0 THEN
    UPDATE public.draft_pools SET state_version = state_version + 1, updated_at = now() WHERE id = p_pool_id;
  END IF;
  RETURN v_count;
END $$;

-- Restart the pick clock (§5.5 resume): the active slot gets its frozen remaining time back; without a current slot the
-- next one activates. The caller checked that no blocked slot exists. Returns the restored remaining milliseconds.
CREATE OR REPLACE FUNCTION public.draft__resume(p_pool_id uuid) RETURNS integer
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_ms integer;
BEGIN
  UPDATE public.draft_pools SET paused_at = NULL, paused_by = NULL, pause_reason = NULL, updated_at = now() WHERE id = p_pool_id;
  UPDATE public.draft_slots
     SET deadline_at = now() + COALESCE(remaining_ms_at_pause, timer_seconds * 1000, 0) * interval '1 millisecond',
         remaining_ms_at_pause = NULL
   WHERE draft_pool_id = p_pool_id AND status = 'active' AND deadline_at IS NULL
   RETURNING COALESCE(EXTRACT(EPOCH FROM (deadline_at - now())) * 1000, 0)::int INTO v_ms;
  IF NOT EXISTS (SELECT 1 FROM public.draft_slots WHERE draft_pool_id = p_pool_id AND status IN ('active', 'blocked')) THEN
    PERFORM public.draft__activate_next(p_pool_id, now());
  END IF;
  RETURN COALESCE(v_ms, 0);
END $$;

-- The single pick writer (confirm, admin assign, admin correct). Steps 1–13 of §6.2, in this order.
CREATE OR REPLACE FUNCTION public.draft__commit_pick(
  p_pool public.draft_pools, p_slot public.draft_slots, p_entry_id uuid, p_actor_id uuid, p_actor_role text,
  p_client_request_id uuid, p_redraft_slot_id uuid, p_line_thresholds jsonb, p_bypass_budget boolean,
  p_action text, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_entry public.point_buy_list_entries; v_player uuid := p_slot.player_id; v_owner uuid; v_restriction text;
  v_open integer; v_rem integer; v_cnt integer; v_cost integer; v_size smallint;
  v_rslot public.redraft_slots; v_transfer integer := 0; v_stage integer := 1; v_form text; v_s2 integer; v_s3 integer;
  v_pick_no integer; v_pick_id uuid; v_tracker_id uuid; v_next uuid; v_pool public.draft_pools;
BEGIN
  SELECT * INTO v_entry FROM public.point_buy_list_entries WHERE id = p_entry_id AND list_version_id = p_pool.list_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_IN_LIST' USING ERRCODE = 'P0001'; END IF;

  -- 1. one owner per line per season (BR-3)
  v_owner := (SELECT t.player_id FROM public.evolution_tracker t
               WHERE t.season_id = p_pool.season_id AND t.line_id = v_entry.line_id LIMIT 1);
  IF v_owner IS NULL THEN
    v_owner := (SELECT k.player_id FROM public.draft_picks k
                 WHERE k.draft_pool_id = p_pool.id AND k.line_id = v_entry.line_id AND k.voided_at IS NULL LIMIT 1);
  END IF;
  IF v_owner IS NOT NULL THEN
    RAISE EXCEPTION 'LINE_TAKEN' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('line_id', v_entry.line_id, 'player_id', v_owner)::text;
  END IF;

  -- 2. restrictions
  SELECT r.reason INTO v_restriction FROM public.draft_line_restrictions r
   WHERE r.draft_pool_id = p_pool.id AND r.player_id = v_player AND r.line_id = v_entry.line_id;
  IF v_restriction = 'own_redraft_drop' THEN RAISE EXCEPTION 'OWN_REDRAFT_DROP' USING ERRCODE = 'P0001'; END IF;
  IF v_restriction IS NOT NULL THEN RAISE EXCEPTION 'LINE_RESTRICTED' USING ERRCODE = 'P0001'; END IF;

  -- 3. redraft lock (Cosmog: special_rules.no_redraft, stored by the importer)
  IF p_pool.kind = 'redraft' AND p_pool.redraft_lock_no_redraft_lines
     AND COALESCE((v_entry.special_rules->>'no_redraft')::boolean, false) THEN
    RAISE EXCEPTION 'COSMOG_REDRAFT_LOCKED' USING ERRCODE = 'P0001';
  END IF;

  -- 4. roster
  v_open := public.draft__open_slots(p_pool.id, v_player);
  IF v_open < 1 THEN
    SELECT slots_total INTO v_size FROM public.draft_participants WHERE draft_pool_id = p_pool.id AND player_id = v_player;
    RAISE EXCEPTION 'ROSTER_FULL' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('size', COALESCE(v_size, 0))::text;
  END IF;

  -- 5. budget + completion check (SPEC Prompt 3 §3; twin of evaluateCompletion in budget.ts)
  IF NOT p_bypass_budget THEN
    v_rem := COALESCE(public.draft__remaining_budget(p_pool.id, v_player), 0);
    IF v_entry.price > v_rem THEN
      RAISE EXCEPTION 'INSUFFICIENT_BUDGET' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('price', v_entry.price, 'remaining', v_rem)::text;
    END IF;
    SELECT m.cnt, m.cost INTO v_cnt, v_cost FROM public.draft__min_completion(p_pool.id, v_player, v_open - 1, v_entry.line_id) m;
    IF v_cnt < v_open - 1 THEN
      RAISE EXCEPTION 'NOT_ENOUGH_LINES' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('slots', v_open - 1, 'available', v_cnt)::text;
    END IF;
    IF v_cost > v_rem - v_entry.price THEN
      RAISE EXCEPTION 'BUDGET_INFEASIBLE' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('shortfall', v_cost - (v_rem - v_entry.price), 'slots', v_open - 1,
                                    'remaining_after', v_rem - v_entry.price, 'min_cost', v_cost)::text;
    END IF;
  END IF;

  -- 6. redraft slot (the slot-bound real-kill transfer, SPEC:757-770)
  IF p_pool.kind = 'redraft' THEN
    IF p_redraft_slot_id IS NULL THEN RAISE EXCEPTION 'REDRAFT_SLOT_REQUIRED' USING ERRCODE = 'P0001'; END IF;
    SELECT * INTO v_rslot FROM public.redraft_slots WHERE id = p_redraft_slot_id FOR UPDATE;
    IF NOT FOUND OR v_rslot.draft_pool_id <> p_pool.id OR v_rslot.player_id <> v_player THEN
      RAISE EXCEPTION 'REDRAFT_SLOT_INVALID' USING ERRCODE = 'P0001';
    END IF;
    IF v_rslot.filled_by_pick_id IS NOT NULL THEN RAISE EXCEPTION 'REDRAFT_SLOT_FILLED' USING ERRCODE = 'P0001'; END IF;
    v_transfer := v_rslot.transferred_real_kills;
  ELSIF p_redraft_slot_id IS NOT NULL THEN
    RAISE EXCEPTION 'REDRAFT_SLOT_INVALID' USING ERRCODE = 'P0001';
  END IF;

  -- 7. stage reached by the transfer (cumulative thresholds, override applied by TS effectiveThresholds)
  IF v_transfer > 0 THEN
    IF p_line_thresholds IS NULL OR p_line_thresholds->>'line_id' IS DISTINCT FROM v_entry.line_id
       OR jsonb_typeof(p_line_thresholds->'stage2_kos') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'THRESHOLDS_REQUIRED' USING ERRCODE = 'P0001';                    -- internal: the route must pass them
    END IF;
    v_s2 := (p_line_thresholds->>'stage2_kos')::int;
    v_s3 := CASE WHEN jsonb_typeof(p_line_thresholds->'stage3_kos') = 'number' THEN (p_line_thresholds->>'stage3_kos')::int END;
    v_stage := CASE WHEN v_s3 IS NOT NULL AND v_entry.stage3_pokemon IS NOT NULL AND v_transfer >= v_s3 THEN 3
                    WHEN v_transfer >= v_s2 THEN 2 ELSE 1 END;
  END IF;
  v_form := CASE v_stage WHEN 3 THEN v_entry.stage3_pokemon WHEN 2 THEN v_entry.stage2_pokemon ELSE v_entry.base_pokemon END;

  -- 8. the pick
  SELECT COALESCE(max(pick_number), 0) + 1 INTO v_pick_no FROM public.draft_picks
   WHERE draft_pool_id = p_pool.id AND voided_at IS NULL;
  INSERT INTO public.draft_picks (draft_pool_id, player_id, pokemon_name, pick_number, round, points_spent, line_id,
    line_entry_id, slot_id, redraft_slot_id, client_request_id, made_by, made_by_role, override_reason)
  VALUES (p_pool.id, v_player, v_entry.base_pokemon, v_pick_no, p_slot.round, v_entry.price, v_entry.line_id,
    v_entry.id, p_slot.id, p_redraft_slot_id, p_client_request_id, p_actor_id, p_actor_role,
    CASE WHEN p_actor_role = 'admin' THEN left(p_reason, 500) END)
  RETURNING id INTO v_pick_id;

  -- 9. the tracker (real kills start at 0; a redraft transfer is evolution progress only, SPEC:859-867)
  INSERT INTO public.evolution_tracker (season_id, player_id, base_pokemon, current_form, current_stage, total_kos, real_kills,
    transferred_evo_progress, locked_stage3_pokemon, line_id, redraft_slot_id, evolved_at)
  VALUES (p_pool.season_id, v_player, v_entry.base_pokemon, v_form, v_stage, v_transfer, 0, v_transfer,
    v_entry.stage3_pokemon, v_entry.line_id, CASE WHEN p_pool.kind = 'redraft' THEN p_redraft_slot_id END,
    CASE WHEN v_stage > 1 THEN now() END)
  RETURNING id INTO v_tracker_id;
  IF v_transfer > 0 THEN
    INSERT INTO public.evo_progress_log (tracker_id, season_id, matchday, source, amount, note, created_by)
    VALUES (v_tracker_id, p_pool.season_id, NULL, 'transferred', v_transfer, 'Redraft slot ' || v_rslot.label, p_actor_id);
  END IF;
  IF v_stage > 1 THEN
    INSERT INTO public.evolution_events (season_id, matchday, tracker_id, player_id, base_pokemon, previous_form, new_form,
      previous_stage, new_stage, total_kos, is_devolution, is_manual)
    VALUES (p_pool.season_id, NULL, v_tracker_id, v_player, v_entry.base_pokemon, v_entry.base_pokemon, v_form,
      1, v_stage, v_transfer, false, false);
  END IF;

  -- 10. close the slot
  IF v_rslot.id IS NOT NULL THEN
    UPDATE public.redraft_slots SET filled_by_pick_id = v_pick_id WHERE id = v_rslot.id;
  END IF;
  UPDATE public.draft_slots
     SET status = 'done', completed_at = now(), deadline_at = NULL, remaining_ms_at_pause = NULL
   WHERE id = p_slot.id;
  IF public.draft__open_slots(p_pool.id, v_player) = 0 THEN
    UPDATE public.draft_participants SET done_at = now() WHERE draft_pool_id = p_pool.id AND player_id = v_player;
  END IF;

  -- 11. audit
  PERFORM public.draft__log(p_pool.season_id, p_pool.id, p_actor_id, p_actor_role, p_action,
    p_player_id => v_player, p_slot_id => p_slot.id, p_pick_id => v_pick_id, p_line_id => v_entry.line_id,
    p_after => jsonb_build_object('price', v_entry.price, 'pick_number', v_pick_no, 'redraft_slot_label', v_rslot.label,
                                  'transfer', v_transfer, 'stage', v_stage),
    p_reason => p_reason, p_client_request_id => p_client_request_id);

  -- 12. next slot
  v_next := public.draft__activate_next(p_pool.id, now());
  UPDATE public.draft_pools SET state_version = state_version + 1, updated_at = now() WHERE id = p_pool.id
  RETURNING * INTO v_pool;

  -- 13.
  RETURN jsonb_build_object('pick_id', v_pick_id, 'tracker_id', v_tracker_id, 'line_id', v_entry.line_id,
    'pick_number', v_pick_no, 'player_id', v_player, 'price', v_entry.price, 'stage', v_stage, 'replay', false,
    'next_slot_id', v_next, 'completed', v_pool.phase = 'complete', 'state_version', v_pool.state_version);
END $$;

-- Raw snapshot (§6.6, RawSnapshot of §10.1): shared state only, no viewer fields. Never contains any
-- redraft_submissions column; redraft drops/slots appear only after publish. B-SNAP's toDraftSnapshotDTO maps it field by
-- field. Additive raw-only fields: pool.engine, config.{extensions_enabled, redraft_lock_no_redraft_lines,
-- submission_deadline_at, token_purchase_closes_at}, active_slot.sort_key, upcoming[].sort_key, prices, restrictions,
-- no_redraft_line_ids, redraft.all_slots. pool.league_time_zone is not SQL's (B-SNAP adds LEAGUE_TIME_ZONE).
CREATE OR REPLACE FUNCTION public.draft__build_snapshot(p_pool public.draft_pools) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE v_current public.draft_slots; v_published boolean; v_redraft jsonb := NULL; v_active jsonb := NULL;
BEGIN
  SELECT * INTO v_current FROM public.draft_slots
   WHERE draft_pool_id = p_pool.id AND status IN ('active', 'blocked') LIMIT 1;
  IF FOUND THEN
    v_active := jsonb_build_object('slot_id', v_current.id, 'player_id', v_current.player_id, 'round', v_current.round,
      'pick_number', v_current.nominal_pick_number, 'kind', v_current.kind, 'status', v_current.status,
      'duration_ms', COALESCE(v_current.timer_seconds, 0) * 1000, 'extensions_applied_ms', v_current.extension_seconds * 1000,
      'started_at', v_current.started_at, 'deadline_at', v_current.deadline_at,
      'remaining_ms_at_pause', v_current.remaining_ms_at_pause, 'sort_key', v_current.sort_key);
  END IF;

  IF p_pool.kind = 'redraft' THEN
    v_published := p_pool.submissions_published_at IS NOT NULL;
    v_redraft := jsonb_build_object(
      'phase', CASE WHEN p_pool.phase = 'submissions'
                    THEN CASE WHEN p_pool.submission_deadline_at IS NOT NULL AND now() >= p_pool.submission_deadline_at
                              THEN 'locked' ELSE 'submissions' END
                    WHEN p_pool.phase = 'drafting' THEN 'drafting' ELSE 'complete' END,
      'deadline_at', p_pool.submission_deadline_at,
      'published_at', p_pool.submissions_published_at,
      'drops', CASE WHEN v_published THEN COALESCE((
          SELECT jsonb_agg(jsonb_build_object('player_id', rs.player_id, 'line_id', rs.dropped_line_id,
                                              'transferred_real_kills', rs.transferred_real_kills) ORDER BY dp.seat, rs.label)
            FROM public.redraft_slots rs
            LEFT JOIN public.draft_participants dp ON dp.draft_pool_id = rs.draft_pool_id AND dp.player_id = rs.player_id
           WHERE rs.draft_pool_id = p_pool.id), '[]'::jsonb) END,
      'all_slots', CASE WHEN v_published THEN COALESCE((
          SELECT jsonb_agg(jsonb_build_object('redraft_slot_id', rs.id, 'player_id', rs.player_id, 'label', rs.label,
                                              'dropped_line_id', rs.dropped_line_id,
                                              'transferred_real_kills', rs.transferred_real_kills,
                                              'filled_by_pick_id', rs.filled_by_pick_id) ORDER BY dp.seat, rs.label)
            FROM public.redraft_slots rs
            LEFT JOIN public.draft_participants dp ON dp.draft_pool_id = rs.draft_pool_id AND dp.player_id = rs.player_id
           WHERE rs.draft_pool_id = p_pool.id), '[]'::jsonb) ELSE '[]'::jsonb END);
  END IF;

  RETURN jsonb_build_object(
    'state_version', p_pool.state_version,
    'server_now', now(),
    'pool', jsonb_build_object('id', p_pool.id, 'season_id', p_pool.season_id, 'kind', p_pool.kind, 'mode', p_pool.mode,
      'status', p_pool.status, 'paused', p_pool.paused_at IS NOT NULL, 'paused_at', p_pool.paused_at,
      'roster_size', COALESCE(p_pool.roster_size, 0), 'budget', COALESCE(p_pool.point_budget, 0),
      'started_at', p_pool.started_at, 'ended_at', p_pool.ended_at, 'phase', p_pool.phase,
      'pause_reason', p_pool.pause_reason, 'list_version_id', p_pool.list_version_id, 'engine', p_pool.engine),
    'config', jsonb_build_object('pick_seconds', COALESCE(p_pool.pick_seconds, 300),
      'makeup_seconds', COALESCE(p_pool.makeup_seconds, 150), 'slow_ladder_seconds', to_jsonb(p_pool.slow_ladder_seconds),
      'extension_seconds', CASE WHEN p_pool.mode = 'slow' OR NOT p_pool.extensions_enabled THEN NULL
                                ELSE to_jsonb(p_pool.extension_seconds) END,
      'redraft_max_lines', p_pool.redraft_max_lines, 'extensions_enabled', p_pool.extensions_enabled,
      'redraft_lock_no_redraft_lines', p_pool.redraft_lock_no_redraft_lines,
      'submission_deadline_at', p_pool.submission_deadline_at, 'token_purchase_closes_at', p_pool.token_purchase_closes_at),
    'participants', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'player_id', dp.player_id, 'name', pl.name, 'avatar_url', pl.avatar_url, 'seat', dp.seat,
          'standing_rank', dp.standing_rank, 'slots_total', dp.slots_total,
          'picks_made', (SELECT count(*) FROM public.draft_picks k
                          WHERE k.draft_pool_id = p_pool.id AND k.player_id = dp.player_id AND k.voided_at IS NULL),
          'open_slots', public.draft__open_slots(p_pool.id, dp.player_id),
          'budget_start', dp.budget_start,
          'budget_remaining', public.draft__remaining_budget(p_pool.id, dp.player_id),
          'penalty_stage', dp.penalty_stage, 'timeout_count', dp.timeout_count,
          'extensions', jsonb_build_object('plus120_used', dp.ext_plus120_used_at IS NOT NULL,
                                           'plus60_used', dp.ext_plus60_used_at IS NOT NULL),
          'done', dp.done_at IS NOT NULL) ORDER BY dp.seat)
        FROM public.draft_participants dp JOIN public.players pl ON pl.id = dp.player_id
       WHERE dp.draft_pool_id = p_pool.id), '[]'::jsonb),
    'active_slot', v_active,
    'upcoming', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('slot_id', u.id, 'player_id', u.player_id, 'pick_number', u.nominal_pick_number,
                                          'round', u.round, 'kind', u.kind,
                                          'duration_ms', public.draft__slot_seconds(p_pool, u.player_id, u.kind) * 1000,
                                          'sort_key', u.sort_key) ORDER BY u.sort_key)
        FROM (SELECT * FROM public.draft_slots s WHERE s.draft_pool_id = p_pool.id AND s.status = 'pending'
               ORDER BY s.sort_key LIMIT 10) u), '[]'::jsonb),
    'picks', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('pick_id', k.id, 'slot_id', k.slot_id, 'pick_number', k.pick_number,
                                          'round', k.round, 'player_id', k.player_id, 'line_id', k.line_id,
                                          'entry_id', k.line_entry_id, 'price', COALESCE(k.points_spent, 0),
                                          'made_at', k."timestamp",
                                          'admin_override', k.made_by_role = 'admin' AND k.made_by IS DISTINCT FROM k.player_id,
                                          'redraft_slot_id', k.redraft_slot_id) ORDER BY k.pick_number)
        FROM public.draft_picks k WHERE k.draft_pool_id = p_pool.id AND k.voided_at IS NULL), '[]'::jsonb),
    'taken', COALESCE((
      SELECT jsonb_object_agg(o.line_id, o.player_id)
        FROM (SELECT DISTINCT ON (x.line_id) x.line_id, x.player_id FROM (
                SELECT t.line_id, t.player_id, 0 AS pri FROM public.evolution_tracker t
                 WHERE t.season_id = p_pool.season_id AND t.line_id IS NOT NULL
                UNION ALL
                SELECT k.line_id, k.player_id, 1 FROM public.draft_picks k
                 WHERE k.draft_pool_id = p_pool.id AND k.voided_at IS NULL AND k.line_id IS NOT NULL) x
              ORDER BY x.line_id, x.pri) o), '{}'::jsonb),
    'prices', COALESCE((
      SELECT jsonb_object_agg(e.line_id, e.price) FROM public.point_buy_list_entries e
       WHERE e.list_version_id = p_pool.list_version_id), '{}'::jsonb),
    'restrictions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('player_id', r.player_id, 'line_id', r.line_id, 'reason', r.reason)
                       ORDER BY r.player_id, r.line_id)
        FROM public.draft_line_restrictions r WHERE r.draft_pool_id = p_pool.id), '[]'::jsonb),
    'no_redraft_line_ids', COALESCE((
      SELECT jsonb_agg(e.line_id ORDER BY e.line_id) FROM public.point_buy_list_entries e
       WHERE e.list_version_id = p_pool.list_version_id AND COALESCE((e.special_rules->>'no_redraft')::boolean, false)),
      '[]'::jsonb),
    'redraft', v_redraft,
    'recent_events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('at', a.occurred_at, 'action', a.action, 'actor_role', a.actor_role,
                                          'player_id', a.player_id, 'line_id', a.line_id, 'slot_id', a.slot_id) ORDER BY a.id DESC)
        FROM (SELECT * FROM public.draft_action_log l
               WHERE l.draft_pool_id = p_pool.id AND l.is_public
                 AND l.action NOT IN ('submission_changed', 'submissions_frozen')
               ORDER BY l.id DESC LIMIT 12) a), '[]'::jsonb));
END $$;

-- Lazy tick (§6.1): cheap unlocked check, lock only when work is due. Resolves overdue slots and auto-publishes a
-- redraft whose submission deadline passed (BR-9). Runs only inside route handlers and the cron.
CREATE OR REPLACE FUNCTION public.draft__tick(p_pool_id uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_pool public.draft_pools; v_due_timeout boolean; v_due_publish boolean; v_timeouts integer := 0;
        v_published boolean := false;
BEGIN
  SELECT * INTO v_pool FROM public.draft_pools WHERE id = p_pool_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'POOL_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF v_pool.engine <> 'queue' THEN
    RETURN jsonb_build_object('timeouts', 0, 'published', false);
  END IF;
  v_due_timeout := v_pool.phase = 'drafting' AND v_pool.paused_at IS NULL AND EXISTS (
    SELECT 1 FROM public.draft_slots WHERE draft_pool_id = p_pool_id AND status = 'active' AND deadline_at <= now());
  v_due_publish := v_pool.kind = 'redraft' AND v_pool.phase = 'submissions' AND v_pool.submission_deadline_at <= now();
  IF NOT (COALESCE(v_due_timeout, false) OR COALESCE(v_due_publish, false)) THEN
    RETURN jsonb_build_object('timeouts', 0, 'published', false);
  END IF;

  v_pool := public.draft__lock(p_pool_id);                           -- re-check everything under the lock
  IF v_pool.kind = 'redraft' AND v_pool.phase = 'submissions' AND v_pool.submission_deadline_at <= now() THEN
    PERFORM public.redraft__publish_locked(v_pool, NULL, 'system', NULL);
    v_published := true;
  END IF;
  v_timeouts := public.draft__resolve_timeouts(p_pool_id);
  RETURN jsonb_build_object('timeouts', v_timeouts, 'published', v_published);
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Pick (§6.2)
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.draft_confirm_pick(
  p_pool_id uuid, p_slot_id uuid, p_player_id uuid, p_actor_id uuid, p_actor_role text,
  p_line_id text, p_client_request_id uuid,
  p_redraft_slot_id uuid DEFAULT NULL, p_line_thresholds jsonb DEFAULT NULL, p_override_reason text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_pool public.draft_pools; v_slot public.draft_slots; v_existing public.draft_picks; v_entry_id uuid;
BEGIN
  IF p_actor_role IS NULL OR p_actor_role NOT IN ('player', 'admin')
     OR (p_actor_role = 'player' AND p_actor_id IS DISTINCT FROM p_player_id) THEN
    RAISE EXCEPTION 'ACTOR_NOT_ALLOWED' USING ERRCODE = 'P0001';
  END IF;
  IF p_actor_role = 'admin' AND p_actor_id IS DISTINCT FROM p_player_id AND COALESCE(btrim(p_override_reason), '') = '' THEN
    RAISE EXCEPTION 'OVERRIDE_REASON_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  v_pool := public.draft__lock(p_pool_id);
  IF v_pool.engine <> 'queue' THEN RAISE EXCEPTION 'POOL_ENGINE_LEGACY' USING ERRCODE = 'P0001'; END IF;

  -- Idempotency (SPEC:1007-1014): the same request id returns the first result and never writes again.
  IF p_client_request_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.draft_picks
     WHERE draft_pool_id = p_pool_id AND client_request_id = p_client_request_id;
    IF FOUND THEN
      IF v_existing.player_id <> p_player_id OR v_existing.line_id IS DISTINCT FROM p_line_id THEN
        RAISE EXCEPTION 'REQUEST_ID_REUSED' USING ERRCODE = 'P0001';
      END IF;
      RETURN jsonb_build_object('pick_id', v_existing.id, 'line_id', v_existing.line_id, 'pick_number', v_existing.pick_number,
        'player_id', v_existing.player_id, 'price', COALESCE(v_existing.points_spent, 0), 'replay', true,
        'voided', v_existing.voided_at IS NOT NULL, 'completed', v_pool.phase = 'complete',
        'state_version', v_pool.state_version);
    END IF;
  END IF;

  PERFORM public.draft__resolve_timeouts(p_pool_id);
  SELECT * INTO v_pool FROM public.draft_pools WHERE id = p_pool_id;
  IF v_pool.phase = 'complete' THEN RAISE EXCEPTION 'DRAFT_COMPLETE' USING ERRCODE = 'P0001'; END IF;
  IF v_pool.phase = 'submissions' THEN RAISE EXCEPTION 'SUBMISSION_PHASE' USING ERRCODE = 'P0001'; END IF;
  IF v_pool.phase = 'setup' THEN RAISE EXCEPTION 'DRAFT_NOT_STARTED' USING ERRCODE = 'P0001'; END IF;
  IF v_pool.phase <> 'drafting' THEN RAISE EXCEPTION 'DRAFT_NOT_ACTIVE' USING ERRCODE = 'P0001'; END IF;
  IF v_pool.paused_at IS NOT NULL THEN
    RAISE EXCEPTION 'DRAFT_PAUSED' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('reason', v_pool.pause_reason)::text;
  END IF;
  SELECT * INTO v_slot FROM public.draft_slots WHERE draft_pool_id = p_pool_id AND status IN ('active', 'blocked') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DRAFT_NOT_ACTIVE' USING ERRCODE = 'P0001'; END IF;
  IF v_slot.id <> p_slot_id THEN
    RAISE EXCEPTION 'STALE_SLOT' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('current_slot_id', v_slot.id, 'current_player_id', v_slot.player_id)::text;
  END IF;
  IF v_slot.player_id <> p_player_id THEN RAISE EXCEPTION 'NOT_YOUR_TURN' USING ERRCODE = 'P0001'; END IF;
  IF v_slot.status = 'blocked' THEN RAISE EXCEPTION 'SLOT_BLOCKED' USING ERRCODE = 'P0001'; END IF;

  SELECT id INTO v_entry_id FROM public.point_buy_list_entries WHERE list_version_id = v_pool.list_version_id AND line_id = p_line_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_IN_LIST' USING ERRCODE = 'P0001'; END IF;
  RETURN public.draft__commit_pick(v_pool, v_slot, v_entry_id, p_actor_id, p_actor_role, p_client_request_id,
    p_redraft_slot_id, p_line_thresholds, false,
    CASE WHEN p_actor_role = 'admin' AND p_actor_id IS DISTINCT FROM p_player_id THEN 'pick_admin_override' ELSE 'pick_confirmed' END,
    p_override_reason);
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Pool lifecycle (§6.3)
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.draft_create_pool(p_season_id uuid, p_kind text, p_actor_id uuid, p_config jsonb, p_seats jsonb)
RETURNS uuid LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_season public.seasons; v_rules public.format_rules; v_initial public.draft_pools; v_pool_id uuid;
        v_mode text; v_budget integer; v_roster integer; v_pick integer; v_makeup integer; v_ladder integer[];
        v_ext_enabled boolean; v_max_lines integer; v_lock boolean; v_deadline timestamptz; v_closes timestamptz;
        v_n integer; v_replaced uuid;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('initial', 'redraft') THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'kind')::text;
  END IF;
  IF p_config IS NOT NULL AND jsonb_typeof(p_config) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'config')::text;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_season_id::text));
  SELECT * INTO v_season FROM public.seasons WHERE id = p_season_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'season_id')::text;
  END IF;
  SELECT * INTO v_rules FROM public.format_rules WHERE season_id = p_season_id;
  v_n := public.draft__validate_seats(p_seats);

  -- shared config (§8.2 ranges are zod's; SQL keeps the safe outer bounds of the column CHECKs)
  v_mode := COALESCE(p_config->>'mode', 'live');
  IF v_mode NOT IN ('live', 'slow') THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'mode')::text;
  END IF;
  v_pick := COALESCE(public.draft__cfg_int(p_config, 'pick_seconds', 30, 172800), 300);
  v_makeup := COALESCE(public.draft__cfg_int(p_config, 'makeup_seconds', 30, 172800), 150);
  v_ladder := COALESCE(public.draft__cfg_ladder(p_config), '{43200,21600,10800,5400}'::integer[]);
  v_ext_enabled := COALESCE(public.draft__cfg_bool(p_config, 'extensions_enabled'), true);
  v_lock := COALESCE(public.draft__cfg_bool(p_config, 'redraft_lock_no_redraft_lines'), true);
  v_max_lines := public.draft__cfg_int(p_config, 'redraft_max_lines', 0, 20, true);

  IF p_kind = 'initial' THEN
    -- A pre-M2 placeholder (engine legacy, still pending, no picks) never became a draft:
    -- the live EvoLiga season created its pool row before the queue engine existed. It is replaced, not a conflict.
    SELECT * INTO v_initial FROM public.draft_pools WHERE season_id = p_season_id AND kind = 'initial';
    IF FOUND THEN
      IF v_initial.engine = 'legacy' AND v_initial.status = 'pending'
         AND NOT EXISTS (SELECT 1 FROM public.draft_picks WHERE draft_pool_id = v_initial.id)
         AND NOT EXISTS (SELECT 1 FROM public.teams WHERE draft_pool_id = v_initial.id) THEN
        DELETE FROM public.draft_pools WHERE id = v_initial.id;
        v_replaced := v_initial.id;
      ELSE
        RAISE EXCEPTION 'POOL_EXISTS' USING ERRCODE = 'P0001';
      END IF;
    END IF;
    IF v_season.point_buy_list_id IS NULL THEN RAISE EXCEPTION 'SEASON_HAS_NO_LIST' USING ERRCODE = 'P0001'; END IF;
    v_budget := COALESCE(public.draft__cfg_int(p_config, 'budget', 1, 1000), v_rules.draft_budget, 180);
    v_roster := COALESCE(public.draft__cfg_int(p_config, 'roster_size', 1, 20), v_rules.draft_picks, 9);
    v_closes := public.draft__cfg_ts(p_config, 'token_purchase_closes_at');
    INSERT INTO public.draft_pools (season_id, draft_type, point_budget, status, engine, kind, mode, phase, list_version_id,
      roster_size, pick_seconds, makeup_seconds, slow_ladder_seconds, extensions_enabled, redraft_max_lines,
      redraft_lock_no_redraft_lines, token_purchase_closes_at, created_by)
    VALUES (p_season_id, 'snake', v_budget, 'pending', 'queue', 'initial', v_mode, 'setup', v_season.point_buy_list_id,
      v_roster, v_pick, v_makeup, v_ladder, v_ext_enabled, v_max_lines, v_lock, v_closes, p_actor_id)
    RETURNING id INTO v_pool_id;
    INSERT INTO public.draft_participants (draft_pool_id, player_id, seat, standing_rank, slots_total, budget_start)
    SELECT v_pool_id, (e->>'player_id')::uuid, (e->>'seat')::int, (e->>'standing_rank')::int, v_roster, v_budget
      FROM jsonb_array_elements(p_seats) e;
  ELSE
    SELECT * INTO v_initial FROM public.draft_pools WHERE season_id = p_season_id AND kind = 'initial';
    IF NOT FOUND OR v_initial.phase <> 'complete' THEN
      RAISE EXCEPTION 'INITIAL_DRAFT_NOT_COMPLETE' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM public.draft_pools WHERE season_id = p_season_id AND kind = 'redraft' AND phase <> 'cancelled') THEN
      RAISE EXCEPTION 'POOL_EXISTS' USING ERRCODE = 'P0001';
    END IF;
    v_deadline := public.draft__cfg_ts(p_config, 'submission_deadline_at');
    IF v_deadline IS NULL OR v_deadline <= now() THEN
      RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('field', 'submission_deadline_at')::text;
    END IF;
    INSERT INTO public.draft_pools (season_id, draft_type, point_budget, status, engine, kind, mode, phase, list_version_id,
      parent_pool_id, roster_size, pick_seconds, makeup_seconds, slow_ladder_seconds, extensions_enabled, redraft_max_lines,
      redraft_lock_no_redraft_lines, submission_deadline_at, created_by)
    VALUES (p_season_id, 'snake', NULL, 'in_progress', 'queue', 'redraft', v_mode, 'submissions',
      COALESCE(v_initial.list_version_id, v_season.point_buy_list_id), v_initial.id, v_initial.roster_size, v_pick, v_makeup,
      v_ladder, v_ext_enabled, COALESCE(v_max_lines, 3), v_lock, v_deadline, p_actor_id)
    RETURNING id INTO v_pool_id;
    INSERT INTO public.draft_participants (draft_pool_id, player_id, seat, standing_rank, slots_total, budget_start)
    SELECT v_pool_id, (e->>'player_id')::uuid, (e->>'seat')::int, (e->>'standing_rank')::int, 0, 0
      FROM jsonb_array_elements(p_seats) e;
  END IF;

  PERFORM public.draft__log(p_season_id, v_pool_id, p_actor_id, 'admin', 'draft_configured',
    p_before => CASE WHEN v_replaced IS NULL THEN NULL
                     ELSE jsonb_build_object('replaced_legacy_placeholder_pool_id', v_replaced) END,
    p_after => jsonb_build_object('kind', p_kind, 'config', COALESCE(p_config, '{}'::jsonb), 'seats', p_seats));
  RETURN v_pool_id;
END $$;

CREATE OR REPLACE FUNCTION public.draft_configure(p_pool_id uuid, p_actor_id uuid, p_patch jsonb, p_seats jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_pool public.draft_pools; v_after public.draft_pools; v_key text; v_allowed text[]; v_patch jsonb;
        v_before_seats jsonb; v_after_seats jsonb; v_int integer; v_ladder integer[]; v_ts timestamptz; v_subs_max integer;
BEGIN
  v_patch := COALESCE(p_patch, '{}'::jsonb) - 'participant_order';      -- seats travel in p_seats
  IF jsonb_typeof(v_patch) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'config')::text;
  END IF;
  v_pool := public.draft__lock(p_pool_id);
  IF v_pool.engine <> 'queue' THEN RAISE EXCEPTION 'POOL_ENGINE_LEGACY' USING ERRCODE = 'P0001'; END IF;

  IF v_pool.kind = 'initial' THEN
    IF v_pool.phase = 'setup' THEN
      v_allowed := ARRAY['mode', 'roster_size', 'budget', 'pick_seconds', 'makeup_seconds', 'slow_ladder_seconds',
                         'extensions_enabled', 'redraft_max_lines', 'redraft_lock_no_redraft_lines', 'token_purchase_closes_at'];
    ELSE
      v_allowed := ARRAY['token_purchase_closes_at'];                  -- editable in every phase
      IF p_seats IS NOT NULL THEN RAISE EXCEPTION 'DRAFT_ALREADY_STARTED' USING ERRCODE = 'P0001'; END IF;
    END IF;
  ELSE
    IF v_pool.phase <> 'submissions' THEN RAISE EXCEPTION 'DRAFT_ALREADY_STARTED' USING ERRCODE = 'P0001'; END IF;
    v_allowed := ARRAY['mode', 'pick_seconds', 'makeup_seconds', 'slow_ladder_seconds', 'extensions_enabled',
                       'redraft_max_lines', 'redraft_lock_no_redraft_lines', 'submission_deadline_at'];
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(v_patch) LOOP
    IF NOT (v_key = ANY (v_allowed)) THEN
      IF v_pool.kind = 'initial' AND v_pool.phase <> 'setup' THEN
        RAISE EXCEPTION 'DRAFT_ALREADY_STARTED' USING ERRCODE = 'P0001';
      END IF;
      RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', v_key)::text;
    END IF;
  END LOOP;

  IF v_patch ? 'mode' THEN
    IF jsonb_typeof(v_patch->'mode') <> 'string' OR v_patch->>'mode' NOT IN ('live', 'slow') THEN
      RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'mode')::text;
    END IF;
    UPDATE public.draft_pools SET mode = v_patch->>'mode' WHERE id = p_pool_id;
  END IF;
  v_int := public.draft__cfg_int(v_patch, 'roster_size', 1, 20);
  IF v_int IS NOT NULL THEN
    UPDATE public.draft_pools SET roster_size = v_int WHERE id = p_pool_id;
    UPDATE public.draft_participants SET slots_total = v_int WHERE draft_pool_id = p_pool_id;
  END IF;
  v_int := public.draft__cfg_int(v_patch, 'budget', 1, 1000);
  IF v_int IS NOT NULL THEN
    UPDATE public.draft_pools SET point_budget = v_int WHERE id = p_pool_id;
    UPDATE public.draft_participants SET budget_start = v_int WHERE draft_pool_id = p_pool_id;
  END IF;
  v_int := public.draft__cfg_int(v_patch, 'pick_seconds', 30, 172800);
  IF v_int IS NOT NULL THEN UPDATE public.draft_pools SET pick_seconds = v_int WHERE id = p_pool_id; END IF;
  v_int := public.draft__cfg_int(v_patch, 'makeup_seconds', 30, 172800);
  IF v_int IS NOT NULL THEN UPDATE public.draft_pools SET makeup_seconds = v_int WHERE id = p_pool_id; END IF;
  v_ladder := public.draft__cfg_ladder(v_patch);
  IF v_ladder IS NOT NULL THEN UPDATE public.draft_pools SET slow_ladder_seconds = v_ladder WHERE id = p_pool_id; END IF;
  IF v_patch ? 'extensions_enabled' THEN
    UPDATE public.draft_pools SET extensions_enabled = public.draft__cfg_bool(v_patch, 'extensions_enabled') WHERE id = p_pool_id;
  END IF;
  IF v_patch ? 'redraft_lock_no_redraft_lines' THEN
    UPDATE public.draft_pools SET redraft_lock_no_redraft_lines = public.draft__cfg_bool(v_patch, 'redraft_lock_no_redraft_lines')
     WHERE id = p_pool_id;
  END IF;
  IF v_patch ? 'redraft_max_lines' THEN
    v_int := public.draft__cfg_int(v_patch, 'redraft_max_lines', 0, 20, true);
    -- Never below a saved secret drop list (NULL = the default 3): publish would otherwise drop more lines than the
    -- configured maximum. Only the count leaves the function, never whose list it is.
    SELECT COALESCE(max(n), 0) INTO v_subs_max
      FROM (SELECT count(*) AS n FROM public.redraft_submissions WHERE draft_pool_id = p_pool_id GROUP BY player_id) c;
    IF v_subs_max > COALESCE(v_int, 3) THEN
      RAISE EXCEPTION 'REDRAFT_MAX_BELOW_SUBMISSIONS' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('count', v_subs_max)::text;
    END IF;
    UPDATE public.draft_pools SET redraft_max_lines = v_int WHERE id = p_pool_id;
  END IF;
  IF v_patch ? 'token_purchase_closes_at' THEN
    UPDATE public.draft_pools SET token_purchase_closes_at = public.draft__cfg_ts(v_patch, 'token_purchase_closes_at')
     WHERE id = p_pool_id;
  END IF;
  IF v_patch ? 'submission_deadline_at' THEN
    v_ts := public.draft__cfg_ts(v_patch, 'submission_deadline_at');
    IF v_ts IS NULL OR v_ts <= now() THEN
      RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('field', 'submission_deadline_at')::text;
    END IF;
    UPDATE public.draft_pools SET submission_deadline_at = v_ts WHERE id = p_pool_id;
  END IF;

  IF p_seats IS NOT NULL THEN
    PERFORM public.draft__validate_seats(p_seats);
    SELECT COALESCE(jsonb_agg(jsonb_build_object('player_id', player_id, 'seat', seat, 'standing_rank', standing_rank)
                              ORDER BY seat), '[]'::jsonb)
      INTO v_before_seats FROM public.draft_participants WHERE draft_pool_id = p_pool_id;
    SET CONSTRAINTS public.draft_participants_seat_unique DEFERRED;
    DELETE FROM public.redraft_submissions s
     WHERE s.draft_pool_id = p_pool_id
       AND s.player_id NOT IN (SELECT (e->>'player_id')::uuid FROM jsonb_array_elements(p_seats) e);
    DELETE FROM public.draft_participants dp
     WHERE dp.draft_pool_id = p_pool_id
       AND dp.player_id NOT IN (SELECT (e->>'player_id')::uuid FROM jsonb_array_elements(p_seats) e);
    SELECT * INTO v_after FROM public.draft_pools WHERE id = p_pool_id;
    INSERT INTO public.draft_participants (draft_pool_id, player_id, seat, standing_rank, slots_total, budget_start)
    SELECT p_pool_id, (e->>'player_id')::uuid, (e->>'seat')::int, (e->>'standing_rank')::int,
           CASE WHEN v_after.kind = 'initial' THEN COALESCE(v_after.roster_size, 0) ELSE 0 END,
           CASE WHEN v_after.kind = 'initial' THEN COALESCE(v_after.point_budget, 0) ELSE 0 END
      FROM jsonb_array_elements(p_seats) e
    ON CONFLICT (draft_pool_id, player_id) DO UPDATE SET seat = EXCLUDED.seat, standing_rank = EXCLUDED.standing_rank;
    SET CONSTRAINTS public.draft_participants_seat_unique IMMEDIATE;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('player_id', player_id, 'seat', seat, 'standing_rank', standing_rank)
                              ORDER BY seat), '[]'::jsonb)
      INTO v_after_seats FROM public.draft_participants WHERE draft_pool_id = p_pool_id;
    PERFORM public.draft__log(v_pool.season_id, p_pool_id, p_actor_id, 'admin', 'seats_changed',
      p_before => v_before_seats, p_after => v_after_seats);
  END IF;

  UPDATE public.draft_pools SET state_version = state_version + 1, updated_at = now() WHERE id = p_pool_id
  RETURNING * INTO v_after;
  IF v_patch <> '{}'::jsonb THEN
    PERFORM public.draft__log(v_pool.season_id, p_pool_id, p_actor_id, 'admin', 'draft_configured',
      p_before => jsonb_build_object('mode', v_pool.mode, 'roster_size', v_pool.roster_size, 'budget', v_pool.point_budget,
        'pick_seconds', v_pool.pick_seconds, 'makeup_seconds', v_pool.makeup_seconds,
        'slow_ladder_seconds', v_pool.slow_ladder_seconds, 'extensions_enabled', v_pool.extensions_enabled,
        'redraft_max_lines', v_pool.redraft_max_lines, 'redraft_lock_no_redraft_lines', v_pool.redraft_lock_no_redraft_lines,
        'submission_deadline_at', v_pool.submission_deadline_at, 'token_purchase_closes_at', v_pool.token_purchase_closes_at),
      p_after => v_patch);
  END IF;
  RETURN jsonb_build_object('state_version', v_after.state_version);
END $$;

CREATE OR REPLACE FUNCTION public.draft_start(p_pool_id uuid, p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_pool public.draft_pools; v_n integer; v_current uuid;
BEGIN
  v_pool := public.draft__lock(p_pool_id);
  IF v_pool.engine <> 'queue' THEN RAISE EXCEPTION 'POOL_ENGINE_LEGACY' USING ERRCODE = 'P0001'; END IF;
  IF v_pool.kind <> 'initial' THEN RAISE EXCEPTION 'SUBMISSION_PHASE' USING ERRCODE = 'P0001'; END IF;   -- a redraft starts at publish
  IF v_pool.phase <> 'setup' THEN RAISE EXCEPTION 'DRAFT_ALREADY_STARTED' USING ERRCODE = 'P0001'; END IF;
  IF v_pool.list_version_id IS NULL THEN RAISE EXCEPTION 'SEASON_HAS_NO_LIST' USING ERRCODE = 'P0001'; END IF;
  IF v_pool.roster_size IS NULL THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'roster_size')::text;
  END IF;
  SELECT count(*) INTO v_n FROM public.draft_participants WHERE draft_pool_id = p_pool_id;
  IF v_n < 2 THEN RAISE EXCEPTION 'SEATS_INVALID' USING ERRCODE = 'P0001'; END IF;

  -- §5.2 snake: seats ascending on odd rounds, descending on even rounds; sort_key = nominal = running index.
  INSERT INTO public.draft_slots (draft_pool_id, player_id, sort_key, round, nominal_pick_number)
  SELECT p_pool_id, s.player_id, s.rn, s.round, s.rn
    FROM (SELECT dp.player_id, r.round,
                 row_number() OVER (ORDER BY r.round, CASE WHEN r.round % 2 = 1 THEN dp.seat ELSE -dp.seat END) AS rn
            FROM public.draft_participants dp CROSS JOIN generate_series(1, v_pool.roster_size) AS r(round)
           WHERE dp.draft_pool_id = p_pool_id) s;
  UPDATE public.draft_participants SET slots_total = v_pool.roster_size, done_at = NULL WHERE draft_pool_id = p_pool_id;
  UPDATE public.draft_pools
     SET phase = 'drafting', status = 'in_progress', started_at = now(), paused_at = NULL, paused_by = NULL, pause_reason = NULL,
         updated_at = now()
   WHERE id = p_pool_id;
  PERFORM public.draft__log(v_pool.season_id, p_pool_id, p_actor_id, 'admin', 'draft_started',
    p_before => jsonb_build_object('phase', v_pool.phase, 'status', v_pool.status, 'started_at', v_pool.started_at,
                                   'paused_at', v_pool.paused_at, 'pause_reason', v_pool.pause_reason),
    p_after => jsonb_build_object('phase', 'drafting', 'status', 'in_progress', 'participants', v_n,
                                  'roster_size', v_pool.roster_size, 'mode', v_pool.mode));
  v_current := public.draft__activate_next(p_pool_id, now());
  UPDATE public.draft_pools SET state_version = state_version + 1 WHERE id = p_pool_id RETURNING * INTO v_pool;
  RETURN jsonb_build_object('state_version', v_pool.state_version, 'active_slot_id', v_current);
END $$;

CREATE OR REPLACE FUNCTION public.draft_end(p_pool_id uuid, p_actor_id uuid, p_reason text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_pool public.draft_pools; v_forfeited integer := 0;
BEGIN
  v_pool := public.draft__lock(p_pool_id);
  IF v_pool.engine <> 'queue' THEN RAISE EXCEPTION 'POOL_ENGINE_LEGACY' USING ERRCODE = 'P0001'; END IF;
  IF v_pool.phase = 'drafting' THEN
    UPDATE public.draft_slots SET status = 'forfeited', completed_at = now(), deadline_at = NULL, remaining_ms_at_pause = NULL
     WHERE draft_pool_id = p_pool_id AND status IN ('pending', 'active', 'blocked');
    GET DIAGNOSTICS v_forfeited = ROW_COUNT;
    UPDATE public.draft_pools
       SET phase = 'complete', status = 'complete', ended_at = now(), paused_at = NULL, paused_by = NULL, pause_reason = NULL,
           updated_at = now()
     WHERE id = p_pool_id;
    UPDATE public.draft_participants SET done_at = COALESCE(done_at, now()) WHERE draft_pool_id = p_pool_id;
    PERFORM public.draft__log(v_pool.season_id, p_pool_id, p_actor_id, 'admin', 'draft_ended',
      p_before => jsonb_build_object('phase', v_pool.phase, 'status', v_pool.status, 'ended_at', v_pool.ended_at,
                                     'paused_at', v_pool.paused_at, 'pause_reason', v_pool.pause_reason),
      p_after => jsonb_build_object('phase', 'complete', 'status', 'complete', 'reason', 'admin',
                                    'forfeited_slots', v_forfeited), p_reason => p_reason);
  ELSIF v_pool.phase = 'submissions' THEN
    UPDATE public.draft_pools SET phase = 'cancelled', status = 'complete', ended_at = now(), updated_at = now()
     WHERE id = p_pool_id;                                              -- submissions stay for the audit
    PERFORM public.draft__log(v_pool.season_id, p_pool_id, p_actor_id, 'admin', 'draft_cancelled',
      p_before => jsonb_build_object('phase', v_pool.phase, 'status', v_pool.status, 'ended_at', v_pool.ended_at),
      p_after => jsonb_build_object('phase', 'cancelled', 'status', 'complete'), p_reason => p_reason);
  ELSIF v_pool.phase = 'setup' THEN
    RAISE EXCEPTION 'DRAFT_NOT_STARTED' USING ERRCODE = 'P0001';
  ELSE
    RAISE EXCEPTION 'DRAFT_COMPLETE' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.draft_pools SET state_version = state_version + 1 WHERE id = p_pool_id RETURNING * INTO v_pool;
  RETURN jsonb_build_object('state_version', v_pool.state_version, 'phase', v_pool.phase);
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Clock control (§6.4)
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.draft_use_extension(p_pool_id uuid, p_player_id uuid, p_kind text, p_slot_id uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_pool public.draft_pools; v_slot public.draft_slots; v_part public.draft_participants; v_secs integer;
        v_deadline timestamptz;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('plus120', 'plus60') THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'kind')::text;
  END IF;
  v_pool := public.draft__lock(p_pool_id);
  IF v_pool.engine <> 'queue' THEN RAISE EXCEPTION 'POOL_ENGINE_LEGACY' USING ERRCODE = 'P0001'; END IF;
  PERFORM public.draft__resolve_timeouts(p_pool_id);
  SELECT * INTO v_pool FROM public.draft_pools WHERE id = p_pool_id;
  IF v_pool.phase <> 'drafting' THEN RAISE EXCEPTION 'DRAFT_NOT_ACTIVE' USING ERRCODE = 'P0001'; END IF;
  IF v_pool.mode = 'slow' OR NOT v_pool.extensions_enabled THEN
    RAISE EXCEPTION 'EXTENSION_NOT_ALLOWED' USING ERRCODE = 'P0001';
  END IF;
  IF v_pool.paused_at IS NOT NULL THEN
    RAISE EXCEPTION 'DRAFT_PAUSED' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('reason', v_pool.pause_reason)::text;
  END IF;
  SELECT * INTO v_slot FROM public.draft_slots WHERE draft_pool_id = p_pool_id AND status IN ('active', 'blocked') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DRAFT_NOT_ACTIVE' USING ERRCODE = 'P0001'; END IF;
  IF v_slot.id <> p_slot_id THEN
    RAISE EXCEPTION 'STALE_SLOT' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('current_slot_id', v_slot.id, 'current_player_id', v_slot.player_id)::text;
  END IF;
  IF v_slot.player_id <> p_player_id THEN RAISE EXCEPTION 'NOT_YOUR_TURN' USING ERRCODE = 'P0001'; END IF;
  IF v_slot.status = 'blocked' THEN RAISE EXCEPTION 'SLOT_BLOCKED' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO v_part FROM public.draft_participants WHERE draft_pool_id = p_pool_id AND player_id = p_player_id FOR UPDATE;
  IF (p_kind = 'plus120' AND v_part.ext_plus120_used_at IS NOT NULL) OR (p_kind = 'plus60' AND v_part.ext_plus60_used_at IS NOT NULL) THEN
    RAISE EXCEPTION 'EXTENSION_USED' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('kind', p_kind)::text;
  END IF;

  v_secs := v_pool.extension_seconds[CASE WHEN p_kind = 'plus120' THEN 1 ELSE 2 END];
  UPDATE public.draft_slots
     SET deadline_at = deadline_at + v_secs * interval '1 second', extension_seconds = extension_seconds + v_secs
   WHERE id = v_slot.id RETURNING deadline_at INTO v_deadline;
  IF p_kind = 'plus120' THEN
    UPDATE public.draft_participants SET ext_plus120_used_at = now() WHERE draft_pool_id = p_pool_id AND player_id = p_player_id;
  ELSE
    UPDATE public.draft_participants SET ext_plus60_used_at = now() WHERE draft_pool_id = p_pool_id AND player_id = p_player_id;
  END IF;
  PERFORM public.draft__log(v_pool.season_id, p_pool_id, p_player_id, 'player', 'extension_used',
    p_player_id => p_player_id, p_slot_id => v_slot.id,
    p_after => jsonb_build_object('kind', p_kind, 'seconds', v_secs, 'deadline_at', v_deadline));
  UPDATE public.draft_pools SET state_version = state_version + 1, updated_at = now() WHERE id = p_pool_id RETURNING * INTO v_pool;
  RETURN jsonb_build_object('deadline_at', v_deadline, 'state_version', v_pool.state_version);
END $$;

-- Admin pause/resume of the pick clock (every mode, BR-16). The redraft submission phase has no clock.
CREATE OR REPLACE FUNCTION public.draft_set_paused(p_pool_id uuid, p_actor_id uuid, p_paused boolean, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_pool public.draft_pools; v_ms integer; v_before jsonb;
BEGIN
  v_pool := public.draft__lock(p_pool_id);
  IF v_pool.engine <> 'queue' THEN RAISE EXCEPTION 'POOL_ENGINE_LEGACY' USING ERRCODE = 'P0001'; END IF;
  PERFORM public.draft__resolve_timeouts(p_pool_id);
  SELECT * INTO v_pool FROM public.draft_pools WHERE id = p_pool_id;
  IF v_pool.phase <> 'drafting' THEN RAISE EXCEPTION 'DRAFT_NOT_ACTIVE' USING ERRCODE = 'P0001'; END IF;
  -- Audit (acceptance 20): the clock state before the change; the active slot's deadline / frozen remainder.
  SELECT jsonb_build_object('paused_at', v_pool.paused_at, 'paused_by', v_pool.paused_by, 'pause_reason', v_pool.pause_reason,
                            'slot_id', s.id, 'deadline_at', s.deadline_at, 'remaining_ms_at_pause', s.remaining_ms_at_pause)
    INTO v_before
    FROM (SELECT 1) AS one
    LEFT JOIN public.draft_slots s ON s.draft_pool_id = p_pool_id AND s.status IN ('active', 'blocked');

  IF p_paused THEN
    IF v_pool.paused_at IS NOT NULL THEN RAISE EXCEPTION 'ALREADY_PAUSED' USING ERRCODE = 'P0001'; END IF;
    UPDATE public.draft_slots
       SET remaining_ms_at_pause = GREATEST(0, EXTRACT(EPOCH FROM (deadline_at - now())) * 1000)::int, deadline_at = NULL
     WHERE draft_pool_id = p_pool_id AND status = 'active' AND deadline_at IS NOT NULL
     RETURNING remaining_ms_at_pause INTO v_ms;
    UPDATE public.draft_pools SET paused_at = now(), paused_by = p_actor_id, pause_reason = 'admin', updated_at = now()
     WHERE id = p_pool_id;
    PERFORM public.draft__log(v_pool.season_id, p_pool_id, p_actor_id, 'admin', 'paused', p_before => v_before,
      p_after => jsonb_build_object('paused_at', now(), 'paused_by', p_actor_id, 'pause_reason', 'admin', 'remaining_ms', v_ms),
      p_reason => p_reason);
  ELSE
    IF v_pool.paused_at IS NULL THEN RAISE EXCEPTION 'NOT_PAUSED' USING ERRCODE = 'P0001'; END IF;
    IF EXISTS (SELECT 1 FROM public.draft_slots WHERE draft_pool_id = p_pool_id AND status = 'blocked') THEN
      RAISE EXCEPTION 'BLOCKED_SLOT_UNRESOLVED' USING ERRCODE = 'P0001';
    END IF;
    v_ms := public.draft__resume(p_pool_id);
    PERFORM public.draft__log(v_pool.season_id, p_pool_id, p_actor_id, 'admin', 'resumed', p_before => v_before,
      p_after => jsonb_build_object('paused_at', NULL, 'pause_reason', NULL, 'remaining_ms', v_ms), p_reason => p_reason);
  END IF;
  UPDATE public.draft_pools SET state_version = state_version + 1 WHERE id = p_pool_id RETURNING * INTO v_pool;
  RETURN jsonb_build_object('state_version', v_pool.state_version, 'paused', v_pool.paused_at IS NOT NULL);
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Admin corrections (§6.5)
-- ════════════════════════════════════════════════════════════════════════════

-- Void a pick (BR-8): restores availability, budget and roster (both derive from live picks), unfills the redraft slot,
-- deletes the line's tracker, and either requeues the player directly before the current slot or records the lost
-- opportunity as a forfeited slot. With p_replacement_line_id it is "correct": void + requeue + an immediate admin pick.
CREATE OR REPLACE FUNCTION public.draft_admin_void_pick(p_pool_id uuid, p_pick_id uuid, p_actor_id uuid, p_reason text,
  p_requeue boolean, p_replacement_line_id text DEFAULT NULL, p_replacement_thresholds jsonb DEFAULT NULL,
  p_client_request_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_pool public.draft_pools; v_pick public.draft_picks; v_existing public.draft_picks; v_tracker public.evolution_tracker;
        v_has_tracker boolean; v_progress integer; v_src public.draft_slots; v_current public.draft_slots;
        v_anchor public.draft_slots; v_prev numeric; v_next numeric; v_key numeric; v_r uuid; v_r_slot public.draft_slots;
        v_secs integer; v_entry_id uuid; v_commit jsonb := NULL;
BEGIN
  IF COALESCE(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'OVERRIDE_REASON_REQUIRED' USING ERRCODE = 'P0001'; END IF;
  IF p_replacement_line_id IS NOT NULL AND NOT COALESCE(p_requeue, false) THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'requeue')::text;
  END IF;
  v_pool := public.draft__lock(p_pool_id);
  IF v_pool.engine <> 'queue' THEN RAISE EXCEPTION 'POOL_ENGINE_LEGACY' USING ERRCODE = 'P0001'; END IF;

  -- A replayed correction returns the first result.
  IF p_client_request_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.draft_picks WHERE draft_pool_id = p_pool_id AND client_request_id = p_client_request_id;
    IF FOUND THEN
      RETURN jsonb_build_object('replay', true, 'pick_id', v_existing.id, 'state_version', v_pool.state_version);
    END IF;
  END IF;

  SELECT * INTO v_pick FROM public.draft_picks WHERE id = p_pick_id AND draft_pool_id = p_pool_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PICK_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF v_pick.voided_at IS NOT NULL THEN RAISE EXCEPTION 'PICK_ALREADY_VOIDED' USING ERRCODE = 'P0001'; END IF;
  IF v_pool.phase = 'drafting' THEN
    IF v_pool.paused_at IS NULL THEN RAISE EXCEPTION 'CORRECTION_REQUIRES_PAUSE' USING ERRCODE = 'P0001'; END IF;
  ELSIF v_pool.phase <> 'complete' THEN
    RAISE EXCEPTION 'DRAFT_NOT_ACTIVE' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_tracker FROM public.evolution_tracker
   WHERE season_id = v_pool.season_id AND line_id = v_pick.line_id FOR UPDATE;
  v_has_tracker := FOUND;
  IF v_has_tracker THEN
    IF v_tracker.player_id <> v_pick.player_id THEN                    -- the line moved on (trade): never touch it
      RAISE EXCEPTION 'LINE_TAKEN' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('line_id', v_pick.line_id, 'player_id', v_tracker.player_id)::text;
    END IF;
    v_progress := v_tracker.real_kills + v_tracker.draft_tokens + v_tracker.kill_tokens + v_tracker.cosmo_points;
    IF v_progress > 0 THEN
      RAISE EXCEPTION 'VOID_BLOCKED_PROGRESS' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('progress', v_progress)::text;
    END IF;
  END IF;

  UPDATE public.draft_picks SET voided_at = now(), voided_by = p_actor_id, void_reason = left(p_reason, 500) WHERE id = p_pick_id;
  IF v_has_tracker THEN DELETE FROM public.evolution_tracker WHERE id = v_tracker.id; END IF;
  UPDATE public.redraft_slots SET filled_by_pick_id = NULL WHERE filled_by_pick_id = p_pick_id;
  SELECT * INTO v_src FROM public.draft_slots WHERE id = v_pick.slot_id;

  IF COALESCE(p_requeue, false) THEN
    SELECT * INTO v_current FROM public.draft_slots
     WHERE draft_pool_id = p_pool_id AND status IN ('active', 'blocked') FOR UPDATE;
    IF FOUND THEN
      UPDATE public.draft_slots
         SET status = 'pending', timer_seconds = NULL, started_at = NULL, deadline_at = NULL, remaining_ms_at_pause = NULL,
             extension_seconds = 0
       WHERE id = v_current.id;
      IF v_pool.pause_reason = 'blocked_slot' THEN
        UPDATE public.draft_pools SET pause_reason = 'admin', paused_by = p_actor_id WHERE id = p_pool_id;
      END IF;
    END IF;
    -- R goes directly before the first pending slot (= the reset current slot), else to the end.
    SELECT * INTO v_anchor FROM public.draft_slots
     WHERE draft_pool_id = p_pool_id AND status = 'pending' ORDER BY sort_key LIMIT 1;
    IF FOUND THEN
      SELECT max(sort_key) INTO v_prev FROM public.draft_slots WHERE draft_pool_id = p_pool_id AND sort_key < v_anchor.sort_key;
      v_key := CASE WHEN v_prev IS NULL THEN v_anchor.sort_key - 1 ELSE (v_prev + v_anchor.sort_key) / 2 END;
    ELSE
      SELECT COALESCE(max(sort_key), 0) + 1 INTO v_key FROM public.draft_slots WHERE draft_pool_id = p_pool_id;
    END IF;
    INSERT INTO public.draft_slots (draft_pool_id, player_id, sort_key, round, nominal_pick_number, kind, status, previous_slot_id)
    VALUES (p_pool_id, v_pick.player_id, v_key, COALESCE(v_src.round, v_pick.round::smallint),
            COALESCE(v_src.nominal_pick_number, v_pick.pick_number), 'normal', 'pending', v_src.id)
    RETURNING id INTO v_r;
    UPDATE public.draft_participants SET done_at = NULL WHERE draft_pool_id = p_pool_id AND player_id = v_pick.player_id;
    IF v_pool.phase = 'complete' THEN                                   -- reopen, paused, so the admin resumes it
      UPDATE public.draft_pools
         SET phase = 'drafting', status = 'in_progress', ended_at = NULL, paused_at = now(), paused_by = p_actor_id,
             pause_reason = 'admin', updated_at = now()
       WHERE id = p_pool_id;
    END IF;
  ELSE
    -- the lost opportunity is recorded as a forfeited slot right after the voided one
    IF v_src.id IS NOT NULL THEN
      SELECT min(sort_key) INTO v_next FROM public.draft_slots WHERE draft_pool_id = p_pool_id AND sort_key > v_src.sort_key;
      v_key := CASE WHEN v_next IS NULL THEN v_src.sort_key + 1 ELSE (v_src.sort_key + v_next) / 2 END;
    ELSE
      SELECT COALESCE(max(sort_key), 0) + 1 INTO v_key FROM public.draft_slots WHERE draft_pool_id = p_pool_id;
    END IF;
    INSERT INTO public.draft_slots (draft_pool_id, player_id, sort_key, round, nominal_pick_number, kind, status,
                                    previous_slot_id, completed_at)
    VALUES (p_pool_id, v_pick.player_id, v_key, COALESCE(v_src.round, v_pick.round::smallint),
            COALESCE(v_src.nominal_pick_number, v_pick.pick_number), 'normal', 'forfeited', v_src.id, now())
    RETURNING id INTO v_r;
  END IF;

  PERFORM public.draft__log(v_pool.season_id, p_pool_id, p_actor_id, 'admin', 'pick_voided',
    p_player_id => v_pick.player_id, p_slot_id => v_pick.slot_id, p_pick_id => p_pick_id, p_line_id => v_pick.line_id,
    p_before => to_jsonb(v_pick), p_after => jsonb_build_object('restored_slot_id', v_r, 'requeue', COALESCE(p_requeue, false)),
    p_reason => p_reason);

  IF p_replacement_line_id IS NOT NULL THEN
    SELECT * INTO v_pool FROM public.draft_pools WHERE id = p_pool_id;
    SELECT id INTO v_entry_id FROM public.point_buy_list_entries
     WHERE list_version_id = v_pool.list_version_id AND line_id = p_replacement_line_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_IN_LIST' USING ERRCODE = 'P0001'; END IF;
    v_secs := public.draft__slot_seconds(v_pool, v_pick.player_id, 'normal');
    UPDATE public.draft_slots
       SET status = 'active', timer_seconds = v_secs, started_at = now(), deadline_at = NULL, remaining_ms_at_pause = v_secs * 1000
     WHERE id = v_r RETURNING * INTO v_r_slot;
    v_commit := public.draft__commit_pick(v_pool, v_r_slot, v_entry_id, p_actor_id, 'admin', p_client_request_id,
      v_pick.redraft_slot_id, p_replacement_thresholds, false, 'pick_corrected', p_reason);
  END IF;

  UPDATE public.draft_pools SET state_version = state_version + 1, updated_at = now() WHERE id = p_pool_id RETURNING * INTO v_pool;
  RETURN jsonb_build_object('state_version', v_pool.state_version, 'restored_slot_id', v_r, 'requeue', COALESCE(p_requeue, false),
    'pick_id', v_commit->'pick_id', 'replay', false);
END $$;

-- Resolve the current blocked slot (§5.3 step 3, Q12): assign (budget bypass; availability/restrictions still apply) or
-- forfeit; then optionally resume.
CREATE OR REPLACE FUNCTION public.draft_admin_resolve_slot(p_pool_id uuid, p_slot_id uuid, p_actor_id uuid, p_action text,
  p_line_id text, p_reason text, p_client_request_id uuid, p_redraft_slot_id uuid, p_line_thresholds jsonb, p_resume boolean)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_pool public.draft_pools; v_slot public.draft_slots; v_existing public.draft_picks; v_entry_id uuid;
        v_commit jsonb := NULL; v_ms integer; v_resumed boolean := false;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('assign', 'forfeit') THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'action')::text;
  END IF;
  IF COALESCE(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'OVERRIDE_REASON_REQUIRED' USING ERRCODE = 'P0001'; END IF;
  v_pool := public.draft__lock(p_pool_id);
  IF v_pool.engine <> 'queue' THEN RAISE EXCEPTION 'POOL_ENGINE_LEGACY' USING ERRCODE = 'P0001'; END IF;
  IF p_action = 'assign' AND p_client_request_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.draft_picks WHERE draft_pool_id = p_pool_id AND client_request_id = p_client_request_id;
    IF FOUND THEN
      RETURN jsonb_build_object('replay', true, 'pick_id', v_existing.id, 'state_version', v_pool.state_version);
    END IF;
  END IF;
  SELECT * INTO v_slot FROM public.draft_slots WHERE draft_pool_id = p_pool_id AND status IN ('active', 'blocked') FOR UPDATE;
  IF NOT FOUND OR v_slot.id <> p_slot_id OR v_slot.status <> 'blocked' THEN
    RAISE EXCEPTION 'SLOT_NOT_BLOCKED' USING ERRCODE = 'P0001';
  END IF;

  IF p_action = 'assign' THEN
    SELECT id INTO v_entry_id FROM public.point_buy_list_entries WHERE list_version_id = v_pool.list_version_id AND line_id = p_line_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_IN_LIST' USING ERRCODE = 'P0001'; END IF;
    v_commit := public.draft__commit_pick(v_pool, v_slot, v_entry_id, p_actor_id, 'admin', p_client_request_id,
      p_redraft_slot_id, p_line_thresholds, true, 'slot_assigned', p_reason);
  ELSE
    -- forfeit (a redraft player's lowest open redraft slot simply stays unfilled; its transfer is lost)
    UPDATE public.draft_slots SET status = 'forfeited', completed_at = now() WHERE id = v_slot.id;
    IF public.draft__open_slots(p_pool_id, v_slot.player_id) = 0 THEN
      UPDATE public.draft_participants SET done_at = now() WHERE draft_pool_id = p_pool_id AND player_id = v_slot.player_id;
    END IF;
    PERFORM public.draft__log(v_pool.season_id, p_pool_id, p_actor_id, 'admin', 'slot_forfeited',
      p_player_id => v_slot.player_id, p_slot_id => v_slot.id,
      p_before => jsonb_build_object('status', v_slot.status, 'completed_at', v_slot.completed_at,
                                     'paused_at', v_pool.paused_at, 'pause_reason', v_pool.pause_reason),
      p_after => jsonb_build_object('status', 'forfeited', 'completed_at', now()), p_reason => p_reason);
    PERFORM public.draft__activate_next(p_pool_id, now());
  END IF;

  IF COALESCE(p_resume, false)
     AND NOT EXISTS (SELECT 1 FROM public.draft_slots WHERE draft_pool_id = p_pool_id AND status = 'blocked')
     AND (SELECT paused_at FROM public.draft_pools WHERE id = p_pool_id) IS NOT NULL
     AND (SELECT phase FROM public.draft_pools WHERE id = p_pool_id) = 'drafting' THEN
    v_ms := public.draft__resume(p_pool_id);
    v_resumed := true;
    PERFORM public.draft__log(v_pool.season_id, p_pool_id, p_actor_id, 'admin', 'resumed',
      p_before => jsonb_build_object('paused_at', v_pool.paused_at, 'paused_by', v_pool.paused_by,
                                     'pause_reason', v_pool.pause_reason),
      p_after => jsonb_build_object('paused_at', NULL, 'pause_reason', NULL, 'remaining_ms', v_ms), p_reason => p_reason);
  END IF;
  UPDATE public.draft_pools SET state_version = state_version + 1, updated_at = now() WHERE id = p_pool_id RETURNING * INTO v_pool;
  RETURN jsonb_build_object('state_version', v_pool.state_version, 'pick_id', v_commit->'pick_id', 'resumed', v_resumed,
    'replay', false);
END $$;

-- Slow-draft penalty stage correction; applies to slots activated afterwards (the active slot keeps its deadline).
CREATE OR REPLACE FUNCTION public.draft_admin_set_penalty(p_pool_id uuid, p_player_id uuid, p_stage smallint, p_actor_id uuid,
  p_reason text) RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_pool public.draft_pools; v_before smallint;
BEGIN
  v_pool := public.draft__lock(p_pool_id);
  IF v_pool.engine <> 'queue' THEN RAISE EXCEPTION 'POOL_ENGINE_LEGACY' USING ERRCODE = 'P0001'; END IF;
  IF p_stage IS NULL OR p_stage < 0 OR p_stage > array_length(v_pool.slow_ladder_seconds, 1) - 1 THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'stage')::text;
  END IF;
  SELECT penalty_stage INTO v_before FROM public.draft_participants
   WHERE draft_pool_id = p_pool_id AND player_id = p_player_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_PARTICIPANT' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.draft_participants SET penalty_stage = p_stage WHERE draft_pool_id = p_pool_id AND player_id = p_player_id;
  PERFORM public.draft__log(v_pool.season_id, p_pool_id, p_actor_id, 'admin', 'penalty_changed',
    p_player_id => p_player_id, p_before => jsonb_build_object('penalty_stage', v_before),
    p_after => jsonb_build_object('penalty_stage', p_stage), p_reason => p_reason);
  UPDATE public.draft_pools SET state_version = state_version + 1, updated_at = now() WHERE id = p_pool_id RETURNING * INTO v_pool;
  RETURN jsonb_build_object('state_version', v_pool.state_version);
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. Reads (§6.6)
-- ════════════════════════════════════════════════════════════════════════════

-- p_tick = false is mandatory for Server Component seeds (critique B9): a publish there could not expire public reads.
CREATE OR REPLACE FUNCTION public.draft_snapshot(p_pool_id uuid, p_since bigint DEFAULT NULL, p_tick boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v jsonb; v_pool public.draft_pools; v_published boolean := false;
BEGIN
  IF COALESCE(p_tick, true) THEN
    v := public.draft__tick(p_pool_id);
    v_published := COALESCE((v->>'published')::boolean, false);
  END IF;
  SELECT * INTO v_pool FROM public.draft_pools WHERE id = p_pool_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'POOL_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF v_pool.engine <> 'queue' THEN RAISE EXCEPTION 'POOL_ENGINE_LEGACY' USING ERRCODE = 'P0001'; END IF;
  IF p_since IS NOT NULL AND p_since = v_pool.state_version THEN
    RETURN jsonb_build_object('unchanged', true, 'state_version', v_pool.state_version, 'server_now', now(),
                              'published_now', v_published);
  END IF;
  RETURN public.draft__build_snapshot(v_pool) || jsonb_build_object('published_now', v_published);
END $$;

-- MyTurnDTO fields + published_now (the route strips it and expires public reads when true, critique B8).
CREATE OR REPLACE FUNCTION public.draft_my_turn(p_pool_id uuid, p_player_id uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v jsonb; v_pool public.draft_pools; v_current public.draft_slots; v_has_current boolean; v_next_player uuid;
        v_on_clock boolean; v_league text;
BEGIN
  v := public.draft__tick(p_pool_id);
  SELECT * INTO v_pool FROM public.draft_pools WHERE id = p_pool_id;
  IF v_pool.engine <> 'queue' THEN RAISE EXCEPTION 'POOL_ENGINE_LEGACY' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO v_current FROM public.draft_slots WHERE draft_pool_id = p_pool_id AND status IN ('active', 'blocked');
  v_has_current := FOUND;
  SELECT s.player_id INTO v_next_player FROM public.draft_slots s
   WHERE s.draft_pool_id = p_pool_id AND s.status = 'pending'
     AND (NOT v_has_current OR s.sort_key > v_current.sort_key)
   ORDER BY s.sort_key LIMIT 1;
  SELECT name INTO v_league FROM public.seasons WHERE id = v_pool.season_id;
  v_on_clock := v_has_current AND v_current.player_id = p_player_id AND v_current.status = 'active';
  RETURN jsonb_build_object(
    'state_version', v_pool.state_version, 'server_now', now(), 'status', v_pool.status, 'mode', v_pool.mode,
    'paused', v_pool.paused_at IS NOT NULL, 'on_clock', v_on_clock,
    'up_next', COALESCE(v_next_player = p_player_id, false),
    'slot_id', CASE WHEN v_on_clock THEN v_current.id END,
    'deadline_at', CASE WHEN v_on_clock THEN v_current.deadline_at END,
    'remaining_ms_at_pause', CASE WHEN v_on_clock THEN v_current.remaining_ms_at_pause END,
    'league_name', COALESCE(v_league, ''),
    'published_now', COALESCE((v->>'published')::boolean, false));
END $$;

-- Cron wrapper (§11.2).
CREATE OR REPLACE FUNCTION public.draft_tick(p_pool_id uuid) RETURNS jsonb
LANGUAGE sql SET search_path = public AS $$
  SELECT public.draft__tick(p_pool_id)
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 7. Notification claims (§6.7). Rows are claimed FOR UPDATE SKIP LOCKED and marked in the same statement, so two
--    concurrent callers (pick route after(), cron) never send one event twice.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.draft_claim_notifications(p_pool_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_started jsonb; v_reminders jsonb; v_alerts jsonb; v_published jsonb;
BEGIN
  -- 1. turn_started (slow pools, clock running): marks every threshold already crossed as sent.
  WITH c AS (
    SELECT s.id FROM public.draft_slots s JOIN public.draft_pools p ON p.id = s.draft_pool_id
     WHERE (p_pool_id IS NULL OR s.draft_pool_id = p_pool_id) AND p.engine = 'queue' AND p.mode = 'slow'
       AND p.phase = 'drafting' AND p.paused_at IS NULL AND s.status = 'active' AND s.deadline_at IS NOT NULL
       AND s.notified_turn_at IS NULL
     FOR UPDATE OF s SKIP LOCKED),
  u AS (
    UPDATE public.draft_slots s
       SET notified_turn_at = now(),
           reminder_mask = (s.reminder_mask
             | ((s.deadline_at - now() <= interval '8 hours')::int)
             | (((s.deadline_at - now() <= interval '4 hours')::int) << 1)
             | (((s.deadline_at - now() <= interval '1 hour')::int) << 2))::smallint
      FROM c WHERE s.id = c.id
    RETURNING s.id, s.draft_pool_id, s.player_id, s.deadline_at, s.timer_seconds, s.round, s.nominal_pick_number, s.kind)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('type', 'turn_started', 'pool_id', u.draft_pool_id, 'season_id', p.season_id,
           'slot_id', u.id, 'player_id', u.player_id, 'deadline_at', u.deadline_at, 'timer_seconds', u.timer_seconds,
           'round', u.round, 'pick_number', u.nominal_pick_number, 'kind', u.kind, 'mode', p.mode)), '[]'::jsonb)
    INTO v_started
    FROM u JOIN public.draft_pools p ON p.id = u.draft_pool_id;

  -- 2. turn_reminder: newly crossed thresholds (8h bit0, 4h bit1, 1h bit2); one claim per slot, smallest threshold.
  WITH c AS (
    SELECT s.id,
           (((s.deadline_at - now() <= interval '8 hours')::int)
            | (((s.deadline_at - now() <= interval '4 hours')::int) << 1)
            | (((s.deadline_at - now() <= interval '1 hour')::int) << 2)) AS crossed,
           s.reminder_mask
      FROM public.draft_slots s JOIN public.draft_pools p ON p.id = s.draft_pool_id
     WHERE (p_pool_id IS NULL OR s.draft_pool_id = p_pool_id) AND p.engine = 'queue' AND p.mode = 'slow'
       AND p.phase = 'drafting' AND p.paused_at IS NULL AND s.status = 'active' AND s.deadline_at IS NOT NULL
       AND s.notified_turn_at IS NOT NULL AND s.notified_turn_at < now() AND s.reminder_mask <> 7
     FOR UPDATE OF s SKIP LOCKED),
  d AS (SELECT c.id, c.crossed, (c.crossed & ~c.reminder_mask) AS fresh FROM c WHERE (c.crossed & ~c.reminder_mask) <> 0),
  u AS (
    UPDATE public.draft_slots s SET reminder_mask = (s.reminder_mask | d.crossed)::smallint
      FROM d WHERE s.id = d.id
    RETURNING s.id, s.draft_pool_id, s.player_id, s.deadline_at, s.timer_seconds, s.round, s.nominal_pick_number, s.kind,
              d.fresh)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('type', 'turn_reminder', 'pool_id', u.draft_pool_id, 'season_id', p.season_id,
           'slot_id', u.id, 'player_id', u.player_id, 'deadline_at', u.deadline_at, 'timer_seconds', u.timer_seconds,
           'round', u.round, 'pick_number', u.nominal_pick_number, 'kind', u.kind, 'mode', p.mode,
           'threshold', CASE WHEN (u.fresh & 4) <> 0 THEN '1h' WHEN (u.fresh & 2) <> 0 THEN '4h' ELSE '8h' END)), '[]'::jsonb)
    INTO v_reminders
    FROM u JOIN public.draft_pools p ON p.id = u.draft_pool_id;

  -- 3. admin alerts (blocked / in-place timeout; any mode)
  WITH c AS (
    SELECT s.id FROM public.draft_slots s JOIN public.draft_pools p ON p.id = s.draft_pool_id
     WHERE (p_pool_id IS NULL OR s.draft_pool_id = p_pool_id) AND p.engine = 'queue'
       AND s.alert_kind IS NOT NULL AND s.alert_notified_at IS NULL
     FOR UPDATE OF s SKIP LOCKED),
  u AS (
    UPDATE public.draft_slots s SET alert_notified_at = now() FROM c WHERE s.id = c.id
    RETURNING s.id, s.draft_pool_id, s.player_id, s.alert_kind)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('type', 'admin_alert', 'alert_kind', u.alert_kind, 'pool_id', u.draft_pool_id,
           'season_id', p.season_id, 'slot_id', u.id, 'player_id', u.player_id)), '[]'::jsonb)
    INTO v_alerts
    FROM u JOIN public.draft_pools p ON p.id = u.draft_pool_id;

  -- 4. redraft reveal
  WITH c AS (
    SELECT p.id FROM public.draft_pools p
     WHERE (p_pool_id IS NULL OR p.id = p_pool_id) AND p.engine = 'queue' AND p.kind = 'redraft'
       AND p.submissions_published_at IS NOT NULL AND p.publish_notified_at IS NULL
     FOR UPDATE SKIP LOCKED),
  u AS (
    UPDATE public.draft_pools p SET publish_notified_at = now() FROM c WHERE p.id = c.id RETURNING p.id, p.season_id)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('type', 'redraft_published', 'pool_id', u.id, 'season_id', u.season_id)),
                  '[]'::jsonb)
    INTO v_published FROM u;

  RETURN v_started || v_reminders || v_alerts || v_published;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 8. Privileges: service_role only.
-- ════════════════════════════════════════════════════════════════════════════

REVOKE ALL ON FUNCTION
  public.draft__lock(uuid),
  public.draft__log(uuid, uuid, uuid, text, text, uuid, uuid, uuid, text, jsonb, jsonb, text, uuid, boolean),
  public.draft__open_slots(uuid, uuid),
  public.draft__remaining_budget(uuid, uuid),
  public.draft__legal_lines(uuid, uuid),
  public.draft__min_completion(uuid, uuid, integer, text),
  public.draft__slot_seconds(public.draft_pools, uuid, text),
  public.epb__season_remaining_points(uuid, uuid),
  public.draft__cfg_int(jsonb, text, integer, integer, boolean),
  public.draft__cfg_bool(jsonb, text),
  public.draft__cfg_ts(jsonb, text),
  public.draft__cfg_ladder(jsonb),
  public.draft__validate_seats(jsonb),
  public.draft__activate_next(uuid, timestamptz),
  public.draft__resolve_timeouts(uuid),
  public.draft__resume(uuid),
  public.draft__commit_pick(public.draft_pools, public.draft_slots, uuid, uuid, text, uuid, uuid, jsonb, boolean, text, text),
  public.draft__build_snapshot(public.draft_pools),
  public.draft__tick(uuid),
  public.draft_confirm_pick(uuid, uuid, uuid, uuid, text, text, uuid, uuid, jsonb, text),
  public.draft_create_pool(uuid, text, uuid, jsonb, jsonb),
  public.draft_configure(uuid, uuid, jsonb, jsonb),
  public.draft_start(uuid, uuid),
  public.draft_end(uuid, uuid, text),
  public.draft_use_extension(uuid, uuid, text, uuid),
  public.draft_set_paused(uuid, uuid, boolean, text),
  public.draft_admin_void_pick(uuid, uuid, uuid, text, boolean, text, jsonb, uuid),
  public.draft_admin_resolve_slot(uuid, uuid, uuid, text, text, text, uuid, uuid, jsonb, boolean),
  public.draft_admin_set_penalty(uuid, uuid, smallint, uuid, text),
  public.draft_snapshot(uuid, bigint, boolean),
  public.draft_my_turn(uuid, uuid),
  public.draft_tick(uuid),
  public.draft_claim_notifications(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.draft__lock(uuid),
  public.draft__log(uuid, uuid, uuid, text, text, uuid, uuid, uuid, text, jsonb, jsonb, text, uuid, boolean),
  public.draft__open_slots(uuid, uuid),
  public.draft__remaining_budget(uuid, uuid),
  public.draft__legal_lines(uuid, uuid),
  public.draft__min_completion(uuid, uuid, integer, text),
  public.draft__slot_seconds(public.draft_pools, uuid, text),
  public.epb__season_remaining_points(uuid, uuid),
  public.draft__cfg_int(jsonb, text, integer, integer, boolean),
  public.draft__cfg_bool(jsonb, text),
  public.draft__cfg_ts(jsonb, text),
  public.draft__cfg_ladder(jsonb),
  public.draft__validate_seats(jsonb),
  public.draft__activate_next(uuid, timestamptz),
  public.draft__resolve_timeouts(uuid),
  public.draft__resume(uuid),
  public.draft__commit_pick(public.draft_pools, public.draft_slots, uuid, uuid, text, uuid, uuid, jsonb, boolean, text, text),
  public.draft__build_snapshot(public.draft_pools),
  public.draft__tick(uuid),
  public.draft_confirm_pick(uuid, uuid, uuid, uuid, text, text, uuid, uuid, jsonb, text),
  public.draft_create_pool(uuid, text, uuid, jsonb, jsonb),
  public.draft_configure(uuid, uuid, jsonb, jsonb),
  public.draft_start(uuid, uuid),
  public.draft_end(uuid, uuid, text),
  public.draft_use_extension(uuid, uuid, text, uuid),
  public.draft_set_paused(uuid, uuid, boolean, text),
  public.draft_admin_void_pick(uuid, uuid, uuid, text, boolean, text, jsonb, uuid),
  public.draft_admin_resolve_slot(uuid, uuid, uuid, text, text, text, uuid, uuid, jsonb, boolean),
  public.draft_admin_set_penalty(uuid, uuid, smallint, uuid, text),
  public.draft_snapshot(uuid, bigint, boolean),
  public.draft_my_turn(uuid, uuid),
  public.draft_tick(uuid),
  public.draft_claim_notifications(uuid)
TO service_role;

COMMIT;

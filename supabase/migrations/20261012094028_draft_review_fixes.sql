-- Draft review fixes (Kilo review of PR #73, group K2-sql).
--
-- M5 (20261012024916_draft_rpcs.sql), M6 (20261012025023_redraft_rpcs.sql) and M4 (20261012024254_epb_progress_sources.sql)
-- are applied and immutable; this migration CREATE OR REPLACEs three functions with the same signatures, search_path and
-- service_role-only privileges, each body copied verbatim from the applied version with only the marked change:
--   1. draft__activate_next (M5): every (re)activation clears notified_turn_at, so a slot that admin void+requeue reset to
--      pending gets a fresh turn_started ping when it activates again (the claim in 20261012065613 keys on
--      notified_turn_at IS NULL). reminder_mask was already reset to the activation default here.
--   2. redraft__publish_locked (M6): drops rank by dropped price DESC NULLS LAST (a line missing from the pool's list
--      sorted first under DESC and was dropped and labelled A as if it were the most expensive).
--   3. redraft_admin_restore_drop (M6): a missing participant row is a coded NOT_PARTICIPANT error, and the overdraw check
--      is NULL-safe (NULL - x < 0 is NULL, which skipped RESTORE_WOULD_OVERDRAW).
--   4. evo_progress_log: at most one positive Cosmo Token row per tracker and matchday (partial unique index). The award
--      in src/lib/draft/progress-engine.ts treats the unique violation as "already awarded"; epb_apply_progress increments
--      and logs in one statement, so the losing call rolls back its increment too. Admin corrections (matchday NULL) and
--      future reversal rows (amount <= 0) are outside the index.
BEGIN;

-- 1. ────────────────────────────────────────────────────────────────────────
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
           alert_kind = 'blocked', alert_notified_at = NULL, notified_turn_at = NULL
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
         reminder_mask = v_mask, notified_turn_at = NULL   -- every (re)activation is a new turn: one fresh turn ping
   WHERE id = v_slot.id;
  RETURN v_slot.id;
END $$;

-- 2. ────────────────────────────────────────────────────────────────────────
-- Caller holds draft__lock. Publishes every submission at once (SPEC:696-699).
CREATE OR REPLACE FUNCTION public.redraft__publish_locked(p_pool public.draft_pools, p_actor_id uuid, p_actor_role text,
  p_reason text) RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_subs jsonb; v_sub jsonb; v_tracker public.evolution_tracker; v_entry public.point_buy_list_entries;
        v_player uuid := NULL; v_n integer := 0; v_slot_id uuid; v_drops jsonb := '[]'::jsonb; v_total integer := 0;
        v_part record; v_next uuid; v_pool public.draft_pools; v_capped integer := 0;
BEGIN
  IF p_pool.kind <> 'redraft' OR p_pool.phase <> 'submissions' THEN
    RAISE EXCEPTION 'SUBMISSIONS_ALREADY_PUBLISHED' USING ERRCODE = 'P0001';
  END IF;

  -- 1. Freeze first: deleting the dropped trackers cascades their submission rows. Only participants' submissions count.
  --    Defensive cap: never more than redraft_max_lines per player (draft_configure refuses lowering it below a saved
  --    list; this guards rows written any other way): the first max lines in BR-10 order drop, the rest stay rostered.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('player_id', r.player_id, 'tracker_id', r.tracker_id, 'line_id', r.line_id,
                                               'price', r.price)
                            ORDER BY r.player_id, r.price DESC NULLS LAST, r.line_id)
                    FILTER (WHERE r.rn <= COALESCE(p_pool.redraft_max_lines, 3)), '[]'::jsonb),
         count(*) FILTER (WHERE r.rn > COALESCE(p_pool.redraft_max_lines, 3))
    INTO v_subs, v_capped
    FROM (SELECT s.player_id, s.tracker_id, s.line_id, e.price,
                 row_number() OVER (PARTITION BY s.player_id ORDER BY e.price DESC NULLS LAST, s.line_id) AS rn
            FROM public.redraft_submissions s
            JOIN public.draft_participants dp ON dp.draft_pool_id = s.draft_pool_id AND dp.player_id = s.player_id
            JOIN public.evolution_tracker t ON t.id = s.tracker_id AND t.player_id = s.player_id
                                           AND t.season_id = p_pool.season_id
            LEFT JOIN public.point_buy_list_entries e ON e.list_version_id = p_pool.list_version_id AND e.line_id = s.line_id
           WHERE s.draft_pool_id = p_pool.id) r;
  PERFORM public.draft__log(p_pool.season_id, p_pool.id, p_actor_id, p_actor_role, 'submissions_frozen',
    p_after => jsonb_build_object('count', jsonb_array_length(v_subs), 'capped', v_capped), p_reason => p_reason,
    p_is_public => false);
  IF v_capped > 0 THEN                                 -- capped lines stay rostered: their stale secret rows go
    DELETE FROM public.redraft_submissions s
     WHERE s.draft_pool_id = p_pool.id
       AND s.tracker_id NOT IN (SELECT (x->>'tracker_id')::uuid FROM jsonb_array_elements(v_subs) AS x);
  END IF;

  -- 2. Per player, dropped price desc then line id → labels A, B, C… (BR-10).
  FOR v_sub IN SELECT x FROM jsonb_array_elements(v_subs) AS x LOOP
    IF v_player IS DISTINCT FROM (v_sub->>'player_id')::uuid THEN
      v_player := (v_sub->>'player_id')::uuid;
      v_n := 0;
    END IF;
    v_n := v_n + 1;
    SELECT * INTO v_tracker FROM public.evolution_tracker WHERE id = (v_sub->>'tracker_id')::uuid FOR UPDATE;
    SELECT * INTO v_entry FROM public.point_buy_list_entries
     WHERE list_version_id = p_pool.list_version_id AND line_id = v_tracker.line_id;
    INSERT INTO public.redraft_slots (draft_pool_id, season_id, player_id, label, dropped_line_id, dropped_entry_id,
      dropped_price, transferred_real_kills, dropped_stage, dropped_tracker_snapshot)
    VALUES (p_pool.id, p_pool.season_id, v_player, chr(64 + v_n), v_tracker.line_id, v_entry.id, COALESCE(v_entry.price, 0),
      v_tracker.real_kills, v_tracker.current_stage, to_jsonb(v_tracker))          -- only real kills transfer (SPEC:757-770)
    RETURNING id INTO v_slot_id;
    INSERT INTO public.draft_line_restrictions (draft_pool_id, player_id, line_id, reason, created_by)
    VALUES (p_pool.id, v_player, v_tracker.line_id, 'own_redraft_drop', p_actor_id)
    ON CONFLICT (draft_pool_id, player_id, line_id) DO NOTHING;
    INSERT INTO public.redraft_history (season_id, player_id, from_tracker_id, to_base_pokemon, to_stage3_pokemon, transfer_type,
      missing_kills_transferred, points_spent, draft_pool_id, dropped_line_id, transferred_real_kills, points_refunded)
    VALUES (p_pool.season_id, v_player, v_tracker.id, v_tracker.base_pokemon, v_tracker.locked_stage3_pokemon, 'secret_drop',
      0, 0, p_pool.id, v_tracker.line_id, v_tracker.real_kills, COALESCE(v_entry.price, 0));
    DELETE FROM public.evolution_tracker WHERE id = v_tracker.id;
    v_drops := v_drops || jsonb_build_object('player_id', v_player, 'label', chr(64 + v_n), 'line_id', v_tracker.line_id,
      'transferred_real_kills', v_tracker.real_kills, 'price', COALESCE(v_entry.price, 0));
    v_total := v_total + 1;
  END LOOP;

  -- 3. Participants: slots = drops; budget = season leftover + refunds (BR-5 ledger, now incl. redraft_slots).
  FOR v_part IN SELECT player_id FROM public.draft_participants WHERE draft_pool_id = p_pool.id LOOP
    UPDATE public.draft_participants dp
       SET slots_total = (SELECT count(*) FROM public.redraft_slots rs
                           WHERE rs.draft_pool_id = p_pool.id AND rs.player_id = v_part.player_id),
           budget_start = COALESCE(public.epb__season_remaining_points(p_pool.season_id, v_part.player_id), 0)
     WHERE dp.draft_pool_id = p_pool.id AND dp.player_id = v_part.player_id;
  END LOOP;
  UPDATE public.draft_participants SET done_at = now() WHERE draft_pool_id = p_pool.id AND slots_total = 0;

  -- 4. Redraft queue (§5.2): rounds 1..max(drops); player P only in rounds 1..drops(P); snake over the frozen seats.
  INSERT INTO public.draft_slots (draft_pool_id, player_id, sort_key, round, nominal_pick_number)
  SELECT p_pool.id, s.player_id, s.rn, s.round, s.rn
    FROM (SELECT dp.player_id, r.round,
                 row_number() OVER (ORDER BY r.round, CASE WHEN r.round % 2 = 1 THEN dp.seat ELSE -dp.seat END) AS rn
            FROM public.draft_participants dp
            CROSS JOIN LATERAL generate_series(1, dp.slots_total) AS r(round)
           WHERE dp.draft_pool_id = p_pool.id AND dp.slots_total > 0) s;

  UPDATE public.draft_pools
     SET phase = 'drafting', status = 'in_progress', submissions_published_at = now(), started_at = now(),
         paused_at = NULL, paused_by = NULL, pause_reason = NULL, updated_at = now()
   WHERE id = p_pool.id;
  PERFORM public.draft__log(p_pool.season_id, p_pool.id, p_actor_id, p_actor_role, 'submissions_published',
    p_after => jsonb_build_object('drops', v_drops), p_reason => p_reason);
  v_next := public.draft__activate_next(p_pool.id, now());
  UPDATE public.draft_pools SET state_version = state_version + 1 WHERE id = p_pool.id RETURNING * INTO v_pool;
  RETURN jsonb_build_object('state_version', v_pool.state_version, 'drops', v_total, 'published', true,
    'active_slot_id', v_next);
END $$;

-- 3. ────────────────────────────────────────────────────────────────────────
-- Undo one drop while the redraft draft is paused: the tracker comes back from its snapshot (new id, same columns), the
-- restriction and the redraft slot go, the refund leaves the budget, and the player loses one queue slot.
CREATE OR REPLACE FUNCTION public.redraft_admin_restore_drop(p_pool_id uuid, p_redraft_slot_id uuid, p_actor_id uuid,
  p_reason text) RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_pool public.draft_pools; v_slot public.redraft_slots; v_snap public.evolution_tracker; v_owner uuid;
        v_budget_start integer; v_spent integer; v_tracker_id uuid; v_queue public.draft_slots; v_forfeited uuid := NULL;
BEGIN
  IF COALESCE(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'OVERRIDE_REASON_REQUIRED' USING ERRCODE = 'P0001'; END IF;
  v_pool := public.draft__lock(p_pool_id);
  IF v_pool.engine <> 'queue' OR v_pool.kind <> 'redraft' THEN RAISE EXCEPTION 'DRAFT_NOT_ACTIVE' USING ERRCODE = 'P0001'; END IF;
  IF v_pool.phase <> 'drafting' OR v_pool.paused_at IS NULL THEN
    RAISE EXCEPTION 'CORRECTION_REQUIRES_PAUSE' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_slot FROM public.redraft_slots WHERE id = p_redraft_slot_id AND draft_pool_id = p_pool_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REDRAFT_SLOT_INVALID' USING ERRCODE = 'P0001'; END IF;
  IF v_slot.filled_by_pick_id IS NOT NULL THEN RAISE EXCEPTION 'REDRAFT_SLOT_FILLED' USING ERRCODE = 'P0001'; END IF;
  v_owner := (SELECT t.player_id FROM public.evolution_tracker t
               WHERE t.season_id = v_pool.season_id AND t.line_id = v_slot.dropped_line_id LIMIT 1);
  IF v_owner IS NULL THEN
    v_owner := (SELECT k.player_id FROM public.draft_picks k
                 WHERE k.draft_pool_id = p_pool_id AND k.line_id = v_slot.dropped_line_id AND k.voided_at IS NULL LIMIT 1);
  END IF;
  IF v_owner IS NOT NULL THEN
    RAISE EXCEPTION 'LINE_TAKEN' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('line_id', v_slot.dropped_line_id, 'player_id', v_owner)::text;
  END IF;
  SELECT budget_start INTO v_budget_start FROM public.draft_participants
   WHERE draft_pool_id = p_pool_id AND player_id = v_slot.player_id FOR UPDATE;
  IF NOT FOUND THEN                                     -- a removed participant keeps redraft_slots rows: no budget to check
    RAISE EXCEPTION 'NOT_PARTICIPANT' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('player_id', v_slot.player_id)::text;
  END IF;
  SELECT COALESCE(sum(points_spent), 0) INTO v_spent FROM public.draft_picks
   WHERE draft_pool_id = p_pool_id AND player_id = v_slot.player_id AND voided_at IS NULL;
  IF v_budget_start IS NULL OR v_budget_start - v_slot.dropped_price - v_spent < 0 THEN   -- NULL-safe
    RAISE EXCEPTION 'RESTORE_WOULD_OVERDRAW' USING ERRCODE = 'P0001';
  END IF;

  v_snap := jsonb_populate_record(NULL::public.evolution_tracker, v_slot.dropped_tracker_snapshot);
  INSERT INTO public.evolution_tracker (season_id, player_id, base_pokemon, current_form, total_kos, current_stage, evolved_at,
    real_kills, draft_tokens, kill_tokens, cosmo_points, suspended_until_matchday, evolution_points_awarded,
    locked_stage3_pokemon, line_id, transferred_evo_progress, redraft_slot_id)
  VALUES (v_pool.season_id, v_slot.player_id, v_snap.base_pokemon, v_snap.current_form, COALESCE(v_snap.total_kos, 0),
    COALESCE(v_snap.current_stage, 1), v_snap.evolved_at, COALESCE(v_snap.real_kills, 0), COALESCE(v_snap.draft_tokens, 0),
    COALESCE(v_snap.kill_tokens, 0), COALESCE(v_snap.cosmo_points, 0), v_snap.suspended_until_matchday,
    COALESCE(v_snap.evolution_points_awarded, 0), v_snap.locked_stage3_pokemon, v_slot.dropped_line_id,
    COALESCE(v_snap.transferred_evo_progress, 0),
    CASE WHEN v_snap.redraft_slot_id IS DISTINCT FROM v_slot.id THEN v_snap.redraft_slot_id END)
  RETURNING id INTO v_tracker_id;

  DELETE FROM public.draft_line_restrictions
   WHERE draft_pool_id = p_pool_id AND player_id = v_slot.player_id AND line_id = v_slot.dropped_line_id
     AND reason = 'own_redraft_drop';
  -- draft_picks.redraft_slot_id has no ON DELETE action: a live pick on the slot is a coded error (never a raw 23503),
  -- and voided picks drop the reference (the slot id stays in this action's log entry).
  IF EXISTS (SELECT 1 FROM public.draft_picks WHERE redraft_slot_id = v_slot.id AND voided_at IS NULL) THEN
    RAISE EXCEPTION 'REDRAFT_SLOT_FILLED' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.draft_picks SET redraft_slot_id = NULL WHERE redraft_slot_id = v_slot.id AND voided_at IS NOT NULL;
  DELETE FROM public.redraft_slots WHERE id = v_slot.id;
  UPDATE public.draft_participants
     SET slots_total = GREATEST(slots_total - 1, 0), budget_start = budget_start - v_slot.dropped_price
   WHERE draft_pool_id = p_pool_id AND player_id = v_slot.player_id;

  -- the player's last pending queue slot goes; else their current slot (then the next one activates, still paused)
  SELECT * INTO v_queue FROM public.draft_slots
   WHERE draft_pool_id = p_pool_id AND player_id = v_slot.player_id AND status = 'pending'
   ORDER BY sort_key DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    UPDATE public.draft_slots SET status = 'forfeited', completed_at = now() WHERE id = v_queue.id;
    v_forfeited := v_queue.id;
  ELSE
    SELECT * INTO v_queue FROM public.draft_slots
     WHERE draft_pool_id = p_pool_id AND player_id = v_slot.player_id AND status IN ('active', 'blocked') FOR UPDATE;
    IF FOUND THEN
      UPDATE public.draft_slots SET status = 'forfeited', completed_at = now(), deadline_at = NULL, remaining_ms_at_pause = NULL
       WHERE id = v_queue.id;
      v_forfeited := v_queue.id;
      PERFORM public.draft__activate_next(p_pool_id, now());
    END IF;
  END IF;
  IF public.draft__open_slots(p_pool_id, v_slot.player_id) = 0 THEN
    UPDATE public.draft_participants SET done_at = COALESCE(done_at, now())
     WHERE draft_pool_id = p_pool_id AND player_id = v_slot.player_id;
  END IF;

  PERFORM public.draft__log(v_pool.season_id, p_pool_id, p_actor_id, 'admin', 'drop_restored',
    p_player_id => v_slot.player_id, p_slot_id => v_forfeited, p_line_id => v_slot.dropped_line_id,
    p_before => jsonb_build_object('redraft_slot_id', v_slot.id, 'label', v_slot.label, 'dropped_price', v_slot.dropped_price,
                                   'transferred_real_kills', v_slot.transferred_real_kills),
    p_after => jsonb_build_object('tracker_id', v_tracker_id, 'forfeited_slot_id', v_forfeited), p_reason => p_reason);
  UPDATE public.draft_pools SET state_version = state_version + 1, updated_at = now() WHERE id = p_pool_id RETURNING * INTO v_pool;
  RETURN jsonb_build_object('state_version', v_pool.state_version, 'tracker_id', v_tracker_id, 'forfeited_slot_id', v_forfeited);
END $$;

-- 4. ────────────────────────────────────────────────────────────────────────
-- Fails loudly (never deletes) if an environment already holds duplicate awards; live had no cosmo_point rows at apply.
DO $$ DECLARE n integer; BEGIN
  SELECT count(*) INTO n FROM (
    SELECT 1 FROM public.evo_progress_log
     WHERE source = 'cosmo_point' AND matchday IS NOT NULL AND amount > 0
     GROUP BY tracker_id, matchday HAVING count(*) > 1) d;
  IF n > 0 THEN
    RAISE EXCEPTION 'evo_progress_log holds % duplicate Cosmo Token (tracker, matchday) awards; resolve by hand first', n;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS evo_progress_log_cosmo_matchday_uniq
  ON public.evo_progress_log (tracker_id, matchday)
  WHERE source = 'cosmo_point' AND matchday IS NOT NULL AND amount > 0;
COMMENT ON INDEX public.evo_progress_log_cosmo_matchday_uniq IS
  'At most one Cosmo Token per tracker per matchday (awardCosmoPoint treats a violation as already awarded).';

REVOKE ALL ON FUNCTION
  public.draft__activate_next(uuid, timestamptz),
  public.redraft__publish_locked(public.draft_pools, uuid, text, text),
  public.redraft_admin_restore_drop(uuid, uuid, uuid, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.draft__activate_next(uuid, timestamptz),
  public.redraft__publish_locked(public.draft_pools, uuid, text, text),
  public.redraft_admin_restore_drop(uuid, uuid, uuid, text)
TO service_role;

COMMIT;

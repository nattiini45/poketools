-- Redraft secret-drop RPCs (EvoLiga draft tool, Prompt 5; draft-backend §6.8, package B-RPC, migration M6).
--
--   redraft_set_submission      a player's SECRET drop list (replaced as a whole; withdraw = empty list). No state_version
--                               bump: nothing shared changes, and the snapshot never reads redraft_submissions.
--   redraft__publish_locked     reveal at the deadline (BR-9): frozen submissions → redraft_slots A, B, C… (dropped price
--                               desc, then line id; BR-10) with the slot-bound real-kill transfer, own-drop restrictions,
--                               refunds into the budget, the redraft queue (§5.2), then the first activation.
--   redraft_publish             admin publish (force before the deadline needs a reason).
--   redraft_admin_restore_drop  undo one drop while the redraft draft is paused.
-- Conventions as in M5 (RAISE '<CODE>' + DETAIL json; season advisory lock via draft__lock).
--
-- Placeholder version: renamed to the live-recorded version at apply time (APPLY package). Not applied by B-RPC.
BEGIN;

CREATE OR REPLACE FUNCTION public.redraft_set_submission(p_pool_id uuid, p_player_id uuid, p_actor_id uuid, p_actor_role text,
  p_line_ids text[]) RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_pool public.draft_pools; v_lines text[]; v_line text; v_tracker public.evolution_tracker; v_rules jsonb;
        v_now timestamptz := now();
BEGIN
  -- Own submission only: admins cannot submit for other players (§8.1 #19).
  IF p_actor_id IS DISTINCT FROM p_player_id OR p_actor_role IS NULL OR p_actor_role NOT IN ('player', 'admin') THEN
    RAISE EXCEPTION 'ACTOR_NOT_ALLOWED' USING ERRCODE = 'P0001';
  END IF;
  v_pool := public.draft__lock(p_pool_id);
  IF v_pool.engine <> 'queue' OR v_pool.kind <> 'redraft' THEN RAISE EXCEPTION 'DRAFT_NOT_ACTIVE' USING ERRCODE = 'P0001'; END IF;
  IF v_pool.phase <> 'submissions' OR v_pool.submission_deadline_at IS NULL OR v_now >= v_pool.submission_deadline_at THEN
    RAISE EXCEPTION 'SUBMISSION_LOCKED' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.draft_participants WHERE draft_pool_id = p_pool_id AND player_id = p_player_id) THEN
    RAISE EXCEPTION 'NOT_PARTICIPANT' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT l ORDER BY l), '{}'::text[]) INTO v_lines
    FROM unnest(COALESCE(p_line_ids, '{}'::text[])) AS l WHERE l IS NOT NULL;
  IF cardinality(v_lines) > COALESCE(v_pool.redraft_max_lines, 3) THEN
    RAISE EXCEPTION 'REDRAFT_MAX_EXCEEDED' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('max', COALESCE(v_pool.redraft_max_lines, 3))::text;
  END IF;
  FOREACH v_line IN ARRAY v_lines LOOP
    SELECT * INTO v_tracker FROM public.evolution_tracker
     WHERE season_id = v_pool.season_id AND line_id = v_line AND player_id = p_player_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'TRACKER_NOT_OWNED' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('line_id', v_line)::text;
    END IF;
    SELECT e.special_rules INTO v_rules FROM public.point_buy_list_entries e
     WHERE e.list_version_id = v_pool.list_version_id AND e.line_id = v_line;
    IF COALESCE((v_rules->>'no_redraft')::boolean, false) THEN
      RAISE EXCEPTION 'LINE_NOT_DROPPABLE' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('line_id', v_line)::text;
    END IF;
  END LOOP;

  DELETE FROM public.redraft_submissions WHERE draft_pool_id = p_pool_id AND player_id = p_player_id;
  INSERT INTO public.redraft_submissions (draft_pool_id, player_id, tracker_id, line_id, updated_at)
  SELECT p_pool_id, p_player_id, t.id, t.line_id, v_now
    FROM public.evolution_tracker t
   WHERE t.season_id = v_pool.season_id AND t.player_id = p_player_id AND t.line_id = ANY (v_lines);

  -- Secret: never public, never in recent_events.
  PERFORM public.draft__log(v_pool.season_id, p_pool_id, p_actor_id, p_actor_role, 'submission_changed',
    p_player_id => p_player_id, p_after => jsonb_build_object('line_ids', to_jsonb(v_lines)), p_is_public => false);
  RETURN jsonb_build_object('line_ids', to_jsonb(v_lines), 'updated_at', CASE WHEN cardinality(v_lines) > 0 THEN v_now END);
END $$;

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
                            ORDER BY r.player_id, r.price DESC, r.line_id)
                    FILTER (WHERE r.rn <= COALESCE(p_pool.redraft_max_lines, 3)), '[]'::jsonb),
         count(*) FILTER (WHERE r.rn > COALESCE(p_pool.redraft_max_lines, 3))
    INTO v_subs, v_capped
    FROM (SELECT s.player_id, s.tracker_id, s.line_id, e.price,
                 row_number() OVER (PARTITION BY s.player_id ORDER BY e.price DESC, s.line_id) AS rn
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

CREATE OR REPLACE FUNCTION public.redraft_publish(p_pool_id uuid, p_actor_id uuid, p_force boolean, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_pool public.draft_pools;
BEGIN
  v_pool := public.draft__lock(p_pool_id);
  IF v_pool.engine <> 'queue' OR v_pool.kind <> 'redraft' OR v_pool.phase = 'cancelled' THEN
    RAISE EXCEPTION 'DRAFT_NOT_ACTIVE' USING ERRCODE = 'P0001';
  END IF;
  IF v_pool.phase <> 'submissions' THEN RAISE EXCEPTION 'SUBMISSIONS_ALREADY_PUBLISHED' USING ERRCODE = 'P0001'; END IF;
  IF v_pool.submission_deadline_at IS NOT NULL AND now() < v_pool.submission_deadline_at THEN
    IF NOT COALESCE(p_force, false) THEN
      RAISE EXCEPTION 'SUBMISSIONS_NOT_DUE' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('deadline_at', v_pool.submission_deadline_at)::text;
    END IF;
    IF COALESCE(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'OVERRIDE_REASON_REQUIRED' USING ERRCODE = 'P0001'; END IF;
  END IF;
  RETURN public.redraft__publish_locked(v_pool, p_actor_id, 'admin', p_reason);
END $$;

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
  SELECT COALESCE(sum(points_spent), 0) INTO v_spent FROM public.draft_picks
   WHERE draft_pool_id = p_pool_id AND player_id = v_slot.player_id AND voided_at IS NULL;
  IF v_budget_start - v_slot.dropped_price - v_spent < 0 THEN
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

REVOKE ALL ON FUNCTION
  public.redraft_set_submission(uuid, uuid, uuid, text, text[]),
  public.redraft__publish_locked(public.draft_pools, uuid, text, text),
  public.redraft_publish(uuid, uuid, boolean, text),
  public.redraft_admin_restore_drop(uuid, uuid, uuid, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.redraft_set_submission(uuid, uuid, uuid, text, text[]),
  public.redraft__publish_locked(public.draft_pools, uuid, text, text),
  public.redraft_publish(uuid, uuid, boolean, text),
  public.redraft_admin_restore_drop(uuid, uuid, uuid, text)
TO service_role;

COMMIT;

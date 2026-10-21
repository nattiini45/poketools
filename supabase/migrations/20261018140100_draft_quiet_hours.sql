-- Draft quiet hours.
--
-- A pool may carry a daily quiet window [quiet_start_hour, quiet_end_hour) on the local calendar of quiet_timezone.
-- Inside it the pick clock does not run; picking stays allowed the whole time. It applies to every pick clock of the
-- queue engine: live normal and make-up slots, the slow ladder, extensions, and the pick phase of a redraft (the
-- redraft submission deadline is a wall instant without a clock and is unchanged).
--   * deadline_at stays an absolute instant: the moment the running (unheld) time left reaches zero. No deadline is
--     ever strictly inside a window (it may coincide with a window start: the time ran out at 00:00).
--   * pause freezes the running ms left; resume adds them back in running time; an extension adds running time.
--   * turn_started pings and the 8h/4h/1h reminders are not claimed inside a window: the first claim after it ends
--     (cron every 10 min, or a route's after()) sends them. Reminder thresholds compare the running time left.
--   * The window is set when the pool is created (config.quiet_hours, sent by POST /api/drafts from the format pack,
--     never by the client) and is not patchable: draft_configure keeps its allowed keys, so a quiet_hours patch is
--     INVALID_CONFIG. Existing pools keep NULL = no quiet hours (nothing changes retroactively).
--
-- Window bounds are instants computed with `timestamp AT TIME ZONE`, so the real length follows DST (Europe/Berlin
-- 00-06: 7 h on 2026-10-25, 5 h on 2027-03-28). TS mirror: src/lib/draft/time.ts (quietWindowEnd, runningMsBetween,
-- addRunningMs); shared vectors: src/lib/draft/__tests__/fixtures/quiet-hours-vectors.json.
--
-- 20261012024916, 20261012065613 and 20261012094028 are applied and immutable. Sections 1-8 CREATE OR REPLACE eight of
-- their functions with the same signatures and search_path, each body copied verbatim from its latest definition with
-- only the change named in its section header. Unchanged on purpose: draft__tick and draft__resolve_timeouts (an
-- overdue slot still closes at its stored deadline, and the chain activates the next slot at that instant, which
-- activate_next now turns into a running-time deadline), draft__slot_seconds, draft_start, redraft__publish_locked,
-- draft_admin_void_pick, draft_admin_resolve_slot, draft_configure (all reach the clock through the functions below).
--
-- Privileges: draft_pools keeps RLS and its service_role-only table privileges (20261008081443); the new columns need
-- no grants. Every new or replaced function is revoked from PUBLIC/anon/authenticated and granted to service_role at
-- the end of this file.
BEGIN;

-- 0. ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.draft_pools
  ADD COLUMN quiet_start_hour smallint,
  ADD COLUMN quiet_end_hour smallint,
  ADD COLUMN quiet_timezone text,
  ADD CONSTRAINT draft_pools_quiet_hours_check CHECK (
    (quiet_start_hour IS NULL AND quiet_end_hour IS NULL AND quiet_timezone IS NULL)
    OR (quiet_start_hour BETWEEN 0 AND 23 AND quiet_end_hour BETWEEN 1 AND 24
        AND quiet_start_hour < quiet_end_hour AND quiet_end_hour - quiet_start_hour <= 23
        AND quiet_timezone <> '' AND length(quiet_timezone) <= 64));

COMMENT ON COLUMN public.draft_pools.quiet_start_hour IS
  'Quiet hours (pick clock held, picking allowed): first held local hour 0..23; NULL with the other two = none.';
COMMENT ON COLUMN public.draft_pools.quiet_end_hour IS
  'Quiet hours: first running local hour 1..24 (exclusive end; the window never crosses local midnight).';
COMMENT ON COLUMN public.draft_pools.quiet_timezone IS
  'Quiet hours: IANA zone of the window''s local calendar (validated against pg_timezone_names at pool creation).';


-- Helpers. All take the three pool columns; a NULL start hour means "no quiet hours" (wall time, the old behaviour).

-- The window of one local day: [day + start h, day + end h) in p_tz, as instants. A wall hour in a spring-forward gap
-- takes the offset before the transition, one in a fall-back overlap the offset after it (PostgreSQL's rule; the TS
-- mirror resolves the same way). A window DST collapses to nothing has w_end <= w_start and is ignored by the callers.
CREATE OR REPLACE FUNCTION public.draft__quiet_bounds(p_day date, p_start smallint, p_end smallint, p_tz text,
  OUT w_start timestamptz, OUT w_end timestamptz)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT (p_day + make_interval(hours => p_start::int)) AT TIME ZONE p_tz,
         (p_day + make_interval(hours => p_end::int)) AT TIME ZONE p_tz
$$;

-- End of the window p_at lies in; NULL outside a window or without quiet hours.
CREATE OR REPLACE FUNCTION public.draft__quiet_window_end(p_at timestamptz, p_start smallint, p_end smallint, p_tz text)
RETURNS timestamptz LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT b.w_end
    FROM generate_series(-1, 1) AS k(n)
    CROSS JOIN LATERAL public.draft__quiet_bounds((p_at AT TIME ZONE p_tz)::date + k.n, p_start, p_end, p_tz) b
   WHERE p_start IS NOT NULL AND p_at IS NOT NULL AND b.w_end > b.w_start AND p_at >= b.w_start AND p_at < b.w_end
   LIMIT 1
$$;

-- First window start strictly after p_at (quiet hours set).
CREATE OR REPLACE FUNCTION public.draft__quiet_next_start(p_at timestamptz, p_start smallint, p_end smallint, p_tz text)
RETURNS timestamptz LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT min(b.w_start)
    FROM generate_series(-1, 2) AS k(n)
    CROSS JOIN LATERAL public.draft__quiet_bounds((p_at AT TIME ZONE p_tz)::date + k.n, p_start, p_end, p_tz) b
   WHERE b.w_end > b.w_start AND b.w_start > p_at
$$;

-- Running (unheld) milliseconds in [p_from, p_to); 0 when p_to <= p_from; NULL when either bound is NULL.
-- Without quiet hours: the wall milliseconds (what the replaced code computed with EXTRACT(EPOCH ...) * 1000).
CREATE OR REPLACE FUNCTION public.draft__running_ms(p_from timestamptz, p_to timestamptz, p_start smallint, p_end smallint,
  p_tz text) RETURNS bigint LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE v_total numeric; v_held numeric; v_first date; v_last date;
BEGIN
  IF p_from IS NULL OR p_to IS NULL THEN RETURN NULL; END IF;
  IF p_to <= p_from THEN RETURN 0; END IF;
  v_total := EXTRACT(EPOCH FROM (p_to - p_from)) * 1000;
  IF p_start IS NULL THEN RETURN round(v_total)::bigint; END IF;
  v_first := (p_from AT TIME ZONE p_tz)::date - 1;
  v_last := (p_to AT TIME ZONE p_tz)::date + 1;
  IF v_last - v_first > 400 THEN
    RAISE EXCEPTION 'draft__running_ms: span too long' USING ERRCODE = 'XX000';            -- invariant (internal)
  END IF;
  SELECT COALESCE(sum(EXTRACT(EPOCH FROM (LEAST(b.w_end, p_to) - GREATEST(b.w_start, p_from))) * 1000), 0)
    INTO v_held
    FROM generate_series(0, v_last - v_first) AS k(n)
    CROSS JOIN LATERAL public.draft__quiet_bounds(v_first + k.n, p_start, p_end, p_tz) b
   WHERE b.w_end > b.w_start AND LEAST(b.w_end, p_to) > GREATEST(b.w_start, p_from);
  RETURN round(v_total - v_held)::bigint;
END $$;

-- The instant at which p_ms running milliseconds have passed since p_from. NULL ms -> NULL (as the wall addition it
-- replaces); p_ms <= 0 -> p_from. Inside a window the count starts at its end, so the result is never strictly inside
-- a window. The step cap is far beyond any pick clock (a valid window leaves >= 1 running hour per day).
CREATE OR REPLACE FUNCTION public.draft__add_running_ms(p_from timestamptz, p_ms bigint, p_start smallint, p_end smallint,
  p_tz text) RETURNS timestamptz LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE v_t timestamptz := p_from; v_rest numeric := p_ms; v_end timestamptz; v_next timestamptz; v_avail numeric;
        v_step integer := 0;
BEGIN
  IF p_from IS NULL OR p_ms IS NULL THEN RETURN NULL; END IF;
  IF p_ms <= 0 THEN RETURN p_from; END IF;
  IF p_start IS NULL THEN RETURN p_from + p_ms * interval '1 millisecond'; END IF;
  LOOP
    v_step := v_step + 1;
    IF v_step > 1000 THEN
      RAISE EXCEPTION 'draft__add_running_ms: no running time found' USING ERRCODE = 'XX000';   -- invariant (internal)
    END IF;
    v_end := public.draft__quiet_window_end(v_t, p_start, p_end, p_tz);
    IF v_end IS NOT NULL THEN v_t := v_end; END IF;
    v_next := public.draft__quiet_next_start(v_t, p_start, p_end, p_tz);
    IF v_next IS NULL THEN
      RAISE EXCEPTION 'draft__add_running_ms: no quiet window ahead' USING ERRCODE = 'XX000';   -- invariant (internal)
    END IF;
    v_avail := EXTRACT(EPOCH FROM (v_next - v_t)) * 1000;
    IF v_rest <= v_avail THEN RETURN v_t + v_rest * interval '1 millisecond'; END IF;
    v_rest := v_rest - v_avail;
    v_t := v_next;
  END LOOP;
END $$;

-- The window as the snapshot / my-turn payload shows it; NULL without quiet hours.
CREATE OR REPLACE FUNCTION public.draft__quiet_hours_json(p_start smallint, p_end smallint, p_tz text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN p_start IS NULL THEN NULL
              ELSE jsonb_build_object('start_hour', p_start, 'end_hour', p_end, 'time_zone', p_tz) END
$$;

-- config.quiet_hours of draft_create_pool: absent or JSON null -> no quiet hours; otherwise exactly
-- {start_hour, end_hour, time_zone} with integer hours 0..23 / 1..24, start < end, at most 23 h (the clock must run
-- some time every day) and a zone of pg_timezone_names. Anything else is INVALID_CONFIG {field: 'quiet_hours'}.
CREATE OR REPLACE FUNCTION public.draft__cfg_quiet(p_cfg jsonb, OUT start_hour smallint, OUT end_hour smallint,
  OUT time_zone text)
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE v jsonb; v_s numeric; v_e numeric; v_tz text;
BEGIN
  IF p_cfg IS NULL OR NOT (p_cfg ? 'quiet_hours') OR jsonb_typeof(p_cfg->'quiet_hours') = 'null' THEN RETURN; END IF;
  v := p_cfg->'quiet_hours';
  IF jsonb_typeof(v) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'quiet_hours')::text;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(v) AS k(key) WHERE k.key NOT IN ('start_hour', 'end_hour', 'time_zone'))
     OR jsonb_typeof(v->'start_hour') IS DISTINCT FROM 'number' OR jsonb_typeof(v->'end_hour') IS DISTINCT FROM 'number'
     OR jsonb_typeof(v->'time_zone') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'quiet_hours')::text;
  END IF;
  v_s := (v->>'start_hour')::numeric;
  v_e := (v->>'end_hour')::numeric;
  v_tz := v->>'time_zone';
  IF v_s <> trunc(v_s) OR v_e <> trunc(v_e) OR v_s < 0 OR v_s > 23 OR v_e < 1 OR v_e > 24 OR v_s >= v_e OR v_e - v_s > 23
     OR length(v_tz) NOT BETWEEN 1 AND 64
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = v_tz) THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'quiet_hours')::text;
  END IF;
  start_hour := v_s::smallint;
  end_hour := v_e::smallint;
  time_zone := v_tz;
END $$;

-- 1. draft__activate_next (base 20261012094028): deadline in running time ──────────────────────────────────────────
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
         deadline_at = CASE WHEN v_pool.paused_at IS NULL                                  -- quiet hours: running time
                             THEN public.draft__add_running_ms(p_at, v_secs::bigint * 1000, v_pool.quiet_start_hour, v_pool.quiet_end_hour, v_pool.quiet_timezone)
                             ELSE NULL END,
         remaining_ms_at_pause = CASE WHEN v_pool.paused_at IS NULL THEN NULL ELSE v_secs * 1000 END,
         reminder_mask = v_mask, notified_turn_at = NULL   -- every (re)activation is a new turn: one fresh turn ping
   WHERE id = v_slot.id;
  RETURN v_slot.id;
END $$;

-- 2. draft__resume (base 20261012024916): resume adds the frozen running ms ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.draft__resume(p_pool_id uuid) RETURNS integer
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_ms integer; v_pool public.draft_pools;
BEGIN
  SELECT * INTO v_pool FROM public.draft_pools WHERE id = p_pool_id;
  UPDATE public.draft_pools SET paused_at = NULL, paused_by = NULL, pause_reason = NULL, updated_at = now() WHERE id = p_pool_id;
  UPDATE public.draft_slots
     SET deadline_at = public.draft__add_running_ms(now(), COALESCE(remaining_ms_at_pause, timer_seconds * 1000, 0)::bigint,
                                                    v_pool.quiet_start_hour, v_pool.quiet_end_hour, v_pool.quiet_timezone),
         remaining_ms_at_pause = NULL
   WHERE draft_pool_id = p_pool_id AND status = 'active' AND deadline_at IS NULL
   RETURNING COALESCE(public.draft__running_ms(now(), deadline_at, v_pool.quiet_start_hour, v_pool.quiet_end_hour, v_pool.quiet_timezone), 0)::int INTO v_ms;
  IF NOT EXISTS (SELECT 1 FROM public.draft_slots WHERE draft_pool_id = p_pool_id AND status IN ('active', 'blocked')) THEN
    PERFORM public.draft__activate_next(p_pool_id, now());
  END IF;
  RETURN COALESCE(v_ms, 0);
END $$;

-- 3. draft_use_extension (base 20261012024916): an extension adds running time ─────────────────────────────────────
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
     SET deadline_at = public.draft__add_running_ms(deadline_at, v_secs::bigint * 1000, v_pool.quiet_start_hour, v_pool.quiet_end_hour, v_pool.quiet_timezone),
         extension_seconds = extension_seconds + v_secs
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

-- 4. draft_set_paused (base 20261012024916): pause freezes the running ms left ─────────────────────────────────────
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
       SET remaining_ms_at_pause = GREATEST(0, public.draft__running_ms(now(), deadline_at, v_pool.quiet_start_hour, v_pool.quiet_end_hour, v_pool.quiet_timezone))::int,
           deadline_at = NULL
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

-- 5. draft__build_snapshot (base 20261012024916): config.quiet_hours ───────────────────────────────────────────────
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
      'submission_deadline_at', p_pool.submission_deadline_at, 'token_purchase_closes_at', p_pool.token_purchase_closes_at,
      'quiet_hours', public.draft__quiet_hours_json(p_pool.quiet_start_hour, p_pool.quiet_end_hour, p_pool.quiet_timezone)),
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

-- 6. draft_my_turn (base 20261012065613): quiet_hours ──────────────────────────────────────────────────────────────
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
    'quiet_hours', public.draft__quiet_hours_json(v_pool.quiet_start_hour, v_pool.quiet_end_hour, v_pool.quiet_timezone),
    'published_now', COALESCE((v->>'published')::boolean, false),
    'timeouts_resolved', COALESCE((v->>'timeouts')::integer, 0));
END $$;

-- 7. draft_claim_notifications (base 20261012065613): running thresholds, no claims inside a window ────────────────
CREATE OR REPLACE FUNCTION public.draft_claim_notifications(p_pool_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_started jsonb; v_reminders jsonb; v_alerts jsonb; v_published jsonb;
BEGIN
  -- 1. turn_started (live AND slow pools, clock running): marks every threshold already crossed as sent, so a slow
  --    slot never gets a reminder for a threshold it started past; live pools never get reminders (step 2 is slow-only).
  --    Quiet hours: no claim inside a window (the ping goes out with the first claim after it ends); thresholds compare
  --    the running (unheld) time left.
  WITH c AS (
    SELECT s.id, public.draft__running_ms(now(), s.deadline_at, p.quiet_start_hour, p.quiet_end_hour, p.quiet_timezone) AS run_ms
      FROM public.draft_slots s JOIN public.draft_pools p ON p.id = s.draft_pool_id
     WHERE (p_pool_id IS NULL OR s.draft_pool_id = p_pool_id) AND p.engine = 'queue' AND p.mode IN ('live', 'slow')
       AND p.phase = 'drafting' AND p.paused_at IS NULL AND s.status = 'active' AND s.deadline_at IS NOT NULL
       AND s.notified_turn_at IS NULL
       AND public.draft__quiet_window_end(now(), p.quiet_start_hour, p.quiet_end_hour, p.quiet_timezone) IS NULL
     FOR UPDATE OF s SKIP LOCKED),
  u AS (
    UPDATE public.draft_slots s
       SET notified_turn_at = now(),
           reminder_mask = (s.reminder_mask
             | ((c.run_ms <= 28800000)::int)
             | (((c.run_ms <= 14400000)::int) << 1)
             | (((c.run_ms <= 3600000)::int) << 2))::smallint
      FROM c WHERE s.id = c.id
    RETURNING s.id, s.draft_pool_id, s.player_id, s.deadline_at, s.timer_seconds, s.round, s.nominal_pick_number, s.kind)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('type', 'turn_started', 'pool_id', u.draft_pool_id, 'season_id', p.season_id,
           'slot_id', u.id, 'player_id', u.player_id, 'deadline_at', u.deadline_at, 'timer_seconds', u.timer_seconds,
           'round', u.round, 'pick_number', u.nominal_pick_number, 'kind', u.kind, 'mode', p.mode)), '[]'::jsonb)
    INTO v_started
    FROM u JOIN public.draft_pools p ON p.id = u.draft_pool_id;

  -- 2. turn_reminder: newly crossed thresholds (8h bit0, 4h bit1, 1h bit2); one claim per slot, smallest threshold.
  --    Quiet hours: running time left; nothing is claimed inside a window (deferred to its end).
  WITH r AS (
    SELECT s.id, public.draft__running_ms(now(), s.deadline_at, p.quiet_start_hour, p.quiet_end_hour, p.quiet_timezone) AS run_ms, s.reminder_mask
      FROM public.draft_slots s JOIN public.draft_pools p ON p.id = s.draft_pool_id
     WHERE (p_pool_id IS NULL OR s.draft_pool_id = p_pool_id) AND p.engine = 'queue' AND p.mode = 'slow'
       AND p.phase = 'drafting' AND p.paused_at IS NULL AND s.status = 'active' AND s.deadline_at IS NOT NULL
       AND s.notified_turn_at IS NOT NULL AND s.notified_turn_at < now() AND s.reminder_mask <> 7
       AND public.draft__quiet_window_end(now(), p.quiet_start_hour, p.quiet_end_hour, p.quiet_timezone) IS NULL
     FOR UPDATE OF s SKIP LOCKED),
  c AS (
    SELECT r.id,
           (((r.run_ms <= 28800000)::int)
            | (((r.run_ms <= 14400000)::int) << 1)
            | (((r.run_ms <= 3600000)::int) << 2)) AS crossed,
           r.reminder_mask
      FROM r),
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

-- 8. draft_create_pool (base 20261012024916): quiet hours from config.quiet_hours ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.draft_create_pool(p_season_id uuid, p_kind text, p_actor_id uuid, p_config jsonb, p_seats jsonb)
RETURNS uuid LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_season public.seasons; v_rules public.format_rules; v_initial public.draft_pools; v_pool_id uuid;
        v_mode text; v_budget integer; v_roster integer; v_pick integer; v_makeup integer; v_ladder integer[];
        v_ext_enabled boolean; v_max_lines integer; v_lock boolean; v_deadline timestamptz; v_closes timestamptz;
        v_n integer; v_replaced uuid; v_q_start smallint; v_q_end smallint; v_q_tz text;
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
  -- Quiet hours: the route sends the format pack's window; frozen at creation, never patched.
  SELECT q.start_hour, q.end_hour, q.time_zone INTO v_q_start, v_q_end, v_q_tz FROM public.draft__cfg_quiet(p_config) q;

  IF p_kind = 'initial' THEN
    -- A pre-M2 placeholder (engine legacy, still pending, no picks) never became a draft:
    -- the live point-buy league season created its pool row before the queue engine existed. It is replaced, not a conflict.
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
      redraft_lock_no_redraft_lines, token_purchase_closes_at, created_by, quiet_start_hour, quiet_end_hour, quiet_timezone)
    VALUES (p_season_id, 'snake', v_budget, 'pending', 'queue', 'initial', v_mode, 'setup', v_season.point_buy_list_id,
      v_roster, v_pick, v_makeup, v_ladder, v_ext_enabled, v_max_lines, v_lock, v_closes, p_actor_id, v_q_start, v_q_end, v_q_tz)
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
      redraft_lock_no_redraft_lines, submission_deadline_at, created_by, quiet_start_hour, quiet_end_hour, quiet_timezone)
    VALUES (p_season_id, 'snake', NULL, 'in_progress', 'queue', 'redraft', v_mode, 'submissions',
      COALESCE(v_initial.list_version_id, v_season.point_buy_list_id), v_initial.id, v_initial.roster_size, v_pick, v_makeup,
      v_ladder, v_ext_enabled, COALESCE(v_max_lines, 3), v_lock, v_deadline, p_actor_id, v_q_start, v_q_end, v_q_tz)
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

-- Privileges ─────────────────────────────────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION
  public.draft__quiet_bounds(date, smallint, smallint, text),
  public.draft__quiet_window_end(timestamptz, smallint, smallint, text),
  public.draft__quiet_next_start(timestamptz, smallint, smallint, text),
  public.draft__running_ms(timestamptz, timestamptz, smallint, smallint, text),
  public.draft__add_running_ms(timestamptz, bigint, smallint, smallint, text),
  public.draft__quiet_hours_json(smallint, smallint, text),
  public.draft__cfg_quiet(jsonb),
  public.draft__activate_next(uuid, timestamptz),
  public.draft__resume(uuid),
  public.draft_use_extension(uuid, uuid, text, uuid),
  public.draft_set_paused(uuid, uuid, boolean, text),
  public.draft__build_snapshot(public.draft_pools),
  public.draft_my_turn(uuid, uuid),
  public.draft_claim_notifications(uuid),
  public.draft_create_pool(uuid, text, uuid, jsonb, jsonb)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.draft__quiet_bounds(date, smallint, smallint, text),
  public.draft__quiet_window_end(timestamptz, smallint, smallint, text),
  public.draft__quiet_next_start(timestamptz, smallint, smallint, text),
  public.draft__running_ms(timestamptz, timestamptz, smallint, smallint, text),
  public.draft__add_running_ms(timestamptz, bigint, smallint, smallint, text),
  public.draft__quiet_hours_json(smallint, smallint, text),
  public.draft__cfg_quiet(jsonb),
  public.draft__activate_next(uuid, timestamptz),
  public.draft__resume(uuid),
  public.draft_use_extension(uuid, uuid, text, uuid),
  public.draft_set_paused(uuid, uuid, boolean, text),
  public.draft__build_snapshot(public.draft_pools),
  public.draft_my_turn(uuid, uuid),
  public.draft_claim_notifications(uuid),
  public.draft_create_pool(uuid, text, uuid, jsonb, jsonb)
TO service_role;

COMMIT;

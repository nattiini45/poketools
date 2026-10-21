-- Live-draft Discord turn pings (owner ruling 2026-10-12, package PINGS).
--
-- M5 (20261012024916_draft_rpcs.sql) is applied and immutable; this migration CREATE OR REPLACEs three of its functions
-- with the same signatures, search_path and service_role-only privileges:
--   * draft_claim_notifications: the turn_started claim now covers live AND slow pools (clock running, not paused,
--     notified_turn_at IS NULL, so exactly once per slot via the existing claim marker). The 8h/4h/1h reminders stay
--     slow-only.
--   * draft_snapshot / draft_my_turn: additionally return `timeouts_resolved` (draft__tick's 'timeouts' count; 0 when
--     not ticked) so the routes know a new slot may have become active and schedule a claim only then (never per poll).
--     The routes strip the field before it reaches the client, like published_now.
BEGIN;

CREATE OR REPLACE FUNCTION public.draft_snapshot(p_pool_id uuid, p_since bigint DEFAULT NULL, p_tick boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v jsonb; v_pool public.draft_pools; v_published boolean := false; v_timeouts integer := 0;
BEGIN
  IF COALESCE(p_tick, true) THEN
    v := public.draft__tick(p_pool_id);
    v_published := COALESCE((v->>'published')::boolean, false);
    v_timeouts := COALESCE((v->>'timeouts')::integer, 0);
  END IF;
  SELECT * INTO v_pool FROM public.draft_pools WHERE id = p_pool_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'POOL_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF v_pool.engine <> 'queue' THEN RAISE EXCEPTION 'POOL_ENGINE_LEGACY' USING ERRCODE = 'P0001'; END IF;
  IF p_since IS NOT NULL AND p_since = v_pool.state_version THEN
    RETURN jsonb_build_object('unchanged', true, 'state_version', v_pool.state_version, 'server_now', now(),
                              'published_now', v_published, 'timeouts_resolved', v_timeouts);
  END IF;
  RETURN public.draft__build_snapshot(v_pool)
         || jsonb_build_object('published_now', v_published, 'timeouts_resolved', v_timeouts);
END $$;

-- MyTurnDTO fields + published_now + timeouts_resolved (the route strips both).
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
    'published_now', COALESCE((v->>'published')::boolean, false),
    'timeouts_resolved', COALESCE((v->>'timeouts')::integer, 0));
END $$;

CREATE OR REPLACE FUNCTION public.draft_claim_notifications(p_pool_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_started jsonb; v_reminders jsonb; v_alerts jsonb; v_published jsonb;
BEGIN
  -- 1. turn_started (live AND slow pools, clock running): marks every threshold already crossed as sent, so a slow
  --    slot never gets a reminder for a threshold it started past; live pools never get reminders (step 2 is slow-only).
  WITH c AS (
    SELECT s.id FROM public.draft_slots s JOIN public.draft_pools p ON p.id = s.draft_pool_id
     WHERE (p_pool_id IS NULL OR s.draft_pool_id = p_pool_id) AND p.engine = 'queue' AND p.mode IN ('live', 'slow')
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

REVOKE ALL ON FUNCTION
  public.draft_snapshot(uuid, bigint, boolean),
  public.draft_my_turn(uuid, uuid),
  public.draft_claim_notifications(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.draft_snapshot(uuid, bigint, boolean),
  public.draft_my_turn(uuid, uuid),
  public.draft_claim_notifications(uuid)
TO service_role;

COMMIT;

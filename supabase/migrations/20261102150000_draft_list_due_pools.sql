-- The draft-ticks cron ticks only pools that have work due (issue #49).
--
-- The cron used to pick the 25 queue pools in `submissions` / `drafting` with the oldest `updated_at`. A tick that
-- finds nothing due never writes the pool, so its `updated_at` never moves: paused drafts, slow drafts whose slot
-- deadline is days away and Redrafts collecting submissions kept the head of the list, and a newer pool whose slot
-- had just expired was never reached once 25 such pools were open. Every run also spent one draft_tick RPC per idle pool.
--
-- public.draft_list_due_pools(p_limit) returns, in SQL, only the queue pools with something due, earliest due first:
--   * an unpaused `drafting` pool with an active slot whose `deadline_at` has passed, or
--   * a `redraft` in `submissions` whose submission deadline has passed and whose publish is not in backoff
--     (draft__publish_retry_due: a publish refused before is not retried while the pool is unchanged, within the hour).
-- The two conditions are the helpers draft__due_timeout and draft__publish_deadline_passed, and draft__tick (replaced
-- below, otherwise verbatim from 20261018140200) calls the same helpers, so the list and the tick cannot drift apart.
-- draft__tick still re-checks everything under the pool lock: the list may be a superset, never a subset.
--
-- Reminders and turn pings do not depend on this list: draft_claim_notifications runs over every pool in one call.
-- The deadline index (idx_draft_slots_active_deadline, 20261012024202) already backs the EXISTS.
--
-- Deploy order: apply this migration BEFORE the code that calls draft_list_due_pools (the cron would fail with
-- "function not found" otherwise). It is read-only: no data changes, no table changes.
BEGIN;

-- 1. Shared predicates ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.draft__due_timeout(p_pool public.draft_pools) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(
    p_pool.phase = 'drafting' AND p_pool.paused_at IS NULL AND EXISTS (
      SELECT 1 FROM public.draft_slots s
       WHERE s.draft_pool_id = p_pool.id AND s.status = 'active' AND s.deadline_at <= now()),
    false)
$$;

CREATE OR REPLACE FUNCTION public.draft__publish_deadline_passed(p_pool public.draft_pools) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(
    p_pool.kind = 'redraft' AND p_pool.phase = 'submissions' AND p_pool.submission_deadline_at <= now(),
    false)
$$;

-- 2. draft__tick (base 20261018140200): the two due conditions come from the shared helpers ──────────────────────────
CREATE OR REPLACE FUNCTION public.draft__tick(p_pool_id uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_pool public.draft_pools; v_due_timeout boolean; v_due_publish boolean; v_timeouts integer := 0;
        v_published boolean := false; v_refused text := NULL; v_skipped boolean := false;
BEGIN
  SELECT * INTO v_pool FROM public.draft_pools WHERE id = p_pool_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'POOL_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF v_pool.engine <> 'queue' THEN
    RETURN jsonb_build_object('timeouts', 0, 'published', false);
  END IF;
  v_due_timeout := public.draft__due_timeout(v_pool);
  v_due_publish := public.draft__publish_deadline_passed(v_pool);
  -- Backoff: a publish refused before is not due again while the pool is unchanged (and within the hour).
  v_skipped := COALESCE(v_due_publish, false) AND NOT public.draft__publish_retry_due(v_pool);
  IF NOT (COALESCE(v_due_timeout, false) OR (COALESCE(v_due_publish, false) AND NOT v_skipped)) THEN
    RETURN jsonb_build_object('timeouts', 0, 'published', false, 'publish_refused', NULL::text, 'publish_backoff', v_skipped);
  END IF;

  v_pool := public.draft__lock(p_pool_id);                           -- re-check everything under the lock
  v_skipped := false;
  IF public.draft__publish_deadline_passed(v_pool) THEN
    IF public.draft__publish_retry_due(v_pool) THEN
      BEGIN
        PERFORM public.redraft__publish_locked(v_pool, NULL, 'system', NULL);
        v_published := true;
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM IN ('REDRAFT_NOT_COMPLETABLE', 'POOL_CHECK_LIMIT') THEN
          v_refused := SQLERRM;
        ELSE
          RAISE;
        END IF;
      END;
      IF v_refused IS NOT NULL THEN
        UPDATE public.draft_pools SET publish_refused_at = now(), publish_refused_version = v_pool.state_version
         WHERE id = p_pool_id;
      END IF;
    ELSE
      v_skipped := true;                                             -- refused before, nothing changed since
    END IF;
  END IF;
  v_timeouts := public.draft__resolve_timeouts(p_pool_id);
  RETURN jsonb_build_object('timeouts', v_timeouts, 'published', v_published, 'publish_refused', v_refused,
                            'publish_backoff', v_skipped);
END $$;

-- 3. The list the cron ticks ───────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.draft_list_due_pools(p_limit integer) RETURNS TABLE (id uuid, season_id uuid)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT p.id, p.season_id
    FROM public.draft_pools p
   WHERE p.engine = 'queue'
     AND p.phase IN ('submissions', 'drafting')
     AND (public.draft__due_timeout(p)
          OR (public.draft__publish_deadline_passed(p) AND public.draft__publish_retry_due(p)))
   ORDER BY CASE
              WHEN p.phase = 'drafting' THEN
                (SELECT min(s.deadline_at) FROM public.draft_slots s WHERE s.draft_pool_id = p.id AND s.status = 'active')
              ELSE p.submission_deadline_at
            END ASC NULLS LAST,
            p.id
   LIMIT GREATEST(COALESCE(p_limit, 0), 0)
$$;

-- Privileges ─────────────────────────────────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION
  public.draft__due_timeout(public.draft_pools),
  public.draft__publish_deadline_passed(public.draft_pools),
  public.draft__tick(uuid),
  public.draft_list_due_pools(integer)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.draft__due_timeout(public.draft_pools),
  public.draft__publish_deadline_passed(public.draft_pools),
  public.draft__tick(uuid),
  public.draft_list_due_pools(integer)
TO service_role;

COMMIT;

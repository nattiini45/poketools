-- Aggregate queue: atomic apply, terminal reclaim, health probe (code review H6, M1, M2).
--
--   apply_aggregate_job        M1. Applies one queued game's aggregate deltas AND sets games.aggregate_applied_at
--                              in ONE transaction, fenced on the job row. Before this, processJob ran
--                              batch_upsert_aggregates and batch_upsert_player_aggregates as two separate RPCs
--                              (Promise.all) and then marked the game in a third request: a failure or a killed
--                              invocation between them left the increments committed with the marker NULL, and the
--                              retried job (markJobFailed or reclaim) added the game a second time.
--                              The delta algebra stays in TS (buildGameAggregateDeltas in
--                              src/lib/supabase/queries/aggregates.ts); this function only reuses the existing
--                              batch_upsert_* bodies, unchanged, inside its own transaction.
--                              Order: (1) job fence: completes the job only while it is still 'processing' (a
--                              cancel from editGame/deleteGame, or a finished duplicate claim, wins); (2) game row
--                              lock FOR UPDATE, so two concurrent applies for one game serialise and the second
--                              sees the marker; (3) both upserts; (4) the marker. Any error rolls back all four,
--                              so the job stays 'processing' and the caller's markJobFailed/reclaim retries a
--                              clean state.
--                              Outcomes (exhaustive; the TS wrapper throws on anything else):
--                                'applied'            deltas applied, marker set, job completed
--                                'already_applied'    marker was already set; job completed, nothing applied
--                                'game_missing'       game row gone; job completed, nothing applied
--                                'job_not_processing' job cancelled or no longer claimed; nothing changed
--                              Scope of the guarantee: this fences the increments (queue jobs, and editGame's
--                              re-apply through applyGameAggregatesNow). The synchronous rollback of admin edit,
--                              delete and match reset is rollback_game_aggregates
--                              (20261018170000_aggregate_rollback_atomic.sql): decrements + marker clear in one
--                              transaction under the same game row lock, fenced on the marker value
--                              (src/lib/pkmn/game-pipeline.ts). Comment added in round 3; no SQL change.
--   reclaim_stale_aggregate_jobs
--                              H6/M2. Replaces the baseline body. A 'processing' job older than 5 minutes whose
--                              attempts are exhausted now ends 'failed' (with last_error) instead of going back to
--                              'pending', where claim_aggregate_jobs (attempts < max_attempts) could never pick it
--                              up again: those rows were stranded forever while every cron run reported success.
--                              Same signature and return (rows reclaimed, both kinds), so the generated type holds.
--   aggregate_job_health       H6. Read-only probe for the cron route: rows the queue can never drain.
--                                stranded_pending  pending with attempts >= max_attempts (unclaimable; rows left by
--                                                  the old reclaim body, or inserted by hand)
--                                stale_processing  processing for more than 15 minutes (three reclaim windows: a
--                                                  reclaim that keeps failing, or a processor that never ends)
--                              Column-to-column comparisons, so it cannot be a PostgREST filter. The cron answers
--                              non-2xx while either is above zero.
--
-- Existing stranded rows are NOT repaired here (owner-gated live data repair). To inspect and repair on the target,
-- after this migration:
--   SELECT * FROM public.aggregate_job_health();
--   UPDATE public.aggregate_jobs
--      SET status = 'failed', last_error = COALESCE(last_error, 'Stranded pending with attempts exhausted'),
--          updated_at = now()
--    WHERE status = 'pending' AND attempts >= max_attempts;
--   then an admin scope rebuild for the affected scopes (the rebuild re-derives from battle_stats).
--
-- Grants: service_role only (20261008081443_close_public_api_roles.sql). New functions get REVOKE ALL from the API
-- roles explicitly; CREATE OR REPLACE of reclaim keeps its existing (already closed) ACL, restated anyway.
BEGIN;

CREATE OR REPLACE FUNCTION public.apply_aggregate_job(
  p_job_id uuid,
  p_game_id uuid,
  p_aggregate_deltas jsonb,
  p_player_deltas jsonb
) RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_job_game_id uuid;
  v_applied_at timestamptz;
BEGIN
  IF p_job_id IS NULL OR p_game_id IS NULL THEN
    RAISE EXCEPTION 'apply_aggregate_job: job id and game id are required' USING ERRCODE = '22004';
  END IF;
  IF jsonb_typeof(p_aggregate_deltas) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_player_deltas) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'apply_aggregate_job: deltas must be JSON arrays' USING ERRCODE = '22023';
  END IF;

  -- 1. Fence: only a job that is still claimed may apply. Takes the job row lock until commit, so a concurrent
  --    cancel_aggregate_jobs_for_game or reclaim waits for this transaction and then sees 'completed'.
  UPDATE aggregate_jobs
     SET status = 'completed', processed_at = now(), updated_at = now()
   WHERE id = p_job_id AND status = 'processing'
  RETURNING game_id INTO v_job_game_id;
  IF NOT FOUND THEN
    RETURN 'job_not_processing';
  END IF;
  IF v_job_game_id IS DISTINCT FROM p_game_id THEN
    -- Rolls back the fence update too: the caller passed another game's deltas.
    RAISE EXCEPTION 'apply_aggregate_job: job % belongs to game %, not %', p_job_id, v_job_game_id, p_game_id
      USING ERRCODE = '22023';
  END IF;

  -- 2. Idempotency marker, read under the game row lock.
  SELECT aggregate_applied_at INTO v_applied_at FROM games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'game_missing';
  END IF;
  IF v_applied_at IS NOT NULL THEN
    RETURN 'already_applied';
  END IF;

  -- 3. Increments (fixed table order: aggregates, then player_aggregates).
  PERFORM batch_upsert_aggregates(p_aggregate_deltas);
  PERFORM batch_upsert_player_aggregates(p_player_deltas);

  -- 4. Marker, in the same transaction as the increments.
  UPDATE games SET aggregate_applied_at = now() WHERE id = p_game_id;

  RETURN 'applied';
END;
$$;

COMMENT ON FUNCTION public.apply_aggregate_job(uuid, uuid, jsonb, jsonb) IS
  'Atomically apply one queued game''s aggregate deltas (built in TS by buildGameAggregateDeltas), set games.aggregate_applied_at and complete the job, fenced on status = processing and the game row lock. Returns applied | already_applied | game_missing | job_not_processing. Service-role only.';

CREATE OR REPLACE FUNCTION public.reclaim_stale_aggregate_jobs() RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH reclaimed AS (
    UPDATE aggregate_jobs
       SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
           last_error = CASE WHEN attempts >= max_attempts
                             THEN 'Processor stopped while processing; attempts exhausted'
                             ELSE last_error END,
           updated_at = now()
     WHERE status = 'processing'
       AND updated_at < now() - INTERVAL '5 minutes'
    RETURNING id
  )
  SELECT count(*)::integer INTO v_count FROM reclaimed;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.reclaim_stale_aggregate_jobs() IS
  'Returns processing jobs idle for more than 5 minutes to pending, or to failed when their attempts are exhausted (never strands an unclaimable pending row). Returns the number of rows changed. Service-role only.';

CREATE OR REPLACE FUNCTION public.aggregate_job_health()
RETURNS TABLE (stranded_pending integer, stale_processing integer)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    (count(*) FILTER (WHERE status = 'pending' AND attempts >= max_attempts))::integer AS stranded_pending,
    (count(*) FILTER (WHERE status = 'processing' AND updated_at < now() - INTERVAL '15 minutes'))::integer
      AS stale_processing
  FROM aggregate_jobs
  WHERE status IN ('pending', 'processing');
$$;

COMMENT ON FUNCTION public.aggregate_job_health() IS
  'Queue rows that can never drain: pending with attempts exhausted, and processing for more than 15 minutes. Read-only; the process-aggregates cron fails while either is above zero. Service-role only.';

REVOKE ALL ON FUNCTION
  public.apply_aggregate_job(uuid, uuid, jsonb, jsonb),
  public.reclaim_stale_aggregate_jobs(),
  public.aggregate_job_health()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.apply_aggregate_job(uuid, uuid, jsonb, jsonb),
  public.reclaim_stale_aggregate_jobs(),
  public.aggregate_job_health()
TO service_role;

COMMIT;

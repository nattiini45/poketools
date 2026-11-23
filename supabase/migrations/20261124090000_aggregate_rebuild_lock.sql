-- CAS-427: enforce the quiescent-write precondition of scope aggregate rebuilds instead of leaving it to the
-- operator. A rebuild (clearAggregatesForScope + the paged recount in src/lib/match/aggregate-rebuild.ts) spans
-- many transactions, so it cannot hold a session or transaction lock: it claims the singleton row of
-- public.aggregate_rebuild_lock, heartbeats it between pages and releases it at the end; expiry makes a crashed
-- rebuild recoverable.
--
-- While an unexpired lock row exists, public.assert_no_aggregate_rebuild() raises PT409 inside the claim, apply
-- and rollback RPCs of BOTH stores (legacy aggregate_jobs + phase_aggregate_jobs). A queue run claims nothing
-- during a rebuild and applies/rollbacks fail fast instead of double-counting or losing a game against the
-- clear. Enqueues are deliberately NOT fenced: a job enqueued inside the window is either live at the rebuild's
-- fence read (skipped, applied after release) or enqueued after it (its game postdates the recount bound), and
-- fenced inserts would strand counted games with no job. The app entry points (recordGameResult, editGame,
-- deleteGame) additionally check the lock before writing, so user writes see a clean 409 rather than a
-- mid-path failure; the rebuild's post-claim grace wait covers app-level writer transactions that passed
-- that check just before the claim.
--
-- The fence's check is made atomic with the write it guards through the lock row itself, which is pre-seeded
-- and never deleted (release resets it): every wrapper takes FOR SHARE on id = 1 FIRST and asserts while
-- holding it through the inner call, so a claim's FOR UPDATE drains (waits out) every in-flight RPC write
-- before it activates the lease, and a writer that queued behind a waiting claim sees the active lease when
-- it wakes and fences instead of proceeding. The grace wait only has to cover app entry points, which do not
-- hold the row lock.
--
-- The six existing functions keep their bodies: each is renamed to <name>_inner (grants follow the function)
-- and a same-signature wrapper performs the guard + fence first, so every caller keeps working unchanged.
--
-- Refusals a PostgREST caller must see use the custom-error form PT409 (HTTP 409): a raised 40001 never leaves
-- the function (20261121220000_fence_sqlstate_pt409.sql).
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'apply_aggregate_job') THEN
    RAISE EXCEPTION 'apply_aggregate_job is missing; this migration must wrap it';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'apply_phase_aggregate_job') THEN
    RAISE EXCEPTION 'apply_phase_aggregate_job is missing; this migration must wrap it';
  END IF;
END $$;

CREATE TABLE public.aggregate_rebuild_lock (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  holder uuid NOT NULL,
  scope_type text NOT NULL,
  scope_id text,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

ALTER TABLE public.aggregate_rebuild_lock ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.aggregate_rebuild_lock TO service_role;

-- The row exists permanently (free state = expired). Every fenced RPC locks it FOR SHARE, so it must exist
-- before any wrapper can run; a claim takes FOR UPDATE on the same row.
INSERT INTO public.aggregate_rebuild_lock (id, holder, scope_type, expires_at)
VALUES (1, '00000000-0000-0000-0000-000000000000', 'none', '-infinity');

COMMENT ON TABLE public.aggregate_rebuild_lock IS
  'Singleton (id = 1) coordination point of CAS-427, pre-seeded free (expires_at = -infinity) and never
   deleted: a scope aggregate rebuild marks it for its whole clear+recount and heartbeats it;
   assert_no_aggregate_rebuild fences claim/apply/rollback RPCs (and app write entry points) while it is
   unexpired. Crash-safe through expires_at. Its row lock is also the serialization point: fenced RPCs hold
   FOR SHARE on it through their inner call and claim takes FOR UPDATE, which drains in-flight writes.';

CREATE OR REPLACE FUNCTION public.assert_no_aggregate_rebuild() RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_lock record;
BEGIN
  SELECT scope_type, scope_id INTO v_lock
    FROM public.aggregate_rebuild_lock
   WHERE expires_at > now();
  IF FOUND THEN
    RAISE EXCEPTION 'aggregate rebuild in progress for scope %/%: result writes and aggregate jobs are fenced until it releases or expires',
      v_lock.scope_type, COALESCE(v_lock.scope_id, '*')
      USING ERRCODE = 'PT409';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.assert_no_aggregate_rebuild() IS
  'CAS-427 fence: raises PT409 while an unexpired aggregate_rebuild_lock row exists. Called by
   aggregate_rebuild_guard (which holds the row FOR SHARE first) and by the app write entry points.';

CREATE OR REPLACE FUNCTION public.aggregate_rebuild_guard() RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Lock the guard row FIRST: while a claim holds FOR UPDATE this queues behind it, and the assert below
  -- then sees the freshly-activated lease and fences. While this FOR SHARE is held, no claim can activate
  -- the lease, so the assert and the inner call it guards run under one consistent lock state.
  PERFORM 1 FROM public.aggregate_rebuild_lock WHERE id = 1 FOR SHARE;
  PERFORM public.assert_no_aggregate_rebuild();
END;
$$;

COMMENT ON FUNCTION public.aggregate_rebuild_guard() IS
  'CAS-427 fence entry of the claim/apply/rollback wrappers: holds the singleton row FOR SHARE through the
   caller''s transaction (blocking a claim''s FOR UPDATE), then asserts no live rebuild. The pair makes the
   fence check atomic with the write it guards.';

CREATE OR REPLACE FUNCTION public.aggregate_rebuild_active() RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM public.aggregate_rebuild_lock WHERE expires_at > now());
END;
$$;

COMMENT ON FUNCTION public.aggregate_rebuild_active() IS
  'CAS-427 probe: whether an unexpired rebuild lock exists. The queue drain uses it to stop early instead of
   spinning while fenced. Service-role only.';

CREATE OR REPLACE FUNCTION public.claim_aggregate_rebuild_lock(
  p_scope_type text,
  p_scope_id text,
  p_ttl_seconds integer DEFAULT 120
) RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_holder uuid := gen_random_uuid();
  v_lock record;
BEGIN
  IF p_scope_type IS NULL THEN
    RAISE EXCEPTION 'p_scope_type is required' USING ERRCODE = '22004';
  END IF;
  IF p_ttl_seconds IS NULL OR p_ttl_seconds <= 0 THEN
    RAISE EXCEPTION 'p_ttl_seconds must be a positive integer' USING ERRCODE = '22023';
  END IF;
  -- FOR UPDATE drains every in-flight fenced RPC write (their FOR SHARE) before the lease activates: this
  -- statement waits until the last shared holder commits, so nothing that already passed the fence can
  -- still be writing aggregates when the recount starts. Writers that arrive while this waits queue behind
  -- it on FOR SHARE and see the active lease when it commits. clock_timestamp() (wall clock, not transaction
  -- start) keeps that wait from consuming the lease: the TTL runs from when the claim actually acquired.
  PERFORM 1 FROM public.aggregate_rebuild_lock WHERE id = 1 FOR UPDATE;
  UPDATE public.aggregate_rebuild_lock
     SET holder = v_holder,
         scope_type = p_scope_type,
         scope_id = p_scope_id,
         acquired_at = clock_timestamp(),
         heartbeat_at = clock_timestamp(),
         expires_at = clock_timestamp() + make_interval(secs => p_ttl_seconds)
   WHERE id = 1 AND expires_at <= clock_timestamp();
  IF NOT FOUND THEN
    SELECT holder, scope_type, scope_id, expires_at INTO v_lock
      FROM public.aggregate_rebuild_lock WHERE id = 1;
    RAISE EXCEPTION 'aggregate rebuild already in progress for scope %/% (expires %)',
      v_lock.scope_type, COALESCE(v_lock.scope_id, '*'), v_lock.expires_at
      USING ERRCODE = 'PT409';
  END IF;
  RETURN v_holder;
END;
$$;

COMMENT ON FUNCTION public.claim_aggregate_rebuild_lock(text, text, integer) IS
  'CAS-427: claim the singleton rebuild lock for a scope, stealing it only when expired; its FOR UPDATE
   drains in-flight fenced writes before the lease activates. Returns the holder token the caller must
   pass to heartbeat/release. Raises PT409 while a live rebuild holds it. Service-role only.';

CREATE OR REPLACE FUNCTION public.heartbeat_aggregate_rebuild_lock(
  p_holder uuid,
  p_ttl_seconds integer DEFAULT 120
) RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF p_ttl_seconds IS NULL OR p_ttl_seconds <= 0 THEN
    RAISE EXCEPTION 'p_ttl_seconds must be a positive integer' USING ERRCODE = '22023';
  END IF;
  UPDATE public.aggregate_rebuild_lock
     SET heartbeat_at = clock_timestamp(),
         expires_at = clock_timestamp() + make_interval(secs => p_ttl_seconds)
   WHERE id = 1 AND holder = p_holder;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'aggregate rebuild lock is not held by % (released or stolen)', p_holder
      USING ERRCODE = 'PT409';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.heartbeat_aggregate_rebuild_lock(uuid, integer) IS
  'CAS-427: extend the rebuild lock while its holder keeps working (one call per recount page). Raises PT409
   when the holder lost the lock. Service-role only.';

CREATE OR REPLACE FUNCTION public.release_aggregate_rebuild_lock(p_holder uuid) RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- The row is permanent: release resets it to the free state instead of deleting it, so fenced RPCs
  -- always have a row to lock FOR SHARE.
  UPDATE public.aggregate_rebuild_lock
     SET holder = '00000000-0000-0000-0000-000000000000',
         expires_at = '-infinity'
   WHERE id = 1 AND holder = p_holder;
END;
$$;

COMMENT ON FUNCTION public.release_aggregate_rebuild_lock(uuid) IS
  'CAS-427: release the rebuild lock. Releasing another holder''s lock is a no-op. Service-role only.';

-- Claim fences: a queue run during a rebuild claims nothing (its caller treats the fence as a no-op pass).
ALTER FUNCTION public.claim_aggregate_jobs(integer) RENAME TO claim_aggregate_jobs_inner;
ALTER FUNCTION public.claim_phase_aggregate_jobs(integer) RENAME TO claim_phase_aggregate_jobs_inner;

CREATE OR REPLACE FUNCTION public.claim_aggregate_jobs(p_limit integer DEFAULT 10)
RETURNS SETOF public.aggregate_jobs
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM public.aggregate_rebuild_guard();
  RETURN QUERY SELECT * FROM public.claim_aggregate_jobs_inner(p_limit);
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_phase_aggregate_jobs(p_limit integer DEFAULT 10)
RETURNS SETOF public.phase_aggregate_jobs
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM public.aggregate_rebuild_guard();
  RETURN QUERY SELECT * FROM public.claim_phase_aggregate_jobs_inner(p_limit);
END;
$$;

-- Apply/rollback fences: an already-claimed job or a synchronous rollback cannot race the clear and recount.
ALTER FUNCTION public.apply_aggregate_job(uuid, uuid, jsonb, jsonb) RENAME TO apply_aggregate_job_inner;
ALTER FUNCTION public.apply_phase_aggregate_job(uuid, uuid, jsonb, jsonb) RENAME TO apply_phase_aggregate_job_inner;
ALTER FUNCTION public.rollback_game_aggregates(uuid, timestamptz, jsonb, jsonb) RENAME TO rollback_game_aggregates_inner;
ALTER FUNCTION public.rollback_phase_game_aggregates(uuid, timestamptz, jsonb, jsonb) RENAME TO rollback_phase_game_aggregates_inner;

CREATE OR REPLACE FUNCTION public.apply_aggregate_job(
  p_job_id uuid,
  p_game_id uuid,
  p_aggregate_deltas jsonb,
  p_player_deltas jsonb
) RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM public.aggregate_rebuild_guard();
  RETURN public.apply_aggregate_job_inner(p_job_id, p_game_id, p_aggregate_deltas, p_player_deltas);
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_phase_aggregate_job(
  p_job_id uuid,
  p_game_id uuid,
  p_aggregate_deltas jsonb,
  p_player_deltas jsonb
) RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM public.aggregate_rebuild_guard();
  RETURN public.apply_phase_aggregate_job_inner(p_job_id, p_game_id, p_aggregate_deltas, p_player_deltas);
END;
$$;

CREATE OR REPLACE FUNCTION public.rollback_game_aggregates(
  p_game_id uuid,
  p_expected_applied_at timestamptz,
  p_aggregate_deltas jsonb,
  p_player_deltas jsonb
) RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM public.aggregate_rebuild_guard();
  RETURN public.rollback_game_aggregates_inner(p_game_id, p_expected_applied_at, p_aggregate_deltas, p_player_deltas);
END;
$$;

CREATE OR REPLACE FUNCTION public.rollback_phase_game_aggregates(
  p_game_id uuid,
  p_expected_applied_at timestamptz,
  p_aggregate_deltas jsonb,
  p_player_deltas jsonb
) RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM public.aggregate_rebuild_guard();
  RETURN public.rollback_phase_game_aggregates_inner(p_game_id, p_expected_applied_at, p_aggregate_deltas, p_player_deltas);
END;
$$;

COMMENT ON FUNCTION public.apply_aggregate_job(uuid, uuid, jsonb, jsonb) IS
  'CAS-427 fence wrapper: refuses (PT409) while an aggregate rebuild lock is held, then delegates to
   apply_aggregate_job_inner. Service-role only.';
COMMENT ON FUNCTION public.apply_phase_aggregate_job(uuid, uuid, jsonb, jsonb) IS
  'CAS-427 fence wrapper: refuses (PT409) while an aggregate rebuild lock is held, then delegates to
   apply_phase_aggregate_job_inner. Service-role only.';
COMMENT ON FUNCTION public.rollback_game_aggregates(uuid, timestamptz, jsonb, jsonb) IS
  'CAS-427 fence wrapper: refuses (PT409) while an aggregate rebuild lock is held, then delegates to
   rollback_game_aggregates_inner. Service-role only.';
COMMENT ON FUNCTION public.rollback_phase_game_aggregates(uuid, timestamptz, jsonb, jsonb) IS
  'CAS-427 fence wrapper: refuses (PT409) while an aggregate rebuild lock is held, then delegates to
   rollback_phase_game_aggregates_inner. Service-role only.';
COMMENT ON FUNCTION public.claim_aggregate_jobs(integer) IS
  'CAS-427 fence wrapper: refuses (PT409) while an aggregate rebuild lock is held, then delegates to
   claim_aggregate_jobs_inner. Service-role only.';
COMMENT ON FUNCTION public.claim_phase_aggregate_jobs(integer) IS
  'CAS-427 fence wrapper: refuses (PT409) while an aggregate rebuild lock is held, then delegates to
   claim_phase_aggregate_jobs_inner. Service-role only.';

REVOKE ALL ON FUNCTION public.assert_no_aggregate_rebuild() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aggregate_rebuild_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aggregate_rebuild_active() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_aggregate_rebuild_lock(text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.heartbeat_aggregate_rebuild_lock(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_aggregate_rebuild_lock(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_aggregate_jobs(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_phase_aggregate_jobs(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_aggregate_job(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_phase_aggregate_job(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rollback_game_aggregates(uuid, timestamptz, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rollback_phase_game_aggregates(uuid, timestamptz, jsonb, jsonb) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.assert_no_aggregate_rebuild() TO service_role;
GRANT EXECUTE ON FUNCTION public.aggregate_rebuild_guard() TO service_role;
GRANT EXECUTE ON FUNCTION public.aggregate_rebuild_active() TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_aggregate_rebuild_lock(text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.heartbeat_aggregate_rebuild_lock(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_aggregate_rebuild_lock(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_aggregate_jobs(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_phase_aggregate_jobs(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_aggregate_job(uuid, uuid, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_phase_aggregate_job(uuid, uuid, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.rollback_game_aggregates(uuid, timestamptz, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.rollback_phase_game_aggregates(uuid, timestamptz, jsonb, jsonb) TO service_role;

COMMIT;

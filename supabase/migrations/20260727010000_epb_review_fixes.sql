-- Evolution Point Buy: code-review fixes
-- 1. Audit rows must survive tracker deletion (redraft deletes the old tracker):
--    - redraft_history.from_tracker_id -> ON DELETE SET NULL
--    - evo_progress_log.tracker_id     -> nullable + ON DELETE SET NULL
-- 2. Atomic progress increments (no read-modify-write lost updates):
--    - increment_tracker_progress(): single UPDATE with clamp at 0 + total_kos recompute
--    - increment_evolution_points(): single UPDATE counter increment

-- 1.1 redraft_history.from_tracker_id: preserve history when the source tracker is deleted
ALTER TABLE "public"."redraft_history"
    DROP CONSTRAINT IF EXISTS "redraft_history_from_tracker_id_fkey";
ALTER TABLE "public"."redraft_history"
    ADD CONSTRAINT "redraft_history_from_tracker_id_fkey"
    FOREIGN KEY ("from_tracker_id") REFERENCES "public"."evolution_tracker"("id") ON DELETE SET NULL;

-- 1.2 evo_progress_log.tracker_id: keep audit logs when a tracker is deleted (was CASCADE)
ALTER TABLE "public"."evo_progress_log"
    ALTER COLUMN "tracker_id" DROP NOT NULL;
ALTER TABLE "public"."evo_progress_log"
    DROP CONSTRAINT IF EXISTS "evo_progress_log_tracker_id_fkey";
ALTER TABLE "public"."evo_progress_log"
    ADD CONSTRAINT "evo_progress_log_tracker_id_fkey"
    FOREIGN KEY ("tracker_id") REFERENCES "public"."evolution_tracker"("id") ON DELETE SET NULL;

-- 2.1 Atomic progress source increment with clamp at 0 and total_kos recompute.
--     Returns the updated tracker row so callers can resolve stage transitions
--     from the post-update values instead of stale in-memory state.
CREATE OR REPLACE FUNCTION public.increment_tracker_progress(
  p_tracker_id uuid,
  p_source text,
  p_amount integer
) RETURNS public.evolution_tracker
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_row public.evolution_tracker;
BEGIN
  IF p_source NOT IN ('real_kills', 'draft_tokens', 'kill_tokens', 'cosmo_points') THEN
    RAISE EXCEPTION 'Invalid progress source: %', p_source;
  END IF;

  UPDATE public.evolution_tracker SET
    real_kills   = CASE WHEN p_source = 'real_kills'   THEN GREATEST(0, real_kills + p_amount)   ELSE real_kills   END,
    draft_tokens = CASE WHEN p_source = 'draft_tokens' THEN GREATEST(0, draft_tokens + p_amount) ELSE draft_tokens END,
    kill_tokens  = CASE WHEN p_source = 'kill_tokens'  THEN GREATEST(0, kill_tokens + p_amount)  ELSE kill_tokens  END,
    cosmo_points = CASE WHEN p_source = 'cosmo_points' THEN GREATEST(0, cosmo_points + p_amount) ELSE cosmo_points END,
    total_kos =
        (CASE WHEN p_source = 'real_kills'   THEN GREATEST(0, real_kills + p_amount)   ELSE real_kills   END)
      + (CASE WHEN p_source = 'draft_tokens' THEN GREATEST(0, draft_tokens + p_amount) ELSE draft_tokens END)
      + (CASE WHEN p_source = 'kill_tokens'  THEN GREATEST(0, kill_tokens + p_amount)  ELSE kill_tokens  END)
      + (CASE WHEN p_source = 'cosmo_points' THEN GREATEST(0, cosmo_points + p_amount) ELSE cosmo_points END),
    updated_at = now()
  WHERE id = p_tracker_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tracker not found: %', p_tracker_id;
  END IF;

  RETURN v_row;
END;
$$;

-- 2.2 Atomic evolution-point counter increment (player-level counter stored on a tracker)
CREATE OR REPLACE FUNCTION public.increment_evolution_points(
  p_tracker_id uuid,
  p_amount integer DEFAULT 1
) RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE public.evolution_tracker
  SET evolution_points_awarded = GREATEST(0, evolution_points_awarded + p_amount),
      updated_at = now()
  WHERE id = p_tracker_id;
$$;

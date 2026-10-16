-- Fix claim_aggregate_jobs: RETURNING id INTO uuid[] fails with 22P02
-- ("malformed array literal") when claiming even a single row, so every
-- processAggregateJobs / cron / after() run logged a claim error and exited
-- with processed=0 while jobs stayed pending forever.

CREATE OR REPLACE FUNCTION public.claim_aggregate_jobs(p_limit integer DEFAULT 10)
RETURNS SETOF public.aggregate_jobs
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT id
    FROM aggregate_jobs
    WHERE status = 'pending'
      AND attempts < max_attempts
    ORDER BY created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  ),
  updated AS (
    UPDATE aggregate_jobs ag
    SET status = 'processing',
        attempts = ag.attempts + 1,
        updated_at = now()
    FROM claimed c
    WHERE ag.id = c.id
    RETURNING ag.*
  )
  SELECT * FROM updated ORDER BY created_at ASC;
END;
$$;

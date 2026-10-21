-- Durable request rate limiting (code review H8 / H4; lead decision 2026-10-18).
--
-- Replaces the per-process in-memory Map in src/lib/utils/rate-limit.ts, which reset on every cold start, was
-- per serverless instance and never evicted keys. One row per (bucket, identity) key holds a fixed window:
-- rate_limit_hit() atomically opens a fresh window or counts one hit in the current one and says whether the
-- hit is within the limit. The key is built in TypeScript as '<bucket>:<sha256(identity) prefix>', so no raw
-- IP address or email address is stored.
--
-- Concurrency: the function first locks an existing key's row (SELECT ... FOR UPDATE) and only THEN reads the
-- clock, so concurrent hits on one key serialize, each sees the count of the previous one, and a hit that waited
-- for the lock past the window end opens the fresh window instead of being counted (and denied) in the expired
-- one; Retry-After is measured from the same post-lock instant. Two first hits on a new key resolve through the
-- INSERT ... ON CONFLICT arbiter (one inserts, the other updates); the loser's clock lags only by the winner's
-- single-statement transaction. No advisory lock is needed.
--
-- Housekeeping: about 1 call in 100 deletes up to 500 rows whose window ended more than an hour ago, so the
-- table stays bounded by the number of keys active in the last hour without a cron.
--
-- Service-role only: RLS enabled with no policies, table privileges and EXECUTE granted to service_role only
-- (AGENTS.md "Never Do"; src/lib/supabase/__tests__/migration-api-grants.test.ts).
BEGIN;

CREATE TABLE public.rate_limit_buckets (
  key          text        PRIMARY KEY CHECK (char_length(key) BETWEEN 1 AND 200),
  window_start timestamptz NOT NULL,
  window_end   timestamptz NOT NULL,
  hits         integer     NOT NULL CHECK (hits >= 1)
);

CREATE INDEX idx_rate_limit_buckets_window_end ON public.rate_limit_buckets (window_end);

ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rate_limit_buckets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.rate_limit_buckets TO service_role;
COMMENT ON TABLE public.rate_limit_buckets IS
  'Service-role only. Fixed-window request counters for rate_limit_hit(); keys are <bucket>:<hashed identity>. No RLS policies by design.';

-- Count one hit for p_key in a window of p_window_seconds and report whether it is within p_max.
--   allowed             true when this hit is number 1..p_max of the current window
--   hits                hits counted in the current window, this one included (denied hits count too)
--   retry_after_seconds 0 when allowed, else whole seconds until the window ends (at least 1)
-- Invalid arguments raise 22023 (invalid_parameter_value); the caller treats any error as limiter unavailable.
CREATE OR REPLACE FUNCTION public.rate_limit_hit(p_key text, p_window_seconds integer, p_max integer)
RETURNS TABLE (allowed boolean, hits integer, retry_after_seconds integer)
LANGUAGE plpgsql
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_now    timestamptz;
  v_window interval;
  v_end    timestamptz;
  v_hits   integer;
BEGIN
  IF p_key IS NULL OR char_length(p_key) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'rate_limit_hit: key must be 1..200 characters' USING ERRCODE = '22023';
  END IF;
  IF p_window_seconds IS NULL OR p_window_seconds NOT BETWEEN 1 AND 604800 THEN
    RAISE EXCEPTION 'rate_limit_hit: window_seconds must be 1..604800' USING ERRCODE = '22023';
  END IF;
  IF p_max IS NULL OR p_max < 1 THEN
    RAISE EXCEPTION 'rate_limit_hit: max must be at least 1' USING ERRCODE = '22023';
  END IF;

  v_window := make_interval(secs => p_window_seconds);

  -- Wait for any concurrent hit on this key first; the clock is read after the wait (see Concurrency above).
  PERFORM 1 FROM public.rate_limit_buckets WHERE key = p_key FOR UPDATE;
  v_now := clock_timestamp();

  INSERT INTO public.rate_limit_buckets AS b (key, window_start, window_end, hits)
  VALUES (p_key, v_now, v_now + v_window, 1)
  ON CONFLICT (key) DO UPDATE
    SET window_start = CASE WHEN b.window_end <= v_now THEN v_now ELSE b.window_start END,
        window_end   = CASE WHEN b.window_end <= v_now THEN v_now + v_window ELSE b.window_end END,
        hits         = CASE WHEN b.window_end <= v_now THEN 1 ELSE least(b.hits, 2147483646) + 1 END
  RETURNING b.window_end, b.hits INTO v_end, v_hits;

  IF random() < 0.01 THEN
    DELETE FROM public.rate_limit_buckets
     WHERE key IN (SELECT r.key FROM public.rate_limit_buckets r
                    WHERE r.window_end < v_now - interval '1 hour'
                    LIMIT 500);
  END IF;

  allowed := v_hits <= p_max;
  hits := v_hits;
  retry_after_seconds := CASE
    WHEN v_hits <= p_max THEN 0
    ELSE greatest(1, ceil(extract(epoch FROM (v_end - v_now)))::integer)
  END;
  RETURN NEXT;
END
$$;

REVOKE ALL ON FUNCTION public.rate_limit_hit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limit_hit(text, integer, integer) TO service_role;
COMMENT ON FUNCTION public.rate_limit_hit(text, integer, integer) IS
  'Service-role only. Atomic fixed-window hit counter behind src/lib/utils/rate-limit.ts.';

COMMIT;

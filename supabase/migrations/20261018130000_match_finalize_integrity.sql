-- Match finalize integrity (code review 2026-10-18: C2, H2).
--
-- 1. matches.finalized_at (C2). A match row flips to 'completed' in its own UPDATE before finalize runs its side effects
--    (ratings, streaks, signatures, achievements, announcements, EPB matchday hooks, bracket propagation). Finalize sets
--    this marker last, and only when every step succeeded (src/lib/match/finalize.ts). Every status write clears it
--    (src/lib/supabase/queries/matches.ts), so a completed match with a NULL marker is one whose finalize did not finish.
--    The auto-confirm cron re-runs the replay-safe steps for such matches once they are 10 minutes old.
--    Backfill: every match already completed was finalized by the code of its time, so it gets its own updated_at. The updated_at trigger is disabled for
--    the backfill so the stamp does not move every completed match's updated_at to the migration time.
--
-- 2. games (match_id, game_number) unique (H2). getNextGameNumber is a max+1 read, so two concurrent submissions for one
--    match could both insert game N (double-counted wins and aggregates). createGame maps the violation of this
--    constraint to a 409 (match_result_conflict). The DO block fails loudly (never deletes) if an environment already
--    holds a duplicate pair. No replay_url uniqueness: a repeated replay URL can be legitimate.
--
-- No new grants: anon and authenticated hold nothing on public.matches or public.games
-- (20261008081402, 20261008081443); service_role keeps its table privileges, which cover the new column.
BEGIN;

-- 1. ────────────────────────────────────────────────────────────────────────
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS finalized_at timestamptz;

COMMENT ON COLUMN public.matches.finalized_at IS
  'Set by match finalize after every completion side effect succeeded; cleared by every status write. '
  'NULL on a completed match = finalize incomplete (healed by the auto-confirm cron where replay-safe).';

ALTER TABLE public.matches DISABLE TRIGGER trg_matches_updated;
UPDATE public.matches
   SET finalized_at = updated_at
 WHERE status = 'completed'
   AND finalized_at IS NULL;
ALTER TABLE public.matches ENABLE TRIGGER trg_matches_updated;

-- The cron's worklist: completed matches whose finalize did not finish (normally empty).
CREATE INDEX IF NOT EXISTS matches_completed_unfinalized_idx
  ON public.matches (updated_at)
  WHERE status = 'completed' AND finalized_at IS NULL;

-- 2. ────────────────────────────────────────────────────────────────────────
DO $$ DECLARE n integer; BEGIN
  SELECT count(*) INTO n FROM (
    SELECT 1 FROM public.games GROUP BY match_id, game_number HAVING count(*) > 1) d;
  IF n > 0 THEN
    RAISE EXCEPTION 'games holds % duplicate (match_id, game_number) pairs; resolve them through the admin game delete first', n;
  END IF;
END $$;

ALTER TABLE public.games
  ADD CONSTRAINT games_match_id_game_number_key UNIQUE (match_id, game_number);

COMMIT;

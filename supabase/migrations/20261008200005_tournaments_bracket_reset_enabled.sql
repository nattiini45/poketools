-- Per-tournament Grand Finals bracket reset toggle (double elimination).
-- Default ON: every DE graph includes the conditional "if necessary" reset
-- slot (played only when the Losers Bracket champion wins the first Grand
-- Finals). Togglable at any time via PATCH /api/tournaments/[id] — enabling
-- after generation materializes through bracket repair; disabling removes
-- any scheduled (unplayed) reset match.
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS bracket_reset_enabled boolean NOT NULL DEFAULT true;

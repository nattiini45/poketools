-- Add a user-facing name to teams (editable in the teambuilder top bar).
-- Distinct from library_title, which is only set when publishing to the library.

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.teams.name IS 'User-chosen team name shown in the teambuilder and team lists';

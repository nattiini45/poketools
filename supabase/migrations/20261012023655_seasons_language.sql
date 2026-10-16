-- seasons.language (i18n-core §6.1): content language of a league (season) for
-- text produced without a viewer: Discord embeds, social images/posts, stored
-- AI reports, and OBS overlays opened without ?lang=. Viewers always see their
-- own UI language; this column never drives a viewer's page.
-- Existing leagues are German (owner ruling); the column default covers API
-- callers that omit it. Standalone tournaments (season_id null) get no column
-- and fall back to DEFAULT_CONTENT_LOCALE ('de') in code.
-- Adds a column only: no GRANT, no new object (migration-api-grants guard).
-- Written only — applied by the APPLY package through the repo's migration
-- process (before draft-backend's 2026101012* files), never by hand.
ALTER TABLE public.seasons
  ADD COLUMN language text NOT NULL DEFAULT 'de'
  CONSTRAINT seasons_language_check CHECK (language IN ('de', 'en'));

COMMENT ON COLUMN public.seasons.language IS
  'Content language for viewerless text (de|en); viewers always see their own UI language';

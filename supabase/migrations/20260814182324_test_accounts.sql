-- Test accounts & test seasons isolation (spec §1)
--
-- Adds an explicit, DB-level marker for reusable dummy/test players and for
-- test-only leagues/seasons. The marker lets every public/global read path and
-- every all_time aggregate exclude test data, while test matches still function
-- normally inside their own test league.
--
-- Test players are identified by is_test_account = true (NOT by username prefix).
-- A match is treated as test data when its season is a test season OR when either
-- participant is a test account.

ALTER TABLE "public"."players"
  ADD COLUMN IF NOT EXISTS "is_test_account" boolean DEFAULT false NOT NULL;

ALTER TABLE "public"."seasons"
  ADD COLUMN IF NOT EXISTS "is_test_season" boolean DEFAULT false NOT NULL;

-- Partial indexes so the exclusion filter on hot public/global read paths is cheap.
CREATE INDEX IF NOT EXISTS "idx_players_test_account"
  ON "public"."players" ("id") WHERE "is_test_account" = true;

CREATE INDEX IF NOT EXISTS "idx_seasons_test_season"
  ON "public"."seasons" ("id") WHERE "is_test_season" = true;

COMMENT ON COLUMN "public"."players"."is_test_account" IS
  'True for reusable dummy/test players (e.g. EvoTest01-14). Excluded from all public/global surfaces; still usable inside explicitly test-marked leagues.';
COMMENT ON COLUMN "public"."seasons"."is_test_season" IS
  'True for leagues/seasons used only for testing. Matches in a test season, or any match involving a test account, are excluded from all global aggregates and public statistics.';

-- Exclude test data from the all_time game count (the usage% denominator) so
-- global usage statistics are not skewed by test matches. Tournament and league
-- scopes are unchanged: a test league still counts its own games locally.
CREATE OR REPLACE FUNCTION public.get_total_games_in_scope(
  p_scope_type public.aggregate_scope,
  p_scope_id uuid
) RETURNS integer
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT count(*)::int
  FROM public.games g
  JOIN public.matches m ON m.id = g.match_id
  WHERE m.status <> 'scheduled'
    AND (
      p_scope_type = 'all_time'
      OR (p_scope_type = 'tournament' AND m.tournament_id = p_scope_id)
      OR (
        p_scope_type = 'league'
        AND m.tournament_id IN (
          SELECT t.id FROM public.tournaments t WHERE t.season_id = p_scope_id
        )
      )
    )
    AND (
      p_scope_type <> 'all_time'
      OR (
        NOT EXISTS (
          SELECT 1 FROM public.tournaments t
          JOIN public.seasons s ON s.id = t.season_id
          WHERE t.id = m.tournament_id AND s.is_test_season = true
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.players p
          WHERE p.id IN (m.player_1_id, m.player_2_id) AND p.is_test_account = true
        )
      )
    );
$$;

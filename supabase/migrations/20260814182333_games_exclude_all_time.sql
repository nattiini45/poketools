-- Persist the all_time test-data gate on the games row (Task T2 carry-over).
--
-- `exclude_all_time` is computed ONCE at game-creation time and frozen. The
-- aggregate increment (aggregate-queue.processJob), rollback
-- (game-pipeline.rollbackAndDeleteGame / editGame), and rebuild
-- (aggregate-rebuild.rebuildAggregatesForScope) paths read this persisted
-- value instead of recomputing shouldExcludeFromAllTime() at read time. This
-- keeps the all_time test-data gate symmetric: flipping is_test_account /
-- is_test_season flags AFTER a match exists can no longer cause all_time
-- aggregate drift, because every game carries the decision it was created
-- with. The column mirrors the logic in shouldExcludeFromAllTime(): a game is
-- excluded when its match's season is a test season OR either participant is a
-- test account.

ALTER TABLE "public"."games"
  ADD COLUMN IF NOT EXISTS "exclude_all_time" boolean DEFAULT false NOT NULL;

COMMENT ON COLUMN "public"."games"."exclude_all_time" IS
  'Frozen at game-creation: true when the game''s match is test data (its season is_test_season OR either participant is_test_account). Read by the all_time aggregate increment/rollback/rebuild paths so the test-data gate stays symmetric and historical games keep the decision they were created with.';

-- Backfill existing rows: mark true where the game's match's season is a test
-- season OR either participant is a test account — mirroring
-- shouldExcludeFromAllTime() exactly.
UPDATE "public"."games" g
  SET "exclude_all_time" = true
  WHERE EXISTS (
        SELECT 1
        FROM "public"."matches" m
        JOIN "public"."tournaments" t ON t.id = m.tournament_id
        JOIN "public"."seasons" s ON s.id = t.season_id
        WHERE m.id = g.match_id AND s.is_test_season = true
      )
     OR EXISTS (
        SELECT 1
        FROM "public"."matches" m
        JOIN "public"."players" p ON p.id = m.player_1_id
        WHERE m.id = g.match_id AND p.is_test_account = true
      )
     OR EXISTS (
        SELECT 1
        FROM "public"."matches" m
        JOIN "public"."players" p ON p.id = m.player_2_id
        WHERE m.id = g.match_id AND p.is_test_account = true
      );
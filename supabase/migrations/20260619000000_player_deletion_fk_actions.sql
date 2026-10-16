-- Player deletion: make the players FK graph deletable.
--
-- Deleting a player ran a bare DELETE on `players`, but ~19 tables referenced
-- players with the Postgres default ON DELETE NO ACTION, so any dependent row
-- raised a foreign-key violation (SQLSTATE 23503) surfaced as a generic 500.
--
-- Policy (see docs / approved plan): clean-delete unused accounts by cascading
-- their owned/personal data, preserve shared content by nulling attribution,
-- and leave NOT NULL competitive references blocking on purpose — the delete
-- route pre-checks those and returns a clear 409 ("suspend or ban instead").
--
-- No column changes NOT NULL -> nullable here, so src/types/database.ts is
-- unaffected (CASCADE / SET NULL on already-nullable columns only).

-- ── Owned / personal data → ON DELETE CASCADE ───────────────────────────────

ALTER TABLE "public"."teams" DROP CONSTRAINT "teams_player_id_fkey";
ALTER TABLE "public"."teams" ADD CONSTRAINT "teams_player_id_fkey"
  FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE CASCADE;

ALTER TABLE "public"."battle_stats" DROP CONSTRAINT "battle_stats_player_id_fkey";
ALTER TABLE "public"."battle_stats" ADD CONSTRAINT "battle_stats_player_id_fkey"
  FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE CASCADE;

ALTER TABLE "public"."player_aggregates" DROP CONSTRAINT "player_aggregates_player_id_fkey";
ALTER TABLE "public"."player_aggregates" ADD CONSTRAINT "player_aggregates_player_id_fkey"
  FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE CASCADE;

ALTER TABLE "public"."draft_picks" DROP CONSTRAINT "draft_picks_player_id_fkey";
ALTER TABLE "public"."draft_picks" ADD CONSTRAINT "draft_picks_player_id_fkey"
  FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE CASCADE;

ALTER TABLE "public"."match_prep_teams" DROP CONSTRAINT "match_prep_teams_player_id_fkey";
ALTER TABLE "public"."match_prep_teams" ADD CONSTRAINT "match_prep_teams_player_id_fkey"
  FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE CASCADE;

ALTER TABLE "public"."ai_generations" DROP CONSTRAINT "ai_generations_player_id_fkey";
ALTER TABLE "public"."ai_generations" ADD CONSTRAINT "ai_generations_player_id_fkey"
  FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE CASCADE;

ALTER TABLE "public"."broadcast_presets" DROP CONSTRAINT "broadcast_presets_owner_id_fkey";
ALTER TABLE "public"."broadcast_presets" ADD CONSTRAINT "broadcast_presets_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "public"."players"("id") ON DELETE CASCADE;

ALTER TABLE "public"."broadcast_moments" DROP CONSTRAINT "broadcast_moments_created_by_fkey";
ALTER TABLE "public"."broadcast_moments" ADD CONSTRAINT "broadcast_moments_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "public"."players"("id") ON DELETE CASCADE;

-- ── Shared content / historical refs (already nullable) → ON DELETE SET NULL ─

ALTER TABLE "public"."rulesets" DROP CONSTRAINT "rulesets_created_by_fkey";
ALTER TABLE "public"."rulesets" ADD CONSTRAINT "rulesets_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "public"."players"("id") ON DELETE SET NULL;

ALTER TABLE "public"."season_storylines" DROP CONSTRAINT "season_storylines_created_by_fkey";
ALTER TABLE "public"."season_storylines" ADD CONSTRAINT "season_storylines_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "public"."players"("id") ON DELETE SET NULL;

ALTER TABLE "public"."draft_pool_templates" DROP CONSTRAINT "draft_pool_templates_created_by_fkey";
ALTER TABLE "public"."draft_pool_templates" ADD CONSTRAINT "draft_pool_templates_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "public"."players"("id") ON DELETE SET NULL;

ALTER TABLE "public"."games" DROP CONSTRAINT "games_winner_id_fkey";
ALTER TABLE "public"."games" ADD CONSTRAINT "games_winner_id_fkey"
  FOREIGN KEY ("winner_id") REFERENCES "public"."players"("id") ON DELETE SET NULL;

ALTER TABLE "public"."matches" DROP CONSTRAINT "matches_winner_id_fkey";
ALTER TABLE "public"."matches" ADD CONSTRAINT "matches_winner_id_fkey"
  FOREIGN KEY ("winner_id") REFERENCES "public"."players"("id") ON DELETE SET NULL;

ALTER TABLE "public"."matches" DROP CONSTRAINT "matches_submitter_id_fkey";
ALTER TABLE "public"."matches" ADD CONSTRAINT "matches_submitter_id_fkey"
  FOREIGN KEY ("submitter_id") REFERENCES "public"."players"("id") ON DELETE SET NULL;

-- ── Left blocking on purpose (NOT NULL competitive refs) ────────────────────
-- matches.player_1_id, matches.player_2_id, match_proposals.proposer_id,
-- match_proposals.responder_id, rating_history.opponent_id remain NO ACTION.
-- The delete route pre-checks matches/proposals and returns 409 so admins
-- suspend/ban competitors instead of destroying opponents' tournament history.

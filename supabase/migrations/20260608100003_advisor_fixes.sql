-- Resolve Supabase database linter security and performance advisories.

-- ---------------------------------------------------------------------------
-- Security: service-role-only RLS policies on private tables (lint 0008)
-- ---------------------------------------------------------------------------

CREATE POLICY "Service role full access admin_export_limits"
  ON public.admin_export_limits FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access aggregate_jobs"
  ON public.aggregate_jobs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access ai_avatar_gallery"
  ON public.ai_avatar_gallery FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access ai_generations"
  ON public.ai_generations FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access audit_log"
  ON public.audit_log FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access avatar_generations"
  ON public.avatar_generations FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access broadcast_presets"
  ON public.broadcast_presets FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access cast_sessions"
  ON public.cast_sessions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access discord_webhooks"
  ON public.discord_webhooks FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access draft_replay_events"
  ON public.draft_replay_events FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access legacy_standings"
  ON public.legacy_standings FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access match_analyses"
  ON public.match_analyses FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access match_prep_analyses"
  ON public.match_prep_analyses FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access match_prep_teams"
  ON public.match_prep_teams FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access match_proposals"
  ON public.match_proposals FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access resource_admins"
  ON public.resource_admins FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access season_storylines"
  ON public.season_storylines FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access social_integrations"
  ON public.social_integrations FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access teams"
  ON public.teams FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access tournament_reports"
  ON public.tournament_reports FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access wiki_note_reports"
  ON public.wiki_note_reports FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Security: pin function search_path (lint 0011)
-- ---------------------------------------------------------------------------

ALTER FUNCTION public.update_updated_at() SET search_path = public;
ALTER FUNCTION public.check_and_record_avatar_generation(uuid, integer) SET search_path = public;
ALTER FUNCTION public.merge_move_counts(jsonb, jsonb) SET search_path = public;
ALTER FUNCTION public.upsert_aggregate(public.aggregate_scope, uuid, text, integer, integer, integer, integer, integer, integer, integer, jsonb) SET search_path = public;
ALTER FUNCTION public.upsert_player_aggregate(public.aggregate_scope, uuid, uuid, text, integer, integer, integer, integer, integer, integer, integer, jsonb) SET search_path = public;
ALTER FUNCTION public.batch_update_seeds(uuid, jsonb) SET search_path = public;
ALTER FUNCTION public.batch_upsert_aggregates(jsonb) SET search_path = public;
ALTER FUNCTION public.batch_upsert_player_aggregates(jsonb) SET search_path = public;
ALTER FUNCTION public.subtract_move_counts(jsonb, jsonb) SET search_path = public;
ALTER FUNCTION public.batch_decrement_aggregates(jsonb) SET search_path = public;
ALTER FUNCTION public.batch_decrement_player_aggregates(jsonb) SET search_path = public;
ALTER FUNCTION public.check_and_record_ai_generation(uuid, text, integer) SET search_path = public;
ALTER FUNCTION public.claim_aggregate_jobs(integer) SET search_path = public;
ALTER FUNCTION public.reclaim_stale_aggregate_jobs() SET search_path = public;
ALTER FUNCTION public.cancel_aggregate_jobs_for_game(uuid) SET search_path = public;
ALTER FUNCTION public.prevent_audit_log_mutation() SET search_path = public;
ALTER FUNCTION public.check_and_record_admin_export(uuid, integer) SET search_path = public;
ALTER FUNCTION public.get_total_games_in_scope(public.aggregate_scope, uuid) SET search_path = public;

-- ---------------------------------------------------------------------------
-- Security: restrict SECURITY DEFINER RPC exposure (lint 0028/0029)
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.check_and_record_admin_export(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_and_record_admin_export(uuid, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_record_admin_export(uuid, integer) TO service_role;

REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO service_role;

-- ---------------------------------------------------------------------------
-- Security: remove broad storage SELECT policies on public buckets (lint 0025)
-- Public buckets serve objects by URL; listing is not required.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Public read access on avatars" ON storage.objects;
DROP POLICY IF EXISTS "Public read access on social-images" ON storage.objects;

-- ---------------------------------------------------------------------------
-- Performance: indexes for unindexed foreign keys (lint 0001)
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_broadcast_moments_created_by
  ON public.broadcast_moments (created_by);

CREATE INDEX IF NOT EXISTS idx_cast_sessions_player1_id
  ON public.cast_sessions (player1_id);

CREATE INDEX IF NOT EXISTS idx_cast_sessions_player2_id
  ON public.cast_sessions (player2_id);

CREATE INDEX IF NOT EXISTS idx_cast_sessions_season_id
  ON public.cast_sessions (season_id);

CREATE INDEX IF NOT EXISTS idx_cast_sessions_tournament_id
  ON public.cast_sessions (tournament_id);

CREATE INDEX IF NOT EXISTS idx_draft_picks_player_id
  ON public.draft_picks (player_id);

CREATE INDEX IF NOT EXISTS idx_draft_pool_templates_created_by
  ON public.draft_pool_templates (created_by);

CREATE INDEX IF NOT EXISTS idx_draft_pools_season_id
  ON public.draft_pools (season_id);

CREATE INDEX IF NOT EXISTS idx_draft_replay_events_pick_id
  ON public.draft_replay_events (pick_id);

CREATE INDEX IF NOT EXISTS idx_evolution_tiers_player_id
  ON public.evolution_tiers (player_id);

CREATE INDEX IF NOT EXISTS idx_games_winner_id
  ON public.games (winner_id);

CREATE INDEX IF NOT EXISTS idx_legacy_standings_player_id
  ON public.legacy_standings (player_id);

CREATE INDEX IF NOT EXISTS idx_match_prep_analyses_player_id
  ON public.match_prep_analyses (player_id);

CREATE INDEX IF NOT EXISTS idx_match_proposals_proposer_id
  ON public.match_proposals (proposer_id);

CREATE INDEX IF NOT EXISTS idx_matches_player_1_id
  ON public.matches (player_1_id);

CREATE INDEX IF NOT EXISTS idx_matches_player_2_id
  ON public.matches (player_2_id);

CREATE INDEX IF NOT EXISTS idx_matches_submitter_id
  ON public.matches (submitter_id);

CREATE INDEX IF NOT EXISTS idx_matches_winner_id
  ON public.matches (winner_id);

CREATE INDEX IF NOT EXISTS idx_player_achievements_achievement_id
  ON public.player_achievements (achievement_id);

CREATE INDEX IF NOT EXISTS idx_player_streaks_last_match_id
  ON public.player_streaks (last_match_id);

CREATE INDEX IF NOT EXISTS idx_rating_history_opponent_id
  ON public.rating_history (opponent_id);

CREATE INDEX IF NOT EXISTS idx_rounds_tournament_id
  ON public.rounds (tournament_id);

CREATE INDEX IF NOT EXISTS idx_rulesets_created_by
  ON public.rulesets (created_by);

CREATE INDEX IF NOT EXISTS idx_season_participants_player_id
  ON public.season_participants (player_id);

CREATE INDEX IF NOT EXISTS idx_season_storylines_created_by
  ON public.season_storylines (created_by);

CREATE INDEX IF NOT EXISTS idx_seasons_ruleset_id
  ON public.seasons (ruleset_id);

CREATE INDEX IF NOT EXISTS idx_teams_draft_pool_id
  ON public.teams (draft_pool_id);

CREATE INDEX IF NOT EXISTS idx_teams_match_id
  ON public.teams (match_id);

CREATE INDEX IF NOT EXISTS idx_teams_season_id
  ON public.teams (season_id);

CREATE INDEX IF NOT EXISTS idx_tournament_group_members_player_id
  ON public.tournament_group_members (player_id);

CREATE INDEX IF NOT EXISTS idx_tournament_participants_player_id
  ON public.tournament_participants (player_id);

CREATE INDEX IF NOT EXISTS idx_tournament_reports_round_id
  ON public.tournament_reports (round_id);

CREATE INDEX IF NOT EXISTS idx_tournaments_ruleset_id
  ON public.tournaments (ruleset_id);

CREATE INDEX IF NOT EXISTS idx_wiki_note_reports_reporter_id
  ON public.wiki_note_reports (reporter_id);

CREATE INDEX IF NOT EXISTS idx_wiki_notes_approved_by
  ON public.wiki_notes (approved_by);

CREATE INDEX IF NOT EXISTS idx_wiki_notes_author_id
  ON public.wiki_notes (author_id);

CREATE INDEX IF NOT EXISTS idx_wiki_notes_rejected_by
  ON public.wiki_notes (rejected_by);

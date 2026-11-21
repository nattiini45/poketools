-- Plan 4.C step 6: once the storage generation leaves `legacy`, a league's stages live in league_phases, so no new
-- season-owned row may appear in public.tournaments. Standalone tournaments (season_id NULL) keep working in every mode;
-- the frozen modes already refuse every legacy write (20261120110000_phase_legacy_write_freeze.sql), so this guard is
-- what holds in `phase` mode. An INSERT with a season, or an UPDATE that sets one, is refused with
-- phase_storage_not_ready. Only a session that logged in as the schema owner is exempt (current_user and session_user
-- both postgres, as in 20261120120000_phase_storage_fence_session.sql): the transfer's inverse writes season-owned
-- rows back, and an API request keeps session_user = authenticator even inside a definer function or a cascade.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.phase_storage__legacy_league_tournament()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_mode text;
BEGIN
  IF NOT (current_user = 'postgres' AND session_user = 'postgres') THEN
    v_mode := public.phase_storage_mode();
    IF v_mode IS DISTINCT FROM 'legacy' THEN
      RAISE EXCEPTION 'phase_storage_not_ready' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('mode', v_mode, 'table', 'tournaments', 'season_owned', true)::text;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.phase_storage__legacy_league_tournament() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_storage__legacy_league_tournament() TO service_role;

CREATE TRIGGER trg_phase_storage_legacy_league_tournament BEFORE INSERT OR UPDATE OF season_id ON public.tournaments
FOR EACH ROW WHEN (NEW.season_id IS NOT NULL) EXECUTE FUNCTION public.phase_storage__legacy_league_tournament();

-- The trigger fires on INSERT into an owned table, so the league trash inventory lists it.
CREATE OR REPLACE FUNCTION public.league_trash__insert_guards()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT ARRAY[
    'draft_pools.trg_draft_pools_guard_group',
    'evolution_tracker.trg_evolution_tracker_group',
    'format_challenges.trg_format_challenges_notify',
    'format_challenges.trg_phase_storage_pointer_guard',
    'games.trg_games_global_replay_check',
    'games.trg_games_global_replay_lock',
    'league_phases.trg_phase_storage_guard',
    'phase_admins.trg_phase_storage_guard',
    'phase_battle_stats.trg_phase_storage_guard',
    'phase_broadcast_moments.trg_phase_storage_guard',
    'phase_cast_sessions.trg_phase_storage_guard',
    'phase_cast_sessions.trg_phase_cast_sessions_global_realtime_lock',
    'phase_cast_sessions.trg_phase_cast_sessions_global_realtime_check',
    'phase_discord_webhooks.trg_phase_storage_guard',
    'phase_epb_animation_views.trg_phase_storage_guard',
    'phase_games.trg_phase_games_global_replay_check',
    'phase_games.trg_phase_games_global_replay_lock',
    'phase_games.trg_phase_storage_guard',
    'phase_group_members.trg_phase_group_members_guard',
    'phase_group_members.trg_phase_storage_guard',
    'phase_groups.trg_phase_groups_guard',
    'phase_groups.trg_phase_storage_guard',
    'phase_match_analyses.trg_phase_storage_guard',
    'phase_match_evolution_snapshots.trg_phase_storage_guard',
    'phase_match_outcomes.trg_phase_storage_guard',
    'phase_match_prep_analyses.trg_phase_storage_guard',
    'phase_match_prep_teams.trg_phase_storage_guard',
    'phase_match_proposals.trg_phase_storage_guard',
    'phase_matches.trg_phase_storage_guard',
    'phase_participants.trg_phase_participants_lock',
    'phase_participants.trg_phase_storage_guard',
    'phase_reports.trg_phase_storage_guard',
    'phase_rounds.trg_phase_rounds_league_groups_guard',
    'phase_rounds.trg_phase_storage_guard',
    'phase_social_integrations.trg_phase_storage_guard',
    'phase_teams.trg_phase_storage_guard',
    'phase_teams.trg_phase_teams_global_share_lock',
    'phase_teams.trg_phase_teams_global_share_check',
    'phase_wiki_note_reports.trg_phase_storage_guard',
    'phase_wiki_notes.trg_phase_storage_guard',
    'rounds.trg_rounds_league_groups_guard',
    'season_formats.trg_season_formats_revision',
    'season_group_members.trg_season_group_members_guard',
    'season_groups.trg_season_groups_guard',
    'season_participants.trg_season_participants_group_guard',
    'teams.trg_phase_storage_pointer_guard',
    'teams.trg_teams_global_share_lock',
    'teams.trg_teams_global_share_check',
    'tournament_groups.trg_tournament_groups_guard_season_group',
    'battle_stats.trg_phase_storage_legacy_freeze',
    'broadcast_moments.trg_phase_storage_legacy_freeze',
    'discord_webhooks.trg_phase_storage_legacy_freeze',
    'epb_animation_views.trg_phase_storage_legacy_freeze',
    'format_challenges.trg_phase_storage_legacy_freeze',
    'games.trg_phase_storage_legacy_freeze',
    'match_analyses.trg_phase_storage_legacy_freeze',
    'match_evolution_snapshots.trg_phase_storage_legacy_freeze',
    'match_outcomes.trg_phase_storage_legacy_freeze',
    'match_prep_analyses.trg_phase_storage_legacy_freeze',
    'match_prep_teams.trg_phase_storage_legacy_freeze',
    'match_proposals.trg_phase_storage_legacy_freeze',
    'matches.trg_phase_storage_legacy_freeze',
    'resource_admins.trg_phase_storage_legacy_freeze',
    'rounds.trg_phase_storage_legacy_freeze',
    'social_integrations.trg_phase_storage_legacy_freeze',
    'teams.trg_phase_storage_legacy_freeze',
    'tournament_group_members.trg_phase_storage_legacy_freeze',
    'tournament_groups.trg_phase_storage_legacy_freeze',
    'tournament_participants.trg_phase_storage_legacy_freeze',
    'tournament_reports.trg_phase_storage_legacy_freeze',
    'tournaments.trg_phase_storage_legacy_freeze',
    'tournaments.trg_phase_storage_legacy_league_tournament',
    'wiki_note_reports.trg_phase_storage_legacy_freeze',
    'wiki_notes.trg_phase_storage_legacy_freeze'
  ]::text[];
$$;
REVOKE ALL ON FUNCTION public.league_trash__insert_guards() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.league_trash__insert_guards() TO service_role;

COMMIT;

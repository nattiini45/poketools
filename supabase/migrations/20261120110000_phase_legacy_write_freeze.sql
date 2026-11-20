-- P6 legacy write freeze (plan 4.B.2): while the storage generation is frozen, no write reaches the tables the transfer
-- reads or rewrites on the legacy side, from any deployment old or new. The phase tables are already fenced outside
-- `phase` mode by trg_phase_storage_guard (20261117102000_phase_storage_fence.sql); this is the legacy half.
--
-- One statement-level trigger per table: it reads the mode once per statement through phase_storage_mode(), which takes
-- the mode row FOR SHARE, so a writer that got in before the freeze holds the row until it commits and
-- phase_storage_transition('legacy', 'frozen_legacy') waits for it (lock_timeout bounds the wait). Legacy and phase
-- modes pass; standalone tournaments keep writing in phase mode. Only a session that logged in as the schema owner (the
-- operator connection and the transfer procedures it runs) is exempt. The test is on session_user as well as
-- current_user: PostgreSQL runs ON DELETE CASCADE / SET NULL actions as the referencing table's owner, so inside a
-- cascade from an API request current_user is postgres while session_user stays authenticator. A service-role DELETE
-- on an unfenced parent (players) therefore cannot reach a fenced child through its foreign key.
--
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.phase_storage__legacy_freeze()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_mode text;
BEGIN
  IF NOT (current_user = 'postgres' AND session_user = 'postgres') THEN
    v_mode := public.phase_storage_mode();
    IF v_mode IN ('frozen_legacy', 'frozen_phase') THEN
      RAISE EXCEPTION 'phase_storage_not_ready' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('mode', v_mode, 'table', TG_TABLE_NAME, 'op', TG_OP)::text;
    END IF;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.phase_storage__legacy_freeze() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase_storage__legacy_freeze() TO service_role;

CREATE TRIGGER trg_phase_storage_legacy_freeze BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.tournaments
FOR EACH STATEMENT EXECUTE FUNCTION public.phase_storage__legacy_freeze();

CREATE TRIGGER trg_phase_storage_legacy_freeze BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.tournament_participants
FOR EACH STATEMENT EXECUTE FUNCTION public.phase_storage__legacy_freeze();

CREATE TRIGGER trg_phase_storage_legacy_freeze BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.tournament_groups
FOR EACH STATEMENT EXECUTE FUNCTION public.phase_storage__legacy_freeze();

CREATE TRIGGER trg_phase_storage_legacy_freeze BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.tournament_group_members
FOR EACH STATEMENT EXECUTE FUNCTION public.phase_storage__legacy_freeze();

CREATE TRIGGER trg_phase_storage_legacy_freeze BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.rounds
FOR EACH STATEMENT EXECUTE FUNCTION public.phase_storage__legacy_freeze();

CREATE TRIGGER trg_phase_storage_legacy_freeze BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.matches
FOR EACH STATEMENT EXECUTE FUNCTION public.phase_storage__legacy_freeze();

CREATE TRIGGER trg_phase_storage_legacy_freeze BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.games
FOR EACH STATEMENT EXECUTE FUNCTION public.phase_storage__legacy_freeze();

CREATE TRIGGER trg_phase_storage_legacy_freeze BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.battle_stats
FOR EACH STATEMENT EXECUTE FUNCTION public.phase_storage__legacy_freeze();

CREATE TRIGGER trg_phase_storage_legacy_freeze BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.match_outcomes
FOR EACH STATEMENT EXECUTE FUNCTION public.phase_storage__legacy_freeze();

CREATE TRIGGER trg_phase_storage_legacy_freeze BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.match_analyses
FOR EACH STATEMENT EXECUTE FUNCTION public.phase_storage__legacy_freeze();

CREATE TRIGGER trg_phase_storage_legacy_freeze BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.match_prep_analyses
FOR EACH STATEMENT EXECUTE FUNCTION public.phase_storage__legacy_freeze();

CREATE TRIGGER trg_phase_storage_legacy_freeze BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.match_prep_teams
FOR EACH STATEMENT EXECUTE FUNCTION public.phase_storage__legacy_freeze();

CREATE TRIGGER trg_phase_storage_legacy_freeze BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.match_proposals
FOR EACH STATEMENT EXECUTE FUNCTION public.phase_storage__legacy_freeze();

CREATE TRIGGER trg_phase_storage_legacy_freeze BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.match_evolution_snapshots
FOR EACH STATEMENT EXECUTE FUNCTION public.phase_storage__legacy_freeze();

CREATE TRIGGER trg_phase_storage_legacy_freeze BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.epb_animation_views
FOR EACH STATEMENT EXECUTE FUNCTION public.phase_storage__legacy_freeze();

CREATE TRIGGER trg_phase_storage_legacy_freeze BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.broadcast_moments
FOR EACH STATEMENT EXECUTE FUNCTION public.phase_storage__legacy_freeze();

CREATE TRIGGER trg_phase_storage_legacy_freeze BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.rating_history
FOR EACH STATEMENT EXECUTE FUNCTION public.phase_storage__legacy_freeze();

CREATE TRIGGER trg_phase_storage_legacy_freeze BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.tournament_reports
FOR EACH STATEMENT EXECUTE FUNCTION public.phase_storage__legacy_freeze();

CREATE TRIGGER trg_phase_storage_legacy_freeze BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.aggregate_jobs
FOR EACH STATEMENT EXECUTE FUNCTION public.phase_storage__legacy_freeze();

CREATE TRIGGER trg_phase_storage_legacy_freeze BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.aggregates
FOR EACH STATEMENT EXECUTE FUNCTION public.phase_storage__legacy_freeze();

CREATE TRIGGER trg_phase_storage_legacy_freeze BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.player_aggregates
FOR EACH STATEMENT EXECUTE FUNCTION public.phase_storage__legacy_freeze();

CREATE TRIGGER trg_phase_storage_legacy_freeze BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.teams
FOR EACH STATEMENT EXECUTE FUNCTION public.phase_storage__legacy_freeze();

CREATE TRIGGER trg_phase_storage_legacy_freeze BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.cast_sessions
FOR EACH STATEMENT EXECUTE FUNCTION public.phase_storage__legacy_freeze();

CREATE TRIGGER trg_phase_storage_legacy_freeze BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.resource_admins
FOR EACH STATEMENT EXECUTE FUNCTION public.phase_storage__legacy_freeze();

CREATE TRIGGER trg_phase_storage_legacy_freeze BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.discord_webhooks
FOR EACH STATEMENT EXECUTE FUNCTION public.phase_storage__legacy_freeze();

CREATE TRIGGER trg_phase_storage_legacy_freeze BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.social_integrations
FOR EACH STATEMENT EXECUTE FUNCTION public.phase_storage__legacy_freeze();

CREATE TRIGGER trg_phase_storage_legacy_freeze BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.wiki_notes
FOR EACH STATEMENT EXECUTE FUNCTION public.phase_storage__legacy_freeze();

CREATE TRIGGER trg_phase_storage_legacy_freeze BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.wiki_note_reports
FOR EACH STATEMENT EXECUTE FUNCTION public.phase_storage__legacy_freeze();

CREATE TRIGGER trg_phase_storage_legacy_freeze BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.agent_suggestions
FOR EACH STATEMENT EXECUTE FUNCTION public.phase_storage__legacy_freeze();

CREATE TRIGGER trg_phase_storage_legacy_freeze BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.player_streaks
FOR EACH STATEMENT EXECUTE FUNCTION public.phase_storage__legacy_freeze();

CREATE TRIGGER trg_phase_storage_legacy_freeze BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.format_challenges
FOR EACH STATEMENT EXECUTE FUNCTION public.phase_storage__legacy_freeze();

-- The freeze triggers fire on INSERT, so the owned tables' ones join the reviewed insert guards. They refuse a frozen
-- write and change no row; a trash restore outside a freeze is unaffected.
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
    'wiki_note_reports.trg_phase_storage_legacy_freeze',
    'wiki_notes.trg_phase_storage_legacy_freeze'
  ]::text[];
$$;
REVOKE ALL ON FUNCTION public.league_trash__insert_guards() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.league_trash__insert_guards() TO service_role;

COMMIT;

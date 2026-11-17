BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE FUNCTION public.cast_global_realtime_lock() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_key uuid; v_other uuid;
BEGIN
  FOR v_key IN
    SELECT DISTINCT k FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'DELETE' THEN NEW.realtime_key END,
      CASE WHEN TG_OP <> 'INSERT' THEN OLD.realtime_key END
    ]) x(k) WHERE k IS NOT NULL ORDER BY k
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_key::text, 419005));
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF TG_TABLE_NAME = 'cast_sessions' THEN
    SELECT id INTO v_other FROM public.phase_cast_sessions WHERE realtime_key = NEW.realtime_key;
  ELSE
    SELECT id INTO v_other FROM public.cast_sessions WHERE realtime_key = NEW.realtime_key;
  END IF;
  IF v_other IS NOT NULL AND v_other <> NEW.id THEN
    RAISE EXCEPTION 'duplicate key violates unique constraint "cast_sessions_global_realtime_key"'
      USING ERRCODE = '23505', CONSTRAINT = 'cast_sessions_global_realtime_key';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.cast_global_realtime_check() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.cast_sessions c JOIN public.phase_cast_sessions p ON p.realtime_key = c.realtime_key
    WHERE c.realtime_key = NEW.realtime_key
  ) THEN
    RAISE EXCEPTION 'duplicate key violates unique constraint "cast_sessions_global_realtime_key"'
      USING ERRCODE = '23505', CONSTRAINT = 'cast_sessions_global_realtime_key';
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER trg_cast_sessions_global_realtime_lock
BEFORE INSERT OR UPDATE OF realtime_key, id OR DELETE ON public.cast_sessions
FOR EACH ROW EXECUTE FUNCTION public.cast_global_realtime_lock();
CREATE TRIGGER trg_phase_cast_sessions_global_realtime_lock
BEFORE INSERT OR UPDATE OF realtime_key, id OR DELETE ON public.phase_cast_sessions
FOR EACH ROW EXECUTE FUNCTION public.cast_global_realtime_lock();
CREATE CONSTRAINT TRIGGER trg_cast_sessions_global_realtime_check
AFTER INSERT OR UPDATE OF realtime_key, id ON public.cast_sessions
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.cast_global_realtime_check();
CREATE CONSTRAINT TRIGGER trg_phase_cast_sessions_global_realtime_check
AFTER INSERT OR UPDATE OF realtime_key, id ON public.phase_cast_sessions
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.cast_global_realtime_check();

REVOKE ALL ON FUNCTION public.cast_global_realtime_lock(), public.cast_global_realtime_check()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cast_global_realtime_lock(), public.cast_global_realtime_check()
  TO service_role;

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
    'tournament_groups.trg_tournament_groups_guard_season_group'
  ]::text[];
$$;
REVOKE ALL ON FUNCTION public.league_trash__insert_guards() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.league_trash__insert_guards() TO service_role;
COMMIT;

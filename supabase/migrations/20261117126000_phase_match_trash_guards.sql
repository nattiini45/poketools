BEGIN;
SET LOCAL lock_timeout = '5s';

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
    'phase_wiki_note_reports.trg_phase_storage_guard',
    'phase_wiki_notes.trg_phase_storage_guard',
    'rounds.trg_rounds_league_groups_guard',
    'season_formats.trg_season_formats_revision',
    'season_group_members.trg_season_group_members_guard',
    'season_groups.trg_season_groups_guard',
    'season_participants.trg_season_participants_group_guard',
    'teams.trg_phase_storage_pointer_guard',
    'tournament_groups.trg_tournament_groups_guard_season_group'
  ]::text[];
$$;

CREATE OR REPLACE FUNCTION public.league_trash__assert_inventory()
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_missing text[]; v_gone text[]; v_ext text[]; v_guards text[];
BEGIN
  SELECT array_agg(DISTINCT i.rel) INTO v_gone FROM public.league_trash__inventory() i WHERE to_regclass('public.' || quote_ident(i.rel)) IS NULL;
  IF v_gone IS NOT NULL THEN
    RAISE EXCEPTION 'LEAGUE_TRASH_INVENTORY_STALE' USING ERRCODE = 'P0001', DETAIL = to_jsonb(v_gone)::text;
  END IF;
  SELECT array_agg(DISTINCT c.conrelid::regclass::text) INTO v_missing
    FROM pg_constraint c
   WHERE c.contype = 'f'
     AND c.confrelid IN (SELECT to_regclass('public.' || quote_ident(i.rel)) FROM public.league_trash__inventory() i WHERE i.cls = 'owned')
     AND c.conrelid::regclass::text NOT IN (SELECT i.rel FROM public.league_trash__inventory() i)
     AND c.conrelid::regclass::text NOT IN (SELECT p.rel FROM public.league_trash__pointers() p);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'LEAGUE_TRASH_INVENTORY_INCOMPLETE' USING ERRCODE = 'P0001', DETAIL = to_jsonb(v_missing)::text;
  END IF;
  SELECT array_agg(DISTINCT c.confrelid::regclass::text) INTO v_ext
    FROM pg_constraint c
   WHERE c.contype = 'f'
     AND c.conrelid IN (SELECT to_regclass('public.' || quote_ident(i.rel)) FROM public.league_trash__inventory() i WHERE i.cls = 'owned')
     AND c.confrelid::regclass::text NOT IN (SELECT i.rel FROM public.league_trash__inventory() i)
     AND c.confrelid::regclass::text NOT IN (SELECT e.parent FROM public.league_trash__external_parents() e);
  IF v_ext IS NOT NULL THEN
    RAISE EXCEPTION 'LEAGUE_TRASH_INVENTORY_INCOMPLETE' USING ERRCODE = 'P0001', DETAIL = to_jsonb(v_ext)::text;
  END IF;
  SELECT array_agg(c.relname || '.' || t.tgname ORDER BY c.relname, t.tgname)
    INTO v_guards
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND NOT t.tgisinternal
     AND (t.tgtype & 4) = 4
     AND c.relname IN (SELECT i.rel FROM public.league_trash__inventory() i WHERE i.cls = 'owned')
     AND c.relname || '.' || t.tgname <> ALL(public.league_trash__insert_guards());
  IF v_guards IS NOT NULL THEN
    RAISE EXCEPTION 'LEAGUE_TRASH_INSERT_GUARD_UNREVIEWED'
      USING ERRCODE = 'P0001', DETAIL = to_jsonb(v_guards)::text;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.league_trash__insert_guards() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.league_trash__insert_guards() TO service_role;

COMMIT;

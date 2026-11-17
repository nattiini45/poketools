BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.league_trash__inventory()
RETURNS TABLE (rel text, cls text, pred text)
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT * FROM (VALUES
    ('seasons',                   'owned',   'id = $1'),
    ('season_participants',       'owned',   'season_id = $1'),
    ('season_groups',             'owned',   'season_id = $1'),
    ('season_group_members',      'owned',   'season_id = $1'),
    ('season_formats',            'owned',   'season_id = $1'),
    ('format_relation_links',     'owned',   'season_id = $1'),
    ('format_resource_items',     'owned',   'season_id = $1'),
    ('format_action_submissions', 'owned',   'season_id = $1'),
    ('format_event_log',          'owned',   'season_id = $1'),
    ('format_flags',              'owned',   'season_id = $1'),
    ('format_player_attrs',       'owned',   'season_id = $1'),
    ('format_track_progress',     'owned',   'season_id = $1'),
    ('format_checks',             'owned',   'season_id = $1'),
    ('format_adjustments',        'owned',   'season_id = $1'),
    ('format_challenges',         'owned',   'season_id = $1'),
    ('format_notifications',      'owned',   'season_id = $1'),
    ('format_rules',              'owned',   'season_id = $1'),
    ('evolution_tiers',           'owned',   'season_id = $1'),
    ('draft_tier_limits',         'owned',   'season_id = $1'),
    ('draft_pool_entries',        'owned',   'season_id = $1'),
    ('legacy_standings',          'owned',   'season_id = $1'),
    ('epb_kill_credit_epochs',    'owned',   'season_id = $1'),
    ('epb_token_grants',          'owned',   'season_id = $1'),
    ('season_storylines',         'owned',   'season_id = $1'),
    ('tournaments',               'owned',   'season_id = $1'),
    ('tournament_participants',   'owned',   'tournament_id IN {phases}'),
    ('tournament_groups',         'owned',   'tournament_id IN {phases}'),
    ('tournament_group_members',  'owned',   'group_id IN {tgroups}'),
    ('rounds',                    'owned',   'tournament_id IN {phases}'),
    ('tournament_reports',        'owned',   'tournament_id IN {phases}'),
    ('matches',                   'owned',   'tournament_id IN {phases}'),
    ('match_outcomes',            'owned',   'match_id IN {matches}'),
    ('games',                     'owned',   'match_id IN {matches}'),
    ('battle_stats',              'owned',   'game_id IN {games}'),
    ('match_analyses',            'owned',   'match_id IN {matches}'),
    ('match_prep_analyses',       'owned',   'match_id IN {matches}'),
    ('match_prep_teams',          'owned',   'match_id IN {matches}'),
    ('match_proposals',           'owned',   'match_id IN {matches}'),
    ('match_evolution_snapshots', 'owned',   'match_id IN {matches}'),
    ('epb_animation_views',       'owned',   'match_id IN {matches}'),
    ('broadcast_moments',         'owned',   'match_id IN {matches} OR game_id IN {games}'),
    ('draft_pools',               'owned',   'season_id = $1'),
    ('draft_participants',        'owned',   'draft_pool_id IN {pools}'),
    ('draft_slots',               'owned',   'draft_pool_id IN {pools}'),
    ('draft_picks',               'owned',   'draft_pool_id IN {pools}'),
    ('draft_replay_events',       'owned',   'draft_pool_id IN {pools}'),
    ('draft_line_restrictions',   'owned',   'draft_pool_id IN {pools}'),
    ('redraft_slots',             'owned',   'season_id = $1 OR draft_pool_id IN {pools}'),
    ('redraft_submissions',       'owned',   'draft_pool_id IN {pools}'),
    ('evolution_tracker',         'owned',   'season_id = $1'),
    ('evolution_events',          'owned',   'season_id = $1'),
    ('evo_progress_log',          'owned',   'season_id = $1'),
    ('epb_draft_token_purchases', 'owned',   'season_id = $1'),
    ('epb_comeback_token_spends', 'owned',   'season_id = $1'),
    ('redraft_history',           'owned',   'season_id = $1'),
    ('redraft_trade_requests',    'owned',   'season_id = $1'),
    ('teams',                     'owned',   'season_id = $1 OR tournament_id IN {phases} OR draft_pool_id IN {pools}'),
    ('resource_admins',           'owned',   '(resource_type = ''season'' AND resource_id = $1) OR (resource_type = ''tournament'' AND resource_id IN {phases})'),
    ('discord_webhooks',          'owned',   '(scope_type = ''season'' AND scope_id = $1) OR (scope_type = ''tournament'' AND scope_id IN {phases})'),
    ('social_integrations',       'owned',   '(scope_type = ''season'' AND scope_id = $1) OR (scope_type = ''tournament'' AND scope_id IN {phases})'),
    ('wiki_notes',                'owned',   '(scope_type = ''league'' AND scope_id = $1) OR (scope_type = ''tournament'' AND scope_id IN {phases})'),
    ('wiki_note_reports',         'owned',   'note_id IN {notes}'),
    ('aggregates',                'derived', '(scope_type = ''league'' AND scope_id = $1) OR (scope_type = ''tournament'' AND scope_id IN {phases})'),
    ('player_aggregates',         'derived', '(scope_type = ''league'' AND scope_id = $1) OR (scope_type = ''tournament'' AND scope_id IN {phases})'),
    ('aggregate_jobs',            'derived', 'game_id IN {games}'),
    ('rating_history',            'derived', 'match_id IN {matches}'),
    ('league_phases', 'owned', 'season_id = $1'),
    ('phase_participants', 'owned', 'phase_id IN {native_phases}'),
    ('phase_groups', 'owned', 'phase_id IN {native_phases}'),
    ('phase_group_members', 'owned', 'group_id IN {phase_groups}'),
    ('phase_rounds', 'owned', 'phase_id IN {native_phases}'),
    ('phase_reports', 'owned', 'phase_id IN {native_phases}'),
    ('phase_matches', 'owned', 'phase_id IN {native_phases}'),
    ('phase_match_outcomes', 'owned', 'match_id IN {phase_matches}'),
    ('phase_games', 'owned', 'match_id IN {phase_matches}'),
    ('phase_battle_stats', 'owned', 'game_id IN {phase_games}'),
    ('phase_match_analyses', 'owned', 'match_id IN {phase_matches}'),
    ('phase_match_prep_analyses', 'owned', 'match_id IN {phase_matches}'),
    ('phase_match_prep_teams', 'owned', 'match_id IN {phase_matches}'),
    ('phase_match_proposals', 'owned', 'match_id IN {phase_matches}'),
    ('phase_match_evolution_snapshots', 'owned', 'match_id IN {phase_matches}'),
    ('phase_epb_animation_views', 'owned', 'match_id IN {phase_matches}'),
    ('phase_broadcast_moments', 'owned', 'match_id IN {phase_matches} OR game_id IN {phase_games}'),
    ('phase_teams', 'owned', 'phase_id IN {native_phases}'),
    ('phase_cast_sessions', 'owned', 'phase_id IN {native_phases}'),
    ('phase_admins', 'owned', 'phase_id IN {native_phases}'),
    ('phase_discord_webhooks', 'owned', 'phase_id IN {native_phases}'),
    ('phase_social_integrations', 'owned', 'phase_id IN {native_phases}'),
    ('phase_wiki_notes', 'owned', 'phase_id IN {native_phases}'),
    ('phase_wiki_note_reports', 'owned', 'note_id IN {phase_notes}'),
    ('phase_aggregates', 'derived', 'phase_id IN {native_phases}'),
    ('phase_player_aggregates', 'derived', 'phase_id IN {native_phases}'),
    ('phase_aggregate_jobs', 'derived', 'game_id IN {phase_games}'),
    ('phase_rating_history', 'derived', 'match_id IN {phase_matches}'),
    ('audit_log',                 'kept',    'false'),
    ('draft_action_log',          'kept',    'false')
  ) AS v(rel, cls, pred)
$$;

CREATE OR REPLACE FUNCTION public.league_trash__pointers()
RETURNS TABLE (rel text, col text, parent text, pred text, relink boolean)
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT * FROM (VALUES
    ('cast_sessions',     'season_id',           'seasons',     'season_id = $1',                                        true),
    ('cast_sessions',     'tournament_id',       'tournaments', 'tournament_id IN {phases}',                             true),
    ('cast_sessions',     'match_id',            'matches',     'match_id IN {matches}',                                 true),
    ('agent_suggestions', 'match_id',            'matches',     'match_id IN {matches}',                                 true),
    ('teams',             'match_id',            'matches',     'match_id IN {matches} AND id NOT IN {teams}',           true),
    ('teams',             'forked_from_team_id', 'teams',       'forked_from_team_id IN {teams} AND id NOT IN {teams}',  true),
    ('player_streaks',    'last_match_id',       'matches',     'last_match_id IN {matches}',                            false)
,
    ('cast_sessions', 'phase_id', 'league_phases', 'phase_id IN {native_phases}', true),
    ('cast_sessions', 'phase_match_id', 'phase_matches', 'phase_match_id IN {phase_matches}', true),
    ('agent_suggestions', 'phase_match_id', 'phase_matches', 'phase_match_id IN {phase_matches}', true),
    ('teams', 'phase_match_id', 'phase_matches', 'phase_match_id IN {phase_matches} AND id NOT IN {teams}', true),
    ('teams', 'forked_from_phase_team_id', 'phase_teams', 'forked_from_phase_team_id IN {phase_teams} AND id NOT IN {teams}', true),
    ('phase_teams', 'forked_from_team_id', 'teams', 'forked_from_team_id IN {teams} AND id NOT IN {phase_teams}', true),
    ('phase_teams', 'forked_from_phase_team_id', 'phase_teams', 'forked_from_phase_team_id IN {phase_teams} AND id NOT IN {phase_teams}', true),
    ('player_streaks', 'last_phase_match_id', 'phase_matches', 'last_phase_match_id IN {phase_matches}', false)
  ) AS v(rel, col, parent, pred, relink)
$$;

CREATE OR REPLACE FUNCTION public.league_trash__restore_plan()
RETURNS TABLE (step int, rel text, filter text, defer text[])
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT * FROM (VALUES
    (1000, 'seasons',                   NULL,                            NULL::text[]),
    (2000, 'season_participants',       NULL,                            NULL),
    (2500, 'season_formats',            NULL,                            NULL),
    (2600, 'format_rules',              NULL,                            NULL),
    (2700, 'evolution_tiers',           NULL,                            NULL),
    (2800, 'draft_tier_limits',         NULL,                            NULL),
    (2900, 'draft_pool_entries',        NULL,                            NULL),
    (3000, 'legacy_standings',          NULL,                            NULL),
    (3100, 'epb_kill_credit_epochs',    NULL,                            NULL),
    (3200, 'epb_token_grants',          NULL,                            NULL),
    (3300, 'season_storylines',         NULL,                            NULL),
    (4000, 'draft_pools',               'r.season_group_id IS NULL',     NULL),
    (4500, 'season_groups',             NULL,                            NULL),
    (4600, 'season_group_members',      NULL,                            NULL),
    (5000, 'draft_pools',               'r.season_group_id IS NOT NULL', NULL),
    (5100, 'draft_participants',        NULL,                            NULL),
    (5200, 'draft_slots',               NULL,                            NULL),
    (5300, 'redraft_slots',             NULL,                            ARRAY['filled_by_pick_id']),
    (5400, 'draft_picks',               NULL,                            NULL),
    (5500, 'draft_replay_events',       NULL,                            NULL),
    (5600, 'draft_line_restrictions',   NULL,                            NULL),
    (6000, 'evolution_tracker',         NULL,                            NULL),
    (6100, 'redraft_submissions',       NULL,                            NULL),
    (6200, 'evolution_events',          NULL,                            NULL),
    (6300, 'evo_progress_log',          NULL,                            NULL),
    (6400, 'epb_draft_token_purchases', NULL,                            NULL),
    (6500, 'epb_comeback_token_spends', NULL,                            NULL),
    (6600, 'redraft_history',           NULL,                            NULL),
    (6700, 'redraft_trade_requests',    NULL,                            NULL),
    (7000, 'tournaments',               NULL,                            NULL),
    (7100, 'tournament_participants',   NULL,                            NULL),
    (7200, 'rounds',                    NULL,                            NULL),
    (7300, 'tournament_reports',        NULL,                            NULL),
    (7400, 'matches',                   NULL,                            NULL),
    (7500, 'tournament_groups',         NULL,                            NULL),
    (7600, 'tournament_group_members',  NULL,                            NULL),
    (7700, 'match_outcomes',            NULL,                            NULL),
    (8000, 'games',                     NULL,                            NULL),
    (8100, 'battle_stats',              NULL,                            NULL),
    (8200, 'match_analyses',            NULL,                            NULL),
    (8300, 'match_prep_analyses',       NULL,                            NULL),
    (8400, 'match_prep_teams',          NULL,                            NULL),
    (8500, 'match_proposals',           NULL,                            NULL),
    (8600, 'match_evolution_snapshots', NULL,                            NULL),
    (8700, 'epb_animation_views',       NULL,                            NULL),
    (8800, 'broadcast_moments',         NULL,                            NULL),
    (9000, 'teams',                     NULL,                            ARRAY['phase_match_id', 'forked_from_phase_team_id']),
    (9500, 'resource_admins',           NULL,                            NULL),
    (9600, 'discord_webhooks',          NULL,                            NULL),
    (9700, 'social_integrations',       NULL,                            NULL),
    (9800, 'wiki_notes',                NULL,                            NULL),
    (9900, 'wiki_note_reports',         NULL,                            NULL),
    (10000, 'format_relation_links',     NULL,                            NULL),
    (10100, 'format_resource_items',     NULL,                            NULL),
    (10200, 'format_action_submissions', NULL,                            NULL),
    (10300, 'format_event_log',          NULL,                            NULL),
    (10400, 'format_flags',              NULL,                            NULL),
    (10500, 'format_player_attrs',       NULL,                            NULL),
    (10600, 'format_track_progress',     NULL,                            NULL),
    (10700, 'format_checks',             NULL,                            NULL),
    (10800, 'format_adjustments',        NULL,                            NULL),
    (10900, 'format_challenges',         NULL,                            NULL),
    (11000, 'format_notifications',      NULL,                            NULL)
,
    (7001, 'league_phases', NULL, NULL),
    (7101, 'phase_participants', NULL, NULL),
    (7102, 'phase_groups', NULL, NULL),
    (7103, 'phase_group_members', NULL, NULL),
    (7201, 'phase_rounds', NULL, NULL),
    (7301, 'phase_reports', NULL, NULL),
    (7401, 'phase_matches', NULL, NULL),
    (7701, 'phase_match_outcomes', NULL, NULL),
    (8001, 'phase_games', NULL, NULL),
    (8101, 'phase_battle_stats', NULL, NULL),
    (8201, 'phase_match_analyses', NULL, NULL),
    (8301, 'phase_match_prep_analyses', NULL, NULL),
    (8401, 'phase_match_prep_teams', NULL, NULL),
    (8501, 'phase_match_proposals', NULL, NULL),
    (8601, 'phase_match_evolution_snapshots', NULL, NULL),
    (8701, 'phase_epb_animation_views', NULL, NULL),
    (8801, 'phase_broadcast_moments', NULL, NULL),
    (9001, 'phase_teams', NULL, NULL),
    (9401, 'phase_cast_sessions', NULL, NULL),
    (9501, 'phase_admins', NULL, NULL),
    (9601, 'phase_discord_webhooks', NULL, NULL),
    (9701, 'phase_social_integrations', NULL, NULL),
    (9801, 'phase_wiki_notes', NULL, NULL),
    (9901, 'phase_wiki_note_reports', NULL, NULL)
  ) AS v(step, rel, filter, defer)
$$;

CREATE OR REPLACE FUNCTION public.league_trash__x(p_pred text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE s text := p_pred; i int;
BEGIN
  FOR i IN 1..8 LOOP
    s := replace(s, '{native_phases}', '(SELECT id FROM public.league_phases WHERE season_id = $1)');
    s := replace(s, '{phase_matches}', '(SELECT id FROM public.phase_matches WHERE phase_id IN {native_phases})');
    s := replace(s, '{phase_games}', '(SELECT id FROM public.phase_games WHERE match_id IN {phase_matches})');
    s := replace(s, '{phase_groups}', '(SELECT id FROM public.phase_groups WHERE phase_id IN {native_phases})');
    s := replace(s, '{phase_teams}', '(SELECT id FROM public.phase_teams WHERE phase_id IN {native_phases})');
    s := replace(s, '{phase_notes}', '(SELECT id FROM public.phase_wiki_notes WHERE phase_id IN {native_phases})');
    s := replace(s, '{phases}',  '(SELECT id FROM public.tournaments WHERE season_id = $1)');
    s := replace(s, '{matches}', '(SELECT id FROM public.matches WHERE tournament_id IN {phases})');
    s := replace(s, '{games}',   '(SELECT id FROM public.games WHERE match_id IN {matches})');
    s := replace(s, '{pools}',   '(SELECT id FROM public.draft_pools WHERE season_id = $1)');
    s := replace(s, '{tgroups}', '(SELECT id FROM public.tournament_groups WHERE tournament_id IN {phases})');
    s := replace(s, '{teams}',   '(SELECT id FROM public.teams WHERE season_id = $1 OR tournament_id IN {phases} OR draft_pool_id IN {pools})');
    s := replace(s, '{notes}',   '(SELECT id FROM public.wiki_notes WHERE (scope_type = ''league'' AND scope_id = $1) OR (scope_type = ''tournament'' AND scope_id IN {phases}))');
  END LOOP;
  RETURN s;
END $$;

CREATE OR REPLACE FUNCTION public.league_trash__shift(p_rel text, p_row jsonb, p_shift interval)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE r jsonb := p_row;
BEGIN
  IF p_rel = 'draft_pools' AND r ->> 'phase' <> 'complete' THEN
    r := public.league_trash__shift_col(r, 'submission_deadline_at', p_shift);
    r := public.league_trash__shift_col(r, 'token_purchase_closes_at', p_shift);
  ELSIF p_rel = 'draft_slots' AND r ->> 'status' = 'active' THEN
    r := public.league_trash__shift_col(r, 'deadline_at', p_shift);
  ELSIF p_rel IN ('matches', 'phase_matches') AND r ->> 'status' = 'pending_confirmation' THEN
    r := public.league_trash__shift_col(r, 'auto_confirm_at', p_shift);
  ELSIF p_rel IN ('match_proposals', 'phase_match_proposals') AND r ->> 'status' = 'pending' THEN
    r := public.league_trash__shift_col(r, 'expires_at', p_shift);
  ELSIF p_rel IN ('rounds', 'phase_rounds') AND r ->> 'status' <> 'completed' THEN
    r := public.league_trash__shift_col(r, 'deadline', p_shift);
  ELSIF p_rel = 'format_challenges' AND r ->> 'status' = 'open' THEN
    r := public.league_trash__shift_col(r, 'expires_at', p_shift);
  ELSIF p_rel = 'season_formats' THEN

    r := jsonb_set(r, '{clock_shift_seconds}',
                   to_jsonb(coalesce((r ->> 'clock_shift_seconds')::bigint, 0) + floor(extract(epoch FROM p_shift))::bigint));
  END IF;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.league_trash_delete(p_season_id uuid, p_actor uuid, p_retention_days integer)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_season public.seasons; v_now timestamptz := now(); v_trash uuid := gen_random_uuid();
  v_counts jsonb; v_players uuid[]; v_phases uuid[]; v_pool record; r record; v_frozen int := 0; v_unlinked jsonb; v_actor_name text;
  v_version text := public.league_trash_schema_version();
BEGIN
  IF p_retention_days IS NULL OR p_retention_days < 1 OR p_retention_days > 3650 THEN
    RAISE EXCEPTION 'LEAGUE_TRASH_BAD_RETENTION' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_season_id::text));
  SELECT * INTO v_season FROM public.seasons WHERE id = p_season_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEAGUE_TRASH_SEASON_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  PERFORM public.league_trash__assert_inventory();

  FOR r IN SELECT i.rel, i.pred FROM public.league_trash__inventory() i
            WHERE i.rel IN ('tournaments', 'tournament_groups', 'rounds', 'matches', 'games', 'draft_pools', 'league_phases', 'phase_groups', 'phase_rounds', 'phase_matches', 'phase_games')
            ORDER BY array_position(ARRAY['tournaments', 'league_phases', 'tournament_groups', 'phase_groups', 'rounds', 'phase_rounds', 'matches', 'phase_matches', 'games', 'phase_games', 'draft_pools'], i.rel) LOOP
    EXECUTE format('SELECT 1 FROM public.%I WHERE %s ORDER BY id FOR UPDATE', r.rel, public.league_trash__x(r.pred)) USING p_season_id;
  END LOOP;


  FOR v_pool IN SELECT * FROM public.draft_pools WHERE season_id = p_season_id AND engine = 'queue' AND phase = 'drafting' AND paused_at IS NULL LOOP
    UPDATE public.draft_slots
       SET remaining_ms_at_pause = GREATEST(0, public.draft__running_ms(v_now, deadline_at, v_pool.quiet_start_hour, v_pool.quiet_end_hour, v_pool.quiet_timezone))::int,
           deadline_at = NULL
     WHERE draft_pool_id = v_pool.id AND status = 'active' AND deadline_at IS NOT NULL;
    UPDATE public.draft_pools SET paused_at = v_now, paused_by = p_actor, pause_reason = 'admin', state_version = state_version + 1 WHERE id = v_pool.id;
    PERFORM public.draft__log(p_season_id, v_pool.id, p_actor, 'admin', 'paused', p_reason => 'League moved to the trash', p_is_public => false);
    v_frozen := v_frozen + 1;
  END LOOP;
  SELECT name INTO v_actor_name FROM public.players WHERE id = p_actor;
  INSERT INTO public.league_trash (id, season_id, season_name, format_type, deleted_at, deleted_by, deleted_by_name, purge_after, schema_version, frozen_pools)
  VALUES (v_trash, p_season_id, v_season.name, v_season.format_type::text, v_now, p_actor, v_actor_name,
          v_now + make_interval(days => p_retention_days), v_version, v_frozen);
  v_unlinked := public.league_trash__capture(p_season_id, v_trash);
  PERFORM public.league_trash__protect(v_trash);
  SELECT jsonb_object_agg(rel, n) INTO v_counts FROM public.league_trash_tables WHERE trash_id = v_trash;
  EXECUTE public.league_trash__x(
    'SELECT coalesce(array_agg(DISTINCT p), ''{}'') FROM (
       SELECT player_id AS p FROM public.season_participants WHERE season_id = $1
       UNION SELECT player_id FROM public.tournament_participants WHERE tournament_id IN {phases}
       UNION SELECT player_1_id FROM public.matches WHERE tournament_id IN {phases}
       UNION SELECT player_2_id FROM public.matches WHERE tournament_id IN {phases}
       UNION SELECT player_id FROM public.phase_participants WHERE phase_id IN {native_phases}
       UNION SELECT player_1_id FROM public.phase_matches WHERE phase_id IN {native_phases}
       UNION SELECT player_2_id FROM public.phase_matches WHERE phase_id IN {native_phases}) s') USING p_season_id INTO v_players;
  SELECT coalesce(array_agg(id), '{}') INTO v_phases FROM (SELECT id FROM public.tournaments WHERE season_id = p_season_id UNION SELECT id FROM public.league_phases WHERE season_id = p_season_id) phases;
  UPDATE public.league_trash SET counts = v_counts, player_ids = v_players, phase_ids = v_phases, unlinked = v_unlinked WHERE id = v_trash;
  DELETE FROM public.league_trash_restore_rebuilds WHERE season_id = p_season_id;

  FOR r IN SELECT i.rel, i.pred FROM public.league_trash__inventory() i
            WHERE i.rel IN ('resource_admins', 'discord_webhooks', 'social_integrations', 'wiki_notes', 'aggregates', 'player_aggregates') LOOP
    EXECUTE format('DELETE FROM public.%I WHERE %s', r.rel, public.league_trash__x(r.pred)) USING p_season_id;
  END LOOP;
  EXECUTE public.league_trash__x('DELETE FROM public.matches WHERE tournament_id IN {phases}') USING p_season_id;
  FOR r IN SELECT i.pred FROM public.league_trash__inventory() i WHERE i.rel = 'teams' LOOP
    EXECUTE public.league_trash__x('DELETE FROM public.teams WHERE ' || r.pred) USING p_season_id;
  END LOOP;
  EXECUTE public.league_trash__x('DELETE FROM public.phase_matches WHERE phase_id IN {native_phases}') USING p_season_id;
  EXECUTE public.league_trash__x('DELETE FROM public.phase_teams WHERE phase_id IN {native_phases}') USING p_season_id;
  EXECUTE public.league_trash__x('DELETE FROM public.phase_cast_sessions WHERE phase_id IN {native_phases}') USING p_season_id;
  EXECUTE public.league_trash__x('UPDATE public.cast_sessions SET phase_id = NULL WHERE phase_id IN {native_phases}') USING p_season_id;
  DELETE FROM public.league_phases WHERE season_id = p_season_id;
  DELETE FROM public.tournaments WHERE season_id = p_season_id;
  DELETE FROM public.draft_pools WHERE season_id = p_season_id;
  DELETE FROM public.season_storylines WHERE season_id = p_season_id;
  DELETE FROM public.seasons WHERE id = p_season_id;
  RETURN jsonb_build_object('trash_id', v_trash, 'season_id', p_season_id, 'season_name', v_season.name,
                            'deleted_at', v_now, 'purge_after', v_now + make_interval(days => p_retention_days),
                            'counts', v_counts, 'player_ids', to_jsonb(v_players), 'phase_ids', to_jsonb(v_phases),
                            'frozen_pools', v_frozen, 'schema_version', v_version);
END $$;

CREATE OR REPLACE FUNCTION public.league_trash_restore(p_trash_id uuid, p_now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  t public.league_trash; p record; f record; e jsonb; v_rows jsonb; v_colsj jsonb; v_miss text[]; v_sql text; v_parent text; v_lost jsonb := '[]';
  v_n bigint; v_shift interval; v_restored jsonb := '{}'::jsonb; v_warn jsonb := '[]'::jsonb; v_ids uuid[]; v_released bigint;
  v_sid uuid; v_queue uuid[] := '{}'; v_phase_queue uuid[] := '{}'; v_bad jsonb; v_jobs bigint := 0;
BEGIN
  SELECT season_id INTO v_sid FROM public.league_trash WHERE id = p_trash_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEAGUE_TRASH_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(v_sid::text));
  SELECT * INTO t FROM public.league_trash WHERE id = p_trash_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEAGUE_TRASH_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF t.purge_after <= p_now THEN RAISE EXCEPTION 'LEAGUE_TRASH_EXPIRED' USING ERRCODE = 'P0001'; END IF;
  IF EXISTS (SELECT 1 FROM public.seasons WHERE id = t.season_id) THEN RAISE EXCEPTION 'LEAGUE_TRASH_SEASON_EXISTS' USING ERRCODE = 'P0001'; END IF;
  IF t.rebuild_pending THEN RAISE EXCEPTION 'LEAGUE_TRASH_REBUILD_PENDING' USING ERRCODE = 'P0001'; END IF;
  v_shift := p_now - t.deleted_at;

  SELECT array_agg(lt.rel ORDER BY lt.rel) INTO v_miss FROM public.league_trash_tables lt
   WHERE lt.trash_id = p_trash_id AND lt.n > 0
     AND (lt.rel NOT IN (SELECT pl.rel FROM public.league_trash__restore_plan() pl) OR to_regclass('public.' || quote_ident(lt.rel)) IS NULL);
  IF v_miss IS NOT NULL THEN
    RAISE EXCEPTION 'LEAGUE_TRASH_PLAN_MISMATCH' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('missing', to_jsonb(v_miss))::text;
  END IF;

  FOR p IN SELECT DISTINCT pl.rel FROM public.league_trash__restore_plan() pl ORDER BY pl.rel LOOP
    SELECT lt.cols INTO v_colsj FROM public.league_trash_tables lt WHERE lt.trash_id = p_trash_id AND lt.rel = p.rel AND lt.n > 0;
    IF v_colsj IS NULL THEN CONTINUE; END IF;
    SELECT array_agg(a.attname) INTO v_miss FROM pg_attribute a
     WHERE a.attrelid = ('public.' || quote_ident(p.rel))::regclass AND a.attnum > 0 AND NOT a.attisdropped
       AND a.attnotnull AND a.attgenerated = '' AND a.attidentity = ''
       AND NOT EXISTS (SELECT 1 FROM pg_attrdef d WHERE d.adrelid = a.attrelid AND d.adnum = a.attnum)
       AND NOT (v_colsj ? a.attname);
    IF v_miss IS NOT NULL THEN
      RAISE EXCEPTION 'LEAGUE_TRASH_SCHEMA_DRIFT' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('rel', p.rel, 'columns', v_miss)::text;
    END IF;
    SELECT array_agg(c) INTO v_miss FROM jsonb_array_elements_text(v_colsj) c
     WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = ('public.' || quote_ident(p.rel))::regclass
                          AND a.attname = c AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '');
    IF v_miss IS NOT NULL THEN
      v_warn := v_warn || jsonb_build_object('code', 'columns_ignored', 'rel', p.rel, 'columns', to_jsonb(v_miss));
    END IF;
  END LOOP;
  FOR p IN SELECT * FROM public.league_trash__restore_plan() ORDER BY step LOOP
    v_rows := NULL; v_colsj := NULL;
    SELECT lt.rows, lt.cols INTO v_rows, v_colsj FROM public.league_trash_tables lt WHERE lt.trash_id = p_trash_id AND lt.rel = p.rel AND lt.n > 0;
    IF v_rows IS NULL THEN CONTINUE; END IF;
    IF p.rel IN ('draft_pools', 'draft_slots', 'matches', 'match_proposals', 'rounds', 'phase_matches', 'phase_match_proposals', 'phase_rounds', 'format_challenges', 'season_formats') THEN
      SELECT coalesce(jsonb_agg(public.league_trash__shift(p.rel, x, v_shift)), '[]'::jsonb) INTO v_rows FROM jsonb_array_elements(v_rows) x;
    END IF;
    IF p.rel = 'games' THEN

      SELECT coalesce(array_agg(DISTINCT (x ->> 'id')::uuid), '{}') INTO v_queue
        FROM jsonb_array_elements(v_rows) x
       WHERE (x ->> 'match_id')::uuid IN (SELECT (m ->> 'id')::uuid FROM public.league_trash_tables lm, jsonb_array_elements(lm.rows) m
                                           WHERE lm.trash_id = p_trash_id AND lm.rel = 'matches' AND m ->> 'status' <> 'scheduled')
         AND (x ->> 'id')::uuid IN (SELECT (b ->> 'game_id')::uuid FROM public.league_trash_tables lb, jsonb_array_elements(lb.rows) b
                                     WHERE lb.trash_id = p_trash_id AND lb.rel = 'battle_stats');
      SELECT count(*) INTO v_released FROM jsonb_array_elements(v_rows) x
       WHERE x ->> 'replay_hash' IS NOT NULL AND EXISTS (SELECT 1 FROM public.games g WHERE g.replay_hash = x ->> 'replay_hash' UNION ALL SELECT 1 FROM public.phase_games g WHERE g.replay_hash = x ->> 'replay_hash');
      IF v_released > 0 THEN v_warn := v_warn || jsonb_build_object('code', 'replay_hash_released', 'count', v_released); END IF;
      SELECT coalesce(jsonb_agg(
               CASE WHEN (x ->> 'id')::uuid = ANY (v_queue) THEN jsonb_set(x, '{aggregate_applied_at}', 'null'::jsonb) ELSE x END
               || CASE WHEN x ->> 'replay_hash' IS NOT NULL AND EXISTS (SELECT 1 FROM public.games g WHERE g.replay_hash = x ->> 'replay_hash' UNION ALL SELECT 1 FROM public.phase_games g WHERE g.replay_hash = x ->> 'replay_hash')
                       THEN '{"replay_hash": null}'::jsonb ELSE '{}'::jsonb END), '[]'::jsonb)
        INTO v_rows FROM jsonb_array_elements(v_rows) x;
    END IF;
    IF p.rel = 'phase_games' THEN

      SELECT coalesce(array_agg(DISTINCT (x ->> 'id')::uuid), '{}') INTO v_phase_queue
        FROM jsonb_array_elements(v_rows) x
       WHERE (x ->> 'match_id')::uuid IN (SELECT (m ->> 'id')::uuid FROM public.league_trash_tables lm, jsonb_array_elements(lm.rows) m
                                           WHERE lm.trash_id = p_trash_id AND lm.rel = 'phase_matches' AND m ->> 'status' <> 'scheduled')
         AND (x ->> 'id')::uuid IN (SELECT (b ->> 'game_id')::uuid FROM public.league_trash_tables lb, jsonb_array_elements(lb.rows) b
                                     WHERE lb.trash_id = p_trash_id AND lb.rel = 'phase_battle_stats');
      SELECT count(*) INTO v_released FROM jsonb_array_elements(v_rows) x
       WHERE x ->> 'replay_hash' IS NOT NULL AND EXISTS (SELECT 1 FROM public.games g WHERE g.replay_hash = x ->> 'replay_hash' UNION ALL SELECT 1 FROM public.phase_games g WHERE g.replay_hash = x ->> 'replay_hash');
      IF v_released > 0 THEN v_warn := v_warn || jsonb_build_object('code', 'replay_hash_released', 'count', v_released); END IF;
      SELECT coalesce(jsonb_agg(
               CASE WHEN (x ->> 'id')::uuid = ANY (v_phase_queue) THEN jsonb_set(x, '{aggregate_applied_at}', 'null'::jsonb) ELSE x END
               || CASE WHEN x ->> 'replay_hash' IS NOT NULL AND EXISTS (SELECT 1 FROM public.games g WHERE g.replay_hash = x ->> 'replay_hash' UNION ALL SELECT 1 FROM public.phase_games g WHERE g.replay_hash = x ->> 'replay_hash')
                       THEN '{"replay_hash": null}'::jsonb ELSE '{}'::jsonb END), '[]'::jsonb)
        INTO v_rows FROM jsonb_array_elements(v_rows) x;
    END IF;

    FOR f IN SELECT a.attname AS col, pr.relname AS parent, pa.attname AS pcol, NOT a.attnotnull AS nullable
               FROM pg_constraint c
               JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
               JOIN pg_class pr ON pr.oid = c.confrelid
               JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = c.confkey[1]
              WHERE c.contype = 'f' AND c.conrelid = ('public.' || quote_ident(p.rel))::regclass AND array_length(c.conkey, 1) = 1
                AND (pr.relname NOT IN (SELECT pl.rel FROM public.league_trash__restore_plan() pl)
                     OR (p.rel = 'teams' AND a.attname IN ('phase_match_id', 'forked_from_phase_team_id'))
                     OR (p.rel = 'phase_teams' AND a.attname IN ('forked_from_team_id', 'forked_from_phase_team_id'))) LOOP
      EXECUTE format('SELECT array_agg(DISTINCT s.x) FROM (SELECT (e ->> %L)::uuid AS x FROM jsonb_array_elements($1) e) s
                       WHERE s.x IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.%I pr WHERE pr.%I = s.x)
                         AND NOT EXISTS (SELECT 1 FROM public.league_trash_tables lt, jsonb_array_elements(lt.rows) saved
                           WHERE lt.trash_id = $2 AND lt.rel = $3 AND saved ->> ''id'' = s.x::text)', f.col, f.parent, f.pcol)
        USING v_rows, p_trash_id, f.parent INTO v_ids;
      IF v_ids IS NOT NULL THEN
        IF NOT f.nullable THEN
          RAISE EXCEPTION 'LEAGUE_TRASH_PARENT_MISSING' USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('rel', p.rel, 'column', f.col, 'parent', f.parent, 'ids', to_jsonb(v_ids[1:20]))::text;
        END IF;
        SELECT jsonb_agg(CASE WHEN (x ->> f.col)::uuid = ANY (v_ids) THEN jsonb_set(x, ARRAY[f.col], 'null'::jsonb) ELSE x END) INTO v_rows FROM jsonb_array_elements(v_rows) x;
        v_warn := v_warn || jsonb_build_object('code', 'parent_missing_nulled', 'rel', p.rel, 'column', f.col, 'count', cardinality(v_ids));
      END IF;
    END LOOP;
    IF p.defer IS NOT NULL THEN
      UPDATE public.league_trash_tables SET rows = v_rows WHERE trash_id = p_trash_id AND rel = p.rel;
    END IF;
    IF p.rel = ANY (public.league_trash__archive_tables()) THEN

      UPDATE public.league_trash_tables SET rows = v_rows WHERE trash_id = p_trash_id AND rel = p.rel;
      v_n := public.league_trash__insert_archive_rows(p_trash_id, p.step);
    ELSE
      v_n := public.league_trash__insert_rows(p.rel, p.filter, v_colsj, p.defer, v_rows);
    END IF;
    v_restored := jsonb_set(v_restored, ARRAY[p.rel], to_jsonb(coalesce((v_restored ->> p.rel)::bigint, 0) + v_n));
    IF p.rel = 'games' AND cardinality(v_queue) > 0 THEN
      INSERT INTO public.aggregate_jobs (game_id, tournament_id, season_id, operation, status)
        SELECT g.id, m.tournament_id, tn.season_id, 'increment', 'pending'
          FROM public.games g JOIN public.matches m ON m.id = g.match_id JOIN public.tournaments tn ON tn.id = m.tournament_id
         WHERE g.id = ANY (v_queue);
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_jobs := v_jobs + v_n;
    END IF;
    IF p.rel = 'phase_games' AND cardinality(v_phase_queue) > 0 THEN
      INSERT INTO public.phase_aggregate_jobs (game_id, match_id, phase_id, season_id, operation, status)
        SELECT g.id, m.id, m.phase_id, ph.season_id, 'increment', 'pending'
          FROM public.phase_games g JOIN public.phase_matches m ON m.id = g.match_id JOIN public.league_phases ph ON ph.id = m.phase_id
         WHERE g.id = ANY (v_phase_queue);
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_jobs := v_jobs + v_n;
    END IF;
  END LOOP;

  FOR p IN SELECT * FROM public.league_trash__restore_plan() WHERE defer IS NOT NULL LOOP
    FOR v_sql IN SELECT format('UPDATE public.%1$I t SET %2$I = r.%2$I FROM jsonb_populate_recordset(NULL::public.%1$I, $1) r WHERE t.id = r.id AND r.%2$I IS NOT NULL', p.rel, c)
                   FROM unnest(p.defer) c LOOP
      EXECUTE v_sql USING (SELECT lt.rows FROM public.league_trash_tables lt WHERE lt.trash_id = p_trash_id AND lt.rel = p.rel);
    END LOOP;
  END LOOP;

  SELECT jsonb_agg(jsonb_build_object('rel', lt.rel, 'captured', lt.n, 'restored', coalesce((v_restored ->> lt.rel)::bigint, 0)) ORDER BY lt.rel)
    INTO v_bad FROM public.league_trash_tables lt
   WHERE lt.trash_id = p_trash_id AND lt.n > 0 AND coalesce((v_restored ->> lt.rel)::bigint, 0) <> lt.n;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'LEAGUE_TRASH_PLAN_MISMATCH' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('mismatched', v_bad)::text;
  END IF;


  FOR e IN SELECT x FROM jsonb_array_elements(t.unlinked) x LOOP
    SELECT pt.parent INTO v_parent FROM public.league_trash__pointers() pt WHERE pt.rel = e ->> 'rel' AND pt.col = e ->> 'col';
    IF v_parent IS NULL THEN
      v_lost := v_lost || jsonb_build_array(e);
      CONTINUE;
    END IF;
    EXECUTE format('UPDATE public.%I SET %I = $1 WHERE id = $2 AND %I IS NULL AND EXISTS (SELECT 1 FROM public.%I WHERE id = $1)',
                   e ->> 'rel', e ->> 'col', e ->> 'col', v_parent) USING (e ->> 'old')::uuid, (e ->> 'id')::uuid;
  END LOOP;
  v_warn := v_warn || coalesce((
    SELECT jsonb_agg(jsonb_build_object('code', 'pointer_unknown', 'rel', s.rel, 'column', s.col, 'count', s.n) ORDER BY s.rel, s.col)
      FROM (SELECT x ->> 'rel' AS rel, x ->> 'col' AS col, count(*) AS n FROM jsonb_array_elements(v_lost) x GROUP BY 1, 2) s), '[]');
  INSERT INTO public.league_trash_restore_rebuilds (season_id, trash_id, season_name, restored_at, phase_ids, player_ids)
  VALUES (t.season_id, t.id, t.season_name, p_now, t.phase_ids, t.player_ids)
  ON CONFLICT (season_id) DO UPDATE
    SET trash_id = EXCLUDED.trash_id, season_name = EXCLUDED.season_name, restored_at = EXCLUDED.restored_at,
        phase_ids = EXCLUDED.phase_ids, player_ids = EXCLUDED.player_ids;
  DELETE FROM public.league_trash WHERE id = p_trash_id;
  RETURN jsonb_build_object(
    'season_id', t.season_id, 'season_name', t.season_name, 'restored', v_restored,
    'shift_seconds', extract(epoch FROM v_shift), 'player_ids', to_jsonb(t.player_ids), 'phase_ids', to_jsonb(t.phase_ids),
    'paused_pools', t.frozen_pools,
    'queued_aggregate_jobs', v_jobs, 'schema_version_at_delete', t.schema_version, 'warnings', v_warn);
END $$;

CREATE OR REPLACE FUNCTION public.league_trash_expire(p_now timestamptz DEFAULT now(), p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_out jsonb;
BEGIN
  WITH due AS (
    SELECT id FROM public.league_trash WHERE purge_after <= p_now AND NOT rebuild_pending
     ORDER BY purge_after LIMIT greatest(p_limit, 1) FOR UPDATE SKIP LOCKED
  ), mids AS (
    SELECT d.id, coalesce((SELECT jsonb_agg(m ->> 'id') FROM public.league_trash_tables lt, jsonb_array_elements(lt.rows) m WHERE lt.trash_id = d.id AND lt.rel IN ('matches', 'phase_matches')), '[]'::jsonb) AS match_ids
      FROM due d
  ), gone AS (
    DELETE FROM public.league_trash t USING due WHERE t.id = due.id
    RETURNING t.id, t.season_id, t.season_name, t.deleted_at, t.purge_after
  )
  SELECT coalesce(jsonb_agg(to_jsonb(gone) || jsonb_build_object('match_ids', mids.match_ids)), '[]'::jsonb) INTO v_out FROM gone JOIN mids ON mids.id = gone.id;
  RETURN v_out;
END $$;

COMMIT;

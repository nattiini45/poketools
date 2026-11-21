SELECT lt_lab.seed(8, 4, 'Phase foundation fixture') AS sid \gset
SELECT id AS actor FROM public.players WHERE id IN (SELECT player_id FROM public.season_participants WHERE season_id = :'sid') ORDER BY id LIMIT 1 \gset

UPDATE public.format_challenges SET created_at = now() - interval '1 day' WHERE season_id = :'sid';

UPDATE public.tournaments SET enrollment_source = jsonb_build_object(
  'type', 'standings', 'source_phase_id', (SELECT id FROM public.tournaments WHERE season_id = :'sid' AND stage_order = 1), 'frozen', false
) WHERE season_id = :'sid' AND stage_order = 2;

INSERT INTO public.match_analyses (match_id, model_id)
SELECT id, 'fixture' FROM public.matches WHERE tournament_id IN (SELECT id FROM public.tournaments WHERE season_id = :'sid')
ON CONFLICT (match_id) DO NOTHING;
INSERT INTO public.match_prep_analyses (match_id, player_id, model_id)
SELECT id, player_1_id, 'fixture' FROM public.matches WHERE tournament_id IN (SELECT id FROM public.tournaments WHERE season_id = :'sid')
ON CONFLICT (match_id, player_id) DO NOTHING;
INSERT INTO public.match_prep_teams (match_id, player_id)
SELECT id, player_1_id FROM public.matches WHERE tournament_id IN (SELECT id FROM public.tournaments WHERE season_id = :'sid')
ON CONFLICT (match_id, player_id) DO NOTHING;
INSERT INTO public.match_proposals (match_id, proposer_id, responder_id, proposed_at, expires_at)
SELECT id, player_1_id, player_2_id, now(), now() + interval '2 days' FROM public.matches WHERE tournament_id IN (SELECT id FROM public.tournaments WHERE season_id = :'sid')
AND NOT EXISTS (SELECT 1 FROM public.match_proposals p WHERE p.match_id = matches.id);
INSERT INTO public.epb_animation_views (player_id, match_id)
SELECT player_1_id, id FROM public.matches WHERE tournament_id IN (SELECT id FROM public.tournaments WHERE season_id = :'sid')
ON CONFLICT (player_id, match_id) DO NOTHING;
INSERT INTO public.broadcast_moments (match_id, game_id, moment_type, created_by)
SELECT g.match_id, g.id, 'highlight', :'actor' FROM public.games g
JOIN public.matches m ON m.id = g.match_id JOIN public.tournaments t ON t.id = m.tournament_id WHERE t.season_id = :'sid';
INSERT INTO public.social_integrations (provider, scope_type, scope_id, label)
SELECT 'x', 'tournament', id, 'Fixture integration' FROM public.tournaments WHERE season_id = :'sid' LIMIT 1;
INSERT INTO public.wiki_note_reports (note_id, reporter_id, reason)
SELECT id, :'actor', 'fixture' FROM public.wiki_notes
WHERE scope_type = 'tournament' AND scope_id IN (SELECT id FROM public.tournaments WHERE season_id = :'sid')
ON CONFLICT (note_id, reporter_id) DO NOTHING;

CREATE TEMP TABLE phase_fixture_context (season_id uuid, actor_id uuid);
INSERT INTO phase_fixture_context VALUES (:'sid', :'actor');

DO $$
DECLARE
  v_sid uuid := (SELECT season_id FROM phase_fixture_context);
  r record; v_rows jsonb; v_cols jsonb; v_pred text; v_n bigint;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    (7001, 'tournaments', 'league_phases'),
    (7101, 'tournament_participants', 'phase_participants'),
    (7102, 'tournament_groups', 'phase_groups'),
    (7103, 'tournament_group_members', 'phase_group_members'),
    (7201, 'rounds', 'phase_rounds'),
    (7301, 'tournament_reports', 'phase_reports'),
    (7401, 'matches', 'phase_matches'),
    (7701, 'match_outcomes', 'phase_match_outcomes'),
    (8001, 'games', 'phase_games'),
    (8101, 'battle_stats', 'phase_battle_stats'),
    (8201, 'match_analyses', 'phase_match_analyses'),
    (8301, 'match_prep_analyses', 'phase_match_prep_analyses'),
    (8401, 'match_prep_teams', 'phase_match_prep_teams'),
    (8501, 'match_proposals', 'phase_match_proposals'),
    (8601, 'match_evolution_snapshots', 'phase_match_evolution_snapshots'),
    (8701, 'epb_animation_views', 'phase_epb_animation_views'),
    (8801, 'broadcast_moments', 'phase_broadcast_moments'),
    (9001, 'teams', 'phase_teams'),
    (9401, 'cast_sessions', 'phase_cast_sessions'),
    (9501, 'resource_admins', 'phase_admins'),
    (9601, 'discord_webhooks', 'phase_discord_webhooks'),
    (9701, 'social_integrations', 'phase_social_integrations'),
    (9801, 'wiki_notes', 'phase_wiki_notes'),
    (9901, 'wiki_note_reports', 'phase_wiki_note_reports')
  ) m(step, source_rel, target_rel) ORDER BY step LOOP
    IF r.source_rel = 'cast_sessions' THEN
      v_pred := 'tournament_id IN {phases}';
    ELSIF r.source_rel = 'teams' THEN
      v_pred := 'tournament_id IN {phases}';
    ELSIF r.source_rel IN ('resource_admins', 'discord_webhooks', 'social_integrations', 'wiki_notes') THEN
      v_pred := CASE WHEN r.source_rel = 'resource_admins' THEN 'resource_type = ''tournament'' AND resource_id IN {phases}'
                    ELSE 'scope_type = ''tournament'' AND scope_id IN {phases}' END;
    ELSIF r.source_rel = 'wiki_note_reports' THEN
      v_pred := 'note_id IN (SELECT id FROM public.wiki_notes WHERE scope_type = ''tournament'' AND scope_id IN {phases})';
    ELSE
      SELECT pred INTO v_pred FROM public.league_trash__inventory() WHERE rel = r.source_rel;
    END IF;
    EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(s)), ''[]''::jsonb) FROM public.%I s WHERE %s',
                   r.source_rel, public.league_trash__x(v_pred)) USING v_sid INTO v_rows;
    IF r.source_rel <> 'tournaments' THEN
      SELECT coalesce(jsonb_agg(x || CASE
        WHEN x ? 'tournament_id' THEN jsonb_build_object('phase_id', x -> 'tournament_id')
        WHEN r.source_rel = 'resource_admins' THEN jsonb_build_object('phase_id', x -> 'resource_id')
        WHEN r.source_rel IN ('discord_webhooks', 'social_integrations', 'wiki_notes') THEN jsonb_build_object('phase_id', x -> 'scope_id')
        WHEN r.source_rel = 'tournament_group_members' THEN jsonb_build_object('phase_id',
          (SELECT tournament_id FROM public.tournament_groups WHERE id = (x ->> 'group_id')::uuid))
        ELSE '{}'::jsonb END
        || CASE WHEN r.source_rel = 'tournament_groups' THEN jsonb_build_object('season_id', v_sid) ELSE '{}'::jsonb END
        || CASE WHEN r.source_rel = 'games' AND x ->> 'replay_hash' IS NOT NULL THEN
          jsonb_build_object('replay_hash', encode(sha256(((x ->> 'replay_hash') || 'phase')::bytea), 'hex')) ELSE '{}'::jsonb END), '[]'::jsonb)
      INTO v_rows FROM jsonb_array_elements(v_rows) x;
    END IF;
    SELECT jsonb_agg(attname ORDER BY attnum) INTO v_cols FROM pg_attribute
      WHERE attrelid = ('public.' || r.target_rel)::regclass AND attnum > 0 AND NOT attisdropped AND attgenerated = '';
    v_n := public.league_trash__insert_rows(r.target_rel, NULL, v_cols, NULL, v_rows);
    IF v_n = 0 THEN RAISE EXCEPTION 'fixture missing target %', r.target_rel; END IF;
  END LOOP;
END $$;

-- The copy leaves the league native-only, as every league is after the P6 transfer: the legacy stage rows it came from
-- go, so the trash snapshot holds no league-owned tournaments row (the 4.C.6 guard refuses to re-insert one in phase mode).
DELETE FROM public.wiki_note_reports WHERE note_id IN (SELECT id FROM public.wiki_notes WHERE scope_type = 'tournament' AND scope_id IN (SELECT id FROM public.tournaments WHERE season_id = :'sid'));
DELETE FROM public.wiki_notes WHERE scope_type = 'tournament' AND scope_id IN (SELECT id FROM public.tournaments WHERE season_id = :'sid');
DELETE FROM public.social_integrations WHERE scope_type = 'tournament' AND scope_id IN (SELECT id FROM public.tournaments WHERE season_id = :'sid');
DELETE FROM public.discord_webhooks WHERE scope_type = 'tournament' AND scope_id IN (SELECT id FROM public.tournaments WHERE season_id = :'sid');
DELETE FROM public.resource_admins WHERE resource_type = 'tournament' AND resource_id IN (SELECT id FROM public.tournaments WHERE season_id = :'sid');
DELETE FROM public.cast_sessions WHERE tournament_id IN (SELECT id FROM public.tournaments WHERE season_id = :'sid');
SET LOCAL poketools.team_correction = 'on';
DELETE FROM public.teams WHERE tournament_id IN (SELECT id FROM public.tournaments WHERE season_id = :'sid');
SET LOCAL poketools.team_correction = 'off';
DELETE FROM public.tournaments WHERE season_id = :'sid';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tournaments WHERE season_id = (SELECT season_id FROM phase_fixture_context)) THEN
    RAISE EXCEPTION 'fixture league still holds a league-owned tournaments row';
  END IF;
END $$;

CREATE TEMP TABLE phase_external_links (kind text PRIMARY KEY, id uuid NOT NULL);
UPDATE public.phase_teams SET forked_from_team_id = NULL,
  forked_from_phase_team_id = (SELECT id FROM public.phase_teams ORDER BY id OFFSET 1 LIMIT 1)
WHERE id = (SELECT id FROM public.phase_teams ORDER BY id LIMIT 1);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.league_phases WHERE enrollment_source_phase_id IS NOT NULL) THEN
    RAISE EXCEPTION 'fixture missing phase enrollment-source chain';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.league_phases'::regclass
    AND conname = 'league_phases_enrollment_source_fkey' AND condeferrable AND condeferred AND confdeltype = 'a') THEN
    RAISE EXCEPTION 'phase enrollment-source constraint is not deferred NO ACTION';
  END IF;
END $$;
WITH added AS (
  INSERT INTO public.teams (player_id, name, phase_match_id)
  SELECT :'actor', 'External match reference', id FROM public.phase_matches ORDER BY id LIMIT 1 RETURNING id
) INSERT INTO phase_external_links SELECT 'match_team', id FROM added;
WITH added AS (
  INSERT INTO public.teams (player_id, name, forked_from_phase_team_id)
  SELECT :'actor', 'External fork reference', id FROM public.phase_teams ORDER BY id LIMIT 1 RETURNING id
) INSERT INTO phase_external_links SELECT 'fork_team', id FROM added;
WITH added AS (
  INSERT INTO public.cast_sessions (owner_id, name, season_id, phase_id, phase_match_id)
  SELECT :'actor', 'External phase reference', :'sid', phase_id, id FROM public.phase_matches ORDER BY id LIMIT 1 RETURNING id
) INSERT INTO phase_external_links SELECT 'cast', id FROM added;

SET ROLE service_role;
DO $$
BEGIN
  BEGIN
    DELETE FROM public.phase_participants WHERE phase_id = (SELECT id FROM public.league_phases LIMIT 1);
    RAISE EXCEPTION 'dormant phase write was accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'phase_storage_not_ready' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.phase_storage_state SET mode = 'phase' WHERE id;
    RAISE EXCEPTION 'service role changed storage generation';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

SELECT public.phase_storage_transition('legacy', 'frozen_legacy');
SELECT public.phase_storage_transition('frozen_legacy', 'frozen_phase');
SELECT public.phase_storage_transition('frozen_phase', 'phase');

CREATE TEMP TABLE phase_before (rel text PRIMARY KEY, n bigint, fingerprint text);
CREATE TEMP TABLE phase_deadlines AS
SELECT 'phase_matches'::text AS rel, id, 'auto_confirm_at'::text AS col, auto_confirm_at AS deadline
FROM public.phase_matches WHERE status = 'pending_confirmation' AND auto_confirm_at IS NOT NULL
UNION ALL
SELECT 'phase_rounds', id, 'deadline', deadline FROM public.phase_rounds WHERE status <> 'completed' AND deadline IS NOT NULL
UNION ALL
SELECT 'phase_match_proposals', id, 'expires_at', expires_at FROM public.phase_match_proposals WHERE status = 'pending';
DO $$
DECLARE r record; v_n bigint; v_hash text;
BEGIN
  FOR r IN SELECT rel, pred FROM public.league_trash__inventory()
    WHERE cls = 'owned' AND (rel = 'league_phases' OR rel LIKE 'phase_%') LOOP
    EXECUTE format('SELECT count(*), md5(string_agg((to_jsonb(s) - ARRAY[''auto_confirm_at'', ''deadline'', ''expires_at'', ''aggregate_applied_at''])::text, ''|'' ORDER BY (to_jsonb(s) - ARRAY[''auto_confirm_at'', ''deadline'', ''expires_at'', ''aggregate_applied_at''])::text)) FROM public.%I s WHERE %s',
                   r.rel, public.league_trash__x(r.pred))
      USING (SELECT season_id FROM phase_fixture_context) INTO v_n, v_hash;
    INSERT INTO phase_before VALUES (r.rel, v_n, v_hash);
  END LOOP;
END $$;

SET ROLE service_role;
SELECT public.league_trash__assert_inventory();
SELECT public.league_trash_delete(:'sid', :'actor', 90) ->> 'trash_id' AS tid \gset
SELECT public.league_trash_rebuild_done(:'tid');
UPDATE public.league_trash_tables SET rows = (
  SELECT jsonb_agg(x ORDER BY (x ->> 'forked_from_phase_team_id') IS NULL, x ->> 'id')
  FROM jsonb_array_elements(rows) x
) WHERE trash_id = :'tid' AND rel = 'phase_teams';
SELECT public.league_trash_restore(:'tid', now() + interval '1 day') AS restore_result \gset
RESET ROLE;

DO $$
DECLARE r record; v_n bigint; v_hash text; v_jobs bigint; v_deadline timestamptz;
BEGIN
  FOR r IN SELECT b.*, i.pred FROM phase_before b JOIN public.league_trash__inventory() i USING (rel) LOOP
    EXECUTE format('SELECT count(*), md5(string_agg((to_jsonb(s) - ARRAY[''auto_confirm_at'', ''deadline'', ''expires_at'', ''aggregate_applied_at''])::text, ''|'' ORDER BY (to_jsonb(s) - ARRAY[''auto_confirm_at'', ''deadline'', ''expires_at'', ''aggregate_applied_at''])::text)) FROM public.%I s WHERE %s',
                   r.rel, public.league_trash__x(r.pred))
      USING (SELECT season_id FROM phase_fixture_context) INTO v_n, v_hash;
    IF v_n <> r.n OR v_hash IS DISTINCT FROM r.fingerprint THEN
      RAISE EXCEPTION 'phase restore parity failed for %', r.rel;
    END IF;
  END LOOP;
  IF (SELECT count(DISTINCT rel) FROM phase_deadlines) <> 3 THEN
    RAISE EXCEPTION 'fixture is missing a native deadline kind';
  END IF;
  FOR r IN SELECT * FROM phase_deadlines LOOP
    EXECUTE format('SELECT %I FROM public.%I WHERE id = $1', r.col, r.rel) USING r.id INTO v_deadline;
    IF v_deadline IS DISTINCT FROM r.deadline + interval '1 day' THEN
      RAISE EXCEPTION 'native deadline did not shift for %', r.rel;
    END IF;
  END LOOP;
  SELECT count(*) INTO v_jobs FROM public.phase_aggregate_jobs;
  IF v_jobs = 0 OR EXISTS (
    SELECT 1 FROM public.phase_aggregate_jobs j JOIN public.phase_games g ON g.id = j.game_id
    WHERE j.status <> 'pending' OR g.aggregate_applied_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'phase restore queue marker mismatch'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND (c.relname = 'league_phases' OR c.relname LIKE 'phase_%')
      AND c.relkind = 'r' AND (NOT c.relrowsecurity
        OR has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
        OR has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE'))
  ) THEN RAISE EXCEPTION 'phase table privileges are open'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.teams WHERE id = (SELECT id FROM phase_external_links WHERE kind = 'match_team') AND phase_match_id IS NOT NULL)
     OR NOT EXISTS (SELECT 1 FROM public.teams WHERE id = (SELECT id FROM phase_external_links WHERE kind = 'fork_team') AND forked_from_phase_team_id IS NOT NULL)
     OR NOT EXISTS (SELECT 1 FROM public.cast_sessions WHERE id = (SELECT id FROM phase_external_links WHERE kind = 'cast') AND phase_id IS NOT NULL AND phase_match_id IS NOT NULL)
  THEN RAISE EXCEPTION 'outside phase references were not restored'; END IF;
END $$;

SET ROLE service_role;
SELECT public.league_trash_restore_rebuild_done(:'sid');
SELECT public.league_trash_delete(:'sid', :'actor', 90) ->> 'trash_id' AS tid \gset
SELECT public.league_trash_rebuild_done(:'tid');
SELECT jsonb_array_length(public.league_trash_expire(now() + interval '91 days', 20)) AS expired \gset
RESET ROLE;
SELECT 1 / CASE WHEN :'expired'::integer > 0 THEN 1 ELSE 0 END AS expiry_verified;

ROLLBACK;

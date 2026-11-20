-- P6 transfer rehearsal (LOCAL stack / CI database job only; never a hosted project).
-- Run after scripts/league-trash-lab/seed.sql inside ONE transaction that the caller opens; the file ends in ROLLBACK,
-- so the database is left exactly as it was:
--   { printf 'BEGIN;\n'; cat scripts/league-trash-lab/seed.sql scripts/phase-separation/p6-transfer-rehearsal.sql; } |
--     docker exec -i supabase_db_poketools psql -U postgres -d postgres -v ON_ERROR_STOP=1 [-v leagues=5]
--
-- Seeds :leagues synthetic leagues (default 5, production's count; about production's moved-row shape) plus one
-- standalone tournament with children, then rehearses the plan 4.D ladder:
--   refusals -> forward -> re-entry no-op -> activate -> inverse (exact round-trip parity) -> re-forward -> activate
--   -> native writes -> inverse (new rows and lineage carried back) -> re-forward.
-- Each transfer prints its ledger report; the summary at the end is the wall time per direction.
\if :{?leagues}
\else
  \set leagues 5
\endif
\timing on

CREATE SCHEMA pt_rh;

CREATE FUNCTION pt_rh.expect(p_sql text, p_message text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE p_message || '%' THEN
      RETURN 'refused as expected: ' || SQLERRM;
    END IF;
    RAISE EXCEPTION 'expected % from [%], got % (%)', p_message, p_sql, SQLERRM, SQLSTATE;
  END;
  RAISE EXCEPTION 'expected % from [%], but it succeeded', p_message, p_sql;
END $$;

-- Whole-row fingerprints of every table the transfer reads or writes on the legacy side, plus the identities it must
-- not touch. teams.updated_at is left out: retargeting an outside team's pointer is an UPDATE, and trg_teams_updated
-- stamps it (the only column the round trip is allowed to change).
CREATE FUNCTION pt_rh.fingerprints() RETURNS TABLE (rel text, rows bigint, fp text) LANGUAGE plpgsql AS $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tournaments', 'tournament_participants', 'tournament_groups', 'tournament_group_members', 'rounds',
    'matches', 'games', 'battle_stats', 'match_outcomes', 'match_analyses', 'match_prep_analyses', 'match_prep_teams', 'match_proposals',
    'match_evolution_snapshots', 'epb_animation_views', 'broadcast_moments', 'rating_history', 'tournament_reports', 'aggregate_jobs',
    'aggregates', 'player_aggregates', 'teams', 'cast_sessions', 'resource_admins', 'discord_webhooks', 'social_integrations',
    'wiki_notes', 'wiki_note_reports', 'agent_suggestions', 'player_streaks', 'format_challenges', 'players', 'seasons',
    'season_groups', 'season_group_members', 'audit_log']
  LOOP
    RETURN QUERY EXECUTE format(
      'SELECT %L::text, count(*), md5(coalesce(string_agg(x, E''\n'' ORDER BY x), '''')) FROM (SELECT (to_jsonb(t) - %L)::text x FROM public.%I t) s',
      t, CASE WHEN t = 'teams' THEN 'updated_at' ELSE '' END, t);
  END LOOP;
END $$;

-- 1. Seed: :leagues leagues of 8 players, three phases of two rounds each, plus one standalone tournament with children.
-- lt_lab.seed picks the newest 'ltp_' players, and inside one transaction they all share created_at, so each league's
-- players are renamed out of the pool before the next league is seeded.
CREATE FUNCTION pt_rh.seed(p_leagues int) RETURNS int LANGUAGE plpgsql AS $$
BEGIN
  FOR i IN 1..p_leagues LOOP
    PERFORM lt_lab.seed(8, 2, 'Rehearsal league ' || i);
    UPDATE public.players SET name = 'ltq_' || substr(name, 5) WHERE name LIKE 'ltp\_%';
  END LOOP;
  RETURN p_leagues;
END $$;
SELECT pt_rh.seed(:leagues) AS leagues_seeded;

DO $$
DECLARE v_ruleset uuid; v_t uuid := gen_random_uuid(); v_r uuid := gen_random_uuid(); v_p uuid[];
BEGIN
  v_ruleset := lt_lab.make_ruleset(gen_random_uuid(), gen_random_uuid(), 'rehearsal standalone ruleset');
  SELECT array_agg(id) INTO v_p FROM (SELECT id FROM public.players WHERE name LIKE 'ltq\_%' ORDER BY id LIMIT 8) s;
  INSERT INTO public.tournaments (id, name, season_id, bracket_type, ruleset_id, status) VALUES (v_t, 'Standalone', NULL, 'round_robin', v_ruleset, 'active');
  INSERT INTO public.tournament_participants (tournament_id, player_id) SELECT v_t, unnest(v_p);
  INSERT INTO public.rounds (id, name, tournament_id, round_number, best_of, status) VALUES (v_r, 'R1', v_t, 1, 3, 'active');
  INSERT INTO public.matches (round_id, tournament_id, player_1_id, player_2_id, status, winner_id)
    SELECT v_r, v_t, v_p[i], v_p[i + 4], 'completed', v_p[i] FROM generate_series(1, 4) i;
  INSERT INTO public.games (match_id, game_number, winner_id, source, parsed, replay_url, replay_hash)
    SELECT m.id, 1, m.winner_id, 'ps_replay', true, 'https://replay.example/s-' || m.id, encode(sha256(('s' || m.id)::bytea), 'hex')
      FROM public.matches m WHERE m.tournament_id = v_t;
  INSERT INTO public.battle_stats (game_id, player_id, pokemon_name, was_brought, was_lead, kos_dealt)
    SELECT g.id, m.player_1_id, 'mon' || k, true, k = 1, 1 FROM public.games g JOIN public.matches m ON m.id = g.match_id, generate_series(1, 6) k
     WHERE m.tournament_id = v_t;
  INSERT INTO public.teams (player_id, tournament_id, pokemon, name) VALUES (v_p[1], v_t, '[]'::jsonb, 'standalone team');
  INSERT INTO public.aggregates (scope_type, scope_id, pokemon_name, total_appearances) VALUES ('tournament', v_t, 'mon1', 4);
  INSERT INTO public.resource_admins (player_id, resource_type, resource_id) VALUES (v_p[2], 'tournament', v_t);
  INSERT INTO public.cast_sessions (owner_id, tournament_id, match_id, name)
    SELECT v_p[1], v_t, (SELECT id FROM public.matches WHERE tournament_id = v_t ORDER BY id LIMIT 1), 'standalone cast';
  -- a league-only cast session that points at a league match without owning a phase (retargeted, not moved)
  INSERT INTO public.cast_sessions (owner_id, match_id, name)
    SELECT v_p[1], (SELECT m.id FROM public.matches m JOIN public.tournaments t ON t.id = m.tournament_id WHERE t.season_id IS NOT NULL ORDER BY m.id LIMIT 1), 'match-only cast';
  INSERT INTO public.cast_sessions (owner_id, name) VALUES (v_p[1], 'unbound cast');
END $$;

-- Shape of what moves (compare plan section 8: 4 league phases, 125 matches, 146 games, 1,636 battle-stat rows).
SELECT (SELECT count(*) FROM tournaments WHERE season_id IS NOT NULL) AS phases,
       (SELECT count(*) FROM matches m JOIN tournaments t ON t.id = m.tournament_id WHERE t.season_id IS NOT NULL) AS matches,
       (SELECT count(*) FROM games g JOIN matches m ON m.id = g.match_id JOIN tournaments t ON t.id = m.tournament_id WHERE t.season_id IS NOT NULL) AS games,
       (SELECT count(*) FROM battle_stats b JOIN games g ON g.id = b.game_id JOIN matches m ON m.id = g.match_id JOIN tournaments t ON t.id = m.tournament_id
         WHERE t.season_id IS NOT NULL) AS battle_stats,
       (SELECT count(*) FROM teams t JOIN tournaments x ON x.id = t.tournament_id WHERE x.season_id IS NOT NULL) AS teams,
       (SELECT count(*) FROM tournaments WHERE season_id IS NULL) AS standalone_tournaments;

CREATE TABLE pt_rh.before AS SELECT * FROM pt_rh.fingerprints();

-- 2. Refusals, each before any write.
SELECT pt_rh.expect('SELECT public.phase_transfer_forward(gen_random_uuid())', 'PHASE_TRANSFER_WRONG_MODE') AS forward_in_legacy_mode;
SELECT public.phase_storage_transition('legacy', 'frozen_legacy') AS mode;
DO $$
BEGIN
  EXECUTE 'SET LOCAL ROLE service_role';
  BEGIN
    PERFORM public.phase_transfer_forward(gen_random_uuid());
    RAISE EXCEPTION 'service_role ran the transfer';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  EXECUTE 'RESET ROLE';
END $$;
SELECT 'refused as expected: service_role cannot execute the transfer' AS api_role;
SELECT pt_rh.expect('SELECT public.phase_transfer_inverse(gen_random_uuid())', 'PHASE_TRANSFER_WRONG_MODE') AS inverse_in_frozen_legacy;
SELECT pt_rh.expect('SELECT public.phase_transfer_activate()', 'PHASE_TRANSFER_NOT_FORWARDED') AS activate_before_forward;
-- historical group repair prerequisite: one slot held by a player outside the phase roster stops the forward
SELECT pt_rh.expect($q$
  WITH g AS (SELECT g.id, g.tournament_id FROM tournament_groups g JOIN tournaments t ON t.id = g.tournament_id WHERE t.season_id IS NOT NULL ORDER BY g.id LIMIT 1),
       d AS (DELETE FROM tournament_participants p USING g WHERE p.tournament_id = g.tournament_id
              AND p.player_id = (SELECT m.player_id FROM tournament_group_members m WHERE m.group_id = g.id ORDER BY m.player_id LIMIT 1) RETURNING 1)
  SELECT public.phase_transfer_forward(gen_random_uuid()) FROM d$q$, 'PHASE_TRANSFER_GROUP_ORPHANS') AS group_orphan;
-- a format challenge must name a phase that exists in the target store (its FK follows the phase)
SELECT pt_rh.expect($q$
  WITH c AS (INSERT INTO format_challenges (season_id, phase_id, round, challenger_id, defender_id, expires_at)
             SELECT (SELECT id FROM seasons ORDER BY id LIMIT 1), t.id, 1, p.player_id, q.player_id, now() + interval '1 day'
               FROM tournaments t
               JOIN LATERAL (SELECT player_id FROM tournament_participants WHERE tournament_id = t.id ORDER BY player_id LIMIT 1) p ON true
               JOIN LATERAL (SELECT player_id FROM tournament_participants WHERE tournament_id = t.id ORDER BY player_id OFFSET 1 LIMIT 1) q ON true
              WHERE t.season_id IS NULL RETURNING 1)
  SELECT public.phase_transfer_forward(gen_random_uuid()) FROM c$q$, 'PHASE_TRANSFER_CHALLENGE_UNMOVABLE') AS challenge_on_standalone;
-- 4.D order 2: reaching teams before matches is the expected red (TEAM_MATCH_COMPLETED)
SELECT pt_rh.expect($q$
  DELETE FROM teams t USING tournaments x, matches m
   WHERE x.id = t.tournament_id AND x.season_id IS NOT NULL AND m.id = t.match_id AND m.status = 'completed'$q$, 'TEAM_MATCH_COMPLETED') AS teams_before_matches;
-- 4.D order 1: deleting before retargeting silently nulls an outside pointer (the hazard the forward asserts against)
DO $$
DECLARE v_before bigint; v_after bigint;
BEGIN
  SELECT count(*) INTO v_before FROM agent_suggestions WHERE match_id IS NOT NULL;
  BEGIN
    DELETE FROM matches m USING tournaments t WHERE t.id = m.tournament_id AND t.season_id IS NOT NULL;
    SELECT count(*) INTO v_after FROM agent_suggestions WHERE match_id IS NOT NULL;
    RAISE EXCEPTION 'rollback';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  IF NOT (v_before > 0 AND v_after < v_before) THEN
    RAISE EXCEPTION 'late-retarget hazard not reproduced (% -> %)', v_before, v_after;
  END IF;
  RAISE NOTICE 'late retarget nulls % of % agent_suggestions pointers without an error', v_before - v_after, v_before;
END $$;

-- 3. Forward.
\set op1 '''00000000-0000-4000-8000-000000000001'''
SELECT jsonb_pretty(public.phase_transfer_forward(:op1) - 'families') AS forward_1;
SELECT (public.phase_transfer_forward(:op1) ->> 'noop')::boolean AS forward_1_reentry_noop;
SELECT mode AS mode_after_forward FROM phase_storage_state;
CREATE FUNCTION pt_rh.challenge_fk() RETURNS text LANGUAGE sql AS $$
  SELECT confrelid::regclass::text || ' ON DELETE ' || CASE confdeltype WHEN 'c' THEN 'CASCADE' ELSE confdeltype::text END
    FROM pg_constraint WHERE conname = 'format_challenges_phase_id_fkey' AND conrelid = 'public.format_challenges'::regclass
$$;
DO $$
BEGIN
  IF pt_rh.challenge_fk() IS DISTINCT FROM 'league_phases ON DELETE CASCADE' THEN
    RAISE EXCEPTION 'format_challenges_phase_id_fkey after the forward: %', pt_rh.challenge_fk();
  END IF;
  IF (SELECT count(*) FROM format_challenges) = 0
     OR EXISTS (SELECT 1 FROM format_challenges c WHERE c.league_phase_id IS DISTINCT FROM c.phase_id
                   OR NOT EXISTS (SELECT 1 FROM league_phases p WHERE p.id = c.phase_id)) THEN
    RAISE EXCEPTION 'format challenges did not follow their phases';
  END IF;
  RAISE NOTICE 'format challenges: % rows, phase FK now %', (SELECT count(*) FROM format_challenges), pt_rh.challenge_fk();
END $$;
-- 4.D order 3 precondition, proved on the native-mode schema: a group row may only follow a tournament row that carries its season
SELECT pt_rh.expect($q$
  WITH t AS (INSERT INTO tournaments (id, name, season_id, bracket_type, ruleset_id, status)
             SELECT p.id, p.name, NULL, p.bracket_type, p.ruleset_id, 'active' FROM league_phases p
              WHERE EXISTS (SELECT 1 FROM phase_groups g WHERE g.phase_id = p.id AND g.season_group_id IS NOT NULL) ORDER BY p.id LIMIT 1 RETURNING id)
  INSERT INTO tournament_groups (tournament_id, name, group_number, season_group_id)
  SELECT t.id, 'A', 1, (SELECT g.season_group_id FROM phase_groups g WHERE g.phase_id = t.id AND g.season_group_id IS NOT NULL LIMIT 1) FROM t$q$,
  'SEASON_GROUP_INVALID') AS group_before_season_linked_tournament;
SELECT jsonb_pretty(public.phase_transfer_activate()) AS activate_1;

-- 4. Rollback while traffic is frozen again, then exact parity with the pre-forward legacy graph.
SELECT public.phase_storage_transition('phase', 'frozen_phase') AS mode;
\set op2 '''00000000-0000-4000-8000-000000000002'''
SELECT jsonb_pretty(public.phase_transfer_inverse(:op2) - 'families') AS inverse_1;
SELECT b.rel, b.rows AS rows_before, a.rows AS rows_after
  FROM pt_rh.before b JOIN pt_rh.fingerprints() a USING (rel) WHERE a.fp <> b.fp OR a.rows <> b.rows;
DO $$
BEGIN
  IF pt_rh.challenge_fk() IS DISTINCT FROM 'tournaments ON DELETE CASCADE' THEN
    RAISE EXCEPTION 'format_challenges_phase_id_fkey after the inverse: %', pt_rh.challenge_fk();
  END IF;
  IF EXISTS (SELECT 1 FROM pt_rh.before b JOIN pt_rh.fingerprints() a USING (rel) WHERE a.fp <> b.fp OR a.rows <> b.rows) THEN
    RAISE EXCEPTION 'round trip changed the legacy graph';
  END IF;
  RAISE NOTICE 'forward + inverse: legacy graph identical in all % tables', (SELECT count(*) FROM pt_rh.before);
END $$;

-- 5. Re-forward (lineage kept), reopen, write natively, roll back again: the current rows travel, lineage covers them.
\set op3 '''00000000-0000-4000-8000-000000000003'''
SELECT (public.phase_transfer_forward(:op3) -> 'timings') AS forward_2_timings;
SELECT public.phase_transfer_activate() ->> 'mode' AS mode;
DO $$
DECLARE v_phase uuid; v_round uuid := gen_random_uuid(); v_match uuid := gen_random_uuid(); v_p1 uuid; v_p2 uuid; v_conv uuid;
BEGIN
  SELECT p.id INTO v_phase FROM league_phases p ORDER BY p.id LIMIT 1;
  SELECT player_id INTO v_p1 FROM phase_participants WHERE phase_id = v_phase ORDER BY player_id LIMIT 1;
  SELECT player_id INTO v_p2 FROM phase_participants WHERE phase_id = v_phase ORDER BY player_id OFFSET 1 LIMIT 1;
  INSERT INTO phase_rounds (id, name, phase_id, round_number, best_of, status) VALUES (v_round, 'Native round', v_phase, 99, 3, 'active');
  INSERT INTO phase_matches (id, round_id, phase_id, player_1_id, player_2_id, status, winner_id) VALUES (v_match, v_round, v_phase, v_p1, v_p2, 'completed', v_p1);
  INSERT INTO phase_games (match_id, game_number, winner_id, source, parsed, replay_url, replay_hash)
    VALUES (v_match, 1, v_p1, 'ps_replay', true, 'https://replay.example/native', encode(sha256('native'::bytea), 'hex'));
  SELECT conversation_id INTO v_conv FROM agent_suggestions LIMIT 1;
  INSERT INTO agent_suggestions (player_id, conversation_id, phase_match_id, context_format) VALUES (v_p1, v_conv, v_match, 'gen9');
  INSERT INTO phase_teams (player_id, phase_id, season_id, match_id, pokemon, name)
    SELECT v_p1, v_phase, p.season_id, v_match, '[]'::jsonb, 'native team' FROM league_phases p WHERE p.id = v_phase;
  PERFORM set_config('pt_rh.native_match', v_match::text, true);
END $$;
SELECT public.phase_storage_transition('phase', 'frozen_phase') AS mode;
\set op4 '''00000000-0000-4000-8000-000000000004'''
SELECT (public.phase_transfer_inverse(:op4) -> 'timings') AS inverse_2_timings;
DO $$
DECLARE v_match uuid := current_setting('pt_rh.native_match')::uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM matches WHERE id = v_match)
     OR NOT EXISTS (SELECT 1 FROM games WHERE match_id = v_match)
     OR NOT EXISTS (SELECT 1 FROM teams WHERE match_id = v_match)
     OR NOT EXISTS (SELECT 1 FROM agent_suggestions WHERE match_id = v_match)
     OR NOT EXISTS (SELECT 1 FROM phase_transfer_lineage WHERE entity_kind = 'match' AND entity_id = v_match
                     AND first_operation_id = '00000000-0000-4000-8000-000000000004') THEN
    RAISE EXCEPTION 'native writes did not travel back with their lineage';
  END IF;
  IF EXISTS (SELECT 1 FROM phase_transfer_lineage l JOIN matches m ON m.id = l.entity_id
              WHERE l.entity_kind = 'match' AND l.first_operation_id <> '00000000-0000-4000-8000-000000000001' AND m.id <> v_match) THEN
    RAISE EXCEPTION 'lineage of the first forward was rewritten';
  END IF;
  RAISE NOTICE 'native match, game, team and pointer travelled back; lineage of both generations kept';
END $$;
\set op5 '''00000000-0000-4000-8000-000000000005'''
SELECT (public.phase_transfer_forward(:op5) -> 'timings') AS forward_3_timings;
SELECT public.phase_transfer_activate() ->> 'mode' AS final_mode, pt_rh.challenge_fk() AS challenge_fk_in_phase_mode;

-- 6. Summary: wall time per direction (server-side, inside the transaction) and the moved-row totals.
SELECT generation, direction, report ->> 'phases' AS phases,
       (SELECT sum((v ->> 'rows')::bigint) FROM jsonb_each(report -> 'families') f(k, v)) AS rows_moved,
       report ->> 'pointer_rows_retargeted' AS pointers_retargeted,
       report -> 'timings' ->> 'copy_ms' AS copy_ms, report -> 'timings' ->> 'delete_ms' AS delete_ms,
       report -> 'timings' ->> 'assert_ms' AS assert_ms, report ->> 'total_ms' AS total_ms
  FROM phase_transfer_ledger ORDER BY generation;

ROLLBACK;

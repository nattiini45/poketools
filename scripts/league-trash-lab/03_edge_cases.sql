-- Edge cases of the league trash on a FRESH seed (LOCAL stack only):
--   docker exec -i supabase_db_poketools psql -U postgres -d postgres < 03_edge_cases.sql
-- Each block prints what it expects. Blocks that must fail print the error and the script goes on.
\set ON_ERROR_STOP off
SELECT lt_lab.seed(16, 4, 'LT Edge') AS sid \gset
SELECT (select id from players where name like 'ltp_%' order by created_at limit 1) AS actor \gset

\echo === (a) streak pointers, frozen draft, draft audit row
SELECT count(*) AS streaks_into_league FROM player_streaks WHERE last_match_id IN (SELECT m.id FROM matches m JOIN tournaments t ON t.id = m.tournament_id WHERE t.season_id = :'sid') \gset
SELECT count(*) AS streaks_with_pointer_before FROM player_streaks WHERE last_match_id IS NOT NULL \gset
SELECT :streaks_into_league AS streak_pointers_into_the_league;
SELECT count(*) AS draft_action_log_before FROM draft_action_log \gset
SELECT 'running drafting pools', count(*) FROM draft_pools WHERE season_id = :'sid' AND phase = 'drafting' AND paused_at IS NULL;

\echo === (b) a cancelled NULL-group pool and a NULL-group legacy tracker inside a grouped league
ALTER TABLE draft_pools DISABLE TRIGGER trg_draft_pools_guard_group;
INSERT INTO draft_pools (id, season_id, draft_type, engine, kind, phase, status, season_group_id) VALUES ('11111111-1111-4111-8111-111111111111', :'sid', 'snake', 'queue', 'initial', 'cancelled', 'pending', NULL);
ALTER TABLE draft_pools ENABLE TRIGGER trg_draft_pools_guard_group;
ALTER TABLE evolution_tracker DISABLE TRIGGER trg_evolution_tracker_group;
INSERT INTO evolution_tracker (id, season_id, player_id, base_pokemon, current_form, season_group_id) SELECT '22222222-2222-4222-8222-222222222222', :'sid', player_id, 'legacyzz', 'legacyzz', NULL FROM season_participants WHERE season_id = :'sid' LIMIT 1;
ALTER TABLE evolution_tracker ENABLE TRIGGER trg_evolution_tracker_group;
CREATE TEMP TABLE fp_a AS SELECT * FROM lt_lab.fp(:'sid');
SELECT league_trash_delete(:'sid', :'actor', 90) ->> 'trash_id' AS tid \gset
SELECT 'streak pointers nulled by the delete (expect = the number above, no explicit UPDATE)', :streaks_with_pointer_before - count(*) AS nulled FROM player_streaks WHERE last_match_id IS NOT NULL;
SELECT 'draft_action_log rows added (expect 1 per frozen pool)', count(*) - :draft_action_log_before AS added FROM draft_action_log;

\echo === (c) junction: the database refuses to delete a parent of the trashed league (expect 3 x 23503)
SELECT p.id AS victim FROM players p JOIN league_trash_players j ON j.player_id = p.id WHERE j.trash_id = :'tid' AND p.name LIKE 'ltp_%' ORDER BY p.created_at DESC LIMIT 1 \gset
DELETE FROM players WHERE id = :'victim';
-- A ruleset is a definition: deleting it cascades over its versions, and the junction refuses.
DELETE FROM ruleset_definitions WHERE id IN (SELECT v.definition_id FROM ruleset_definition_versions v WHERE v.id IN (SELECT ruleset_id FROM league_trash_rulesets WHERE trash_id = :'tid'));
DELETE FROM point_buy_list_versions WHERE id IN (SELECT list_version_id FROM league_trash_point_buy_versions WHERE trash_id = :'tid');

\echo === (d) season id taken again: restore refuses (expect LEAGUE_TRASH_SEASON_EXISTS)
INSERT INTO seasons (id, name, format_type) VALUES (:'sid', 'squatter', 'singles');
SELECT league_trash_restore(:'tid');
DELETE FROM seasons WHERE id = :'sid';

\echo === (e) defence in depth: a NOT NULL parent that vanished anyway (junction row removed by hand) -> PARENT_MISSING
DELETE FROM league_trash_players WHERE trash_id = :'tid' AND player_id = :'victim';
DELETE FROM players WHERE id = :'victim';
SELECT league_trash_restore(:'tid');
INSERT INTO players (id, name, is_guest) VALUES (:'victim', 'ltp_revived', true);

\echo === (f) a nullable parent vanished (a point-buy list entry): restore succeeds with parent_missing_nulled
SELECT (elem ->> 'line_entry_id')::uuid AS entry FROM league_trash_tables, jsonb_array_elements(rows) elem WHERE trash_id = :'tid' AND rel = 'draft_picks' AND elem ->> 'line_entry_id' IS NOT NULL LIMIT 1 \gset
DELETE FROM point_buy_list_entries WHERE id = :'entry';

\echo === (g) PLAN_MISMATCH: a captured table the plan does not know, then a row count that disagrees
UPDATE league_trash_tables SET rel = 'lt_unknown_table' WHERE trash_id = :'tid' AND rel = 'format_rules';
SELECT league_trash_restore(:'tid');
UPDATE league_trash_tables SET rel = 'format_rules' WHERE trash_id = :'tid' AND rel = 'lt_unknown_table';
UPDATE league_trash_tables SET n = n + 1 WHERE trash_id = :'tid' AND rel = 'format_rules';
SELECT league_trash_restore(:'tid');
UPDATE league_trash_tables SET n = n - 1 WHERE trash_id = :'tid' AND rel = 'format_rules';
SELECT 'nothing restored by the failed attempts (expect 0)', count(*) FROM seasons WHERE id = :'sid';
SELECT league_trash_restore(:'tid') -> 'warnings' AS warnings;
SELECT 'NULL-group cancelled pool is back (expect 1)', count(*) FROM draft_pools WHERE id = '11111111-1111-4111-8111-111111111111' AND season_group_id IS NULL;
SELECT 'legacy tracker is back; its group was filled by the trigger (the one known non-identical row)', season_group_id IS NOT NULL FROM evolution_tracker WHERE id = '22222222-2222-4222-8222-222222222222';
\echo --- hash diff against before the delete (expect: draft_picks and evolution_tracker only):
SELECT b.rel, b.n, a.n FROM fp_a b JOIN lt_lab.fp(:'sid') a USING (rel) WHERE b.h <> a.h OR b.n <> a.n;
SELECT 'tombstone present until the app confirms (expect 1)', count(*) FROM league_trash_restore_rebuilds WHERE season_id = :'sid';
SELECT league_trash_restore_rebuild_done(:'sid') AS tombstone_cleared;

\echo === (h) the rebuild marker keeps an expired row until the app confirmed the rebuild; restore refuses after purge_after
SELECT league_trash_delete(:'sid', :'actor', 90) ->> 'trash_id' AS tid \gset
UPDATE league_trash SET deleted_at = now() - interval '100 days', purge_after = now() - interval '10 days' WHERE id = :'tid';
SELECT league_trash_restore(:'tid');
SELECT 'expire with rebuild_pending (expect 0 purged)', jsonb_array_length(league_trash_expire());
SELECT league_trash_rebuild_done(:'tid') AS marker_cleared, league_trash_rebuild_done(:'tid') AS second_time_false;
SELECT 'expire after the rebuild (expect 1 purged, match ids returned)', jsonb_array_length(e -> 'match_ids') AS match_ids, e ->> 'season_name' FROM jsonb_array_elements(league_trash_expire()) e;
SELECT 'trash rows / captured rows / junction rows left (expect 0 0 0)', (SELECT count(*) FROM league_trash), (SELECT count(*) FROM league_trash_tables), (SELECT count(*) FROM league_trash_players);

\echo === (i) inventory guard: an unclassified cascade child (expect INVENTORY_INCOMPLETE, league untouched)
SELECT lt_lab.seed(8, 2, 'LT Guard') AS sid2 \gset
CREATE TABLE public.lt_probe (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid REFERENCES public.tournaments(id) ON DELETE CASCADE);
SELECT league_trash_delete(:'sid2', :'actor', 90);
DROP TABLE public.lt_probe;
\echo --- an owned table with a foreign key to an unclassified parent (expect INVENTORY_INCOMPLETE)
CREATE TABLE public.lt_probe_parent (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
ALTER TABLE public.season_storylines ADD COLUMN lt_probe_id uuid REFERENCES public.lt_probe_parent(id);
SELECT league_trash_delete(:'sid2', :'actor', 90);
ALTER TABLE public.season_storylines DROP COLUMN lt_probe_id;
DROP TABLE public.lt_probe_parent;
SELECT count(*) AS league_still_there FROM seasons WHERE id = :'sid2';

\echo === (j) bad retention (expect 22023) and a missing league (expect LEAGUE_TRASH_SEASON_NOT_FOUND)
SELECT league_trash_delete(:'sid2', :'actor', 0);
SELECT league_trash_delete(gen_random_uuid(), :'actor', 90);

\echo === (k) Rule-preset rulesets named by season_formats.preset_rulesets belong to the league: the junction holds them too
SELECT lt_lab.seed(8, 2, 'LT Showdown') AS sid3 \gset
-- season_formats.preset_rulesets maps a rule preset to a ruleset DEFINITION (league-owned); the junction holds its head version.
SELECT lt_lab.make_ruleset('33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444', 'lt preset ruleset', :'sid3') WHERE NOT EXISTS (SELECT 1 FROM ruleset_definitions WHERE id = '33333333-3333-4333-8333-333333333333');
UPDATE season_formats SET preset_rulesets = jsonb_build_object('gen9ou', '33333333-3333-4333-8333-333333333333', 'bogus', 'not-a-uuid') WHERE season_id = :'sid3';
SELECT league_trash_delete(:'sid3', :'actor', 90) ->> 'trash_id' AS tid3 \gset
SELECT 'rulesets held by the trash (expect 2: the phases ruleset and the head version of the preset one)', count(*) FROM league_trash_rulesets WHERE trash_id = :'tid3';
\echo --- the cleanup that removes unused rule-preset rulesets is refused by the database (expect 23503)
SELECT format_delete_unused_preset_rulesets('{"gen9ou": "33333333-3333-4333-8333-333333333333"}'::jsonb, '{}'::jsonb);
SELECT league_trash_restore(:'tid3') -> 'warnings' AS warnings;
SELECT league_trash_restore_rebuild_done(:'sid3');

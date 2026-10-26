-- Delete + restore a seeded league and compare it with itself.
--   docker exec -i supabase_db_poketools psql -U postgres -d postgres -v sid=<season uuid> < 01_cycle.sql
-- Expected: "leftovers" empty, "others changed" shows only draft_action_log (+1 per frozen pool) and
-- league_trash* tables are excluded, "diff after restore" empty, "others after restore" shows only draft_action_log.
\timing on
CREATE TEMP TABLE fp_before AS SELECT * FROM lt_lab.fp(:'sid');
CREATE TEMP TABLE oth_before AS SELECT * FROM lt_lab.others(:'sid');
SELECT (select id from players where name like 'ltp_%' order by created_at limit 1) AS actor \gset
SELECT league_trash_delete(:'sid', :'actor', 90) - 'player_ids' - 'phase_ids' AS del \gset
\echo DELETE result
SELECT :'del'::jsonb ->> 'trash_id' AS tid \gset
SELECT :'del'::jsonb -> 'frozen_pools' AS frozen, (SELECT pg_size_pretty(sum(pg_column_size(rows))::bigint) FROM league_trash_tables WHERE trash_id = :'tid'::uuid) stored;
\echo leftovers by inventory key (must be empty):
SELECT rel, n FROM lt_lab.fp(:'sid') WHERE n > 0;
SELECT count(*) AS orphan_resource_admins FROM resource_admins WHERE resource_id = :'sid';
SELECT count(*) AS agg_left FROM aggregates WHERE scope_id = :'sid';
\echo others changed (only draft_action_log, +1 per frozen pool):
SELECT b.k, b.v, a.v FROM oth_before b JOIN lt_lab.others(:'sid') a ON a.k = b.k WHERE a.v <> b.v;
\echo junction rows held by the trash
SELECT (SELECT count(*) FROM league_trash_players WHERE trash_id = :'tid'::uuid) players, (SELECT count(*) FROM league_trash_rulesets WHERE trash_id = :'tid'::uuid) rulesets, (SELECT count(*) FROM league_trash_point_buy_versions WHERE trash_id = :'tid'::uuid) list_versions;
\echo restore
SELECT league_trash_restore(:'tid') - 'player_ids' - 'phase_ids' AS res \gset
SELECT :'res'::jsonb -> 'warnings' AS warnings, :'res'::jsonb -> 'shift_seconds' shift, :'res'::jsonb -> 'queued_aggregate_jobs' queued_jobs, :'res'::jsonb -> 'paused_pools' paused;
\echo diff after restore (must be empty):
SELECT b.rel, b.n, a.n, b.h = a.h AS same FROM fp_before b JOIN lt_lab.fp(:'sid') a USING (rel) WHERE b.n <> a.n OR b.h <> a.h;
\echo others after restore (only draft_action_log):
SELECT b.k, b.v, a.v FROM oth_before b JOIN lt_lab.others(:'sid') a ON a.k = b.k WHERE a.v <> b.v;
SELECT count(*) AS trash_rows_left, (SELECT count(*) FROM league_trash_players) junction_left, (SELECT count(*) FROM league_trash_restore_rebuilds) tombstones FROM league_trash;

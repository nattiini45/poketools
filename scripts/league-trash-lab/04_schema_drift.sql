-- Schema drift while a league sits in the trash (LOCAL stack only). Needs DDL, which is why it is a manual lab and not
-- part of the opt-in vitest file (that one uses supabase-js and cannot alter tables).
--   docker exec -i supabase_db_poketools psql -U postgres -d postgres < 04_schema_drift.sql
-- Expected, in order:
--   1  column dropped since the delete          -> restore succeeds, warning columns_ignored {format_rules: [lt_tmp]}
--   2  new NOT NULL column WITH default         -> restore succeeds, the default is applied (5 of 5 rows)
--   3  new NOT NULL column WITHOUT default      -> LEAGUE_TRASH_SCHEMA_DRIFT {rel, columns}, nothing restored
--      the same column given a default again    -> restore succeeds
--   4  a captured table dropped since the delete -> LEAGUE_TRASH_PLAN_MISMATCH {missing: [...]}, nothing restored
\set ON_ERROR_STOP off
SELECT lt_lab.seed(8, 2, 'LT Drift') AS sid \gset
SELECT (select id from players where name like 'ltp_%' order by created_at limit 1) AS actor \gset

\echo === 1 + 2 + 3
ALTER TABLE format_rules ADD COLUMN lt_tmp text DEFAULT 'abc';
SELECT league_trash_delete(:'sid', :'actor', 90) ->> 'trash_id' AS tid \gset
SELECT league_trash_rebuild_done(:'tid');
ALTER TABLE format_rules DROP COLUMN lt_tmp;
ALTER TABLE season_storylines ADD COLUMN lt_new int NOT NULL DEFAULT 7;
ALTER TABLE season_storylines ADD COLUMN lt_req text NOT NULL DEFAULT 'x';
ALTER TABLE season_storylines ALTER COLUMN lt_req DROP DEFAULT;
SELECT league_trash_restore(:'tid');
ALTER TABLE season_storylines ALTER COLUMN lt_req SET DEFAULT 'x';
SELECT league_trash_restore(:'tid') -> 'warnings' AS warnings_ok;
SELECT 'new default applied (expect 5)', count(*) FROM season_storylines WHERE season_id = :'sid' AND lt_new = 7;
ALTER TABLE season_storylines DROP COLUMN lt_new;
ALTER TABLE season_storylines DROP COLUMN lt_req;
SELECT league_trash_restore_rebuild_done(:'sid');

\echo === 4 a captured table dropped
SELECT league_trash_delete(:'sid', :'actor', 90) ->> 'trash_id' AS tid \gset
SELECT league_trash_rebuild_done(:'tid');
-- pretend the captured draft_tier_limits is gone: rename the live table away for the attempt
ALTER TABLE draft_tier_limits RENAME TO draft_tier_limits_renamed;
SELECT league_trash_restore(:'tid');
ALTER TABLE draft_tier_limits_renamed RENAME TO draft_tier_limits;
SELECT 'still in the trash (expect 1)', count(*) FROM league_trash WHERE id = :'tid';
SELECT league_trash_restore(:'tid') -> 'warnings' AS warnings_ok;
SELECT league_trash_restore_rebuild_done(:'sid');

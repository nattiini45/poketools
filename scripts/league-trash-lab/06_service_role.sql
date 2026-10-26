-- The delete / restore cycle as service_role (LOCAL stack only). The other scripts run as the superuser, which can write
-- every table; PostgREST runs the functions as service_role, which cannot (redraft_trade_requests is a read-only archive,
-- 20261018140300_epb_retire_trades.sql). This proves that the archive rows come back through league_trash__insert_archive_rows
-- and that no other privilege is missing.
--   docker exec -i supabase_db_poketools psql -U postgres -d postgres < 06_service_role.sql
-- Expected: the archive row count before = after (1), "diff after restore" empty.
SELECT lt_lab.seed(8, 2, 'LT Role') AS sid \gset
SELECT (select id from players where name like 'ltp_%' order by created_at limit 1) AS actor \gset
CREATE TEMP TABLE fp_before AS SELECT * FROM lt_lab.fp(:'sid');
SELECT count(*) AS archive_before FROM redraft_trade_requests WHERE season_id = :'sid';
SET ROLE service_role;
SELECT has_table_privilege('service_role', 'public.redraft_trade_requests', 'INSERT') AS can_insert_archive;
SELECT league_trash_delete(:'sid', :'actor', 90) ->> 'trash_id' AS tid \gset
SELECT league_trash_rebuild_done(:'tid');
SELECT league_trash_restore(:'tid') -> 'restored' -> 'redraft_trade_requests' AS archive_restored;
SELECT league_trash_restore_rebuild_done(:'sid');
\echo the owner-rights helper refuses anything else (expect LEAGUE_TRASH_NOT_ARCHIVE):
SELECT league_trash__insert_archive_rows(gen_random_uuid(), 10);   -- step 10 restores 'seasons'
RESET ROLE;
SELECT count(*) AS archive_after FROM redraft_trade_requests WHERE season_id = :'sid';
\echo diff after restore (must be empty):
SELECT b.rel, b.n, a.n FROM fp_before b JOIN lt_lab.fp(:'sid') a USING (rel) WHERE b.n <> a.n OR b.h <> a.h;

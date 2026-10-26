-- Delete and restore timings (LOCAL stack only). Seeds a league of the given size, VACUUM ANALYZEs, then times the two
-- calls (psql \timing, no statement timeout: through PostgREST every call is one statement under the 8 s limit).
--   docker exec -i supabase_db_poketools psql -U postgres -d postgres -v players=32 -v rounds=12 < 05_timing.sql
-- players x rounds (per phase, 3 phases): 24x8 small, 32x12 realistic large, 48x30 big, 96x40 huge.
SELECT lt_lab.seed(:players, :rounds, 'LT Timing ' || :players || 'x' || :rounds) AS sid \gset
SELECT (select id from players where name like 'ltp_%' order by created_at limit 1) AS actor \gset
VACUUM (ANALYZE);
SELECT (SELECT count(*) FROM matches m JOIN tournaments t ON t.id = m.tournament_id WHERE t.season_id = :'sid') matches,
       (SELECT count(*) FROM games g JOIN matches m ON m.id = g.match_id JOIN tournaments t ON t.id = m.tournament_id WHERE t.season_id = :'sid') games,
       (SELECT count(*) FROM battle_stats b JOIN games g ON g.id = b.game_id JOIN matches m ON m.id = g.match_id JOIN tournaments t ON t.id = m.tournament_id WHERE t.season_id = :'sid') battle_stats;
\timing on
\echo >>> DELETE
SELECT league_trash_delete(:'sid', :'actor', 90) ->> 'trash_id' AS tid \gset
\echo >>> RESTORE
SELECT league_trash_restore(:'tid') ->> 'queued_aggregate_jobs' AS queued_jobs;
\timing off
SELECT league_trash_restore_rebuild_done(:'sid');

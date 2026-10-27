-- Clocks, pointers and the aggregate queue across a simulated 30 days in the trash.
--   docker exec -i supabase_db_poketools psql -U postgres -d postgres -v sid=<season uuid> < 02_clocks_and_pointers.sql
-- Expected after the restore: every running deadline moved by exactly the shift (min = max = 30 days), the active
-- draft slot frozen (deadline NULL, remaining_ms set) in a paused pool, cast sessions / forked teams re-linked,
-- games with stats unmarked with ONE pending increment job each, no streak pointer (the app recomputes them).
SELECT (select id from players where name like 'ltp_%' order by created_at limit 1) AS actor \gset
\echo === BEFORE
SELECT 'pool' k, id::text, phase, paused_at IS NOT NULL paused, submission_deadline_at IS NOT NULL sub, token_purchase_closes_at IS NOT NULL tok FROM draft_pools WHERE season_id = :'sid' ORDER BY created_at, id;
SELECT 'active slot' k, count(*) FILTER (WHERE status='active' AND deadline_at IS NOT NULL) live, count(*) FILTER (WHERE status='active' AND remaining_ms_at_pause IS NOT NULL) frozen FROM draft_slots WHERE draft_pool_id IN (SELECT id FROM draft_pools WHERE season_id = :'sid');
SELECT 'streak pointers into league', count(*) FROM player_streaks WHERE last_match_id IN (SELECT m.id FROM matches m JOIN tournaments t ON t.id = m.tournament_id WHERE t.season_id = :'sid');
CREATE TEMP TABLE b_auto AS SELECT m.id, m.auto_confirm_at FROM matches m JOIN tournaments t ON t.id = m.tournament_id WHERE t.season_id = :'sid' AND m.status='pending_confirmation';
CREATE TEMP TABLE b_round AS SELECT r.id, r.deadline FROM rounds r JOIN tournaments t ON t.id = r.tournament_id WHERE t.season_id = :'sid';
CREATE TEMP TABLE b_prop AS SELECT p.id, p.expires_at FROM match_proposals p JOIN matches m ON m.id = p.match_id JOIN tournaments t ON t.id = m.tournament_id WHERE t.season_id = :'sid' AND p.status = 'pending';
CREATE TEMP TABLE b_pool AS SELECT id, submission_deadline_at, token_purchase_closes_at FROM draft_pools WHERE season_id = :'sid';
CREATE TEMP TABLE b_game AS SELECT g.id, g.updated_at FROM games g JOIN matches m ON m.id = g.match_id JOIN tournaments t ON t.id = m.tournament_id WHERE t.season_id = :'sid';
-- an OVERDUE deadline must move too (time stood still): push one round and one pending match into the past first
UPDATE rounds SET deadline = now() - interval '2 days' WHERE id = (SELECT id FROM b_round WHERE deadline IS NOT NULL LIMIT 1);
UPDATE matches SET auto_confirm_at = now() - interval '1 hour' WHERE id = (SELECT id FROM b_auto LIMIT 1);
DELETE FROM b_round; INSERT INTO b_round SELECT r.id, r.deadline FROM rounds r JOIN tournaments t ON t.id = r.tournament_id WHERE t.season_id = :'sid';
DELETE FROM b_auto; INSERT INTO b_auto SELECT m.id, m.auto_confirm_at FROM matches m JOIN tournaments t ON t.id = m.tournament_id WHERE t.season_id = :'sid' AND m.status='pending_confirmation';
SELECT league_trash_delete(:'sid', :'actor', 90) ->> 'trash_id' AS tid \gset
\echo === AFTER DELETE
SELECT 'cast_sessions with a league link', count(*) FROM cast_sessions WHERE season_id IS NOT NULL OR tournament_id IS NOT NULL OR match_id IS NOT NULL;
SELECT 'streak pointers (any)', count(*) FROM player_streaks WHERE last_match_id IS NOT NULL;
SELECT 'trash row', season_name, format_type, purge_after - deleted_at AS window_, jsonb_array_length(unlinked) unlinked, cardinality(phase_ids) phases, cardinality(player_ids) players, rebuild_pending FROM league_trash WHERE id = :'tid';
-- simulate 30 days in the trash
SELECT league_trash_rebuild_done(:'tid');
SELECT league_trash_restore(:'tid', now() + interval '30 days') ->> 'shift_seconds' AS shift \gset
\echo === AFTER RESTORE (30 days later): shift = :shift s
SELECT 'pool' k, p.id::text, p.phase, p.paused_at IS NOT NULL paused, p.pause_reason, (p.submission_deadline_at - b.submission_deadline_at) sub_shift, (p.token_purchase_closes_at - b.token_purchase_closes_at) tok_shift
  FROM draft_pools p JOIN b_pool b USING (id) ORDER BY p.created_at, p.id;
SELECT 'slots', count(*) FILTER (WHERE status='active' AND deadline_at IS NOT NULL) live, count(*) FILTER (WHERE status='active' AND remaining_ms_at_pause IS NOT NULL) frozen FROM draft_slots WHERE draft_pool_id IN (SELECT id FROM draft_pools WHERE season_id = :'sid');
SELECT 'auto_confirm shift (incl. one overdue)', count(*), min(m.auto_confirm_at - b.auto_confirm_at), max(m.auto_confirm_at - b.auto_confirm_at) FROM matches m JOIN b_auto b USING (id);
SELECT 'round deadline shift (incl. one overdue)', count(*), min(r.deadline - b.deadline), max(r.deadline - b.deadline) FROM rounds r JOIN b_round b USING (id);
SELECT 'proposal expiry shift', count(*), min(p.expires_at - b.expires_at), max(p.expires_at - b.expires_at) FROM match_proposals p JOIN b_prop b USING (id);
SELECT 'cast_sessions relinked', count(*) FROM cast_sessions WHERE season_id = :'sid';
SELECT 'fork child relinked', count(*) FROM teams WHERE forked_from_team_id IN (SELECT id FROM teams WHERE season_id = :'sid');
SELECT 'outside team ptr relinked', count(*) FROM teams WHERE season_id IS NULL AND match_id IS NOT NULL;
SELECT 'agent_suggestions ptr relinked', count(*) FROM agent_suggestions WHERE match_id IS NOT NULL;
SELECT 'streak pointers into league (recomputed by the app)', count(*) FROM player_streaks WHERE last_match_id IN (SELECT m.id FROM matches m JOIN tournaments t ON t.id = m.tournament_id WHERE t.season_id = :'sid');
SELECT 'games', count(*) total, count(*) FILTER (WHERE g.aggregate_applied_at IS NULL) marker_null, count(*) FILTER (WHERE g.updated_at <> b.updated_at) updated_at_changed FROM games g JOIN b_game b USING (id);
SELECT 'increment jobs queued', count(*), count(DISTINCT game_id) distinct_games, count(*) FILTER (WHERE status = 'pending' AND operation = 'increment') pending_increment FROM aggregate_jobs WHERE season_id = :'sid';
SELECT 'trash rows', count(*) FROM league_trash;
SELECT 'tombstone', rebuild_pending IS NOT NULL FROM (SELECT 1 AS rebuild_pending FROM league_trash_restore_rebuilds WHERE season_id = :'sid') s;
SELECT league_trash_restore_rebuild_done(:'sid') AS tombstone_cleared;

-- P6 preflight report: the sanitized, READ-ONLY measurement the maintenance transfer needs
-- (docs/phase-separation.md, "P6 preflight"; plan section 4.A).
--
-- Local stack (the rehearsal this file is tested on):
--   docker exec -i supabase_db_poketools psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < scripts/phase-separation/p6-preflight.sql
--
-- Production, by the deployment owner only, on an operator connection:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/phase-separation/p6-preflight.sql
--
-- Every statement below is a SELECT. The whole file runs in ONE BEGIN READ ONLY transaction, so a write
-- (and any function that writes) aborts the run instead of changing anything. Nothing here creates a temp
-- table, selects INTO, or calls a function that writes; the dynamic counting uses query_to_xml() around a
-- `SELECT count(*)`, which is the only way to close a per-league inventory predicate over every league at
-- once without a scratch table.
--
-- Output is counts, booleans and ids only: no player name, e-mail, avatar, credential, replay hash, share
-- token or other private row value is ever selected. The owner runs this against the hosted project; agents
-- and CI never do (AGENTS.md, "Automation never spends the Supabase quota").
--
-- `\timing on` prints a cost line per statement, so the owner sees which block costs what: the maintenance
-- window is chosen from this measurement, not from a total. Blocks are emitted cheapest-first and the one
-- inherently linear anti-join (section 9) runs last, alone, so a slow block cannot hide the rest. The numeric
-- prefix in each `section` label is the plan's section number, not the emission order.
--
-- Blocks, in emission order (plan number first):
--   3   applied migration versions, and whether the five phase migrations of the plan are applied  (catalog-ledger)
--   4   foreign keys from outside the inventory into the moved graph (retarget or refuse)           (catalog only)
--   5   INSERT/DELETE triggers on the moved tables that are not the known phase guards              (catalog only)
--   10  current storage generation, and phase rows that exist while the mode is not yet `phase`     (singleton + small)
--   8   replay-hash and share/stream-key collisions (counts only, never the key values)             (linear in games/teams)
--   2   trash generation: snapshots that hold phase-owned families                                 (linear in captured payload)
--   7   aggregate queues, leases and the work a freeze would strand                                (linear in jobs/games)
--   6   null and cross-owner anomalies, each a count, plus the informational standalone-with-children count (linear in matches/stats)
--   1   ownership families: phase-owned rows and bytes per inventory relation, plus the grand total (widest: every relation)
--   11  JSON-embedded moved ids, one scan per jsonb column of an owned/derived relation     (linear in jsonb payload)
--   9   historical group repair prerequisite: group slots held by a player outside the phase roster (one anti-join, last)
--
-- The native-generation blocks (10, the cross-store half of 8, 7c and 6b) are gated on the probe above: on a
-- pre-bundle schema they print `skipped: needs <file>` rows, and blocks 1, 2, 4, 5, 9 and 11 keep producing the
-- legacy figures the maintenance window is sized from.

BEGIN READ ONLY;
SET LOCAL lock_timeout = '5s';
\timing on

-- Schema capability. The P6 order is preflight, then migrations, then transfer, so this report has to run
-- against BOTH schema states: the pre-bundle schema (production's head before the phase bundle) and the full
-- bundle. One probe decides whether a block may speak about the native generation; blocks that must are
-- wrapped in \if and print an explicit `skipped: needs <file>` row instead of failing the run, so the owner
-- sees the whole report with named holes rather than a truncated one. The legacy halves always run: those
-- numbers are what the window is sized from.
SELECT CASE WHEN to_regclass('public.league_phases') IS NOT NULL
             AND to_regclass('public.phase_storage_state') IS NOT NULL
             AND EXISTS (SELECT 1 FROM public.league_trash__inventory() i WHERE i.rel = 'league_phases')
            THEN 'true' ELSE 'false' END AS bundle_ready \gset

\echo
\echo '### P6 preflight: read-only, sanitized. Blocks run cheapest-first; the section label is the plan number.'
\echo '### phase schema (bundle) applied:' :bundle_ready

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Applied migration versions.                                                  [plan 4.A: migration versions]
--
-- `supabase_migrations.schema_migrations` is the CLI's ledger, bounded by the number of applied files. The
-- second block is the phase bundle the plan names: an unapplied row there is the difference between "the
-- schema can hold the transfer" and "it cannot".
\echo
\echo '=== [3] Applied migration versions (complete ledger) ==='
SELECT '3.migrations'::text AS section, m.version, m.name
  FROM supabase_migrations.schema_migrations m
 ORDER BY m.version;

\echo '=== [3b] Phase migrations named by the plan ==='
SELECT '3.migrations-required'::text AS section,
       req.version,
       req.label,
       (m.version IS NOT NULL) AS applied
  FROM (VALUES
    ('20261117102000', 'phase_storage_fence'),
    ('20261118120000', 'legacy_format_storage_fence'),
    ('20261118121000', 'phase_replay_library'),
    ('20261118122000', 'phase_pokemon_item_usage'),
    ('20261118115000', 'phase_admin_roster_group_locks')
  ) AS req(version, label)
  LEFT JOIN supabase_migrations.schema_migrations m ON m.version = req.version
 ORDER BY req.version;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Outside references into the moved graph.                                     [plan 4.A: unrecognized FKs]
--
-- The moved graph is `league_phases` and every phase_* table (the targets) plus the legacy phase family the
-- transfer reads and deletes (the sources). A foreign key into that graph whose own table is NOT classified by
-- `league_trash__inventory()` (cast_sessions, agent_suggestions, player_streaks, ...) is a reference the
-- transfer must retarget or refuse: the inventory does not classify it, so neither the capture nor the restore
-- knows it. Catalog only, so this block is cheap on any database.
\echo
\echo '=== [4] Foreign keys into the moved graph from tables outside the inventory ==='
WITH inv AS (
  SELECT rel, cls FROM public.league_trash__inventory()
),
moved AS (
  -- phase targets
  SELECT rel FROM inv WHERE rel = 'league_phases' OR rel LIKE 'phase\_%'
  UNION
  -- the legacy phase family the manifest moves
  SELECT rel FROM inv WHERE cls IN ('owned', 'derived') AND rel IN
    ('tournaments','tournament_participants','tournament_groups','tournament_group_members',
     'rounds','tournament_reports','matches','games','battle_stats',
     'match_analyses','match_prep_analyses','match_prep_teams','match_proposals',
     'match_evolution_snapshots','epb_animation_views','broadcast_moments','teams',
     'resource_admins','discord_webhooks','social_integrations',
     'wiki_notes','wiki_note_reports','aggregates','player_aggregates','aggregate_jobs',
     'rating_history')
  UNION
  -- legacy children the inventory reaches only through a parent, plus the pointer tables the manifest touches
  SELECT rel FROM (VALUES ('match_outcomes'), ('cast_sessions')) AS x(rel)
)
SELECT '4.outside-fks'::text AS section,
       c.conname AS constraint_name,
       c.conrelid::regclass::text AS source_table,
       c.confrelid::regclass::text AS target_table,
       CASE c.confdeltype WHEN 'a' THEN 'no_action' WHEN 'r' THEN 'restrict' WHEN 'c' THEN 'cascade'
                          WHEN 'n' THEN 'set_null' WHEN 'd' THEN 'set_default' ELSE c.confdeltype::text
       END AS delete_action,
       c.condeferrable AS deferrable
  FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace
 WHERE c.contype = 'f'
   AND n.nspname = 'public'
   AND c.confrelid::regclass::text IN (SELECT rel FROM moved)
   AND c.conrelid::regclass::text NOT IN (SELECT rel FROM inv)
 ORDER BY source_table, target_table, constraint_name;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. Triggers on the moved tables.                                  [plan 4.A: no unknown INSERT trigger]
--
-- The known phase guard is `public.phase_storage__guard()` (registered as trg_phase_storage_guard on every phase
-- table, and as the legacy pointer guard on teams). Anything else that fires on INSERT or DELETE on a moved table
-- runs during the copy: the phase-side replay/cast/share locks and the integrity guards are expected, an unknown
-- one is what the plan forbids. Only INSERT/DELETE are listed, because an UPDATE-only trigger cannot fire on a
-- copy-in or on the legacy delete.
\echo
\echo '=== [5] INSERT/DELETE triggers on moved tables that are not the known phase guard ==='
WITH inv AS (
  SELECT rel, cls FROM public.league_trash__inventory()
),
moved AS (
  SELECT rel FROM inv WHERE rel = 'league_phases' OR rel LIKE 'phase\_%'
  UNION
  SELECT rel FROM inv WHERE cls IN ('owned', 'derived') AND rel IN
    ('tournaments','tournament_participants','tournament_groups','tournament_group_members',
     'rounds','tournament_reports','matches','games','battle_stats',
     'match_analyses','match_prep_analyses','match_prep_teams','match_proposals',
     'match_evolution_snapshots','epb_animation_views','broadcast_moments','teams',
     'resource_admins','discord_webhooks','social_integrations',
     'wiki_notes','wiki_note_reports','aggregates','player_aggregates','aggregate_jobs',
     'rating_history')
  UNION
  SELECT rel FROM (VALUES ('match_outcomes'), ('cast_sessions')) AS x(rel)
)
SELECT '5.triggers'::text AS section,
       c.relname::text AS table_name,
       t.tgname AS trigger_name,
       p.proname::text AS function_name,
       concat_ws('+',
                 CASE WHEN t.tgtype & 4 <> 0 THEN 'INSERT' END,
                 CASE WHEN t.tgtype & 8 <> 0 THEN 'DELETE' END,
                 CASE WHEN t.tgtype & 16 <> 0 THEN 'UPDATE' END) AS fires_on,
       CASE WHEN t.tgtype & 2 <> 0 THEN 'BEFORE' WHEN t.tgtype & 64 <> 0 THEN 'INSTEAD OF' ELSE 'AFTER' END AS timing,
       t.tgdeferrable AS deferrable,
       (t.tgtype & 1) = 1 AS for_each_row
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_proc p ON p.oid = t.tgfoid
 WHERE n.nspname = 'public'
   AND NOT t.tgisinternal
   AND c.relname IN (SELECT rel FROM moved)
   AND p.proname <> 'phase_storage__guard'
   AND (t.tgtype & 4 <> 0 OR t.tgtype & 8 <> 0)
 ORDER BY c.relname, t.tgname;

\echo '=== [4b] Scope: does this schema state know the phase targets? ==='
SELECT '4.outside-fks-scope'::text AS section,
       'phase_targets_in_inventory'::text AS item,
       EXISTS (SELECT 1 FROM public.league_trash__inventory() i WHERE i.rel = 'league_phases') AS known
UNION ALL
SELECT '5.triggers-scope', 'phase_targets_in_moved_set',
       EXISTS (SELECT 1 FROM public.league_trash__inventory() i WHERE i.rel = 'league_phases')
 ORDER BY 1, 2;

-- ---------------------------------------------------------------------------------------------------------------
-- 10. Storage state.                                                     [plan 4.A: current storage generation]
--
-- The mode is the operator-owned singleton. `phase_rows_present_while_not_phase` is the boolean the cutover must
-- start from: a native row on a stack that is not in phase mode is either rehearsal residue or a write that
-- escaped the fence, and both stop the transfer. The per-relation counts are cheap at preflight time precisely
-- because the native generation is supposed to be empty; they stop being cheap the moment the first one is not.
\echo
\if :bundle_ready
\echo '=== [10] Storage generation ==='
SELECT '10.storage-state'::text AS section,
       s.mode,
       (s.mode = 'phase') AS mode_allows_phase_writes,
       now() AS observed_at
  FROM public.phase_storage_state s;

\echo '=== [10b] Native phase rows per relation (largest first) ==='
WITH phase_rel AS (
  SELECT i.rel FROM public.league_trash__inventory() i
   WHERE i.rel = 'league_phases' OR i.rel LIKE 'phase\_%'
),
counts AS (
  SELECT r.rel,
         (xpath('//row/n/text()', query_to_xml(
           format('SELECT count(*) AS n FROM public.%I', r.rel), true, false, '')))[1]::text::bigint AS rows_present
    FROM phase_rel r
)
SELECT '10.phase-rows'::text AS section, c.rel, c.rows_present
  FROM counts c
 ORDER BY c.rows_present DESC NULLS LAST, c.rel;

\echo '=== [10c] Phase rows present while the mode is not phase ==='
WITH phase_rel AS (
  SELECT i.rel FROM public.league_trash__inventory() i
   WHERE i.rel = 'league_phases' OR i.rel LIKE 'phase\_%'
),
counts AS (
  SELECT r.rel,
         (xpath('//row/n/text()', query_to_xml(
           format('SELECT count(*) AS n FROM public.%I', r.rel), true, false, '')))[1]::text::bigint AS rows_present
    FROM phase_rel r
)
SELECT '10.phase-rows-early'::text AS section,
       (SELECT mode FROM public.phase_storage_state) AS mode,
       (coalesce(sum(c.rows_present), 0) > 0 AND (SELECT mode FROM public.phase_storage_state) <> 'phase')
         AS phase_rows_present_while_not_phase,
       coalesce(sum(c.rows_present), 0)::bigint AS phase_rows_total,
       count(*) FILTER (WHERE c.rows_present > 0)::bigint AS relations_holding_rows
  FROM counts c;
\else
\echo '=== [10] Storage generation: the phase schema is not applied, so there is no generation to report ==='
SELECT '10.storage-state'::text AS section, 'skipped'::text AS status,
       'needs 20261117102000_phase_storage_fence.sql'::text AS needs
UNION ALL
SELECT '10.phase-rows', 'skipped', 'needs 20261117100000_phase_owned_schema.sql'
UNION ALL
SELECT '10.phase-rows-early', 'skipped', 'needs 20261117100000_phase_owned_schema.sql'
 ORDER BY 1;
\endif

-- ---------------------------------------------------------------------------------------------------------------
-- 8. Replay and share-key collisions.                       [plan 4.A: replay/share-key collisions, counts only]
--
-- The phase generation keeps both uniqueness rules globally (games_replay_hash_key, the cast realtime lock and
-- the team share lock). A collision inside the union means the copy cannot keep the value, so it is counted
-- before the transfer. Counts only: the key values are never selected. One pass per store, three result rows.
\echo
\if :bundle_ready
\echo '=== [8] Replay-hash and share/stream-key collisions (counts only) ==='
SELECT '8.collisions'::text AS section, a.check_name, a.duplicate_keys, a.rows_in_duplicate_keys
  FROM (
    SELECT 'games_replay_hash_inside_the_phase_union'::text AS check_name,
           count(*)::bigint AS duplicate_keys,
           coalesce(sum(h.n), 0)::bigint AS rows_in_duplicate_keys
      FROM (SELECT u.replay_hash, count(*)::bigint AS n
              FROM (SELECT g.replay_hash FROM public.games g
                      JOIN public.matches m ON m.id = g.match_id
                      JOIN public.tournaments t ON t.id = m.tournament_id
                     WHERE t.season_id IS NOT NULL AND g.replay_hash IS NOT NULL
                    UNION ALL
                    SELECT pg.replay_hash FROM public.phase_games pg WHERE pg.replay_hash IS NOT NULL) u
             GROUP BY u.replay_hash
            HAVING count(*) > 1) h
    UNION ALL
    SELECT 'cast_realtime_key_across_both_session_stores',
           count(*), coalesce(sum(h.n), 0)
      FROM (SELECT u.k, count(*)::bigint AS n
              FROM (SELECT c.realtime_key AS k FROM public.cast_sessions c
                    UNION ALL
                    SELECT c.realtime_key FROM public.phase_cast_sessions c) u
             GROUP BY u.k
            HAVING count(*) > 1) h
    UNION ALL
    SELECT 'team_share_token_across_both_team_stores',
           count(*), coalesce(sum(h.n), 0)
      FROM (SELECT u.k, count(*)::bigint AS n
              FROM (SELECT t.share_token AS k FROM public.teams t WHERE t.share_token IS NOT NULL
                    UNION ALL
                    SELECT t.share_token FROM public.phase_teams t WHERE t.share_token IS NOT NULL) u
             GROUP BY u.k
            HAVING count(*) > 1) h
  ) AS a
 ORDER BY a.check_name;
\else
\echo '=== [8] Replay-hash and share-key collisions, legacy store only (the phase store does not exist yet) ==='
SELECT '8.collisions'::text AS section, a.check_name, a.duplicate_keys, a.rows_in_duplicate_keys
  FROM (
    SELECT 'games_replay_hash_inside_the_legacy_phase_family'::text AS check_name,
           count(*)::bigint AS duplicate_keys,
           coalesce(sum(h.n), 0)::bigint AS rows_in_duplicate_keys
      FROM (SELECT g.replay_hash, count(*)::bigint AS n
              FROM public.games g
              JOIN public.matches m ON m.id = g.match_id
              JOIN public.tournaments t ON t.id = m.tournament_id
             WHERE t.season_id IS NOT NULL AND g.replay_hash IS NOT NULL
             GROUP BY g.replay_hash
            HAVING count(*) > 1) h
    UNION ALL
    SELECT 'cast_realtime_key_inside_the_legacy_store',
           count(*), coalesce(sum(h.n), 0)
      FROM (SELECT c.realtime_key AS k, count(*)::bigint AS n
              FROM public.cast_sessions c
             GROUP BY c.realtime_key
            HAVING count(*) > 1) h
    UNION ALL
    SELECT 'team_share_token_inside_the_legacy_store',
           count(*), coalesce(sum(h.n), 0)
      FROM (SELECT t.share_token AS k, count(*)::bigint AS n
              FROM public.teams t WHERE t.share_token IS NOT NULL
             GROUP BY t.share_token
            HAVING count(*) > 1) h
  ) AS a
 ORDER BY a.check_name;
SELECT '8.collisions-skipped'::text AS section,
       'needs 20261117100000_phase_owned_schema.sql'::text AS needs;
\endif

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Trash generation.                                             [plan 4.A: legacy-stored deleted phases]
--
-- A captured snapshot is classified by the relations it holds, never by a guessed column: a row that carries
-- `league_phases`/`phase_*` was captured in the native generation, one that carries the legacy family is the
-- legacy shape P6 must convert, and one that carries both is a mixed capture. `purge_after` buckets show what
-- the freeze window expires next. Bytes are the stored jsonb payload (pg_column_size per captured table), so the
-- cost is linear in the size of the bin, not in the number of leagues.
\echo
\echo '=== [2] Trash generation (all captured snapshots, by format and purge bucket) ==='
WITH snap AS (
  -- a capture of an empty native table (n = 0) is not native-generation data, so the format is decided by the
  -- relations that actually hold rows
  SELECT tt.trash_id,
         bool_or(tt.n > 0 AND (tt.rel = 'league_phases' OR tt.rel LIKE 'phase\_%')) AS has_phase_family,
         bool_or(tt.n > 0 AND tt.rel IN ('tournaments','tournament_participants','tournament_groups','tournament_group_members',
                            'rounds','tournament_reports','matches','match_outcomes','games','battle_stats',
                            'match_analyses','match_prep_analyses','match_prep_teams','match_proposals',
                            'match_evolution_snapshots','epb_animation_views','broadcast_moments','teams',
                            'cast_sessions','resource_admins','discord_webhooks','social_integrations',
                            'wiki_notes','wiki_note_reports','aggregates','player_aggregates','aggregate_jobs',
                            'rating_history')) AS has_legacy_family,
         count(*)::bigint AS captured_tables,
         coalesce(sum(tt.n), 0)::bigint AS captured_rows,
         coalesce(sum(pg_column_size(tt.rows)), 0)::bigint AS captured_bytes
    FROM public.league_trash_tables tt
   GROUP BY tt.trash_id
)
SELECT '2.trash'::text AS section,
       CASE WHEN s.has_phase_family AND s.has_legacy_family THEN 'phase_and_legacy'
            WHEN s.has_phase_family THEN 'phase_only'
            WHEN s.has_legacy_family THEN 'legacy_only'
            WHEN s.trash_id IS NULL THEN 'no_captured_tables'
            ELSE 'other' END AS snapshot_format,
       CASE WHEN l.purge_after <= now() THEN 'expired'
            WHEN l.purge_after <= now() + interval '7 days' THEN 'due_in_0_7d'
            WHEN l.purge_after <= now() + interval '30 days' THEN 'due_in_8_30d'
            WHEN l.purge_after <= now() + interval '90 days' THEN 'due_in_31_90d'
            ELSE 'due_in_over_90d' END AS purge_bucket,
       count(*)::bigint AS trashed_leagues,
       coalesce(sum(s.captured_tables), 0)::bigint AS captured_tables,
       coalesce(sum(s.captured_rows), 0)::bigint AS captured_rows,
       coalesce(sum(s.captured_bytes), 0)::bigint AS captured_bytes,
       count(*) FILTER (WHERE s.has_phase_family)::bigint AS of_which_hold_phase_family
  FROM public.league_trash l
  LEFT JOIN snap s ON s.trash_id = l.id
 GROUP BY 2, 3
 ORDER BY 2, 3;

\echo '=== [2b] Trash rows whose snapshots hold a phase-owned family (the conversion scope) ==='
WITH snap AS (
  SELECT tt.trash_id,
         bool_or(tt.n > 0 AND (tt.rel = 'league_phases' OR tt.rel LIKE 'phase\_%')) AS has_phase_family,
         bool_or(tt.n > 0 AND tt.rel IN ('tournaments','tournament_participants','tournament_groups','tournament_group_members',
                            'rounds','tournament_reports','matches','match_outcomes','games','battle_stats',
                            'match_analyses','match_prep_analyses','match_prep_teams','match_proposals',
                            'match_evolution_snapshots','epb_animation_views','broadcast_moments','teams',
                            'cast_sessions','resource_admins','discord_webhooks','social_integrations',
                            'wiki_notes','wiki_note_reports','aggregates','player_aggregates','aggregate_jobs',
                            'rating_history')) AS has_legacy_family,
         count(*)::bigint AS captured_tables,
         coalesce(sum(tt.n), 0)::bigint AS captured_rows,
         coalesce(sum(pg_column_size(tt.rows)), 0)::bigint AS captured_bytes
    FROM public.league_trash_tables tt
   GROUP BY tt.trash_id
)
SELECT '2.trash-scope'::text AS section,
       CASE WHEN s.has_phase_family THEN 'holds_native_phase_rows'
            ELSE 'legacy_snapshot_needs_conversion' END AS snapshot_shape,
       count(*)::bigint AS trashed_leagues,
       coalesce(sum(s.captured_tables), 0)::bigint AS captured_tables,
       coalesce(sum(s.captured_rows), 0)::bigint AS captured_rows,
       coalesce(sum(s.captured_bytes), 0)::bigint AS captured_bytes,
       count(*) FILTER (WHERE l.purge_after <= now())::bigint AS of_which_expired,
       count(*) FILTER (WHERE l.rebuild_pending)::bigint AS of_which_rebuild_pending
  FROM public.league_trash l
  JOIN snap s ON s.trash_id = l.id
 WHERE s.has_phase_family OR s.has_legacy_family
 GROUP BY 2
 ORDER BY 2;

\echo '=== [2c] Relations held by captured snapshots (phase generation and legacy family) ==='
SELECT '2.trash-relations'::text AS section,
       CASE WHEN tt.rel = 'league_phases' OR tt.rel LIKE 'phase\_%' THEN 'native_phase_generation'
            ELSE 'legacy_phase_family' END AS generation,
       tt.rel,
       count(DISTINCT tt.trash_id)::bigint AS snapshots,
       coalesce(sum(tt.n), 0)::bigint AS captured_rows,
       coalesce(sum(pg_column_size(tt.rows)), 0)::bigint AS captured_bytes
  FROM public.league_trash_tables tt
 WHERE tt.n > 0
   AND (tt.rel = 'league_phases' OR tt.rel LIKE 'phase\_%'
    OR tt.rel IN ('tournaments','tournament_participants','tournament_groups','tournament_group_members',
                  'rounds','tournament_reports','matches','match_outcomes','games','battle_stats',
                  'match_analyses','match_prep_analyses','match_prep_teams','match_proposals',
                  'match_evolution_snapshots','epb_animation_views','broadcast_moments','teams',
                  'cast_sessions','resource_admins','discord_webhooks','social_integrations',
                  'wiki_notes','wiki_note_reports','aggregates','player_aggregates','aggregate_jobs',
                  'rating_history'))
 GROUP BY 2, 3
 ORDER BY 2, 3;

\echo '=== [2d] Physical footprint of the trash tables ==='
SELECT '2.trash-footprint'::text AS section,
       c.relname::text AS rel,
       pg_total_relation_size(c.oid) AS relation_bytes
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relname IN ('league_trash', 'league_trash_tables')
 ORDER BY 2;

-- ---------------------------------------------------------------------------------------------------------------
-- 7. Queues and leases.                                             [plan 4.A: queues/leases; 4.B drain]
--
-- The aggregate worker is what a freeze must drain: a queued job for a phase-owned game has no worker once the
-- transfer locks the tables. Leases are the games a caster or submitter still holds. Both stores are listed
-- because the maintenance boundary straddles them; the legacy half always runs, the native half only when the
-- phase schema is applied. Cost is linear in the job tables and in the games they name, through indexed joins.
\echo
\echo '=== [7] Aggregate queues for phase-owned games, by status (legacy generation) ==='
SELECT '7.queues'::text AS section,
       'legacy_generation'::text AS generation,
       j.status,
       count(*)::bigint AS jobs,
       count(*) FILTER (WHERE j.operation = 'increment')::bigint AS increment_jobs,
       count(*) FILTER (WHERE j.operation = 'decrement')::bigint AS decrement_jobs
  FROM public.aggregate_jobs j
  JOIN public.games g ON g.id = j.game_id
  JOIN public.matches m ON m.id = g.match_id
  JOIN public.tournaments t ON t.id = m.tournament_id
 WHERE t.season_id IS NOT NULL
 GROUP BY j.status
 ORDER BY j.status;

\echo '=== [7b] Work a freeze would strand, and open leases (legacy generation) ==='
SELECT '7.stranded'::text AS section, a.item, a.n
  FROM (
    SELECT 'legacy_aggregate_jobs_pending'::text AS item, count(*)::bigint AS n
      FROM public.aggregate_jobs j
      JOIN public.games g ON g.id = j.game_id
      JOIN public.matches m ON m.id = g.match_id
      JOIN public.tournaments t ON t.id = m.tournament_id
     WHERE t.season_id IS NOT NULL AND j.status = 'pending'
    UNION ALL
    SELECT 'legacy_aggregate_jobs_processing', count(*)
      FROM public.aggregate_jobs j
      JOIN public.games g ON g.id = j.game_id
      JOIN public.matches m ON m.id = g.match_id
      JOIN public.tournaments t ON t.id = m.tournament_id
     WHERE t.season_id IS NOT NULL AND j.status = 'processing'
    UNION ALL
    SELECT 'legacy_aggregate_jobs_failed', count(*)
      FROM public.aggregate_jobs j
      JOIN public.games g ON g.id = j.game_id
      JOIN public.matches m ON m.id = g.match_id
      JOIN public.tournaments t ON t.id = m.tournament_id
     WHERE t.season_id IS NOT NULL AND j.status = 'failed'
    UNION ALL
    SELECT 'legacy_games_with_an_active_edit_lease', count(*)
      FROM public.games g
      JOIN public.matches m ON m.id = g.match_id
      JOIN public.tournaments t ON t.id = m.tournament_id
     WHERE t.season_id IS NOT NULL AND g.edit_lease_until IS NOT NULL AND g.edit_lease_until > now()
    UNION ALL
    SELECT 'legacy_games_with_any_edit_lease_marker', count(*)
      FROM public.games g
      JOIN public.matches m ON m.id = g.match_id
      JOIN public.tournaments t ON t.id = m.tournament_id
     WHERE t.season_id IS NOT NULL AND g.edit_lease_token IS NOT NULL
    UNION ALL
    SELECT 'legacy_phase_cast_sessions_live', count(*)
      FROM public.cast_sessions c JOIN public.tournaments t ON t.id = c.tournament_id
     WHERE c.status = 'live' AND t.season_id IS NOT NULL
  ) AS a
 ORDER BY a.item;

\if :bundle_ready
\echo '=== [7c] Aggregate queues and leases, native generation ==='
SELECT '7.queues'::text AS section,
       'native_phase_generation'::text AS generation,
       j.status,
       count(*)::bigint AS jobs,
       count(*) FILTER (WHERE j.operation = 'increment')::bigint AS increment_jobs,
       count(*) FILTER (WHERE j.operation = 'decrement')::bigint AS decrement_jobs
  FROM public.phase_aggregate_jobs j
 GROUP BY j.status
 ORDER BY j.status;

SELECT '7.stranded'::text AS section, a.item, a.n
  FROM (
    SELECT 'phase_aggregate_jobs_pending'::text AS item, count(*)::bigint AS n
      FROM public.phase_aggregate_jobs j WHERE j.status = 'pending'
    UNION ALL
    SELECT 'phase_aggregate_jobs_processing', count(*)
      FROM public.phase_aggregate_jobs j WHERE j.status = 'processing'
    UNION ALL
    SELECT 'phase_aggregate_jobs_failed', count(*)
      FROM public.phase_aggregate_jobs j WHERE j.status = 'failed'
    UNION ALL
    SELECT 'phase_games_with_an_active_edit_lease', count(*)
      FROM public.phase_games g
     WHERE g.edit_lease_until IS NOT NULL AND g.edit_lease_until > now()
    UNION ALL
    SELECT 'phase_cast_sessions_live', count(*)
      FROM public.phase_cast_sessions c WHERE c.status = 'live'
  ) AS a
 ORDER BY a.item;
\else
\echo '=== [7c] Native-generation queues and leases: the phase schema is not applied ==='
SELECT '7.queues'::text AS section, 'skipped'::text AS status,
       'needs 20261117100000_phase_owned_schema.sql'::text AS needs
UNION ALL
SELECT '7.stranded', 'skipped', 'needs 20261117100000_phase_owned_schema.sql'
 ORDER BY 1;
\endif

-- ---------------------------------------------------------------------------------------------------------------
-- 6. Null and cross-owner anomalies.                                    [plan 4.A: null/cross-owner anomalies]
--
-- One row per check, always a count. `check_name` says exactly what was counted, so the owner can reproduce it;
-- nothing here names a player, a credential or a row value. Each check walks one family through its indexed
-- parent key, so the cost is linear in matches/games/battle_stats, not quadratic. The legacy checks run on every
-- schema state; the native ones are gated because they read the phase tables. A pre-bundle run therefore reports
-- the holes as explicit rows instead of stopping at the first missing relation.
\echo
\echo '=== [6] Standalone tournaments holding children (informational, not an anomaly) ==='
-- A standalone tournament that holds participants, groups, rounds or matches is what a standalone event is;
-- reporting it as an anomaly made every real standalone event look like a broken league phase. It is counted
-- here, apart from the anomaly table, and the anomaly itself moved into block 6 as the discriminator: a row
-- that carries a marker no standalone write path can set without a season.
SELECT '6.standalone'::text AS section, 'standalone_tournaments_holding_children'::text AS item,
       count(*)::bigint AS n
  FROM public.tournaments t
 WHERE t.season_id IS NULL
   AND (EXISTS (SELECT 1 FROM public.tournament_participants p WHERE p.tournament_id = t.id)
     OR EXISTS (SELECT 1 FROM public.tournament_groups g WHERE g.tournament_id = t.id)
     OR EXISTS (SELECT 1 FROM public.rounds r WHERE r.tournament_id = t.id)
     OR EXISTS (SELECT 1 FROM public.matches m WHERE m.tournament_id = t.id));

\echo
\echo '=== [6] Null and cross-owner anomalies, legacy family (counts) ==='
SELECT '6.anomalies'::text AS section, a.check_name, a.n
  FROM (
    -- a league stage that lost its season: this is the anomaly the plain "standalone with children" count used to
    -- be mistaken for. Both arms are markers no standalone write path can set:
    --   enrollment_source is written only by syncStandingsEnrollment, which throws unless the phase's season_id
    --   equals the league id it was called with;
    --   format_stage_key is written only by the season-scoped format materialisation functions, which insert it
    --   with that season's id.
    -- stage_order is deliberately not an arm: POST /api/tournaments accepts it and createTournament writes it,
    -- and PATCH /api/tournaments/[id] accepts it because the phase-editability guard returns early when the row
    -- has no season. A standalone event may legally carry a stage order.
    SELECT 'league_stages_missing_their_season'::text AS check_name, count(*)::bigint AS n
      FROM public.tournaments t
     WHERE t.season_id IS NULL
       AND (t.enrollment_source IS NOT NULL OR t.format_stage_key IS NOT NULL)
    UNION ALL
    -- a child that claims a league while its tournament is standalone: two owners for one row
    SELECT 'children_claiming_league_under_standalone_tournament', count(*)
      FROM public.teams x JOIN public.tournaments t ON t.id = x.tournament_id
     WHERE x.season_id IS NOT NULL AND t.season_id IS NULL
    UNION ALL
    SELECT 'cast_sessions_claiming_league_under_standalone_tournament', count(*)
      FROM public.cast_sessions x JOIN public.tournaments t ON t.id = x.tournament_id
     WHERE x.season_id IS NOT NULL AND t.season_id IS NULL
    UNION ALL
    -- a league-owned match whose round belongs to another tournament
    SELECT 'matches_whose_round_is_in_another_tournament', count(*)
      FROM public.matches m JOIN public.tournaments t ON t.id = m.tournament_id
      JOIN public.rounds r ON r.id = m.round_id
     WHERE t.season_id IS NOT NULL AND r.tournament_id <> m.tournament_id
    UNION ALL
    -- a game whose statistics name a player the owning phase never enrolled
    SELECT 'battle_stats_player_outside_the_phase_roster', count(*)
      FROM public.battle_stats b
      JOIN public.games g ON g.id = b.game_id
      JOIN public.matches m ON m.id = g.match_id
      JOIN public.tournaments t ON t.id = m.tournament_id
     WHERE t.season_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.tournament_participants p
                        WHERE p.tournament_id = t.id AND p.player_id = b.player_id)
    UNION ALL
    SELECT 'broadcast_moments_whose_game_is_in_another_match', count(*)
      FROM public.broadcast_moments bm JOIN public.games g ON g.id = bm.game_id
     WHERE g.match_id <> bm.match_id
    UNION ALL
    -- a league pointer that no longer resolves
    SELECT 'tournaments_pointing_at_a_missing_season', count(*)
      FROM public.tournaments t
     WHERE t.season_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = t.season_id)
  ) AS a
 ORDER BY a.check_name;

\if :bundle_ready
\echo '=== [6b] Null and cross-owner anomalies, native generation (counts) ==='
SELECT '6.anomalies'::text AS section, a.check_name, a.n
  FROM (
    SELECT 'phase_groups_whose_season_differs_from_their_phase'::text AS check_name, count(*)::bigint AS n
      FROM public.phase_groups g JOIN public.league_phases p ON p.id = g.phase_id
     WHERE g.season_id <> p.season_id
    UNION ALL
    SELECT 'phase_group_members_whose_phase_differs_from_their_group', count(*)
      FROM public.phase_group_members m JOIN public.phase_groups g ON g.id = m.group_id
     WHERE m.phase_id <> g.phase_id
    UNION ALL
    SELECT 'phase_group_members_outside_the_phase_roster', count(*)
      FROM public.phase_group_members m
     WHERE NOT EXISTS (SELECT 1 FROM public.phase_participants p
                        WHERE p.phase_id = m.phase_id AND p.player_id = m.player_id)
    UNION ALL
    SELECT 'phase_participants_outside_their_league_roster', count(*)
      FROM public.phase_participants pp JOIN public.league_phases p ON p.id = pp.phase_id
     WHERE NOT EXISTS (SELECT 1 FROM public.season_participants sp
                        WHERE sp.season_id = p.season_id AND sp.player_id = pp.player_id)
    UNION ALL
    SELECT 'phase_aggregate_jobs_whose_owner_disagrees_with_their_game', count(*)
      FROM public.phase_aggregate_jobs j
      JOIN public.phase_games g ON g.id = j.game_id
      JOIN public.phase_matches m ON m.id = g.match_id
      JOIN public.league_phases p ON p.id = m.phase_id
     WHERE j.phase_id <> p.id OR j.season_id <> p.season_id OR j.match_id <> m.id
    UNION ALL
    SELECT 'league_phases_pointing_at_a_missing_season', count(*)
      FROM public.league_phases p
     WHERE NOT EXISTS (SELECT 1 FROM public.seasons s WHERE s.id = p.season_id)
    UNION ALL
    -- UUID preservation is only safe when no standalone tournament already owns the id
    SELECT 'phase_ids_colliding_with_an_independent_tournament', count(*)
      FROM public.league_phases p
     WHERE EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = p.id AND t.season_id IS NULL)
  ) AS a
 ORDER BY a.check_name;
\else
\echo '=== [6b] Native-generation anomaly checks: the phase schema is not applied ==='
SELECT '6.anomalies-skipped'::text AS section, 'skipped'::text AS status,
       'needs 20261117100000_phase_owned_schema.sql'::text AS needs;
\endif

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Ownership families.                              [plan 4.A: row counts/bytes by ownership family]
--
-- A "league phase" is derived from `tournaments.season_id IS NOT NULL`: the inventory closes that root over the
-- whole FK/polymorphic graph, so running its predicate with the season root widened to every season counts
-- exactly the rows the transfer would see. `league_trash__x()` expands the {phases}/{matches}/... tokens; the
-- remaining `$1` is the season; it always appears as `= $1`, and here that comparison is widened to
-- `= ANY (SELECT id FROM public.seasons)` so one statement counts every league. The phase_* generation is counted the same way through `{native_phases}`.
--
-- This is the widest block: one indexed count per inventory relation (~100), each linear in that relation's row
-- count. It is also the number the maintenance window is chosen from, so it is measured, not bounded.
--
-- relation_bytes is the whole relation's footprint (pg_total_relation_size, which includes indexes and TOAST).
-- owned_bytes_estimate is that footprint scaled by the owned row share: the honest estimate available without
-- per-row reads. `rows_total` is the full table count, so a relation that is mostly standalone stays visible.
-- The split is by store generation only: `legacy_and_league_level` also holds the league-level families that the
-- transfer does not move (drafts, enrollment, storylines), so the transfer's own size is the per-relation rows.
\echo
\echo '=== [1] Ownership families: every relation, then the split and the grand total ==='
WITH inv AS (
  SELECT i.rel, i.cls,
         -- every inventory predicate takes the season as $1, always as `= $1`; `= ANY (...)` is the
         -- multi-league widening of exactly that comparison, so one statement counts every league
         replace(public.league_trash__x(i.pred), '= $1', '= ANY (SELECT id FROM public.seasons)') AS pred
    FROM public.league_trash__inventory() i
   WHERE i.cls IN ('owned', 'derived')
),
counted AS (
  -- one scan per relation: both counts are extracted from the same result document
  SELECT inv.rel, inv.cls,
         (xpath('//row/n/text()', d.doc))[1]::text::bigint AS rows_owned,
         (xpath('//row/t/text()', d.doc))[1]::text::bigint AS rows_total,
         pg_total_relation_size(('public.' || quote_ident(inv.rel))::regclass) AS relation_bytes
    FROM inv
   CROSS JOIN LATERAL (
     SELECT query_to_xml(
              format('SELECT count(*) FILTER (WHERE %s) AS n, count(*) AS t FROM public.%I', inv.pred, inv.rel),
              true, false, '') AS doc
   ) d
),
rels AS (
  SELECT CASE WHEN c.rel = 'league_phases' OR c.rel LIKE 'phase\_%' THEN 'native_phase_generation'
              ELSE 'legacy_and_league_level' END AS generation,
         c.rel, c.cls, c.rows_owned, c.rows_total, c.relation_bytes,
         CASE WHEN c.rows_total > 0 THEN (c.relation_bytes * c.rows_owned) / c.rows_total ELSE 0 END AS owned_bytes_estimate
    FROM counted c
)
SELECT x.section, x.generation, x.rel, x.cls, x.rows_owned, x.rows_total, x.relation_bytes, x.owned_bytes_estimate
  FROM (
    SELECT 1 AS sort_key, '1.ownership'::text AS section, r.generation, r.rel, r.cls,
           r.rows_owned, r.rows_total, r.relation_bytes, r.owned_bytes_estimate
      FROM rels r
    UNION ALL
    SELECT 2, '1.ownership-split', r.generation, NULL::text, NULL::text,
           sum(r.rows_owned)::bigint, NULL::bigint, sum(r.relation_bytes)::bigint, sum(r.owned_bytes_estimate)::bigint
      FROM rels r
     GROUP BY r.generation
    UNION ALL
    SELECT 3, '1.ownership-total', 'all_inventoried'::text, NULL::text, NULL::text,
           sum(r.rows_owned)::bigint, NULL::bigint, sum(r.relation_bytes)::bigint, sum(r.owned_bytes_estimate)::bigint
      FROM rels r
  ) x
 ORDER BY x.sort_key, (x.rows_owned = 0), x.rows_owned DESC, x.generation, x.rel;

-- ---------------------------------------------------------------------------------------------------------------
-- 11. JSON-embedded moved ids.                                  [plan 4.A: keys embedded in JSON]
--
-- The inventory's predicates compare columns, so an id that lives only inside a jsonb document (stage specs,
-- enrollment sources, format runtime subjects, stored analysis payloads) is invisible to section 1. This block
-- discovers the candidates from the catalog — every jsonb column on a relation the inventory classifies
-- owned/derived, plus the two phase parents — and scans each one for UUID text that resolves to an id the
-- transfer moves (phase, match, round and game ids of both generations).
--
-- One statement per column through \gexec, so `\timing` attributes the cost to the exact column that spends it.
-- A relation whose reltuples estimate is above 2,000,000 is not scanned: it is printed as skipped_oversize with
-- its estimate, so the omission is visible. No count is limited. `estimated_rows` of -1 means the planner has
-- never analysed that relation, which is normal for a table that is still empty.
\echo
\echo '=== [11] JSON-embedded moved ids: rel|column_name|status|scanned|estimated_rows|moved_id_scope|rows_hit|distinct_moved_ids ==='
\set QUIET 1
\pset format unaligned
\pset tuples_only on
\unset QUIET
WITH inventory AS (
  SELECT rel, cls FROM public.league_trash__inventory()
),
moved_ids AS (
  -- The ids the transfer moves. The native half is appended only when the phase schema is applied: the
  -- references sit inside a string, so a pre-bundle run never parses them. `moved_id_scope` reports which set
  -- was used, so a pre-bundle run cannot look like a complete answer.
  SELECT $ids$SELECT id FROM public.tournaments WHERE season_id IS NOT NULL
UNION SELECT m.id FROM public.matches m JOIN public.tournaments t ON t.id = m.tournament_id WHERE t.season_id IS NOT NULL
UNION SELECT r.id FROM public.rounds r JOIN public.tournaments t ON t.id = r.tournament_id WHERE t.season_id IS NOT NULL
UNION SELECT g.id FROM public.games g JOIN public.matches m ON m.id = g.match_id JOIN public.tournaments t ON t.id = m.tournament_id WHERE t.season_id IS NOT NULL$ids$
       || CASE WHEN EXISTS (SELECT 1 FROM public.league_trash__inventory() i WHERE i.rel = 'league_phases')
               THEN $ids$
UNION SELECT id FROM public.league_phases
UNION SELECT id FROM public.phase_matches
UNION SELECT id FROM public.phase_rounds
UNION SELECT id FROM public.phase_games$ids$ ELSE '' END AS ids_sql,
       CASE WHEN EXISTS (SELECT 1 FROM public.league_trash__inventory() i WHERE i.rel = 'league_phases')
            THEN 'legacy_and_native' ELSE 'legacy_only' END AS id_scope
),
candidates AS (
  SELECT c.relname, a.attname, c.reltuples
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    JOIN pg_type ty ON ty.oid = a.atttypid AND ty.typname = 'jsonb'
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND (c.relname IN (SELECT rel FROM inventory WHERE cls IN ('owned', 'derived'))
          OR c.relname IN ('tournaments', 'league_phases'))
     AND c.relname NOT IN ('audit_log', 'draft_action_log', 'league_trash_tables')
)
SELECT format($gen$
SELECT '11.json-refs'::text AS section,
       %1$L::text AS rel,
       %2$L::text AS column_name,
       %3$L::text AS status,
       %4$L::boolean AS scanned,
       %5$s::bigint AS estimated_rows,
       %7$L::text AS moved_id_scope,
       CASE WHEN %4$L::boolean THEN (xpath('//row/a/text()', s.doc))[1]::text::bigint END AS rows_hit,
       CASE WHEN %4$L::boolean THEN (xpath('//row/b/text()', s.doc))[1]::text::bigint END AS distinct_moved_ids
  FROM (SELECT query_to_xml(%6$L, true, false, '') AS doc) s$gen$,
       c.relname,
       c.attname,
       CASE WHEN c.reltuples > 2000000 THEN 'skipped_oversize' ELSE 'scanned' END,
       (c.reltuples <= 2000000),
       c.reltuples::bigint,
       CASE WHEN c.reltuples <= 2000000 THEN
         format('SELECT count(DISTINCT t.ctid) AS a, count(DISTINCT h.id) AS b '
                'FROM public.%I t CROSS JOIN LATERAL (SELECT (x)[1]::uuid AS id '
                'FROM regexp_matches(t.%I::text, %L, ''g'') AS x) h JOIN (%s) mv ON mv.id = h.id',
                c.relname, c.attname,
                '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
                (SELECT ids_sql FROM moved_ids))
       END,
       (SELECT id_scope FROM moved_ids)) AS stmt
  FROM candidates c
 ORDER BY c.relname, c.attname
\gexec
\set QUIET 1
\pset tuples_only off
\pset format aligned
\unset QUIET

-- ---------------------------------------------------------------------------------------------------------------
-- 9. Historical group repair prerequisite.                  [plan 4.A / docs: historical group repair]
--
-- A legacy group slot held by a player who is not in that phase's roster cannot be copied: the native
-- phase_group_members participant FK requires enrollment (docs/phase-separation.md, "Historical group repair").
-- Rows are derived through the group (group -> tournament -> league), grouped by phase id, and stop at counts.
--
-- This is the only block whose per-row work is an anti-join, so it runs last and alone. Output is bounded to 200
-- phase ids after the total row (both come from the same pass, so the bound never hides the true number): the
-- `truncated` flag says whether more phases exist than are printed. The scan itself is one pass over
-- tournament_group_members with a pkey probe into tournament_participants per row.
\echo
\echo '=== [9] Group slots whose player is outside the owning phase roster (total row first) ==='
WITH orphans AS (
  SELECT t.id AS phase_id,
         count(*)::bigint AS orphan_group_members,
         count(DISTINCT g.id)::bigint AS affected_groups
    FROM public.tournament_group_members m
    JOIN public.tournament_groups g ON g.id = m.group_id
    JOIN public.tournaments t ON t.id = g.tournament_id
   WHERE t.season_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.tournament_participants p
                      WHERE p.tournament_id = t.id AND p.player_id = m.player_id)
   GROUP BY GROUPING SETS ((t.id), ())
)
SELECT '9.group-orphans'::text AS section,
       o.phase_id,
       (o.phase_id IS NULL) AS is_total,
       o.orphan_group_members,
       o.affected_groups,
       count(*) FILTER (WHERE o.phase_id IS NOT NULL) OVER ()::bigint AS phases_with_orphans,
       (count(*) OVER () > 201) AS truncated
  FROM orphans o
 ORDER BY (o.phase_id IS NOT NULL), o.phase_id
 LIMIT 201;

COMMIT;

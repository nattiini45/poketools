-- League recycle bin: deleting a league moves it to the trash for a retention window; the superadmin can restore it,
-- a daily cron removes expired entries. Part 1 of 6 (tables, functions, grants, the streak key swap, the small indexes);
-- the later files validate the swapped key and build the four large-table indexes CONCURRENTLY (one statement per file:
-- the CLI sends a file as a pipeline, which CREATE INDEX CONCURRENTLY refuses unless it is the only statement).
--
--   league_trash                         One row per trashed league: name, deleted by/at, purge_after, row counts for the
--                                        trash page, the players and phases the league touched, the highest migration
--                                        applied at delete time, and the rebuild_pending marker. Service-role only.
--   league_trash_tables                  One row per captured table (the league's rows as a jsonb array of row_to_json).
--   league_trash_players / _rulesets /   Junction tables, ON DELETE RESTRICT, filled at delete FROM THE CAPTURED ROWS: every
--   _point_buy_versions                  player, ruleset and point-buy list version a captured row points at. They make the
--                                        database refuse EVERY delete of such a parent (claim_guest_player, a ruleset delete,
--                                        the Showdown ruleset cleanup, a player delete) while the league sits in the trash,
--                                        so a restore never meets a vanished NOT NULL parent. They cascade away with the
--                                        trash row (restore or purge).
--   league_trash_restore_rebuilds        Tombstone keyed by season_id, written by a restore and removed once the app has
--                                        rebuilt the derived data (the matching marker of a delete is
--                                        league_trash.rebuild_pending).
--   league_trash__inventory()            THE inventory (the one place that classifies every table the league reaches):
--                                          owned    captured, deleted, restored
--                                          derived  deleted, NOT captured; rebuilt from the remaining matches by the app
--                                                   (aggregates scope rows, player_aggregates, aggregate_jobs, rating_history)
--                                          kept     append-only logs that outlive the league (audit_log, draft_action_log)
--                                        The predicate of a row selects the league's rows; $1 is the season id and {x}
--                                        tokens expand in league_trash__x().
--   league_trash__pointers()             Rows OUTSIDE the league that point into it (ON DELETE SET NULL, or the derived
--                                        streak pointer): recorded as (table, id, column, old value) and re-linked on restore
--                                        when the row still exists and the column is still NULL.
--   league_trash__external_parents()     Rows the league points AT and never owns (players, rulesets, list versions, list
--                                        entries, format definitions) and how each is protected while the league is trashed.
--   league_trash__restore_plan()         Insert order of a restore (FK order plus the guard-trigger order below).
--   league_trash__assert_inventory()     Aborts a delete BEFORE it touches anything when a table references the league
--                                        subtree, or an owned table references a parent, that no list above classifies.
--   league_trash_delete(season, actor, days)   ONE transaction: advisory lock, then the league row, freeze running draft
--                                        clocks, capture, protect the parents, delete in FK-safe order.
--   league_trash_restore(trash_id)       ONE transaction: re-insert the captured rows with their ids over the column
--                                        intersection, shift EVERY running deadline by the time spent in the trash, queue the
--                                        restored games for the aggregate worker, re-link the outside rows, drop the trash
--                                        row. Restored running drafts come back PAUSED. Aborts unless every captured row
--                                        came back (LEAGUE_TRASH_PLAN_MISMATCH).
--   league_trash_expire(now, limit)      Deletes expired trash rows (SKIP LOCKED, so a restore in progress wins).
--   league_trash_rebuild_done(trash)     The app calls these once its derived-data rebuild finished (delete / restore).
--   league_trash_restore_rebuild_done(season)
--   league_trash_schema_version()        Highest applied migration version. Owner rights: service_role cannot read
--                                        supabase_migrations.
--   league_trash__insert_rows(_owner)    The INSERT of one captured table over the column intersection. The _owner twin has
--                                        owner rights and only accepts league_trash__archive_tables(): the read-only archive
--                                        redraft_trade_requests, whose INSERT was revoked from service_role on purpose.
--
-- Delete order (all of it inside league_trash_delete): polymorphic rows (resource_admins, discord_webhooks,
-- social_integrations, wiki_notes) and the league / phase aggregate scopes (they key on the phase ids), then
-- matches (cascades games, battle_stats and the per-match rows; teams.match_id, cast_sessions and agent_suggestions
-- are SET NULL), then teams (the completed-match lock sees match_id NULL), tournaments, ALL draft pools in one
-- statement (initial + redraft, parent_pool_id and the circular pick/slot keys resolve at statement end),
-- season_storylines, and the league row (cascades the rest). tournament_groups and draft_pools reference
-- season_groups with ON DELETE RESTRICT, which is why phases and pools go before the league.
--
-- Restore order: see league_trash__restore_plan(). No existing guard trigger is bypassed: season_participants first
-- (no groups yet), pools without a group before season_groups (the group guard only counts non-cancelled
-- ones), season_groups, season_group_members (no rounds and no pool of the group exist yet), pools with a group,
-- trackers (the group trigger finds the members), tournaments, rounds BEFORE tournament_groups (the first-round
-- guard has nothing to compare yet), matches, tournament_groups and their members, games and children, teams.
-- The only cycle (redraft_slots.filled_by_pick_id <-> draft_picks.redraft_slot_id) is written in a second pass.
--
-- Time stands still in the trash: restore shifts every wall-clock deadline of the league by (restore time - delete time)
-- (draft_pools.submission_deadline_at / token_purchase_closes_at, draft_slots.deadline_at, matches.auto_confirm_at,
-- match_proposals.expires_at, rounds.deadline), whether or not it had already passed, so nothing becomes due the moment
-- a league comes back. Running queue drafts are frozen at delete with the draft_set_paused mechanics.
--
-- Aggregates: the games of a restored league come back with aggregate_applied_at NULL and ONE pending increment
-- aggregate_jobs row each (games with battle stats in a non-scheduled match, the set the scope rebuild counts), so the
-- existing worker rebuilds the league, tournament and all_time scopes atomically and resumably. Ratings, streaks and
-- the EPB repair stay in the app.
--
-- player_streaks.last_match_id becomes ON DELETE SET NULL: the NO ACTION key made every delete of a phase or league
-- that held a player's latest match fail with 23503; streaks are recomputed from the remaining matches afterwards.
-- The key is swapped NOT VALID here and validated by the next file (the weaker lock, per docs/operations-backup.md).
--
-- Grants: service_role only (20261008081443_close_public_api_roles.sql); every function is REVOKEd explicitly.
-- DEPLOY ORDER: this file and the five after it before the code that calls league_trash_delete / league_trash_restore.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.player_streaks DROP CONSTRAINT player_streaks_last_match_id_fkey;
ALTER TABLE public.player_streaks ADD CONSTRAINT player_streaks_last_match_id_fkey
  FOREIGN KEY (last_match_id) REFERENCES public.matches(id) ON DELETE SET NULL NOT VALID;

-- Keys on the delete path that no usable index covers (a deleted match, game, tracker or slot runs one referential
-- check per child table; without an index that is a sequential scan). League-scale tables only: the indexes of the
-- large tables are built CONCURRENTLY by the next files. Partial indexes are listed when the existing one cannot serve
-- the check (its predicate must be implied by the check, which it never is), and redraft_submissions because its
-- primary key leads with another column.
CREATE INDEX IF NOT EXISTS idx_epb_comeback_token_spends_tracker_id ON public.epb_comeback_token_spends (tracker_id);
CREATE INDEX IF NOT EXISTS idx_epb_draft_token_purchases_tracker_id ON public.epb_draft_token_purchases (tracker_id);
CREATE INDEX IF NOT EXISTS idx_redraft_history_from_tracker_id ON public.redraft_history (from_tracker_id) WHERE from_tracker_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_redraft_history_draft_pool_id ON public.redraft_history (draft_pool_id) WHERE draft_pool_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_draft_picks_redraft_slot_id ON public.draft_picks (redraft_slot_id) WHERE redraft_slot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_draft_picks_slot_id_all ON public.draft_picks (slot_id) WHERE slot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_evolution_tracker_redraft_slot_id ON public.evolution_tracker (redraft_slot_id) WHERE redraft_slot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_draft_slots_origin_slot_id ON public.draft_slots (origin_slot_id) WHERE origin_slot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_draft_slots_previous_slot_id ON public.draft_slots (previous_slot_id) WHERE previous_slot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_draft_pools_parent_pool_id ON public.draft_pools (parent_pool_id) WHERE parent_pool_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_redraft_submissions_tracker_id ON public.redraft_submissions (tracker_id);
CREATE INDEX IF NOT EXISTS idx_redraft_trade_requests_from_tracker_a ON public.redraft_trade_requests (from_tracker_a_id) WHERE from_tracker_a_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_redraft_trade_requests_from_tracker_b ON public.redraft_trade_requests (from_tracker_b_id) WHERE from_tracker_b_id IS NOT NULL;

-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE public.league_trash (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id       uuid NOT NULL,                       -- no FK: the league row is gone
  season_name     text NOT NULL,
  format_type      text NOT NULL,
  deleted_at      timestamptz NOT NULL DEFAULT now(),
  deleted_by      uuid REFERENCES public.players(id) ON DELETE SET NULL,
  deleted_by_name text,
  purge_after     timestamptz NOT NULL,
  counts          jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {table: rows}, for the trash page
  player_ids      uuid[] NOT NULL DEFAULT '{}',        -- every player the league touched (rating / streak rebuild)
  phase_ids       uuid[] NOT NULL DEFAULT '{}',        -- the league's phases (cache tags, tournament-scope aggregate clear)
  unlinked        jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{rel, col, id, old}] outside rows to re-link on restore
  schema_version  text,                                -- highest applied migration at delete time ("schema changed since delete")
  rebuild_pending boolean NOT NULL DEFAULT true,       -- the app's derived-data rebuild after the delete has not finished
  CONSTRAINT league_trash_window CHECK (purge_after > deleted_at)
);
CREATE UNIQUE INDEX uq_league_trash_season ON public.league_trash (season_id);
CREATE INDEX idx_league_trash_purge_after ON public.league_trash (purge_after);
CREATE INDEX idx_league_trash_deleted_by ON public.league_trash (deleted_by) WHERE deleted_by IS NOT NULL;
ALTER TABLE public.league_trash ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.league_trash FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.league_trash TO service_role;
COMMENT ON TABLE public.league_trash IS
  'Recycle bin of deleted leagues: one row per league, restorable until purge_after. The captured rows live in league_trash_tables. Service-role only.';

CREATE TABLE public.league_trash_tables (
  trash_id uuid NOT NULL REFERENCES public.league_trash(id) ON DELETE CASCADE,
  rel      text NOT NULL,
  cols     jsonb NOT NULL,                              -- column names at capture time (schema-drift guard on restore)
  n        integer NOT NULL,
  rows     jsonb NOT NULL,                              -- [to_jsonb(row)]
  PRIMARY KEY (trash_id, rel)
);
ALTER TABLE public.league_trash_tables ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.league_trash_tables FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.league_trash_tables TO service_role;
COMMENT ON TABLE public.league_trash_tables IS
  'The rows of one owned table of a trashed league (jsonb array) with the column list at capture time. Cascades with league_trash. Service-role only.';

CREATE TABLE public.league_trash_players (
  trash_id  uuid NOT NULL REFERENCES public.league_trash(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE RESTRICT,
  PRIMARY KEY (trash_id, player_id)
);
CREATE INDEX idx_league_trash_players_player_id ON public.league_trash_players (player_id);

CREATE TABLE public.league_trash_rulesets (
  trash_id   uuid NOT NULL REFERENCES public.league_trash(id) ON DELETE CASCADE,
  ruleset_id uuid NOT NULL REFERENCES public.rulesets(id) ON DELETE RESTRICT,
  PRIMARY KEY (trash_id, ruleset_id)
);
CREATE INDEX idx_league_trash_rulesets_ruleset_id ON public.league_trash_rulesets (ruleset_id);

CREATE TABLE public.league_trash_point_buy_versions (
  trash_id        uuid NOT NULL REFERENCES public.league_trash(id) ON DELETE CASCADE,
  list_version_id uuid NOT NULL REFERENCES public.point_buy_list_versions(id) ON DELETE RESTRICT,
  PRIMARY KEY (trash_id, list_version_id)
);
CREATE INDEX idx_league_trash_pbv_list_version_id ON public.league_trash_point_buy_versions (list_version_id);

CREATE TABLE public.league_trash_restore_rebuilds (
  season_id   uuid PRIMARY KEY,                         -- no FK: a league deleted again drops its tombstone
  trash_id    uuid NOT NULL,
  season_name text NOT NULL,
  restored_at timestamptz NOT NULL DEFAULT now(),
  phase_ids   uuid[] NOT NULL DEFAULT '{}',
  player_ids  uuid[] NOT NULL DEFAULT '{}'
);

ALTER TABLE public.league_trash_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_trash_rulesets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_trash_point_buy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_trash_restore_rebuilds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.league_trash_players, public.league_trash_rulesets, public.league_trash_point_buy_versions,
              public.league_trash_restore_rebuilds FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.league_trash_players, public.league_trash_rulesets,
  public.league_trash_point_buy_versions, public.league_trash_restore_rebuilds TO service_role;
COMMENT ON TABLE public.league_trash_players IS
  'Players referenced by the captured rows of a trashed league. ON DELETE RESTRICT: the player cannot be deleted or merged while the league is in the trash. Service-role only.';
COMMENT ON TABLE public.league_trash_rulesets IS
  'Rulesets referenced by the captured rows of a trashed league (phases, the league, the Showdown rulesets of its format). ON DELETE RESTRICT. Service-role only.';
COMMENT ON TABLE public.league_trash_point_buy_versions IS
  'Point-buy list versions referenced by the captured rows of a trashed league. ON DELETE RESTRICT. Service-role only.';
COMMENT ON TABLE public.league_trash_restore_rebuilds IS
  'One row per restored league whose derived-data rebuild has not been confirmed yet (removed by league_trash_restore_rebuild_done). Service-role only.';

-- ---------------------------------------------------------------------------------------------------------------
-- THE INVENTORY. $1 is the league's season id.
CREATE OR REPLACE FUNCTION public.league_trash__inventory()
RETURNS TABLE (rel text, cls text, pred text)
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT * FROM (VALUES
    ('seasons',                   'owned',   'id = $1'),
    ('season_participants',       'owned',   'season_id = $1'),
    ('season_groups',             'owned',   'season_id = $1'),
    ('season_group_members',      'owned',   'season_id = $1'),
    ('season_formats',            'owned',   'season_id = $1'),
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
  ) AS v(rel, col, parent, pred, relink)
$$;

-- Parents outside the league that owned rows point at. 'junction': the database refuses to delete the parent while a
-- trashed league references it (the junction table is filled at delete from the captured rows). 'nulled': a nullable
-- reference whose parent may vanish; restore sets it to NULL and returns a parent_missing_nulled warning.
CREATE OR REPLACE FUNCTION public.league_trash__external_parents()
RETURNS TABLE (parent text, protection text, junction text, jcol text)
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT * FROM (VALUES
    ('players',                 'junction', 'league_trash_players',              'player_id'),
    ('rulesets',                'junction', 'league_trash_rulesets',             'ruleset_id'),
    ('point_buy_list_versions', 'junction', 'league_trash_point_buy_versions',   'list_version_id'),
    ('point_buy_list_entries',  'nulled',   NULL,                                NULL),
    ('format_definitions',      'nulled',   NULL,                                NULL)
  ) AS v(parent, protection, junction, jcol)
$$;

CREATE OR REPLACE FUNCTION public.league_trash__restore_plan()
RETURNS TABLE (step int, rel text, filter text, defer text[])
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT * FROM (VALUES
    (10, 'seasons',                   NULL,                            NULL::text[]),
    (20, 'season_participants',       NULL,                            NULL),
    (25, 'season_formats',            NULL,                            NULL),
    (26, 'format_rules',              NULL,                            NULL),
    (27, 'evolution_tiers',           NULL,                            NULL),
    (28, 'draft_tier_limits',         NULL,                            NULL),
    (29, 'draft_pool_entries',        NULL,                            NULL),
    (30, 'legacy_standings',          NULL,                            NULL),
    (31, 'epb_kill_credit_epochs',    NULL,                            NULL),
    (32, 'epb_token_grants',          NULL,                            NULL),
    (33, 'season_storylines',         NULL,                            NULL),
    (40, 'draft_pools',               'r.season_group_id IS NULL',     NULL),
    (45, 'season_groups',             NULL,                            NULL),
    (46, 'season_group_members',      NULL,                            NULL),
    (50, 'draft_pools',               'r.season_group_id IS NOT NULL', NULL),
    (51, 'draft_participants',        NULL,                            NULL),
    (52, 'draft_slots',               NULL,                            NULL),
    (53, 'redraft_slots',             NULL,                            ARRAY['filled_by_pick_id']),
    (54, 'draft_picks',               NULL,                            NULL),
    (55, 'draft_replay_events',       NULL,                            NULL),
    (56, 'draft_line_restrictions',   NULL,                            NULL),
    (60, 'evolution_tracker',         NULL,                            NULL),
    (61, 'redraft_submissions',       NULL,                            NULL),
    (62, 'evolution_events',          NULL,                            NULL),
    (63, 'evo_progress_log',          NULL,                            NULL),
    (64, 'epb_draft_token_purchases', NULL,                            NULL),
    (65, 'epb_comeback_token_spends', NULL,                            NULL),
    (66, 'redraft_history',           NULL,                            NULL),
    (67, 'redraft_trade_requests',    NULL,                            NULL),
    (70, 'tournaments',               NULL,                            NULL),
    (71, 'tournament_participants',   NULL,                            NULL),
    (72, 'rounds',                    NULL,                            NULL),
    (73, 'tournament_reports',        NULL,                            NULL),
    (74, 'matches',                   NULL,                            NULL),
    (75, 'tournament_groups',         NULL,                            NULL),
    (76, 'tournament_group_members',  NULL,                            NULL),
    (80, 'games',                     NULL,                            NULL),
    (81, 'battle_stats',              NULL,                            NULL),
    (82, 'match_analyses',            NULL,                            NULL),
    (83, 'match_prep_analyses',       NULL,                            NULL),
    (84, 'match_prep_teams',          NULL,                            NULL),
    (85, 'match_proposals',           NULL,                            NULL),
    (86, 'match_evolution_snapshots', NULL,                            NULL),
    (87, 'epb_animation_views',       NULL,                            NULL),
    (88, 'broadcast_moments',         NULL,                            NULL),
    (90, 'teams',                     NULL,                            NULL),
    (95, 'resource_admins',           NULL,                            NULL),
    (96, 'discord_webhooks',          NULL,                            NULL),
    (97, 'social_integrations',       NULL,                            NULL),
    (98, 'wiki_notes',                NULL,                            NULL),
    (99, 'wiki_note_reports',         NULL,                            NULL)
  ) AS v(step, rel, filter, defer)
$$;

-- Expands the {x} tokens of an inventory predicate.
CREATE OR REPLACE FUNCTION public.league_trash__x(p_pred text, p_season uuid)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE s text := p_pred; i int;
BEGIN
  FOR i IN 1..4 LOOP
    s := replace(s, '{phases}',  '(SELECT id FROM public.tournaments WHERE season_id = $1)');
    s := replace(s, '{rounds}',  '(SELECT id FROM public.rounds WHERE tournament_id IN {phases})');
    s := replace(s, '{matches}', '(SELECT id FROM public.matches WHERE tournament_id IN {phases})');
    s := replace(s, '{games}',   '(SELECT id FROM public.games WHERE match_id IN {matches})');
    s := replace(s, '{pools}',   '(SELECT id FROM public.draft_pools WHERE season_id = $1)');
    s := replace(s, '{tgroups}', '(SELECT id FROM public.tournament_groups WHERE tournament_id IN {phases})');
    s := replace(s, '{teams}',   '(SELECT id FROM public.teams WHERE season_id = $1 OR tournament_id IN {phases} OR draft_pool_id IN {pools})');
    s := replace(s, '{notes}',   '(SELECT id FROM public.wiki_notes WHERE (scope_type = ''league'' AND scope_id = $1) OR (scope_type = ''tournament'' AND scope_id IN {phases}))');
  END LOOP;
  RETURN s;
END $$;

-- Raises before a delete touches anything when (a) an inventory table no longer exists, (b) a table has an FK into an
-- owned table and is neither inventoried nor a pointer, or (c) an owned table has an FK to a table that is neither
-- inventoried nor a classified external parent. Runtime twin of the migration-replay test.
CREATE OR REPLACE FUNCTION public.league_trash__assert_inventory()
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_missing text[]; v_gone text[]; v_ext text[];
BEGIN
  SELECT array_agg(DISTINCT i.rel) INTO v_gone FROM public.league_trash__inventory() i WHERE to_regclass('public.' || quote_ident(i.rel)) IS NULL;
  IF v_gone IS NOT NULL THEN
    RAISE EXCEPTION 'LEAGUE_TRASH_INVENTORY_STALE' USING ERRCODE = 'P0001', DETAIL = to_jsonb(v_gone)::text;
  END IF;
  SELECT array_agg(DISTINCT c.conrelid::regclass::text) INTO v_missing
    FROM pg_constraint c
   WHERE c.contype = 'f'
     AND c.confrelid IN (SELECT to_regclass('public.' || quote_ident(i.rel)) FROM public.league_trash__inventory() i WHERE i.cls = 'owned')
     AND c.conrelid::regclass::text NOT IN (SELECT i.rel FROM public.league_trash__inventory() i)
     AND c.conrelid::regclass::text NOT IN (SELECT p.rel FROM public.league_trash__pointers() p);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'LEAGUE_TRASH_INVENTORY_INCOMPLETE' USING ERRCODE = 'P0001', DETAIL = to_jsonb(v_missing)::text;
  END IF;
  SELECT array_agg(DISTINCT c.confrelid::regclass::text) INTO v_ext
    FROM pg_constraint c
   WHERE c.contype = 'f'
     AND c.conrelid IN (SELECT to_regclass('public.' || quote_ident(i.rel)) FROM public.league_trash__inventory() i WHERE i.cls = 'owned')
     AND c.confrelid::regclass::text NOT IN (SELECT i.rel FROM public.league_trash__inventory() i)
     AND c.confrelid::regclass::text NOT IN (SELECT e.parent FROM public.league_trash__external_parents() e);
  IF v_ext IS NOT NULL THEN
    RAISE EXCEPTION 'LEAGUE_TRASH_INVENTORY_INCOMPLETE' USING ERRCODE = 'P0001', DETAIL = to_jsonb(v_ext)::text;
  END IF;
END $$;

-- Highest applied migration version. Owner rights: service_role cannot read supabase_migrations. NULL when the ledger
-- does not exist (a database that was not set up by the Supabase CLI).
CREATE OR REPLACE FUNCTION public.league_trash_schema_version()
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN RETURN NULL; END IF;
  EXECUTE 'SELECT max(version) FROM supabase_migrations.schema_migrations' INTO v;
  RETURN v;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Clock shift on restore: the league's clocks stood still in the trash, so EVERY running deadline moves by the time
-- spent there (whether or not it had passed when the league was deleted).
CREATE OR REPLACE FUNCTION public.league_trash__shift_col(p_row jsonb, p_col text, p_shift interval)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE
    WHEN p_row ->> p_col IS NULL THEN p_row
    ELSE jsonb_set(p_row, ARRAY[p_col], to_jsonb((p_row ->> p_col)::timestamptz + p_shift))
  END
$$;

CREATE OR REPLACE FUNCTION public.league_trash__shift(p_rel text, p_row jsonb, p_shift interval)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE r jsonb := p_row;
BEGIN
  IF p_rel = 'draft_pools' AND r ->> 'phase' <> 'complete' THEN
    r := public.league_trash__shift_col(r, 'submission_deadline_at', p_shift);
    r := public.league_trash__shift_col(r, 'token_purchase_closes_at', p_shift);
  ELSIF p_rel = 'draft_slots' AND r ->> 'status' = 'active' THEN
    r := public.league_trash__shift_col(r, 'deadline_at', p_shift);
  ELSIF p_rel = 'matches' AND r ->> 'status' = 'pending_confirmation' THEN
    r := public.league_trash__shift_col(r, 'auto_confirm_at', p_shift);
  ELSIF p_rel = 'match_proposals' AND r ->> 'status' = 'pending' THEN
    r := public.league_trash__shift_col(r, 'expires_at', p_shift);
  ELSIF p_rel = 'rounds' AND r ->> 'status' <> 'completed' THEN
    r := public.league_trash__shift_col(r, 'deadline', p_shift);
  END IF;
  RETURN r;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- CAPTURE: one league_trash_tables row per owned table; returns the unlinked pointers.
CREATE OR REPLACE FUNCTION public.league_trash__capture(p_season uuid, p_trash uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE r record; v_unlinked jsonb := '[]'::jsonb; v_ptr jsonb;
BEGIN
  FOR r IN SELECT i.rel, i.pred FROM public.league_trash__inventory() i WHERE i.cls = 'owned' LOOP
    EXECUTE format('INSERT INTO public.league_trash_tables (trash_id, rel, cols, n, rows)
                    SELECT $2, %1$L, $3, count(*), coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) FROM public.%2$I t WHERE %3$s',
                   r.rel, r.rel, public.league_trash__x(r.pred, p_season))
      USING p_season, p_trash,
            (SELECT jsonb_agg(a.attname ORDER BY a.attnum) FROM pg_attribute a
              WHERE a.attrelid = ('public.' || quote_ident(r.rel))::regclass AND a.attnum > 0 AND NOT a.attisdropped);
  END LOOP;
  FOR r IN SELECT p.rel, p.col, p.pred FROM public.league_trash__pointers() p WHERE p.relink LOOP
    EXECUTE format('SELECT coalesce(jsonb_agg(jsonb_build_object(''rel'', %L, ''col'', %L, ''id'', id, ''old'', %I)), ''[]''::jsonb) FROM public.%I WHERE %s',
                   r.rel, r.col, r.col, r.rel, public.league_trash__x(r.pred, p_season)) USING p_season INTO v_ptr;
    v_unlinked := v_unlinked || v_ptr;
  END LOOP;
  RETURN v_unlinked;
END $$;

-- PROTECT: fills the junction tables FROM THE CAPTURED ROWS, one pass per foreign-key column of an owned table that
-- points at a 'junction' parent (found in the catalog, so a column added later is covered), plus the rulesets named by
-- season_formats.preset_rulesets (they are not foreign keys but belong to the league).
CREATE OR REPLACE FUNCTION public.league_trash__protect(p_trash uuid)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT cr.relname AS rel, a.attname AS col, e.junction, e.jcol
      FROM pg_constraint c
      JOIN pg_class cr ON cr.oid = c.conrelid AND cr.relnamespace = 'public'::regnamespace
      JOIN pg_class pr ON pr.oid = c.confrelid AND pr.relnamespace = 'public'::regnamespace
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      JOIN public.league_trash__external_parents() e ON e.parent = pr.relname AND e.protection = 'junction'
     WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1
       AND cr.relname IN (SELECT i.rel FROM public.league_trash__inventory() i WHERE i.cls = 'owned')
  LOOP
    EXECUTE format('INSERT INTO public.%I (trash_id, %I)
                    SELECT DISTINCT $1, (x ->> %L)::uuid FROM public.league_trash_tables lt, jsonb_array_elements(lt.rows) x
                     WHERE lt.trash_id = $1 AND lt.rel = %L AND x ->> %L IS NOT NULL
                    ON CONFLICT DO NOTHING', r.junction, r.jcol, r.col, r.rel, r.col) USING p_trash;
  END LOOP;
  INSERT INTO public.league_trash_rulesets (trash_id, ruleset_id)
    SELECT DISTINCT p_trash, (v.value #>> '{}')::uuid
      FROM public.league_trash_tables lt, jsonb_array_elements(lt.rows) x, jsonb_each(coalesce(x -> 'preset_rulesets', '{}'::jsonb)) v
     WHERE lt.trash_id = p_trash AND lt.rel = 'season_formats'
       AND jsonb_typeof(x -> 'preset_rulesets') = 'object'
       AND (v.value #>> '{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND EXISTS (SELECT 1 FROM public.rulesets rs WHERE rs.id = (v.value #>> '{}')::uuid)
    ON CONFLICT DO NOTHING;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- DELETE. Errors (SQLSTATE P0001, message = code): LEAGUE_TRASH_SEASON_NOT_FOUND, LEAGUE_TRASH_INVENTORY_INCOMPLETE
-- (DETAIL: the unclassified tables), LEAGUE_TRASH_INVENTORY_STALE. Lock order: the per-season advisory lock (the
-- draft__lock key) FIRST, then the league row, so a draft RPC that holds the advisory lock never waits on us.
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
  PERFORM pg_advisory_xact_lock(hashtext(p_season_id::text));      -- the draft__lock key: no draft RPC runs meanwhile
  SELECT * INTO v_season FROM public.seasons WHERE id = p_season_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEAGUE_TRASH_SEASON_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  PERFORM public.league_trash__assert_inventory();

  -- Row locks on the spine: a writer that adds a child under a captured parent waits, then fails its FK check.
  FOR r IN SELECT i.rel, i.pred FROM public.league_trash__inventory() i
            WHERE i.rel IN ('tournaments', 'tournament_groups', 'rounds', 'matches', 'games', 'draft_pools') ORDER BY i.rel LOOP
    EXECUTE format('SELECT 1 FROM public.%I WHERE %s FOR UPDATE', r.rel, public.league_trash__x(r.pred, p_season_id)) USING p_season_id;
  END LOOP;

  -- Freeze running draft clocks with the draft_set_paused mechanics (inline: no overdue auto-resolution, no
  -- DRAFT_NOT_ACTIVE). The restored pool comes back paused; an admin resumes it with draft__resume. A redraft pool in
  -- its submissions phase has no pause: its submission_deadline_at shifts on restore like every other clock.
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
  INSERT INTO public.league_trash (id, season_id, season_name, format_type, deleted_at, deleted_by, deleted_by_name, purge_after, schema_version)
  VALUES (v_trash, p_season_id, v_season.name, v_season.format_type::text, v_now, p_actor, v_actor_name,
          v_now + make_interval(days => p_retention_days), v_version);
  v_unlinked := public.league_trash__capture(p_season_id, v_trash);
  PERFORM public.league_trash__protect(v_trash);
  SELECT jsonb_object_agg(rel, n) INTO v_counts FROM public.league_trash_tables WHERE trash_id = v_trash;
  EXECUTE public.league_trash__x(
    'SELECT coalesce(array_agg(DISTINCT p), ''{}'') FROM (
       SELECT player_id AS p FROM public.season_participants WHERE season_id = $1
       UNION SELECT player_id FROM public.tournament_participants WHERE tournament_id IN {phases}
       UNION SELECT player_1_id FROM public.matches WHERE tournament_id IN {phases}
       UNION SELECT player_2_id FROM public.matches WHERE tournament_id IN {phases}) s', p_season_id) USING p_season_id INTO v_players;
  SELECT coalesce(array_agg(id), '{}') INTO v_phases FROM public.tournaments WHERE season_id = p_season_id;
  UPDATE public.league_trash SET counts = v_counts, player_ids = v_players, phase_ids = v_phases, unlinked = v_unlinked WHERE id = v_trash;
  DELETE FROM public.league_trash_restore_rebuilds WHERE season_id = p_season_id;   -- this delete's own rebuild covers it

  -- 1. Polymorphic rows + derived scope rows (they key on the phase ids, so they go before the phases).
  FOR r IN SELECT i.rel, i.pred FROM public.league_trash__inventory() i
            WHERE i.rel IN ('resource_admins', 'discord_webhooks', 'social_integrations', 'wiki_notes', 'aggregates', 'player_aggregates') LOOP
    EXECUTE format('DELETE FROM public.%I WHERE %s', r.rel, public.league_trash__x(r.pred, p_season_id)) USING p_season_id;
  END LOOP;
  -- 2. Matches (cascade games, stats, per-match rows; SET NULL on teams / cast_sessions / agent_suggestions / streak pointer).
  EXECUTE public.league_trash__x('DELETE FROM public.matches WHERE tournament_id IN {phases}', p_season_id) USING p_season_id;
  -- 3. Teams (the completed-match lock sees match_id NULL now).
  FOR r IN SELECT i.pred FROM public.league_trash__inventory() i WHERE i.rel = 'teams' LOOP
    EXECUTE public.league_trash__x('DELETE FROM public.teams WHERE ' || r.pred, p_season_id) USING p_season_id;
  END LOOP;
  -- 4. Phases, 5. all pools in ONE statement, 6. storylines, 7. the league (cascades the rest).
  DELETE FROM public.tournaments WHERE season_id = p_season_id;
  DELETE FROM public.draft_pools WHERE season_id = p_season_id;
  DELETE FROM public.season_storylines WHERE season_id = p_season_id;
  DELETE FROM public.seasons WHERE id = p_season_id;

  RETURN jsonb_build_object('trash_id', v_trash, 'season_id', p_season_id, 'season_name', v_season.name,
                            'deleted_at', v_now, 'purge_after', v_now + make_interval(days => p_retention_days),
                            'counts', v_counts, 'player_ids', to_jsonb(v_players), 'phase_ids', to_jsonb(v_phases),
                            'frozen_pools', v_frozen, 'schema_version', v_version);
END $$;

-- INSERT of one captured table over the column intersection: the columns the snapshot carried AND the table still has
-- (a dropped column is ignored, a new one takes its default), generated columns and the deferred cyclic columns left out.
-- jsonb_populate_recordset parses with the CURRENT column types. Returns the rows inserted.
CREATE OR REPLACE FUNCTION public.league_trash__insert_rows(p_rel text, p_filter text, p_snapshot_cols jsonb, p_defer text[], p_rows jsonb)
RETURNS bigint LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_ins text; v_sel text; v_n bigint;
BEGIN
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum), string_agg('r.' || quote_ident(a.attname), ', ' ORDER BY a.attnum)
    INTO v_ins, v_sel
    FROM pg_attribute a
   WHERE a.attrelid = ('public.' || quote_ident(p_rel))::regclass AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
     AND p_snapshot_cols ? a.attname AND NOT (p_defer IS NOT NULL AND a.attname = ANY (p_defer));
  EXECUTE format('INSERT INTO public.%1$I (%2$s) SELECT %3$s FROM jsonb_populate_recordset(NULL::public.%1$I, $1) r%4$s',
                 p_rel, v_ins, v_sel, CASE WHEN p_filter IS NOT NULL THEN ' WHERE ' || p_filter ELSE '' END) USING p_rows;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- Owned tables service_role may not write: read-only archives whose INSERT / UPDATE was revoked on purpose
-- (redraft_trade_requests, 20261018140300_epb_retire_trades.sql). Their rows still belong to the league, so a restore
-- brings them back through league_trash__insert_rows_owner. The replay test fails when a migration revokes INSERT from
-- service_role on an owned table that is not listed here.
CREATE OR REPLACE FUNCTION public.league_trash__archive_tables()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT ARRAY['redraft_trade_requests']
$$;

-- Owner rights, and only for the archive tables above: the restore inserts the captured rows of a read-only archive.
CREATE OR REPLACE FUNCTION public.league_trash__insert_rows_owner(p_rel text, p_filter text, p_snapshot_cols jsonb, p_defer text[], p_rows jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_rel IS NULL OR p_rel <> ALL (public.league_trash__archive_tables()) THEN
    RAISE EXCEPTION 'LEAGUE_TRASH_NOT_ARCHIVE' USING ERRCODE = 'P0001';
  END IF;
  RETURN public.league_trash__insert_rows(p_rel, p_filter, p_snapshot_cols, p_defer, p_rows);
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- RESTORE. Errors (P0001, message = code): LEAGUE_TRASH_NOT_FOUND, LEAGUE_TRASH_EXPIRED, LEAGUE_TRASH_SEASON_EXISTS,
-- LEAGUE_TRASH_SCHEMA_DRIFT (DETAIL {rel, columns}: a NOT NULL column without default that the snapshot lacks),
-- LEAGUE_TRASH_PARENT_MISSING (DETAIL {rel, column, parent, ids}: a NOT NULL parent that was deleted since),
-- LEAGUE_TRASH_PLAN_MISMATCH (DETAIL {missing: [rel]} or {mismatched: [{rel, captured, restored}]}: a captured table
-- the restore did not visit, or a table whose restored row count differs from the captured one).
-- Nothing is restored on any error (one transaction). Warnings (returned, never silent): parent_missing_nulled,
-- replay_hash_released, columns_ignored.
CREATE OR REPLACE FUNCTION public.league_trash_restore(p_trash_id uuid, p_now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  t public.league_trash; p record; f record; e jsonb; v_rows jsonb; v_colsj jsonb; v_miss text[]; v_sql text;
  v_n bigint; v_shift interval; v_restored jsonb := '{}'::jsonb; v_warn jsonb := '[]'::jsonb; v_ids uuid[]; v_released bigint;
  v_sid uuid; v_queue uuid[] := '{}'; v_bad jsonb; v_jobs bigint := 0;
BEGIN
  SELECT season_id INTO v_sid FROM public.league_trash WHERE id = p_trash_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'LEAGUE_TRASH_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(v_sid::text));              -- same order as the delete: advisory lock, then the rows
  SELECT * INTO t FROM public.league_trash WHERE id = p_trash_id FOR UPDATE;   -- waits for a running expiry / restore
  IF NOT FOUND THEN RAISE EXCEPTION 'LEAGUE_TRASH_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF t.purge_after <= p_now THEN RAISE EXCEPTION 'LEAGUE_TRASH_EXPIRED' USING ERRCODE = 'P0001'; END IF;
  IF EXISTS (SELECT 1 FROM public.seasons WHERE id = t.season_id) THEN RAISE EXCEPTION 'LEAGUE_TRASH_SEASON_EXISTS' USING ERRCODE = 'P0001'; END IF;
  v_shift := p_now - t.deleted_at;

  -- Every captured table with rows must be restorable (in the plan, and still a table).
  SELECT array_agg(lt.rel ORDER BY lt.rel) INTO v_miss FROM public.league_trash_tables lt
   WHERE lt.trash_id = p_trash_id AND lt.n > 0
     AND (lt.rel NOT IN (SELECT pl.rel FROM public.league_trash__restore_plan() pl) OR to_regclass('public.' || quote_ident(lt.rel)) IS NULL);
  IF v_miss IS NOT NULL THEN
    RAISE EXCEPTION 'LEAGUE_TRASH_PLAN_MISMATCH' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('missing', to_jsonb(v_miss))::text;
  END IF;

  -- Preflight: schema drift (a NOT NULL column without default that the snapshot does not carry) and columns the
  -- snapshot has that the table lost (ignored, reported).
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

    IF p.rel IN ('draft_pools', 'draft_slots', 'matches', 'match_proposals', 'rounds') THEN
      SELECT coalesce(jsonb_agg(public.league_trash__shift(p.rel, x, v_shift)), '[]'::jsonb) INTO v_rows FROM jsonb_array_elements(v_rows) x;
    END IF;
    IF p.rel = 'games' THEN
      -- A game with battle stats in a non-scheduled match is what the scope rebuild counts: it comes back unmarked
      -- with one pending increment job (inserted below), so the worker rebuilds the aggregates atomically. A replay
      -- hash that a newer game has taken since is released.
      SELECT coalesce(array_agg(DISTINCT (x ->> 'id')::uuid), '{}') INTO v_queue
        FROM jsonb_array_elements(v_rows) x
       WHERE (x ->> 'match_id')::uuid IN (SELECT (m ->> 'id')::uuid FROM public.league_trash_tables lm, jsonb_array_elements(lm.rows) m
                                           WHERE lm.trash_id = p_trash_id AND lm.rel = 'matches' AND m ->> 'status' <> 'scheduled')
         AND (x ->> 'id')::uuid IN (SELECT (b ->> 'game_id')::uuid FROM public.league_trash_tables lb, jsonb_array_elements(lb.rows) b
                                     WHERE lb.trash_id = p_trash_id AND lb.rel = 'battle_stats');
      SELECT count(*) INTO v_released FROM jsonb_array_elements(v_rows) x
       WHERE x ->> 'replay_hash' IS NOT NULL AND EXISTS (SELECT 1 FROM public.games g WHERE g.replay_hash = x ->> 'replay_hash');
      IF v_released > 0 THEN v_warn := v_warn || jsonb_build_object('code', 'replay_hash_released', 'count', v_released); END IF;
      SELECT coalesce(jsonb_agg(
               CASE WHEN (x ->> 'id')::uuid = ANY (v_queue) THEN jsonb_set(x, '{aggregate_applied_at}', 'null'::jsonb) ELSE x END
               || CASE WHEN x ->> 'replay_hash' IS NOT NULL AND EXISTS (SELECT 1 FROM public.games g WHERE g.replay_hash = x ->> 'replay_hash')
                       THEN '{"replay_hash": null}'::jsonb ELSE '{}'::jsonb END), '[]'::jsonb)
        INTO v_rows FROM jsonb_array_elements(v_rows) x;
    END IF;

    -- Parents outside the league (players, list versions, rulesets, definitions...): NOT NULL => abort, nullable => NULL + warning.
    FOR f IN SELECT a.attname AS col, pr.relname AS parent, pa.attname AS pcol, NOT a.attnotnull AS nullable
               FROM pg_constraint c
               JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
               JOIN pg_class pr ON pr.oid = c.confrelid
               JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = c.confkey[1]
              WHERE c.contype = 'f' AND c.conrelid = ('public.' || quote_ident(p.rel))::regclass AND array_length(c.conkey, 1) = 1
                AND pr.relname NOT IN (SELECT pl.rel FROM public.league_trash__restore_plan() pl) LOOP
      EXECUTE format('SELECT array_agg(DISTINCT s.x) FROM (SELECT (e ->> %L)::uuid AS x FROM jsonb_array_elements($1) e) s
                       WHERE s.x IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.%I pr WHERE pr.%I = s.x)', f.col, f.parent, f.pcol)
        USING v_rows INTO v_ids;
      IF v_ids IS NOT NULL THEN
        IF NOT f.nullable THEN
          RAISE EXCEPTION 'LEAGUE_TRASH_PARENT_MISSING' USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('rel', p.rel, 'column', f.col, 'parent', f.parent, 'ids', to_jsonb(v_ids[1:20]))::text;
        END IF;
        SELECT jsonb_agg(CASE WHEN (x ->> f.col)::uuid = ANY (v_ids) THEN jsonb_set(x, ARRAY[f.col], 'null'::jsonb) ELSE x END) INTO v_rows FROM jsonb_array_elements(v_rows) x;
        v_warn := v_warn || jsonb_build_object('code', 'parent_missing_nulled', 'rel', p.rel, 'column', f.col, 'count', cardinality(v_ids));
      END IF;
    END LOOP;

    v_n := CASE WHEN p.rel = ANY (public.league_trash__archive_tables())
                THEN public.league_trash__insert_rows_owner(p.rel, p.filter, v_colsj, p.defer, v_rows)
                ELSE public.league_trash__insert_rows(p.rel, p.filter, v_colsj, p.defer, v_rows) END;
    v_restored := jsonb_set(v_restored, ARRAY[p.rel], to_jsonb(coalesce((v_restored ->> p.rel)::bigint, 0) + v_n));

    IF p.rel = 'games' AND cardinality(v_queue) > 0 THEN
      INSERT INTO public.aggregate_jobs (game_id, tournament_id, season_id, operation, status)
        SELECT g.id, m.tournament_id, tn.season_id, 'increment', 'pending'
          FROM public.games g JOIN public.matches m ON m.id = g.match_id JOIN public.tournaments tn ON tn.id = m.tournament_id
         WHERE g.id = ANY (v_queue);
      GET DIAGNOSTICS v_jobs = ROW_COUNT;
    END IF;
  END LOOP;

  -- Second pass for the cyclic columns (redraft_slots.filled_by_pick_id <-> draft_picks.redraft_slot_id).
  FOR p IN SELECT * FROM public.league_trash__restore_plan() WHERE defer IS NOT NULL LOOP
    FOR v_sql IN SELECT format('UPDATE public.%1$I t SET %2$I = r.%2$I FROM jsonb_populate_recordset(NULL::public.%1$I, $1) r WHERE t.id = r.id AND r.%2$I IS NOT NULL', p.rel, c)
                   FROM unnest(p.defer) c LOOP
      EXECUTE v_sql USING (SELECT lt.rows FROM public.league_trash_tables lt WHERE lt.trash_id = p_trash_id AND lt.rel = p.rel);
    END LOOP;
  END LOOP;

  -- Nothing may be lost silently: every captured table came back with exactly the captured number of rows.
  SELECT jsonb_agg(jsonb_build_object('rel', lt.rel, 'captured', lt.n, 'restored', coalesce((v_restored ->> lt.rel)::bigint, 0)) ORDER BY lt.rel)
    INTO v_bad FROM public.league_trash_tables lt
   WHERE lt.trash_id = p_trash_id AND lt.n > 0 AND coalesce((v_restored ->> lt.rel)::bigint, 0) <> lt.n;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'LEAGUE_TRASH_PLAN_MISMATCH' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('mismatched', v_bad)::text;
  END IF;

  -- Re-link the outside rows that were unlinked (only when the row still exists and its column is still NULL).
  FOR e IN SELECT x FROM jsonb_array_elements(t.unlinked) x LOOP
    SELECT pt.parent INTO v_sql FROM public.league_trash__pointers() pt WHERE pt.rel = e ->> 'rel' AND pt.col = e ->> 'col';
    EXECUTE format('UPDATE public.%I SET %I = $1 WHERE id = $2 AND %I IS NULL AND EXISTS (SELECT 1 FROM public.%I WHERE id = $1)',
                   e ->> 'rel', e ->> 'col', e ->> 'col', v_sql) USING (e ->> 'old')::uuid, (e ->> 'id')::uuid;
  END LOOP;

  INSERT INTO public.league_trash_restore_rebuilds (season_id, trash_id, season_name, restored_at, phase_ids, player_ids)
  VALUES (t.season_id, t.id, t.season_name, p_now, t.phase_ids, t.player_ids)
  ON CONFLICT (season_id) DO UPDATE
    SET trash_id = EXCLUDED.trash_id, season_name = EXCLUDED.season_name, restored_at = EXCLUDED.restored_at,
        phase_ids = EXCLUDED.phase_ids, player_ids = EXCLUDED.player_ids;
  DELETE FROM public.league_trash WHERE id = p_trash_id;           -- cascades the captured rows and the junction rows
  RETURN jsonb_build_object(
    'season_id', t.season_id, 'season_name', t.season_name, 'restored', v_restored,
    'shift_seconds', extract(epoch FROM v_shift), 'player_ids', to_jsonb(t.player_ids), 'phase_ids', to_jsonb(t.phase_ids),
    'paused_pools', (SELECT count(*) FROM public.draft_pools WHERE season_id = t.season_id AND engine = 'queue' AND phase = 'drafting' AND paused_at IS NOT NULL),
    'queued_aggregate_jobs', v_jobs, 'schema_version_at_delete', t.schema_version, 'warnings', v_warn);
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- EXPIRE: deletes expired trash rows (a restore in progress holds the row lock, SKIP LOCKED leaves it alone). A row
-- whose derived-data rebuild is still pending is kept (it is the only record of the players and phases to rebuild);
-- it goes with the next run after the app confirmed the rebuild.
-- Returns [{id, season_id, season_name, deleted_at, purge_after, match_ids}] (match_ids: for the storage sweep).
CREATE OR REPLACE FUNCTION public.league_trash_expire(p_now timestamptz DEFAULT now(), p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_out jsonb;
BEGIN
  WITH due AS (
    SELECT id FROM public.league_trash WHERE purge_after <= p_now AND NOT rebuild_pending
     ORDER BY purge_after LIMIT greatest(p_limit, 1) FOR UPDATE SKIP LOCKED
  ), mids AS (
    SELECT d.id, coalesce((SELECT jsonb_agg(m ->> 'id') FROM public.league_trash_tables lt, jsonb_array_elements(lt.rows) m WHERE lt.trash_id = d.id AND lt.rel = 'matches'), '[]'::jsonb) AS match_ids
      FROM due d
  ), gone AS (
    DELETE FROM public.league_trash t USING due WHERE t.id = due.id
    RETURNING t.id, t.season_id, t.season_name, t.deleted_at, t.purge_after
  )
  SELECT coalesce(jsonb_agg(to_jsonb(gone) || jsonb_build_object('match_ids', mids.match_ids)), '[]'::jsonb) INTO v_out FROM gone JOIN mids ON mids.id = gone.id;
  RETURN v_out;
END $$;

-- The app confirms its derived-data rebuild. True when a marker was cleared.
CREATE OR REPLACE FUNCTION public.league_trash_rebuild_done(p_trash_id uuid)
RETURNS boolean LANGUAGE sql SET search_path = public AS $$
  WITH done AS (UPDATE public.league_trash SET rebuild_pending = false WHERE id = p_trash_id AND rebuild_pending RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM done)
$$;

CREATE OR REPLACE FUNCTION public.league_trash_restore_rebuild_done(p_season_id uuid)
RETURNS boolean LANGUAGE sql SET search_path = public AS $$
  WITH done AS (DELETE FROM public.league_trash_restore_rebuilds WHERE season_id = p_season_id RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM done)
$$;

COMMENT ON FUNCTION public.league_trash_delete(uuid, uuid, integer) IS
  'Moves a league to the trash in one transaction: advisory lock, league row, freezes running draft clocks, captures every owned table into league_trash_tables, protects the referenced parents, deletes the league in FK-safe order. Returns {trash_id, counts, player_ids, phase_ids, ...}. Service-role only.';
COMMENT ON FUNCTION public.league_trash_restore(uuid, timestamptz) IS
  'Restores a trashed league (same ids, every running deadline shifted by the time in the trash, running drafts paused, games queued for the aggregate worker) and drops the trash row. Errors: LEAGUE_TRASH_NOT_FOUND | _EXPIRED | _SEASON_EXISTS | _SCHEMA_DRIFT | _PARENT_MISSING | _PLAN_MISMATCH. Service-role only.';
COMMENT ON FUNCTION public.league_trash_expire(timestamptz, integer) IS
  'Deletes trash rows whose purge_after has passed and whose rebuild is confirmed (SKIP LOCKED) and returns them with their match ids. Service-role only.';
COMMENT ON FUNCTION public.league_trash_rebuild_done(uuid) IS
  'Clears league_trash.rebuild_pending after the app rebuilt the derived data of a delete. Service-role only.';
COMMENT ON FUNCTION public.league_trash_restore_rebuild_done(uuid) IS
  'Removes the restore tombstone of a season after the app rebuilt the derived data of a restore. Service-role only.';
COMMENT ON FUNCTION public.league_trash_schema_version() IS
  'Highest applied migration version (owner rights: service_role cannot read supabase_migrations). Service-role only.';
COMMENT ON FUNCTION public.league_trash__inventory() IS
  'The classification of every table a league reaches (owned / derived / kept) with the predicate that selects the league''s rows ($1 = season id). Service-role only.';

REVOKE ALL ON FUNCTION
  public.league_trash__inventory(), public.league_trash__pointers(), public.league_trash__external_parents(),
  public.league_trash__restore_plan(), public.league_trash__x(text, uuid), public.league_trash__assert_inventory(),
  public.league_trash_schema_version(),
  public.league_trash__shift_col(jsonb, text, interval), public.league_trash__shift(text, jsonb, interval),
  public.league_trash__capture(uuid, uuid), public.league_trash__protect(uuid),
  public.league_trash__insert_rows(text, text, jsonb, text[], jsonb), public.league_trash__archive_tables(),
  public.league_trash__insert_rows_owner(text, text, jsonb, text[], jsonb),
  public.league_trash_delete(uuid, uuid, integer), public.league_trash_restore(uuid, timestamptz),
  public.league_trash_expire(timestamptz, integer), public.league_trash_rebuild_done(uuid),
  public.league_trash_restore_rebuild_done(uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.league_trash__inventory(), public.league_trash__pointers(), public.league_trash__external_parents(),
  public.league_trash__restore_plan(), public.league_trash__x(text, uuid), public.league_trash__assert_inventory(),
  public.league_trash_schema_version(),
  public.league_trash__shift_col(jsonb, text, interval), public.league_trash__shift(text, jsonb, interval),
  public.league_trash__capture(uuid, uuid), public.league_trash__protect(uuid),
  public.league_trash__insert_rows(text, text, jsonb, text[], jsonb), public.league_trash__archive_tables(),
  public.league_trash__insert_rows_owner(text, text, jsonb, text[], jsonb),
  public.league_trash_delete(uuid, uuid, integer), public.league_trash_restore(uuid, timestamptz),
  public.league_trash_expire(timestamptz, integer), public.league_trash_rebuild_done(uuid),
  public.league_trash_restore_rebuild_done(uuid)
TO service_role;

COMMIT;

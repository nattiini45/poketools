-- P6 maintenance transfer: league phases move from the legacy tournament-shaped store to the native phase store
-- (plan 4.C/4.D, docs/phase-separation.md "P6 transfer"). Nothing here runs on apply: the migration only creates
-- the ledger, the lineage table and the operator procedures. The schema owner (postgres) calls them on an
-- operator connection during the maintenance window; no API role can execute them.
--
-- Ladder (forward):   legacy -> frozen_legacy (phase_storage_transition) -> phase_transfer_forward -> frozen_phase
--                     -> phase_transfer_activate -> phase
-- Ladder (rollback):  phase -> frozen_phase (phase_storage_transition) -> phase_transfer_inverse -> frozen_legacy
--                     -> legacy (phase_storage_transition)
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE public.phase_transfer_ledger (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operation_id uuid NOT NULL,
  direction text NOT NULL CHECK (direction IN ('forward', 'inverse')),
  generation integer NOT NULL,
  schema_version text NOT NULL,
  from_mode text NOT NULL,
  to_mode text NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  report jsonb NOT NULL,
  CONSTRAINT phase_transfer_ledger_operation_key UNIQUE (operation_id, direction),
  CONSTRAINT phase_transfer_ledger_generation_key UNIQUE (generation)
);
ALTER TABLE public.phase_transfer_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.phase_transfer_ledger FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.phase_transfer_ledger TO service_role;

-- Durable owner proof for every phase, round, match and game that crossed stores. It holds ids only, has no foreign
-- key (it must outlive the rows it describes) and is never deleted by a transfer in either direction.
CREATE TABLE public.phase_transfer_lineage (
  entity_kind text NOT NULL CHECK (entity_kind IN ('phase', 'round', 'match', 'game')),
  entity_id uuid NOT NULL,
  phase_id uuid NOT NULL,
  season_id uuid NOT NULL,
  match_id uuid,
  first_operation_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_kind, entity_id),
  CONSTRAINT phase_transfer_lineage_match_check CHECK ((entity_kind IN ('match', 'game')) = (match_id IS NOT NULL))
);
CREATE INDEX phase_transfer_lineage_phase_idx ON public.phase_transfer_lineage (phase_id);
ALTER TABLE public.phase_transfer_lineage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.phase_transfer_lineage FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.phase_transfer_lineage TO service_role;

-- The explicit table manifest, in insert order. src_where selects the moving rows (over the pg_temp id sets the
-- procedure builds), dst_where the copies, key_* a unique total order for the fingerprints, exprs the target columns
-- that are not copied by name (alias s is the source row).
CREATE OR REPLACE FUNCTION public.phase_transfer__manifest(p_direction text)
RETURNS TABLE (seq int, src text, dst text, src_where text, dst_where text, key_src text, key_dst text, exprs jsonb)
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT * FROM (VALUES
    (10, 'tournaments', 'league_phases', 'id IN (SELECT id FROM _pt_phase)', 'id IN (SELECT id FROM _pt_phase)', 'id', 'id',
         '{"status": "s.status::text::public.phase_status"}'::jsonb),
    (20, 'tournament_participants', 'phase_participants', 'tournament_id IN (SELECT id FROM _pt_phase)', 'phase_id IN (SELECT id FROM _pt_phase)',
         'tournament_id, player_id', 'phase_id, player_id', '{"phase_id": "s.tournament_id"}'),
    (30, 'tournament_groups', 'phase_groups', 'tournament_id IN (SELECT id FROM _pt_phase)', 'phase_id IN (SELECT id FROM _pt_phase)', 'id', 'id',
         '{"phase_id": "s.tournament_id", "season_id": "(SELECT p.season_id FROM _pt_phase p WHERE p.id = s.tournament_id)"}'),
    (40, 'tournament_group_members', 'phase_group_members', 'group_id IN (SELECT id FROM _pt_group)', 'group_id IN (SELECT id FROM _pt_group)',
         'group_id, player_id', 'group_id, player_id', '{"phase_id": "(SELECT g.phase_id FROM _pt_group g WHERE g.id = s.group_id)"}'),
    (50, 'rounds', 'phase_rounds', 'tournament_id IN (SELECT id FROM _pt_phase)', 'phase_id IN (SELECT id FROM _pt_phase)', 'id', 'id', '{"phase_id": "s.tournament_id"}'),
    (60, 'matches', 'phase_matches', 'id IN (SELECT id FROM _pt_match)', 'id IN (SELECT id FROM _pt_match)', 'id', 'id', '{"phase_id": "s.tournament_id"}'),
    (70, 'games', 'phase_games', 'id IN (SELECT id FROM _pt_game)', 'id IN (SELECT id FROM _pt_game)', 'id', 'id', '{}'),
    (80, 'battle_stats', 'phase_battle_stats', 'game_id IN (SELECT id FROM _pt_game)', 'game_id IN (SELECT id FROM _pt_game)', 'id', 'id', '{}'),
    (90, 'match_outcomes', 'phase_match_outcomes', 'match_id IN (SELECT id FROM _pt_match)', 'match_id IN (SELECT id FROM _pt_match)', 'match_id', 'match_id', '{}'),
    (100, 'match_analyses', 'phase_match_analyses', 'match_id IN (SELECT id FROM _pt_match)', 'match_id IN (SELECT id FROM _pt_match)', 'id', 'id', '{}'),
    (110, 'match_prep_analyses', 'phase_match_prep_analyses', 'match_id IN (SELECT id FROM _pt_match)', 'match_id IN (SELECT id FROM _pt_match)', 'id', 'id', '{}'),
    (120, 'match_prep_teams', 'phase_match_prep_teams', 'match_id IN (SELECT id FROM _pt_match)', 'match_id IN (SELECT id FROM _pt_match)', 'id', 'id', '{}'),
    (130, 'match_proposals', 'phase_match_proposals', 'match_id IN (SELECT id FROM _pt_match)', 'match_id IN (SELECT id FROM _pt_match)', 'id', 'id', '{}'),
    (140, 'match_evolution_snapshots', 'phase_match_evolution_snapshots', 'match_id IN (SELECT id FROM _pt_match)', 'match_id IN (SELECT id FROM _pt_match)', 'id', 'id', '{}'),
    (150, 'epb_animation_views', 'phase_epb_animation_views', 'match_id IN (SELECT id FROM _pt_match)', 'match_id IN (SELECT id FROM _pt_match)', 'id', 'id', '{}'),
    (160, 'broadcast_moments', 'phase_broadcast_moments', 'match_id IN (SELECT id FROM _pt_match)', 'match_id IN (SELECT id FROM _pt_match)', 'id', 'id', '{}'),
    (170, 'rating_history', 'phase_rating_history', 'match_id IN (SELECT id FROM _pt_match)', 'match_id IN (SELECT id FROM _pt_match)', 'id', 'id', '{}'),
    (180, 'tournament_reports', 'phase_reports', 'tournament_id IN (SELECT id FROM _pt_phase)', 'phase_id IN (SELECT id FROM _pt_phase)', 'id', 'id', '{"phase_id": "s.tournament_id"}'),
    (190, 'aggregate_jobs', 'phase_aggregate_jobs', 'game_id IN (SELECT id FROM _pt_game)', 'game_id IN (SELECT id FROM _pt_game)', 'id', 'id',
         '{"phase_id": "s.tournament_id", "match_id": "(SELECT g.match_id FROM _pt_game g WHERE g.id = s.game_id)", "season_id": "coalesce(s.season_id, (SELECT p.season_id FROM _pt_phase p WHERE p.id = s.tournament_id))"}'),
    (200, 'aggregates', 'phase_aggregates', 'scope_type = ''tournament'' AND scope_id IN (SELECT id FROM _pt_phase)', 'phase_id IN (SELECT id FROM _pt_phase)', 'id', 'id', '{"phase_id": "s.scope_id"}'),
    (210, 'player_aggregates', 'phase_player_aggregates', 'scope_type = ''tournament'' AND scope_id IN (SELECT id FROM _pt_phase)', 'phase_id IN (SELECT id FROM _pt_phase)', 'id', 'id', '{"phase_id": "s.scope_id"}'),
    (220, 'teams', 'phase_teams', 'id IN (SELECT id FROM _pt_team)', 'id IN (SELECT id FROM _pt_team)', 'id', 'id',
         '{"phase_id": "s.tournament_id", "forked_from_team_id": "CASE WHEN s.forked_from_team_id IN (SELECT id FROM _pt_team) THEN NULL ELSE s.forked_from_team_id END", "forked_from_phase_team_id": "CASE WHEN s.forked_from_team_id IN (SELECT id FROM _pt_team) THEN s.forked_from_team_id ELSE s.forked_from_phase_team_id END"}'),
    (230, 'cast_sessions', 'phase_cast_sessions', 'id IN (SELECT id FROM _pt_cast)', 'id IN (SELECT id FROM _pt_cast)', 'id', 'id', '{"phase_id": "s.tournament_id"}'),
    (240, 'resource_admins', 'phase_admins', 'resource_type = ''tournament'' AND resource_id IN (SELECT id FROM _pt_phase)', 'phase_id IN (SELECT id FROM _pt_phase)', 'id', 'id', '{"phase_id": "s.resource_id"}'),
    (250, 'discord_webhooks', 'phase_discord_webhooks', 'scope_type = ''tournament'' AND scope_id IN (SELECT id FROM _pt_phase)', 'phase_id IN (SELECT id FROM _pt_phase)', 'id', 'id', '{"phase_id": "s.scope_id"}'),
    (260, 'social_integrations', 'phase_social_integrations', 'scope_type = ''tournament'' AND scope_id IN (SELECT id FROM _pt_phase)', 'phase_id IN (SELECT id FROM _pt_phase)', 'id', 'id', '{"phase_id": "s.scope_id"}'),
    (270, 'wiki_notes', 'phase_wiki_notes', 'id IN (SELECT id FROM _pt_note)', 'id IN (SELECT id FROM _pt_note)', 'id', 'id', '{"phase_id": "s.scope_id"}'),
    (280, 'wiki_note_reports', 'phase_wiki_note_reports', 'note_id IN (SELECT id FROM _pt_note)', 'note_id IN (SELECT id FROM _pt_note)', 'id', 'id', '{}')
  ) f(seq, src, dst, src_where, dst_where, key_src, key_dst, exprs)
  WHERE p_direction = 'forward'
  UNION ALL
  SELECT * FROM (VALUES
    (10, 'league_phases', 'tournaments', 'id IN (SELECT id FROM _pt_phase)', 'id IN (SELECT id FROM _pt_phase)', 'id', 'id',
         '{"status": "s.status::text::public.tournament_status"}'::jsonb),
    (20, 'phase_participants', 'tournament_participants', 'phase_id IN (SELECT id FROM _pt_phase)', 'tournament_id IN (SELECT id FROM _pt_phase)',
         'phase_id, player_id', 'tournament_id, player_id', '{"tournament_id": "s.phase_id"}'),
    (30, 'phase_groups', 'tournament_groups', 'id IN (SELECT id FROM _pt_group)', 'id IN (SELECT id FROM _pt_group)', 'id', 'id', '{"tournament_id": "s.phase_id"}'),
    (40, 'phase_group_members', 'tournament_group_members', 'group_id IN (SELECT id FROM _pt_group)', 'group_id IN (SELECT id FROM _pt_group)',
         'group_id, player_id', 'group_id, player_id', '{}'),
    (50, 'phase_rounds', 'rounds', 'phase_id IN (SELECT id FROM _pt_phase)', 'tournament_id IN (SELECT id FROM _pt_phase)', 'id', 'id', '{"tournament_id": "s.phase_id"}'),
    (60, 'phase_matches', 'matches', 'id IN (SELECT id FROM _pt_match)', 'id IN (SELECT id FROM _pt_match)', 'id', 'id', '{"tournament_id": "s.phase_id"}'),
    (70, 'phase_games', 'games', 'id IN (SELECT id FROM _pt_game)', 'id IN (SELECT id FROM _pt_game)', 'id', 'id', '{}'),
    (80, 'phase_battle_stats', 'battle_stats', 'game_id IN (SELECT id FROM _pt_game)', 'game_id IN (SELECT id FROM _pt_game)', 'id', 'id', '{}'),
    (90, 'phase_match_outcomes', 'match_outcomes', 'match_id IN (SELECT id FROM _pt_match)', 'match_id IN (SELECT id FROM _pt_match)', 'match_id', 'match_id', '{}'),
    (100, 'phase_match_analyses', 'match_analyses', 'match_id IN (SELECT id FROM _pt_match)', 'match_id IN (SELECT id FROM _pt_match)', 'id', 'id', '{}'),
    (110, 'phase_match_prep_analyses', 'match_prep_analyses', 'match_id IN (SELECT id FROM _pt_match)', 'match_id IN (SELECT id FROM _pt_match)', 'id', 'id', '{}'),
    (120, 'phase_match_prep_teams', 'match_prep_teams', 'match_id IN (SELECT id FROM _pt_match)', 'match_id IN (SELECT id FROM _pt_match)', 'id', 'id', '{}'),
    (130, 'phase_match_proposals', 'match_proposals', 'match_id IN (SELECT id FROM _pt_match)', 'match_id IN (SELECT id FROM _pt_match)', 'id', 'id', '{}'),
    (140, 'phase_match_evolution_snapshots', 'match_evolution_snapshots', 'match_id IN (SELECT id FROM _pt_match)', 'match_id IN (SELECT id FROM _pt_match)', 'id', 'id', '{}'),
    (150, 'phase_epb_animation_views', 'epb_animation_views', 'match_id IN (SELECT id FROM _pt_match)', 'match_id IN (SELECT id FROM _pt_match)', 'id', 'id', '{}'),
    (160, 'phase_broadcast_moments', 'broadcast_moments', 'match_id IN (SELECT id FROM _pt_match)', 'match_id IN (SELECT id FROM _pt_match)', 'id', 'id', '{}'),
    (170, 'phase_rating_history', 'rating_history', 'match_id IN (SELECT id FROM _pt_match)', 'match_id IN (SELECT id FROM _pt_match)', 'id', 'id', '{}'),
    (180, 'phase_reports', 'tournament_reports', 'phase_id IN (SELECT id FROM _pt_phase)', 'tournament_id IN (SELECT id FROM _pt_phase)', 'id', 'id', '{"tournament_id": "s.phase_id"}'),
    (190, 'phase_aggregate_jobs', 'aggregate_jobs', 'game_id IN (SELECT id FROM _pt_game)', 'game_id IN (SELECT id FROM _pt_game)', 'id', 'id', '{"tournament_id": "s.phase_id"}'),
    (200, 'phase_aggregates', 'aggregates', 'phase_id IN (SELECT id FROM _pt_phase)', 'scope_type = ''tournament'' AND scope_id IN (SELECT id FROM _pt_phase)', 'id', 'id',
         '{"scope_type": "''tournament''::public.aggregate_scope", "scope_id": "s.phase_id"}'),
    (210, 'phase_player_aggregates', 'player_aggregates', 'phase_id IN (SELECT id FROM _pt_phase)', 'scope_type = ''tournament'' AND scope_id IN (SELECT id FROM _pt_phase)', 'id', 'id',
         '{"scope_type": "''tournament''::public.aggregate_scope", "scope_id": "s.phase_id"}'),
    (220, 'phase_teams', 'teams', 'id IN (SELECT id FROM _pt_team)', 'id IN (SELECT id FROM _pt_team)', 'id', 'id',
         '{"tournament_id": "s.phase_id", "forked_from_team_id": "coalesce(s.forked_from_team_id, s.forked_from_phase_team_id)", "forked_from_phase_team_id": "NULL::uuid"}'),
    (230, 'phase_cast_sessions', 'cast_sessions', 'id IN (SELECT id FROM _pt_cast)', 'id IN (SELECT id FROM _pt_cast)', 'id', 'id', '{"tournament_id": "s.phase_id", "phase_id": "NULL::uuid"}'),
    (240, 'phase_admins', 'resource_admins', 'phase_id IN (SELECT id FROM _pt_phase)', 'resource_type = ''tournament'' AND resource_id IN (SELECT id FROM _pt_phase)', 'id', 'id',
         '{"resource_type": "''tournament''", "resource_id": "s.phase_id"}'),
    (250, 'phase_discord_webhooks', 'discord_webhooks', 'phase_id IN (SELECT id FROM _pt_phase)', 'scope_type = ''tournament'' AND scope_id IN (SELECT id FROM _pt_phase)', 'id', 'id',
         '{"scope_type": "''tournament''", "scope_id": "s.phase_id"}'),
    (260, 'phase_social_integrations', 'social_integrations', 'phase_id IN (SELECT id FROM _pt_phase)', 'scope_type = ''tournament'' AND scope_id IN (SELECT id FROM _pt_phase)', 'id', 'id',
         '{"scope_type": "''tournament''", "scope_id": "s.phase_id"}'),
    (270, 'phase_wiki_notes', 'wiki_notes', 'id IN (SELECT id FROM _pt_note)', 'id IN (SELECT id FROM _pt_note)', 'id', 'id', '{"scope_type": "''tournament''", "scope_id": "s.phase_id"}'),
    (280, 'phase_wiki_note_reports', 'wiki_note_reports', 'note_id IN (SELECT id FROM _pt_note)', 'note_id IN (SELECT id FROM _pt_note)', 'id', 'id', '{}')
  ) i(seq, src, dst, src_where, dst_where, key_src, key_dst, exprs)
  WHERE p_direction = 'inverse'
$$;
REVOKE ALL ON FUNCTION public.phase_transfer__manifest(text) FROM PUBLIC, anon, authenticated, service_role;

-- Copies every manifest family in order and records the source count and fingerprint (computed over the target
-- column expressions, so renamed columns compare) in _pt_fp. A fingerprint is an md5 over the rows' text; no value
-- leaves the transaction.
CREATE OR REPLACE FUNCTION public.phase_transfer__copy(p_direction text)
RETURNS void LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  r record; v_cols text; v_exprs text; v_fsrc text; v_fdst text; v_n bigint; v_sn bigint; v_sfp text;
BEGIN
  FOR r IN SELECT * FROM public.phase_transfer__manifest(p_direction) m ORDER BY m.seq LOOP
    SELECT string_agg(quote_ident(d.column_name), ', ' ORDER BY d.ordinal_position),
           string_agg(coalesce(r.exprs ->> d.column_name, 's.' || quote_ident(d.column_name)), ', ' ORDER BY d.ordinal_position),
           string_agg(format('quote_nullable((%s)::text)', coalesce(r.exprs ->> d.column_name, 's.' || quote_ident(d.column_name))), ', ' ORDER BY d.ordinal_position),
           string_agg(format('quote_nullable((d.%I)::text)', d.column_name), ', ' ORDER BY d.ordinal_position)
      INTO v_cols, v_exprs, v_fsrc, v_fdst
      FROM information_schema.columns d
     WHERE d.table_schema = 'public' AND d.table_name = r.dst AND d.is_generated = 'NEVER'
       AND (r.exprs ? d.column_name OR EXISTS (
             SELECT 1 FROM information_schema.columns c
              WHERE c.table_schema = 'public' AND c.table_name = r.src AND c.column_name = d.column_name AND c.is_generated = 'NEVER'));
    IF v_cols IS NULL THEN
      RAISE EXCEPTION 'PHASE_TRANSFER_MANIFEST_INVALID' USING ERRCODE = 'P0001', DETAIL = r.dst;
    END IF;
    EXECUTE format('SELECT count(*), md5(coalesce(string_agg(concat_ws(%L, %s), %L ORDER BY %s), %L)) FROM public.%I s WHERE %s',
                   '|', v_fsrc, E'\n', r.key_src, '', r.src, r.src_where)
      INTO v_sn, v_sfp;
    EXECUTE format('INSERT INTO public.%I (%s) SELECT %s FROM public.%I s WHERE %s', r.dst, v_cols, v_exprs, r.src, r.src_where);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> v_sn THEN
      RAISE EXCEPTION 'PHASE_TRANSFER_PARITY' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('table', r.dst, 'source_rows', v_sn, 'copied_rows', v_n)::text;
    END IF;
    INSERT INTO _pt_fp (seq, src, dst, src_where, dst_where, key_dst, fdst, rows, fingerprint)
      VALUES (r.seq, r.src, r.dst, r.src_where, r.dst_where, r.key_dst, v_fdst, v_sn, v_sfp);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.phase_transfer__copy(text) FROM PUBLIC, anon, authenticated, service_role;

-- After the sources are deleted: every family's copies still fingerprint to the source, and no source row is left.
CREATE OR REPLACE FUNCTION public.phase_transfer__verify_copies()
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE r record; v_n bigint; v_fp text; v_left bigint; v_out jsonb := '{}';
BEGIN
  FOR r IN SELECT * FROM _pt_fp ORDER BY seq LOOP
    EXECUTE format('SELECT count(*), md5(coalesce(string_agg(concat_ws(%L, %s), %L ORDER BY %s), %L)) FROM public.%I d WHERE %s',
                   '|', r.fdst, E'\n', r.key_dst, '', r.dst, r.dst_where)
      INTO v_n, v_fp;
    EXECUTE format('SELECT count(*) FROM public.%I s WHERE %s', r.src, r.src_where) INTO v_left;
    IF v_n <> r.rows OR v_fp <> r.fingerprint THEN
      RAISE EXCEPTION 'PHASE_TRANSFER_PARITY' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('table', r.dst, 'source_rows', r.rows, 'target_rows', v_n, 'fingerprint_equal', v_fp = r.fingerprint)::text;
    END IF;
    IF v_left <> 0 THEN
      RAISE EXCEPTION 'PHASE_TRANSFER_SOURCE_LEFT' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('table', r.src, 'rows', v_left)::text;
    END IF;
    v_out := v_out || jsonb_build_object(r.dst, jsonb_build_object('rows', r.rows, 'fingerprint', r.fingerprint));
  END LOOP;
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.phase_transfer__verify_copies() FROM PUBLIC, anon, authenticated, service_role;

-- Per column pair (old pointer, new pointer) of the rows OUTSIDE the moved graph that may point into it: how many
-- point anywhere. Equal before and after, or a referential SET NULL ate a pointer (plan 4.D, transfer order 1).
CREATE OR REPLACE FUNCTION public.phase_transfer__pointer_counts()
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
BEGIN
  RETURN jsonb_build_object(
    'agent_suggestions.match', (SELECT count(*) FROM public.agent_suggestions WHERE num_nonnulls(match_id, phase_match_id) > 0),
    'cast_sessions.match', (SELECT count(*) FROM public.cast_sessions WHERE id NOT IN (SELECT id FROM _pt_cast) AND num_nonnulls(match_id, phase_match_id) > 0),
    'cast_sessions.owner', (SELECT count(*) FROM public.cast_sessions WHERE id NOT IN (SELECT id FROM _pt_cast)
                              AND (tournament_id IS NOT NULL OR (phase_id IS NOT NULL AND phase_match_id IS NULL))),
    'player_streaks.match', (SELECT count(*) FROM public.player_streaks WHERE num_nonnulls(last_match_id, last_phase_match_id) > 0),
    'teams.match', (SELECT count(*) FROM public.teams WHERE id NOT IN (SELECT id FROM _pt_team) AND num_nonnulls(match_id, phase_match_id) > 0),
    'teams.fork', (SELECT count(*) FROM public.teams WHERE id NOT IN (SELECT id FROM _pt_team) AND num_nonnulls(forked_from_team_id, forked_from_phase_team_id) > 0),
    'moved_teams.fork', (SELECT count(*) FROM public.teams WHERE id IN (SELECT id FROM _pt_team) AND num_nonnulls(forked_from_team_id, forked_from_phase_team_id) > 0)
                      + (SELECT count(*) FROM public.phase_teams WHERE id IN (SELECT id FROM _pt_team) AND num_nonnulls(forked_from_team_id, forked_from_phase_team_id) > 0),
    'format_challenges.match', (SELECT count(*) FROM public.format_challenges WHERE num_nonnulls(match_id, phase_match_id) > 0),
    'format_challenges.phase', (SELECT count(*) FROM public.format_challenges WHERE phase_id IN (SELECT id FROM _pt_phase))
  );
END $$;
REVOKE ALL ON FUNCTION public.phase_transfer__pointer_counts() FROM PUBLIC, anon, authenticated, service_role;

-- Rows the transfer must never change: identities, league-level and all-time projections, ratings and streak
-- counters, the audit trail and the league rosters. Compared before and after in both directions.
CREATE OR REPLACE FUNCTION public.phase_transfer__shared_fingerprint()
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
BEGIN
  RETURN jsonb_build_object(
    'players', (SELECT md5(coalesce(string_agg(p::text, E'\n' ORDER BY p.id), '')) FROM public.players p),
    'seasons', (SELECT md5(coalesce(string_agg(s::text, E'\n' ORDER BY s.id), '')) FROM public.seasons s),
    'season_participants', (SELECT md5(coalesce(string_agg(s::text, E'\n' ORDER BY s.season_id, s.player_id), '')) FROM public.season_participants s),
    'season_groups', (SELECT md5(coalesce(string_agg(s::text, E'\n' ORDER BY s.id), '')) FROM public.season_groups s),
    'season_group_members', (SELECT md5(coalesce(string_agg(s::text, E'\n' ORDER BY s.season_id, s.player_id), '')) FROM public.season_group_members s),
    'audit_log', (SELECT md5(coalesce(string_agg(a::text, E'\n' ORDER BY a.id), '')) FROM public.audit_log a),
    'aggregates_shared', (SELECT md5(coalesce(string_agg(a::text, E'\n' ORDER BY a.id), '')) FROM public.aggregates a
                           WHERE NOT (a.scope_type = 'tournament' AND a.scope_id IN (SELECT id FROM _pt_phase))),
    'player_aggregates_shared', (SELECT md5(coalesce(string_agg(a::text, E'\n' ORDER BY a.id), '')) FROM public.player_aggregates a
                                  WHERE NOT (a.scope_type = 'tournament' AND a.scope_id IN (SELECT id FROM _pt_phase))),
    'player_streaks_counters', (SELECT md5(coalesce(string_agg(concat_ws('|', s.id, s.player_id, s.current_win_streak, s.best_win_streak,
                                  s.current_loss_streak, s.best_loss_streak, s.current_ko_streak, s.best_ko_streak, s.current_flawless_streak,
                                  s.best_flawless_streak, s.updated_at), E'\n' ORDER BY s.id), '')) FROM public.player_streaks s),
    'aggregate_jobs_other', (SELECT md5(coalesce(string_agg(j::text, E'\n' ORDER BY j.id), '')) FROM public.aggregate_jobs j
                              WHERE j.game_id NOT IN (SELECT id FROM _pt_game)),
    'standalone_tournaments', (SELECT md5(coalesce(string_agg(t::text, E'\n' ORDER BY t.id), '')) FROM public.tournaments t
                                WHERE t.id NOT IN (SELECT id FROM _pt_phase))
  );
END $$;
REVOKE ALL ON FUNCTION public.phase_transfer__shared_fingerprint() FROM PUBLIC, anon, authenticated, service_role;

-- Lock order shared by both directions, so a rollback queues behind (never deadlocks against) the live league
-- order: the transfer lock, every league advisory lock in UUID order, the season rows, then each moved family's
-- tables in a fixed dependency order in EXCLUSIVE mode (readers continue; any writer that slipped past the freeze
-- waits and then hits the fence). lock_timeout aborts instead of waiting.
CREATE OR REPLACE FUNCTION public.phase_transfer__lock()
RETURNS integer LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_season uuid; v_n int := 0;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM pg_advisory_xact_lock(pg_catalog.hashtextextended('phase_transfer', 419100));
  FOR v_season IN
    SELECT s FROM (SELECT season_id FROM public.tournaments WHERE season_id IS NOT NULL
                   UNION SELECT season_id FROM public.league_phases) x(s) ORDER BY s
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext(v_season::text));
    v_n := v_n + 1;
  END LOOP;
  PERFORM 1 FROM public.seasons s
   WHERE s.id IN (SELECT season_id FROM public.tournaments UNION SELECT season_id FROM public.league_phases)
   ORDER BY s.id FOR KEY SHARE;
  LOCK TABLE public.tournaments, public.tournament_participants, public.tournament_groups, public.tournament_group_members,
             public.rounds, public.matches, public.games, public.battle_stats, public.match_outcomes, public.match_analyses,
             public.match_prep_analyses, public.match_prep_teams, public.match_proposals, public.match_evolution_snapshots,
             public.epb_animation_views, public.broadcast_moments, public.rating_history, public.tournament_reports,
             public.aggregate_jobs, public.aggregates, public.player_aggregates, public.teams, public.cast_sessions,
             public.resource_admins, public.discord_webhooks, public.social_integrations, public.wiki_notes,
             public.wiki_note_reports, public.agent_suggestions, public.player_streaks, public.format_challenges
    IN EXCLUSIVE MODE;
  LOCK TABLE public.league_phases, public.phase_participants, public.phase_groups, public.phase_group_members,
             public.phase_rounds, public.phase_matches, public.phase_games, public.phase_battle_stats,
             public.phase_match_outcomes, public.phase_match_analyses, public.phase_match_prep_analyses,
             public.phase_match_prep_teams, public.phase_match_proposals, public.phase_match_evolution_snapshots,
             public.phase_epb_animation_views, public.phase_broadcast_moments, public.phase_rating_history,
             public.phase_reports, public.phase_aggregate_jobs, public.phase_aggregates, public.phase_player_aggregates,
             public.phase_teams, public.phase_cast_sessions, public.phase_admins, public.phase_discord_webhooks,
             public.phase_social_integrations, public.phase_wiki_notes, public.phase_wiki_note_reports
    IN EXCLUSIVE MODE;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.phase_transfer__lock() FROM PUBLIC, anon, authenticated, service_role;

-- Cross-store uniqueness of capability keys: zero duplicates across the union of both stores.
CREATE OR REPLACE FUNCTION public.phase_transfer__assert_keys()
RETURNS void LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_dup jsonb;
BEGIN
  SELECT jsonb_build_object(
    'replay_hash', (SELECT count(*) FROM (SELECT replay_hash FROM public.games WHERE replay_hash IS NOT NULL
                     UNION ALL SELECT replay_hash FROM public.phase_games WHERE replay_hash IS NOT NULL) x GROUP BY replay_hash HAVING count(*) > 1 LIMIT 1),
    'share_token', (SELECT count(*) FROM (SELECT share_token FROM public.teams WHERE share_token IS NOT NULL
                     UNION ALL SELECT share_token FROM public.phase_teams WHERE share_token IS NOT NULL) x GROUP BY share_token HAVING count(*) > 1 LIMIT 1),
    'realtime_key', (SELECT count(*) FROM (SELECT realtime_key FROM public.cast_sessions
                     UNION ALL SELECT realtime_key FROM public.phase_cast_sessions) x GROUP BY realtime_key HAVING count(*) > 1 LIMIT 1))
    INTO v_dup;
  IF jsonb_strip_nulls(v_dup) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'PHASE_TRANSFER_KEY_DUPLICATE' USING ERRCODE = 'P0001', DETAIL = jsonb_strip_nulls(v_dup)::text;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.phase_transfer__assert_keys() FROM PUBLIC, anon, authenticated, service_role;

-- Every moved phase, round, match and game has lineage naming exactly its owner (immutable audit continuity).
CREATE OR REPLACE FUNCTION public.phase_transfer__record_lineage(p_operation_id uuid)
RETURNS bigint LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_bad bigint; v_n bigint;
BEGIN
  CREATE TEMP TABLE _pt_lin ON COMMIT DROP AS
    SELECT 'phase'::text kind, p.id, p.id phase_id, p.season_id, NULL::uuid match_id FROM _pt_phase p
    UNION ALL SELECT 'round', r.id, r.phase_id, p.season_id, NULL FROM _pt_round r JOIN _pt_phase p ON p.id = r.phase_id
    UNION ALL SELECT 'match', m.id, m.phase_id, p.season_id, m.id FROM _pt_match m JOIN _pt_phase p ON p.id = m.phase_id
    UNION ALL SELECT 'game', g.id, g.phase_id, p.season_id, g.match_id FROM _pt_game g JOIN _pt_phase p ON p.id = g.phase_id;
  INSERT INTO public.phase_transfer_lineage (entity_kind, entity_id, phase_id, season_id, match_id, first_operation_id)
    SELECT kind, id, phase_id, season_id, match_id, p_operation_id FROM _pt_lin
  ON CONFLICT (entity_kind, entity_id) DO NOTHING;
  SELECT count(*) INTO v_bad FROM _pt_lin x
   WHERE NOT EXISTS (SELECT 1 FROM public.phase_transfer_lineage l
                      WHERE l.entity_kind = x.kind AND l.entity_id = x.id AND l.phase_id = x.phase_id
                        AND l.season_id = x.season_id AND l.match_id IS NOT DISTINCT FROM x.match_id);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'PHASE_TRANSFER_LINEAGE_CONFLICT' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('entities', v_bad)::text;
  END IF;
  SELECT count(*) INTO v_n FROM _pt_lin;
  DROP TABLE _pt_lin;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.phase_transfer__record_lineage(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.phase_transfer__drop_temp()
RETURNS void LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['_pt_phase', '_pt_group', '_pt_round', '_pt_match', '_pt_game', '_pt_team', '_pt_cast', '_pt_note', '_pt_fp', '_pt_ptr'] LOOP
    IF to_regclass('pg_temp.' || v_name) IS NOT NULL THEN
      EXECUTE format('DROP TABLE pg_temp.%I', v_name);
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.phase_transfer__drop_temp() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.phase_transfer__begin(p_operation_id uuid, p_direction text, p_mode text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_report jsonb; v_mode text;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'PHASE_TRANSFER_OPERATOR_ONLY' USING ERRCODE = '42501';
  END IF;
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION 'PHASE_TRANSFER_OPERATION_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  SELECT report INTO v_report FROM public.phase_transfer_ledger WHERE operation_id = p_operation_id AND direction = p_direction;
  IF FOUND THEN
    RETURN v_report || jsonb_build_object('noop', true);
  END IF;
  SELECT mode INTO v_mode FROM public.phase_storage_state WHERE id FOR UPDATE;
  IF v_mode IS DISTINCT FROM p_mode THEN
    RAISE EXCEPTION 'PHASE_TRANSFER_WRONG_MODE' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('mode', v_mode, 'required', p_mode)::text;
  END IF;
  SET CONSTRAINTS ALL DEFERRED;
  PERFORM public.phase_transfer__drop_temp();
  CREATE TEMP TABLE _pt_fp (seq int, src text, dst text, src_where text, dst_where text, key_dst text, fdst text, rows bigint, fingerprint text) ON COMMIT DROP;
  CREATE TEMP TABLE _pt_ptr (tbl text, id uuid, col text, target uuid) ON COMMIT DROP;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.phase_transfer__begin(uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.phase_transfer__finish(
  p_operation_id uuid, p_direction text, p_from text, p_to text, p_started timestamptz, p_report jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_generation int; v_report jsonb;
BEGIN
  PERFORM public.phase_storage_transition(p_from, p_to);
  SELECT coalesce(max(generation), 0) + 1 INTO v_generation FROM public.phase_transfer_ledger;
  v_report := p_report || jsonb_build_object('operation_id', p_operation_id, 'direction', p_direction, 'generation', v_generation,
    'mode', p_to, 'total_ms', round(extract(epoch FROM clock_timestamp() - p_started) * 1000, 1));
  INSERT INTO public.phase_transfer_ledger (operation_id, direction, generation, schema_version, from_mode, to_mode, started_at, finished_at, report)
    VALUES (p_operation_id, p_direction, v_generation, '20261120100000', p_from, p_to, p_started, clock_timestamp(), v_report);
  RETURN v_report;
END $$;
REVOKE ALL ON FUNCTION public.phase_transfer__finish(uuid, text, text, text, timestamptz, jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- Forward: frozen_legacy -> frozen_phase in one transaction. Order (plan 4.C, 4.D "P6 transfer-order acceptance"):
-- refusals before any write; copy in dependency order; lineage; retarget every outside pointer; delete matches (and
-- with them games) BEFORE teams; then the remaining legacy rows; then every assertion; then the mode change.
CREATE OR REPLACE FUNCTION public.phase_transfer_forward(p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_started timestamptz := clock_timestamp(); v_t timestamptz; v_noop jsonb; v_ms jsonb := '{}';
  v_n bigint; v_seasons int; v_ptr_before jsonb; v_ptr_after jsonb; v_shared_before jsonb; v_shared_after jsonb;
  v_copies jsonb; v_lineage bigint; v_fc_fk boolean; v_report jsonb;
BEGIN
  v_noop := public.phase_transfer__begin(p_operation_id, 'forward', 'frozen_legacy');
  IF v_noop IS NOT NULL THEN RETURN v_noop; END IF;
  v_seasons := public.phase_transfer__lock();
  v_t := clock_timestamp();

  CREATE TEMP TABLE _pt_phase ON COMMIT DROP AS SELECT id, season_id FROM public.tournaments WHERE season_id IS NOT NULL;
  CREATE TEMP TABLE _pt_group ON COMMIT DROP AS SELECT g.id, g.tournament_id phase_id FROM public.tournament_groups g JOIN _pt_phase p ON p.id = g.tournament_id;
  CREATE TEMP TABLE _pt_round ON COMMIT DROP AS SELECT r.id, r.tournament_id phase_id FROM public.rounds r JOIN _pt_phase p ON p.id = r.tournament_id;
  CREATE TEMP TABLE _pt_match ON COMMIT DROP AS SELECT m.id, m.tournament_id phase_id FROM public.matches m JOIN _pt_phase p ON p.id = m.tournament_id;
  CREATE TEMP TABLE _pt_game ON COMMIT DROP AS SELECT g.id, g.match_id, m.phase_id FROM public.games g JOIN _pt_match m ON m.id = g.match_id;
  CREATE TEMP TABLE _pt_team ON COMMIT DROP AS SELECT t.id FROM public.teams t JOIN _pt_phase p ON p.id = t.tournament_id;
  CREATE TEMP TABLE _pt_cast ON COMMIT DROP AS SELECT c.id FROM public.cast_sessions c JOIN _pt_phase p ON p.id = c.tournament_id;
  CREATE TEMP TABLE _pt_note ON COMMIT DROP AS SELECT n.id FROM public.wiki_notes n JOIN _pt_phase p ON p.id = n.scope_id WHERE n.scope_type = 'tournament';
  ANALYZE _pt_phase, _pt_group, _pt_round, _pt_match, _pt_game, _pt_team, _pt_cast, _pt_note;

  -- Refusals. Each fires before any row is written, so a red here leaves the database exactly as it was.
  PERFORM public.league_trash__assert_inventory();
  IF EXISTS (SELECT 1 FROM public.league_phases) OR EXISTS (SELECT 1 FROM public.phase_matches) OR EXISTS (SELECT 1 FROM public.phase_teams)
     OR EXISTS (SELECT 1 FROM public.phase_cast_sessions) OR EXISTS (SELECT 1 FROM public.phase_aggregates) OR EXISTS (SELECT 1 FROM public.phase_wiki_notes) THEN
    RAISE EXCEPTION 'PHASE_TRANSFER_TARGET_NOT_EMPTY' USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_n FROM public.tournament_group_members m JOIN _pt_group g ON g.id = m.group_id
   WHERE NOT EXISTS (SELECT 1 FROM public.tournament_participants p WHERE p.tournament_id = g.phase_id AND p.player_id = m.player_id);
  IF v_n > 0 THEN
    RAISE EXCEPTION 'PHASE_TRANSFER_GROUP_ORPHANS' USING ERRCODE = 'P0001',
      DETAIL = (SELECT jsonb_build_object('orphan_group_members', v_n, 'phase_ids', jsonb_agg(DISTINCT g.phase_id))
                  FROM public.tournament_group_members m JOIN _pt_group g ON g.id = m.group_id
                 WHERE NOT EXISTS (SELECT 1 FROM public.tournament_participants p WHERE p.tournament_id = g.phase_id AND p.player_id = m.player_id))::text;
  END IF;
  SELECT count(*) INTO v_n FROM public.league_trash_tables t
   WHERE t.n > 0 AND t.rel IN ('tournaments', 'tournament_participants', 'tournament_groups', 'tournament_group_members', 'rounds', 'matches', 'games',
                               'battle_stats', 'match_outcomes', 'match_analyses', 'match_prep_analyses', 'match_prep_teams', 'match_proposals',
                               'match_evolution_snapshots', 'epb_animation_views', 'broadcast_moments', 'rating_history', 'tournament_reports',
                               'aggregate_jobs', 'teams', 'resource_admins', 'discord_webhooks', 'social_integrations', 'wiki_notes', 'wiki_note_reports');
  IF v_n > 0 THEN
    RAISE EXCEPTION 'PHASE_TRANSFER_TRASH_CONVERSION_REQUIRED' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('snapshot_tables', v_n)::text;
  END IF;
  SELECT count(*) INTO v_n FROM public.aggregate_jobs j JOIN _pt_game g ON g.id = j.game_id WHERE j.tournament_id IS DISTINCT FROM g.phase_id;
  IF v_n = 0 THEN
    SELECT count(*) INTO v_n FROM public.aggregate_jobs j JOIN _pt_phase p ON p.id = j.tournament_id WHERE j.game_id NOT IN (SELECT id FROM _pt_game);
  END IF;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'PHASE_TRANSFER_CROSS_OWNER' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('aggregate_jobs', v_n)::text;
  END IF;
  SELECT count(*) INTO v_n FROM public.teams t WHERE t.match_id IN (SELECT id FROM _pt_match)
     AND t.tournament_id IS NOT NULL AND t.id NOT IN (SELECT id FROM _pt_team);
  IF v_n > 0 THEN
    RAISE EXCEPTION 'PHASE_TRANSFER_CROSS_OWNER' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('teams', v_n)::text;
  END IF;

  v_ptr_before := public.phase_transfer__pointer_counts();
  v_shared_before := public.phase_transfer__shared_fingerprint();
  INSERT INTO _pt_ptr
    SELECT 'agent_suggestions', id, 'match', match_id FROM public.agent_suggestions WHERE match_id IN (SELECT id FROM _pt_match)
    UNION ALL SELECT 'cast_sessions', id, 'match', match_id FROM public.cast_sessions WHERE match_id IN (SELECT id FROM _pt_match) AND id NOT IN (SELECT id FROM _pt_cast)
    UNION ALL SELECT 'player_streaks', id, 'match', last_match_id FROM public.player_streaks WHERE last_match_id IN (SELECT id FROM _pt_match)
    UNION ALL SELECT 'teams', id, 'match', match_id FROM public.teams WHERE match_id IN (SELECT id FROM _pt_match) AND id NOT IN (SELECT id FROM _pt_team)
    UNION ALL SELECT 'teams', id, 'fork', forked_from_team_id FROM public.teams WHERE forked_from_team_id IN (SELECT id FROM _pt_team) AND id NOT IN (SELECT id FROM _pt_team)
    UNION ALL SELECT 'moved_teams', id, 'fork', forked_from_team_id FROM public.teams WHERE forked_from_team_id IN (SELECT id FROM _pt_team) AND id IN (SELECT id FROM _pt_team)
    UNION ALL SELECT 'format_challenges', id, 'phase', phase_id FROM public.format_challenges WHERE phase_id IN (SELECT id FROM _pt_phase)
    UNION ALL SELECT 'format_challenges', id, 'match', match_id FROM public.format_challenges WHERE match_id IN (SELECT id FROM _pt_match);
  v_ms := v_ms || jsonb_build_object('prepare_ms', round(extract(epoch FROM clock_timestamp() - v_t) * 1000, 1)); v_t := clock_timestamp();

  PERFORM public.phase_transfer__copy('forward');
  v_ms := v_ms || jsonb_build_object('copy_ms', round(extract(epoch FROM clock_timestamp() - v_t) * 1000, 1)); v_t := clock_timestamp();

  v_lineage := public.phase_transfer__record_lineage(p_operation_id);

  -- Retarget before delete: every ON DELETE SET NULL pointer would otherwise be nulled silently by the deletes below.
  UPDATE public.agent_suggestions SET phase_match_id = match_id, match_id = NULL WHERE match_id IN (SELECT id FROM _pt_match);
  UPDATE public.cast_sessions c SET phase_id = m.phase_id, phase_match_id = c.match_id, match_id = NULL
    FROM _pt_match m WHERE c.match_id = m.id AND c.id NOT IN (SELECT id FROM _pt_cast);
  UPDATE public.player_streaks SET last_phase_match_id = last_match_id, last_match_id = NULL WHERE last_match_id IN (SELECT id FROM _pt_match);
  UPDATE public.teams SET phase_match_id = match_id, match_id = NULL WHERE match_id IN (SELECT id FROM _pt_match) AND id NOT IN (SELECT id FROM _pt_team);
  UPDATE public.teams SET forked_from_phase_team_id = forked_from_team_id, forked_from_team_id = NULL
   WHERE forked_from_team_id IN (SELECT id FROM _pt_team) AND id NOT IN (SELECT id FROM _pt_team);
  -- format_challenges.phase_id mirrors league_phase_id once the phase is native, so its cascade FK to tournaments goes
  -- with the tournament rows (restored by the inverse).
  SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'format_challenges_phase_id_fkey' AND conrelid = 'public.format_challenges'::regclass) INTO v_fc_fk;
  IF v_fc_fk THEN
    ALTER TABLE public.format_challenges DROP CONSTRAINT format_challenges_phase_id_fkey;
  END IF;
  UPDATE public.format_challenges
     SET league_phase_id = phase_id,
         phase_match_id = CASE WHEN match_id IN (SELECT id FROM _pt_match) THEN match_id END,
         match_id = CASE WHEN match_id IN (SELECT id FROM _pt_match) THEN NULL ELSE match_id END
   WHERE phase_id IN (SELECT id FROM _pt_phase);
  v_ms := v_ms || jsonb_build_object('retarget_ms', round(extract(epoch FROM clock_timestamp() - v_t) * 1000, 1)); v_t := clock_timestamp();

  -- Delete the legacy subtree. Matches (and their games, stats, jobs, children) go first, so the referential action
  -- clears teams.match_id before the teams themselves are deleted (trg_teams_completed_match_lock).
  DELETE FROM public.cast_sessions WHERE id IN (SELECT id FROM _pt_cast);
  DELETE FROM public.matches WHERE id IN (SELECT id FROM _pt_match);
  DELETE FROM public.teams WHERE id IN (SELECT id FROM _pt_team);
  DELETE FROM public.aggregates WHERE scope_type = 'tournament' AND scope_id IN (SELECT id FROM _pt_phase);
  DELETE FROM public.player_aggregates WHERE scope_type = 'tournament' AND scope_id IN (SELECT id FROM _pt_phase);
  DELETE FROM public.resource_admins WHERE resource_type = 'tournament' AND resource_id IN (SELECT id FROM _pt_phase);
  DELETE FROM public.discord_webhooks WHERE scope_type = 'tournament' AND scope_id IN (SELECT id FROM _pt_phase);
  DELETE FROM public.social_integrations WHERE scope_type = 'tournament' AND scope_id IN (SELECT id FROM _pt_phase);
  DELETE FROM public.wiki_notes WHERE id IN (SELECT id FROM _pt_note);
  DELETE FROM public.tournaments WHERE id IN (SELECT id FROM _pt_phase);
  v_ms := v_ms || jsonb_build_object('delete_ms', round(extract(epoch FROM clock_timestamp() - v_t) * 1000, 1)); v_t := clock_timestamp();

  -- Assertions (plan 4.D).
  v_copies := public.phase_transfer__verify_copies();
  SELECT count(*) INTO v_n FROM _pt_ptr p WHERE NOT CASE p.tbl
    WHEN 'agent_suggestions' THEN EXISTS (SELECT 1 FROM public.agent_suggestions a WHERE a.id = p.id AND a.phase_match_id = p.target AND a.match_id IS NULL)
    WHEN 'cast_sessions' THEN EXISTS (SELECT 1 FROM public.cast_sessions c JOIN public.phase_matches m ON m.id = c.phase_match_id
                                       WHERE c.id = p.id AND c.phase_match_id = p.target AND c.phase_id = m.phase_id AND c.match_id IS NULL)
    WHEN 'player_streaks' THEN EXISTS (SELECT 1 FROM public.player_streaks s WHERE s.id = p.id AND s.last_phase_match_id = p.target)
    WHEN 'teams' THEN EXISTS (SELECT 1 FROM public.teams t WHERE t.id = p.id AND
                       CASE p.col WHEN 'match' THEN t.phase_match_id = p.target ELSE t.forked_from_phase_team_id = p.target END)
    WHEN 'moved_teams' THEN EXISTS (SELECT 1 FROM public.phase_teams t WHERE t.id = p.id AND t.forked_from_phase_team_id = p.target)
    WHEN 'format_challenges' THEN EXISTS (SELECT 1 FROM public.format_challenges f WHERE f.id = p.id AND
                       CASE p.col WHEN 'phase' THEN f.league_phase_id = p.target ELSE f.phase_match_id = p.target END)
    ELSE false END;
  v_ptr_after := public.phase_transfer__pointer_counts();
  IF v_n > 0 OR v_ptr_after <> v_ptr_before THEN
    RAISE EXCEPTION 'PHASE_TRANSFER_POINTER_NULLED' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('rows', v_n, 'before', v_ptr_before, 'after', v_ptr_after)::text;
  END IF;
  v_shared_after := public.phase_transfer__shared_fingerprint();
  IF v_shared_after <> v_shared_before THEN
    RAISE EXCEPTION 'PHASE_TRANSFER_SHARED_CHANGED' USING ERRCODE = 'P0001',
      DETAIL = (SELECT jsonb_agg(k) FROM jsonb_object_keys(v_shared_before) k WHERE v_shared_before -> k <> v_shared_after -> k)::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.tournaments WHERE season_id IS NOT NULL) THEN
    RAISE EXCEPTION 'PHASE_TRANSFER_SOURCE_LEFT' USING ERRCODE = 'P0001', DETAIL = 'tournaments';
  END IF;
  PERFORM public.phase_transfer__assert_keys();
  PERFORM public.league_trash__assert_inventory();
  SET CONSTRAINTS ALL IMMEDIATE;
  v_ms := v_ms || jsonb_build_object('assert_ms', round(extract(epoch FROM clock_timestamp() - v_t) * 1000, 1));

  v_report := public.phase_transfer__finish(p_operation_id, 'forward', 'frozen_legacy', 'frozen_phase', v_started,
    jsonb_build_object('seasons_locked', v_seasons, 'phases', (SELECT count(*) FROM _pt_phase), 'lineage_entities', v_lineage,
                       'format_challenges_fk_dropped', v_fc_fk, 'families', v_copies, 'pointers', v_ptr_after,
                       'pointer_rows_retargeted', (SELECT count(*) FROM _pt_ptr), 'timings', v_ms));
  PERFORM public.phase_transfer__drop_temp();
  RETURN v_report;
END $$;
REVOKE ALL ON FUNCTION public.phase_transfer_forward(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Inverse: frozen_phase -> frozen_legacy, the same ladder backwards under the same locks. It moves the CURRENT
-- native rows (including rows written after reopening), restores tournaments (with season_id) before their groups and
-- groups before rounds, re-points every outside pointer before the native rows are deleted, and keeps lineage.
CREATE OR REPLACE FUNCTION public.phase_transfer_inverse(p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_started timestamptz := clock_timestamp(); v_t timestamptz; v_noop jsonb; v_ms jsonb := '{}';
  v_n bigint; v_seasons int; v_ptr_before jsonb; v_ptr_after jsonb; v_shared_before jsonb; v_shared_after jsonb;
  v_copies jsonb; v_lineage bigint; v_fc_fk boolean; v_report jsonb;
BEGIN
  v_noop := public.phase_transfer__begin(p_operation_id, 'inverse', 'frozen_phase');
  IF v_noop IS NOT NULL THEN RETURN v_noop; END IF;
  v_seasons := public.phase_transfer__lock();
  v_t := clock_timestamp();

  CREATE TEMP TABLE _pt_phase ON COMMIT DROP AS SELECT id, season_id FROM public.league_phases;
  CREATE TEMP TABLE _pt_group ON COMMIT DROP AS SELECT id, phase_id FROM public.phase_groups;
  CREATE TEMP TABLE _pt_round ON COMMIT DROP AS SELECT id, phase_id FROM public.phase_rounds;
  CREATE TEMP TABLE _pt_match ON COMMIT DROP AS SELECT id, phase_id FROM public.phase_matches;
  CREATE TEMP TABLE _pt_game ON COMMIT DROP AS SELECT g.id, g.match_id, m.phase_id FROM public.phase_games g JOIN public.phase_matches m ON m.id = g.match_id;
  CREATE TEMP TABLE _pt_team ON COMMIT DROP AS SELECT id FROM public.phase_teams;
  CREATE TEMP TABLE _pt_cast ON COMMIT DROP AS SELECT id FROM public.phase_cast_sessions;
  CREATE TEMP TABLE _pt_note ON COMMIT DROP AS SELECT id FROM public.phase_wiki_notes;
  ANALYZE _pt_phase, _pt_group, _pt_round, _pt_match, _pt_game, _pt_team, _pt_cast, _pt_note;

  PERFORM public.league_trash__assert_inventory();
  SELECT count(*) INTO v_n FROM public.phase_reports WHERE round_id IS NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'PHASE_TRANSFER_INVERSE_UNREPRESENTABLE' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('phase_reports_without_round', v_n)::text;
  END IF;
  SELECT count(*) INTO v_n FROM public.league_trash_tables t WHERE t.n > 0 AND (t.rel LIKE 'phase\_%' OR t.rel = 'league_phases');
  IF v_n > 0 THEN
    RAISE EXCEPTION 'PHASE_TRANSFER_TRASH_CONVERSION_REQUIRED' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('snapshot_tables', v_n)::text;
  END IF;

  v_ptr_before := public.phase_transfer__pointer_counts();
  v_shared_before := public.phase_transfer__shared_fingerprint();
  INSERT INTO _pt_ptr
    SELECT 'agent_suggestions', id, 'match', phase_match_id FROM public.agent_suggestions WHERE phase_match_id IS NOT NULL
    UNION ALL SELECT 'cast_sessions', id, 'match', phase_match_id FROM public.cast_sessions WHERE phase_match_id IS NOT NULL
    UNION ALL SELECT 'cast_sessions', id, 'phase', phase_id FROM public.cast_sessions WHERE phase_id IS NOT NULL AND phase_match_id IS NULL
    UNION ALL SELECT 'player_streaks', id, 'match', last_phase_match_id FROM public.player_streaks WHERE last_phase_match_id IS NOT NULL
    UNION ALL SELECT 'teams', id, 'match', phase_match_id FROM public.teams WHERE phase_match_id IS NOT NULL
    UNION ALL SELECT 'teams', id, 'fork', forked_from_phase_team_id FROM public.teams WHERE forked_from_phase_team_id IS NOT NULL
    UNION ALL SELECT 'moved_teams', id, 'fork', forked_from_phase_team_id FROM public.phase_teams WHERE forked_from_phase_team_id IS NOT NULL
    UNION ALL SELECT 'format_challenges', id, 'phase', league_phase_id FROM public.format_challenges WHERE league_phase_id IS NOT NULL
    UNION ALL SELECT 'format_challenges', id, 'match', phase_match_id FROM public.format_challenges WHERE phase_match_id IS NOT NULL;
  v_ms := v_ms || jsonb_build_object('prepare_ms', round(extract(epoch FROM clock_timestamp() - v_t) * 1000, 1)); v_t := clock_timestamp();

  PERFORM public.phase_transfer__copy('inverse');
  v_ms := v_ms || jsonb_build_object('copy_ms', round(extract(epoch FROM clock_timestamp() - v_t) * 1000, 1)); v_t := clock_timestamp();

  v_lineage := public.phase_transfer__record_lineage(p_operation_id);

  UPDATE public.agent_suggestions SET match_id = phase_match_id, phase_match_id = NULL WHERE phase_match_id IS NOT NULL;
  UPDATE public.cast_sessions SET tournament_id = CASE WHEN phase_match_id IS NULL THEN phase_id END,
                                  match_id = phase_match_id, phase_id = NULL, phase_match_id = NULL
   WHERE phase_id IS NOT NULL OR phase_match_id IS NOT NULL;
  UPDATE public.player_streaks SET last_match_id = last_phase_match_id, last_phase_match_id = NULL WHERE last_phase_match_id IS NOT NULL;
  UPDATE public.teams SET match_id = phase_match_id, phase_match_id = NULL WHERE phase_match_id IS NOT NULL;
  UPDATE public.teams SET forked_from_team_id = forked_from_phase_team_id, forked_from_phase_team_id = NULL
   WHERE forked_from_phase_team_id IS NOT NULL AND id NOT IN (SELECT id FROM _pt_team);
  UPDATE public.format_challenges
     SET match_id = coalesce(phase_match_id, match_id), phase_match_id = NULL, league_phase_id = NULL
   WHERE league_phase_id IS NOT NULL;
  v_ms := v_ms || jsonb_build_object('retarget_ms', round(extract(epoch FROM clock_timestamp() - v_t) * 1000, 1)); v_t := clock_timestamp();

  DELETE FROM public.phase_cast_sessions;
  DELETE FROM public.phase_matches;
  DELETE FROM public.phase_teams;
  DELETE FROM public.phase_aggregates;
  DELETE FROM public.phase_player_aggregates;
  DELETE FROM public.phase_admins;
  DELETE FROM public.phase_discord_webhooks;
  DELETE FROM public.phase_social_integrations;
  DELETE FROM public.phase_wiki_notes;
  DELETE FROM public.league_phases;
  SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'format_challenges_phase_id_fkey' AND conrelid = 'public.format_challenges'::regclass) INTO v_fc_fk;
  IF NOT v_fc_fk THEN
    ALTER TABLE public.format_challenges ADD CONSTRAINT format_challenges_phase_id_fkey
      FOREIGN KEY (phase_id) REFERENCES public.tournaments(id) ON DELETE CASCADE;
  END IF;
  v_ms := v_ms || jsonb_build_object('delete_ms', round(extract(epoch FROM clock_timestamp() - v_t) * 1000, 1)); v_t := clock_timestamp();

  v_copies := public.phase_transfer__verify_copies();
  SELECT count(*) INTO v_n FROM _pt_ptr p WHERE NOT CASE p.tbl
    WHEN 'agent_suggestions' THEN EXISTS (SELECT 1 FROM public.agent_suggestions a WHERE a.id = p.id AND a.match_id = p.target AND a.phase_match_id IS NULL)
    WHEN 'cast_sessions' THEN EXISTS (SELECT 1 FROM public.cast_sessions c WHERE c.id = p.id AND c.phase_id IS NULL AND c.phase_match_id IS NULL AND
                       CASE p.col WHEN 'match' THEN c.match_id = p.target ELSE c.tournament_id = p.target END)
    WHEN 'player_streaks' THEN EXISTS (SELECT 1 FROM public.player_streaks s WHERE s.id = p.id AND s.last_match_id = p.target)
    WHEN 'teams' THEN EXISTS (SELECT 1 FROM public.teams t WHERE t.id = p.id AND
                       CASE p.col WHEN 'match' THEN t.match_id = p.target ELSE t.forked_from_team_id = p.target END)
    WHEN 'moved_teams' THEN EXISTS (SELECT 1 FROM public.teams t WHERE t.id = p.id AND t.forked_from_team_id = p.target)
    WHEN 'format_challenges' THEN EXISTS (SELECT 1 FROM public.format_challenges f WHERE f.id = p.id AND
                       CASE p.col WHEN 'phase' THEN f.phase_id = p.target ELSE f.match_id = p.target END)
    ELSE false END;
  v_ptr_after := public.phase_transfer__pointer_counts();
  IF v_n > 0 OR v_ptr_after - 'format_challenges.phase' <> v_ptr_before - 'format_challenges.phase' THEN
    RAISE EXCEPTION 'PHASE_TRANSFER_POINTER_NULLED' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('rows', v_n, 'before', v_ptr_before, 'after', v_ptr_after)::text;
  END IF;
  v_shared_after := public.phase_transfer__shared_fingerprint();
  IF v_shared_after - 'standalone_tournaments' <> v_shared_before - 'standalone_tournaments' THEN
    RAISE EXCEPTION 'PHASE_TRANSFER_SHARED_CHANGED' USING ERRCODE = 'P0001',
      DETAIL = (SELECT jsonb_agg(k) FROM jsonb_object_keys(v_shared_before) k WHERE v_shared_before -> k <> v_shared_after -> k)::text;
  END IF;
  IF EXISTS (SELECT 1 FROM public.league_phases) OR EXISTS (SELECT 1 FROM public.phase_matches) OR EXISTS (SELECT 1 FROM public.phase_teams)
     OR EXISTS (SELECT 1 FROM public.phase_cast_sessions) THEN
    RAISE EXCEPTION 'PHASE_TRANSFER_SOURCE_LEFT' USING ERRCODE = 'P0001', DETAIL = 'phase store';
  END IF;
  PERFORM public.phase_transfer__assert_keys();
  PERFORM public.league_trash__assert_inventory();
  SET CONSTRAINTS ALL IMMEDIATE;
  v_ms := v_ms || jsonb_build_object('assert_ms', round(extract(epoch FROM clock_timestamp() - v_t) * 1000, 1));

  v_report := public.phase_transfer__finish(p_operation_id, 'inverse', 'frozen_phase', 'frozen_legacy', v_started,
    jsonb_build_object('seasons_locked', v_seasons, 'phases', (SELECT count(*) FROM _pt_phase), 'lineage_entities', v_lineage,
                       'format_challenges_fk_restored', NOT v_fc_fk, 'families', v_copies, 'pointers', v_ptr_after,
                       'pointer_rows_retargeted', (SELECT count(*) FROM _pt_ptr), 'timings', v_ms));
  PERFORM public.phase_transfer__drop_temp();
  RETURN v_report;
END $$;
REVOKE ALL ON FUNCTION public.phase_transfer_inverse(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Activation gate: frozen_phase -> phase only after a completed forward is the newest ledger entry and every native
-- phase, round, match and game carries lineage naming its exact owner.
CREATE OR REPLACE FUNCTION public.phase_transfer_activate()
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_last text; v_missing bigint;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'PHASE_TRANSFER_OPERATOR_ONLY' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM 1 FROM public.phase_storage_state WHERE id FOR UPDATE;
  SELECT direction INTO v_last FROM public.phase_transfer_ledger ORDER BY generation DESC LIMIT 1;
  IF v_last IS DISTINCT FROM 'forward' THEN
    RAISE EXCEPTION 'PHASE_TRANSFER_NOT_FORWARDED' USING ERRCODE = 'P0001';
  END IF;
  SELECT (SELECT count(*) FROM public.league_phases p WHERE NOT EXISTS (SELECT 1 FROM public.phase_transfer_lineage l
            WHERE l.entity_kind = 'phase' AND l.entity_id = p.id AND l.phase_id = p.id AND l.season_id = p.season_id))
       + (SELECT count(*) FROM public.phase_rounds r JOIN public.league_phases p ON p.id = r.phase_id WHERE NOT EXISTS (SELECT 1 FROM public.phase_transfer_lineage l
            WHERE l.entity_kind = 'round' AND l.entity_id = r.id AND l.phase_id = r.phase_id AND l.season_id = p.season_id))
       + (SELECT count(*) FROM public.phase_matches m JOIN public.league_phases p ON p.id = m.phase_id WHERE NOT EXISTS (SELECT 1 FROM public.phase_transfer_lineage l
            WHERE l.entity_kind = 'match' AND l.entity_id = m.id AND l.phase_id = m.phase_id AND l.season_id = p.season_id AND l.match_id = m.id))
       + (SELECT count(*) FROM public.phase_games g JOIN public.phase_matches m ON m.id = g.match_id JOIN public.league_phases p ON p.id = m.phase_id
            WHERE NOT EXISTS (SELECT 1 FROM public.phase_transfer_lineage l
            WHERE l.entity_kind = 'game' AND l.entity_id = g.id AND l.phase_id = m.phase_id AND l.season_id = p.season_id AND l.match_id = g.match_id))
    INTO v_missing;
  IF v_missing > 0 THEN
    RAISE EXCEPTION 'PHASE_TRANSFER_LINEAGE_MISSING' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('entities', v_missing)::text;
  END IF;
  RETURN jsonb_build_object('mode', public.phase_storage_transition('frozen_phase', 'phase'), 'lineage_missing', 0);
END $$;
REVOKE ALL ON FUNCTION public.phase_transfer_activate() FROM PUBLIC, anon, authenticated, service_role;

COMMIT;

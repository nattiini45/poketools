BEGIN;
SET LOCAL lock_timeout = '5s';

-- Keep existing rows undated. Their original signup order was not recorded.
ALTER TABLE public.season_participants ADD COLUMN joined_at timestamptz;
ALTER TABLE public.season_participants ALTER COLUMN joined_at SET DEFAULT clock_timestamp();

-- The incoming player's roster row, phase seats and any new relation links commit together. Format writers
-- use season_formats.revision to fence plans validated against the old roster or old recipient.
CREATE FUNCTION public.format__splice_roster_player(
  p_season_id uuid, p_player_id uuid, p_spec jsonb, p_seed text
) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_relation text;
  v_from uuid;
  v_to uuid;
BEGIN
  FOR v_relation IN
    SELECT r ->> 'key' FROM jsonb_array_elements(coalesce(p_spec -> 'relations', '[]'::jsonb)) r
    WHERE r ->> 'shape' = 'derangement' AND r ->> 'late_joiners' = 'splice'
    ORDER BY r ->> 'key'
  LOOP
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.format_relation_links l WHERE l.season_id = p_season_id AND l.relation_key = v_relation
        AND p_player_id IN (l.from_player_id, l.to_player_id)
    );

    -- Prefer an unrevealed link whose giver has yet to submit. If everyone has submitted, keep the picks
    -- and their lock status and move only that giver's action-origin holdings with their new recipient.
    SELECT l.from_player_id, l.to_player_id INTO v_from, v_to
    FROM public.format_relation_links l
    WHERE l.season_id = p_season_id AND l.relation_key = v_relation
    ORDER BY (l.revealed_at IS NOT NULL),
      (SELECT count(*) FROM public.format_action_submissions s
       JOIN jsonb_array_elements(p_spec -> 'rules') r
         ON r ->> 'kind' = 'player.action' AND r ->> 'via' = v_relation AND r ->> 'id' = s.action_key
       WHERE s.season_id = p_season_id AND s.actor_player_id = l.from_player_id
         AND s.target_player_id = l.to_player_id AND s.status IN ('submitted', 'locked')),
      md5(p_seed || ':' || v_relation || ':' || p_player_id::text || ':' || l.from_player_id::text),
      l.from_player_id
    LIMIT 1;
    CONTINUE WHEN NOT FOUND;

    UPDATE public.format_relation_links
      SET to_player_id = p_player_id, revealed_at = NULL
      WHERE season_id = p_season_id AND relation_key = v_relation AND from_player_id = v_from;
    INSERT INTO public.format_relation_links (season_id, relation_key, from_player_id, to_player_id)
      VALUES (p_season_id, v_relation, p_player_id, v_to);

    WITH moved AS (
      UPDATE public.format_action_submissions s SET target_player_id = p_player_id
      WHERE s.season_id = p_season_id AND s.actor_player_id = v_from AND s.target_player_id = v_to
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(p_spec -> 'rules') r
                    WHERE r ->> 'kind' = 'player.action' AND r ->> 'via' = v_relation AND r ->> 'id' = s.action_key)
      RETURNING s.id
    )
    UPDATE public.format_resource_items i SET player_id = p_player_id
      FROM moved WHERE i.season_id = p_season_id AND i.player_id = v_to
        AND i.source = 'action' AND i.source_ref = moved.id::text;
  END LOOP;
END $$;

-- The caller supplies the same phase generation it writes. Only ungrouped Swiss can take active entrants:
-- it pairs the current roster each round, without rewriting a fixed schedule or assigning groups.
CREATE FUNCTION public.format__sync_league_roster(p_season_id uuid, p_native boolean, p_player_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_spec jsonb;
  v_seed text;
  v_phase_table text := CASE WHEN p_native THEN 'league_phases' ELSE 'tournaments' END;
  v_member_table text := CASE WHEN p_native THEN 'phase_participants' ELSE 'tournament_participants' END;
  v_group_table text := CASE WHEN p_native THEN 'phase_groups' ELSE 'tournament_groups' END;
  v_owner_column text := CASE WHEN p_native THEN 'phase_id' ELSE 'tournament_id' END;
  v_added uuid[];
  v_seed_phases uuid[];
  v_player uuid;
BEGIN
  PERFORM 1 FROM public.seasons WHERE id = p_season_id FOR NO KEY UPDATE;
  SELECT f.spec, f.seed INTO v_spec, v_seed FROM public.season_formats f
  WHERE f.season_id = p_season_id AND f.engine = 'kit'
    AND f.spec @> '{"stages":[{"participants":{"from":"roster","enrollment":"league_roster"}}]}'::jsonb
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  EXECUTE format($query$
    WITH inserted AS (
    INSERT INTO public.%1$I (%2$I, player_id, seed)
    SELECT p.id, s.player_id,
      (coalesce((SELECT max(m.seed) FROM public.%1$I m WHERE m.%2$I = p.id), 0)
        + row_number() OVER (
          PARTITION BY p.id
          ORDER BY CASE WHEN p.stage_spec #>> '{stage,participants,seeding}' = 'signup' THEN s.joined_at END
            NULLS FIRST, s.player_id
        ))::integer
    FROM public.%3$I p
    JOIN public.season_participants s ON s.season_id = p.season_id
    WHERE p.season_id = $1 AND p.format_stage_key IS NOT NULL AND p.format_group = 0
      AND p.stage_spec #> '{stage,participants}' @> '{"from":"roster","enrollment":"league_roster"}'::jsonb
      AND (
        p.status = 'upcoming' OR (
          p.status = 'active'
          AND (
            p.stage_spec #>> '{stage,pairing,kind}' = 'swiss'
            OR p.stage_spec #> '{stage,pairing}' @> '{"kind":"filter","base":{"kind":"swiss"}}'::jsonb
          )
          AND p.stage_spec #> '{stage,groups}' IS NULL
          AND NOT EXISTS (SELECT 1 FROM public.season_groups g WHERE g.season_id = p.season_id)
          AND NOT EXISTS (SELECT 1 FROM public.%4$I g WHERE g.%2$I = p.id)
        )
      )
      AND ($2 IS NULL OR s.player_id = $2)
      AND NOT EXISTS (SELECT 1 FROM public.%1$I m WHERE m.%2$I = p.id AND m.player_id = s.player_id)
    ORDER BY p.id, s.player_id
    ON CONFLICT (%2$I, player_id) DO NOTHING
    RETURNING %2$I AS phase_id, player_id
    )
    SELECT (SELECT array_agg(DISTINCT i.player_id ORDER BY i.player_id) FROM inserted i),
      array_agg(p.id)
    FROM public.%3$I p
    WHERE p.season_id = $1 AND p.status = 'upcoming' AND p.format_stage_key IS NOT NULL AND p.format_group = 0
      AND p.stage_spec #> '{stage,participants}' @> '{"from":"roster","enrollment":"league_roster"}'::jsonb
      AND (
        ($2 IS NULL AND p.stage_spec #>> '{stage,participants,seeding}' IN ('rating', 'random', 'signup'))
        OR (p.stage_spec #>> '{stage,participants,seeding}' IN ('rating', 'random')
          AND EXISTS (SELECT 1 FROM inserted i WHERE i.phase_id = p.id))
      )
  $query$, v_member_table, v_owner_column, v_phase_table, v_group_table)
    INTO v_added, v_seed_phases USING p_season_id, p_player_id;

  IF v_seed_phases IS NOT NULL THEN
    -- Reattaching can change the seed or mode while retaining all seats. Reapply the mode on full sync.
    -- Clearing first allows seed exchanges under the unique index.
    EXECUTE format('UPDATE public.%I SET seed = NULL WHERE %I = ANY ($1)', v_member_table, v_owner_column)
      USING v_seed_phases;
    EXECUTE format($query$
      WITH ranked AS (
        SELECT p.id AS phase_id, m.player_id, row_number() OVER (
          PARTITION BY p.id ORDER BY
            CASE WHEN s.mode = 'rating' THEN coalesce(r.rating, 1500) END DESC,
            CASE WHEN s.mode = 'rating' THEN pl.name END,
            CASE WHEN s.mode = 'random' THEN md5($2 || ':' || p.format_stage_key || ':' || m.player_id::text) END,
            CASE WHEN s.mode = 'signup' THEN sp.joined_at END NULLS FIRST,
            m.player_id
        )::integer AS seed
        FROM public.%1$I m
        JOIN public.%3$I p ON p.id = m.%2$I
        CROSS JOIN LATERAL (SELECT p.stage_spec #>> '{stage,participants,seeding}' AS mode) s
        JOIN public.players pl ON pl.id = m.player_id
        LEFT JOIN public.player_ratings r ON r.player_id = m.player_id AND s.mode = 'rating'
        LEFT JOIN public.season_participants sp
          ON sp.season_id = p.season_id AND sp.player_id = m.player_id AND s.mode = 'signup'
        WHERE p.id = ANY ($1)
      )
      UPDATE public.%1$I m SET seed = r.seed FROM ranked r
      WHERE m.%2$I = r.phase_id AND m.player_id = r.player_id
    $query$, v_member_table, v_owner_column, v_phase_table) USING v_seed_phases, v_seed;
  END IF;

  IF v_added IS NOT NULL THEN
    FOREACH v_player IN ARRAY v_added LOOP
      PERFORM public.format__splice_roster_player(p_season_id, v_player, v_spec, v_seed);
    END LOOP;
  END IF;
  IF v_added IS NOT NULL OR v_seed_phases IS NOT NULL THEN
    UPDATE public.season_formats SET revision = revision WHERE season_id = p_season_id;
  END IF;
END $$;

CREATE FUNCTION public.season_participant_add(p_season_id uuid, p_player_id uuid) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_mode text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_season_id::text));
  PERFORM 1 FROM public.seasons WHERE id = p_season_id FOR NO KEY UPDATE;
  INSERT INTO public.season_participants (season_id, player_id) VALUES (p_season_id, p_player_id);
  v_mode := public.phase_storage_mode();
  IF v_mode IN ('legacy', 'phase') THEN
    PERFORM public.format__sync_league_roster(p_season_id, v_mode = 'phase', p_player_id);
  ELSIF EXISTS (
    SELECT 1 FROM public.season_formats f WHERE f.season_id = p_season_id AND f.engine = 'kit'
      AND f.spec @> '{"stages":[{"participants":{"from":"roster","enrollment":"league_roster"}}]}'::jsonb
  ) THEN
    RAISE EXCEPTION 'phase_storage_not_ready' USING ERRCODE = 'P0001';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.season_participant_remove(p_season_id uuid, p_player_id uuid) RETURNS boolean
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_group uuid;
  v_left integer;
  v_removed integer;
  v_mode text;
  v_phase_table text;
  v_member_table text;
  v_owner_column text;
BEGIN
  IF p_season_id IS NULL OR p_player_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_CONFIG' USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('field', 'player_id')::text;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_season_id::text));
  IF public.season__legacy_draft_live(p_season_id) THEN
    RAISE EXCEPTION 'SEASON_DRAFT_LOCKED' USING ERRCODE = 'P0001';
  END IF;
  SELECT m.group_id INTO v_group FROM public.season_group_members m
   WHERE m.season_id = p_season_id AND m.player_id = p_player_id;
  IF FOUND THEN
    IF public.season_group__league_scheduled(p_season_id) THEN
      RAISE EXCEPTION 'SEASON_GROUPS_SCHEDULED' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('season_group_id', v_group)::text;
    END IF;
    IF public.season_group__has_live_pool(v_group)
       OR EXISTS (SELECT 1 FROM public.evolution_tracker t
                   WHERE t.season_id = p_season_id AND t.player_id = p_player_id AND t.season_group_id = v_group
                     AND t.line_id IS NOT NULL) THEN
      RAISE EXCEPTION 'SEASON_GROUP_LOCKED' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('season_group_id', v_group)::text;
    END IF;
    SELECT count(*) INTO v_left FROM public.season_group_members
     WHERE group_id = v_group AND player_id <> p_player_id;
    IF v_left < 2 THEN
      RAISE EXCEPTION 'SEASON_GROUP_TOO_SMALL' USING ERRCODE = 'P0001',
        DETAIL = jsonb_build_object('season_group_id', v_group)::text;
    END IF;
  END IF;

  PERFORM 1 FROM public.seasons WHERE id = p_season_id FOR NO KEY UPDATE;
  DELETE FROM public.season_participants WHERE season_id = p_season_id AND player_id = p_player_id;
  IF NOT FOUND THEN RETURN false; END IF;

  -- The format row serializes removal with a relation draw. A successful removal bumps the
  -- revision so a concurrent draw prepared using the old roster must reload and retry.
  PERFORM 1 FROM public.season_formats f WHERE f.season_id = p_season_id AND f.engine = 'kit'
    AND f.spec @> '{"stages":[{"participants":{"from":"roster","enrollment":"league_roster"}}]}'::jsonb
    FOR UPDATE;
  IF FOUND THEN
    v_mode := public.phase_storage_mode();
    IF v_mode IS DISTINCT FROM 'legacy' AND v_mode IS DISTINCT FROM 'phase' THEN
      RAISE EXCEPTION 'phase_storage_not_ready' USING ERRCODE = 'P0001';
    END IF;
    v_phase_table := CASE WHEN v_mode = 'phase' THEN 'league_phases' ELSE 'tournaments' END;
    v_member_table := CASE WHEN v_mode = 'phase' THEN 'phase_participants' ELSE 'tournament_participants' END;
    v_owner_column := CASE WHEN v_mode = 'phase' THEN 'phase_id' ELSE 'tournament_id' END;
    EXECUTE format($query$
      DELETE FROM public.%1$I m USING public.%3$I p
      WHERE m.%2$I = p.id AND m.player_id = $2 AND p.season_id = $1
        AND p.status = 'upcoming' AND p.format_stage_key IS NOT NULL AND p.format_group = 0
        AND p.stage_spec #> '{stage,participants}' @> '{"from":"roster","enrollment":"league_roster"}'::jsonb
    $query$, v_member_table, v_owner_column, v_phase_table) USING p_season_id, p_player_id;
    GET DIAGNOSTICS v_removed = ROW_COUNT;
    IF v_removed > 0 THEN
      IF EXISTS (
        SELECT 1 FROM public.format_relation_links l WHERE l.season_id = p_season_id
          AND p_player_id IN (l.from_player_id, l.to_player_id)
      ) THEN
        RAISE EXCEPTION 'SEASON_ROSTER_RELATION_ASSIGNED' USING ERRCODE = 'P0001';
      END IF;
      UPDATE public.season_formats SET revision = revision WHERE season_id = p_season_id;
    END IF;
  END IF;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.format__splice_roster_player(uuid, uuid, jsonb, text),
  public.format__sync_league_roster(uuid, boolean, uuid), public.season_participant_add(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.format__splice_roster_player(uuid, uuid, jsonb, text),
  public.format__sync_league_roster(uuid, boolean, uuid), public.season_participant_add(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.format_attach_season(
  p_season_id uuid, p_definition_id uuid, p_version_no integer, p_spec jsonb, p_spec_hash text, p_seed text, p_stages jsonb,
  p_preset_rulesets jsonb DEFAULT '{}'::jsonb, p_confirm_clear boolean DEFAULT false, p_confirmed_counts jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_format           public.season_format_type;
  v_replaced         boolean;
  v_manual           integer;
  v_removed          uuid[];
  v_stages           jsonb;
  v_previous         jsonb;
  v_removed_rulesets uuid[];
  v_cleared          jsonb;
BEGIN
  IF current_user <> 'postgres' AND public.phase_storage_mode() IS DISTINCT FROM 'legacy' THEN
    RAISE EXCEPTION 'phase_storage_not_ready' USING ERRCODE = 'P0001';
  END IF;
  IF p_stages IS NULL OR jsonb_typeof(p_stages) <> 'array' THEN
    RAISE EXCEPTION 'format_attach_season: p_stages must be a json array' USING ERRCODE = '22023';
  END IF;
  IF p_preset_rulesets IS NULL OR jsonb_typeof(p_preset_rulesets) <> 'object' THEN
    RAISE EXCEPTION 'format_attach_season: p_preset_rulesets must be a json object' USING ERRCODE = '22023';
  END IF;
  SELECT s.format_type INTO v_format FROM public.seasons s WHERE s.id = p_season_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FORMAT_SEASON_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_format <> 'custom' THEN
    RAISE EXCEPTION 'FORMAT_SEASON_NOT_CUSTOM' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.format__lock_phases(p_season_id);
  IF public.format_season_started(p_season_id) THEN
    RAISE EXCEPTION 'FORMAT_SEASON_STARTED' USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_manual FROM public.tournaments t
   WHERE t.season_id = p_season_id AND t.format_stage_key IS NULL;
  IF v_manual > 0 THEN
    RAISE EXCEPTION 'FORMAT_SEASON_HAS_MANUAL_PHASES' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('count', v_manual)::text;
  END IF;

  SELECT f.preset_rulesets INTO v_previous FROM public.season_formats f WHERE f.season_id = p_season_id;
  v_replaced := FOUND;
  IF v_replaced THEN
    v_cleared := public.format__guard_runtime_clear(p_season_id, coalesce(p_confirm_clear, false), p_confirmed_counts);
  END IF;
  -- A first attach clears too: runtime rows without a season_formats row belong to no format (a ghost check or an event of a
  -- format that was detached, written by a writer that raced the detach), and would otherwise be inherited by the new one.
  PERFORM public.format__clear_runtime(p_season_id);
  INSERT INTO public.season_formats AS f (season_id, definition_id, version_no, spec, spec_hash, seed, preset_rulesets)
  VALUES (p_season_id, p_definition_id, p_version_no, p_spec, p_spec_hash, p_seed, p_preset_rulesets)
  ON CONFLICT (season_id) DO UPDATE
    SET definition_id = EXCLUDED.definition_id, version_no = EXCLUDED.version_no, spec = EXCLUDED.spec,
        spec_hash = EXCLUDED.spec_hash, seed = EXCLUDED.seed, tunables = '{}'::jsonb,
        amendments = '[]'::jsonb, preset_rulesets = EXCLUDED.preset_rulesets, frozen_at = now();

  -- Phases whose (stage, group) left the spec are removed. The started check above, taken under the seasons row and every
  -- phase row (format__lock_phases), proves they are upcoming and have no rounds, and no writer can change that before this
  -- statement.
  WITH wanted AS (
    SELECT x.key, coalesce(x.format_group, 0) AS format_group
      FROM jsonb_to_recordset(p_stages) AS x(key text, format_group integer)),
  gone AS (
    DELETE FROM public.tournaments t
     WHERE t.season_id = p_season_id AND t.format_stage_key IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM wanted w WHERE w.key = t.format_stage_key AND w.format_group = t.format_group)
    RETURNING t.id)
  SELECT coalesce(array_agg(g.id), ARRAY[]::uuid[]) INTO v_removed FROM gone g;

  WITH up AS (
    INSERT INTO public.tournaments AS t
           (season_id, format_stage_key, format_group, name, bracket_type, ruleset_id, best_of_default, bo_overrides,
            is_doubles, bracket_reset_enabled, third_place_enabled, stage_order, stage_spec)
    SELECT p_season_id, x.key, coalesce(x.format_group, 0), x.name, x.bracket_type, x.ruleset_id, x.best_of_default,
           coalesce(x.bo_overrides, '{}'::jsonb), x.is_doubles, x.bracket_reset_enabled,
           coalesce(x.third_place_enabled, false), x.stage_order, x.stage_spec
      FROM jsonb_to_recordset(p_stages) AS x(
             key text, format_group integer, name text, bracket_type public.bracket_type, ruleset_id uuid,
             best_of_default integer, bo_overrides jsonb, is_doubles boolean, bracket_reset_enabled boolean,
             third_place_enabled boolean, stage_order integer, stage_spec jsonb)
    ON CONFLICT (season_id, format_stage_key, format_group) WHERE format_stage_key IS NOT NULL DO UPDATE
      SET name = EXCLUDED.name, bracket_type = EXCLUDED.bracket_type, ruleset_id = EXCLUDED.ruleset_id,
          best_of_default = EXCLUDED.best_of_default, bo_overrides = EXCLUDED.bo_overrides,
          is_doubles = EXCLUDED.is_doubles, bracket_reset_enabled = EXCLUDED.bracket_reset_enabled,
          third_place_enabled = EXCLUDED.third_place_enabled,
          stage_order = EXCLUDED.stage_order, stage_spec = EXCLUDED.stage_spec
    RETURNING t.id, t.format_stage_key, t.format_group)
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'key', u.format_stage_key, 'group', u.format_group)), '[]'::jsonb)
    INTO v_stages FROM up u;

  PERFORM public.format__sync_league_roster(p_season_id, false, NULL);

  -- Rulesets the previous attach created that this one no longer uses (after the phases point at the new ones).
  v_removed_rulesets := public.format_delete_unused_preset_rulesets(v_previous, p_preset_rulesets);

  RETURN jsonb_build_object(
    'replaced', v_replaced, 'stages', v_stages,
    'removed_stage_ids', to_jsonb(v_removed), 'removed_ruleset_ids', to_jsonb(v_removed_rulesets),
    'cleared', v_cleared);
END $$;

CREATE OR REPLACE FUNCTION public.phase_format_attach_season(
  p_season_id uuid, p_definition_id uuid, p_version_no integer, p_spec jsonb, p_spec_hash text, p_seed text, p_stages jsonb,
  p_preset_rulesets jsonb DEFAULT '{}'::jsonb, p_confirm_clear boolean DEFAULT false, p_confirmed_counts jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_format           public.season_format_type;
  v_replaced         boolean;
  v_manual           integer;
  v_removed          uuid[];
  v_stages           jsonb;
  v_previous         jsonb;
  v_removed_rulesets uuid[];
  v_cleared          jsonb;
BEGIN
  IF current_user <> 'postgres' AND public.phase_storage_mode() IS DISTINCT FROM 'phase' THEN
    RAISE EXCEPTION 'phase_storage_not_ready' USING ERRCODE = 'P0001';
  END IF;
  IF p_stages IS NULL OR jsonb_typeof(p_stages) <> 'array' THEN
    RAISE EXCEPTION 'phase_format_attach_season: p_stages must be a json array' USING ERRCODE = '22023';
  END IF;
  IF p_preset_rulesets IS NULL OR jsonb_typeof(p_preset_rulesets) <> 'object' THEN
    RAISE EXCEPTION 'phase_format_attach_season: p_preset_rulesets must be a json object' USING ERRCODE = '22023';
  END IF;
  SELECT s.format_type INTO v_format FROM public.seasons s WHERE s.id = p_season_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FORMAT_SEASON_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_format <> 'custom' THEN
    RAISE EXCEPTION 'FORMAT_SEASON_NOT_CUSTOM' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.phase_format__lock_phases(p_season_id);
  IF public.phase_format_season_started(p_season_id) THEN
    RAISE EXCEPTION 'FORMAT_SEASON_STARTED' USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_manual FROM public.league_phases t
   WHERE t.season_id = p_season_id AND t.format_stage_key IS NULL;
  IF v_manual > 0 THEN
    RAISE EXCEPTION 'FORMAT_SEASON_HAS_MANUAL_PHASES' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('count', v_manual)::text;
  END IF;

  SELECT f.preset_rulesets INTO v_previous FROM public.season_formats f WHERE f.season_id = p_season_id;
  v_replaced := FOUND;
  IF v_replaced THEN
    v_cleared := public.format__guard_runtime_clear(p_season_id, coalesce(p_confirm_clear, false), p_confirmed_counts);
  END IF;
  -- A first attach clears too: runtime rows without a season_formats row belong to no format (a ghost check or an event of a
  -- format that was detached, written by a writer that raced the detach), and would otherwise be inherited by the new one.
  PERFORM public.format__clear_runtime(p_season_id);
  INSERT INTO public.season_formats AS f (season_id, definition_id, version_no, spec, spec_hash, seed, preset_rulesets)
  VALUES (p_season_id, p_definition_id, p_version_no, p_spec, p_spec_hash, p_seed, p_preset_rulesets)
  ON CONFLICT (season_id) DO UPDATE
    SET definition_id = EXCLUDED.definition_id, version_no = EXCLUDED.version_no, spec = EXCLUDED.spec,
        spec_hash = EXCLUDED.spec_hash, seed = EXCLUDED.seed, tunables = '{}'::jsonb,
        amendments = '[]'::jsonb, preset_rulesets = EXCLUDED.preset_rulesets, frozen_at = now();

  -- Phases whose (stage, group) left the spec are removed. The started check above, taken under the seasons row and every
  -- phase row (phase_format__lock_phases), proves they are upcoming and have no rounds, and no writer can change that before this
  -- statement.
  WITH wanted AS (
    SELECT x.key, coalesce(x.format_group, 0) AS format_group
      FROM jsonb_to_recordset(p_stages) AS x(key text, format_group integer)),
  gone AS (
    DELETE FROM public.league_phases t
     WHERE t.season_id = p_season_id AND t.format_stage_key IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM wanted w WHERE w.key = t.format_stage_key AND w.format_group = t.format_group)
    RETURNING t.id)
  SELECT coalesce(array_agg(g.id), ARRAY[]::uuid[]) INTO v_removed FROM gone g;

  WITH up AS (
    INSERT INTO public.league_phases AS t
           (season_id, format_stage_key, format_group, name, bracket_type, ruleset_id, best_of_default, bo_overrides,
            is_doubles, bracket_reset_enabled, third_place_enabled, stage_order, stage_spec)
    SELECT p_season_id, x.key, coalesce(x.format_group, 0), x.name, x.bracket_type, x.ruleset_id, x.best_of_default,
           coalesce(x.bo_overrides, '{}'::jsonb), x.is_doubles, x.bracket_reset_enabled,
           coalesce(x.third_place_enabled, false), x.stage_order, x.stage_spec
      FROM jsonb_to_recordset(p_stages) AS x(
             key text, format_group integer, name text, bracket_type public.bracket_type, ruleset_id uuid,
             best_of_default integer, bo_overrides jsonb, is_doubles boolean, bracket_reset_enabled boolean,
             third_place_enabled boolean, stage_order integer, stage_spec jsonb)
    ON CONFLICT (season_id, format_stage_key, format_group) WHERE format_stage_key IS NOT NULL DO UPDATE
      SET name = EXCLUDED.name, bracket_type = EXCLUDED.bracket_type, ruleset_id = EXCLUDED.ruleset_id,
          best_of_default = EXCLUDED.best_of_default, bo_overrides = EXCLUDED.bo_overrides,
          is_doubles = EXCLUDED.is_doubles, bracket_reset_enabled = EXCLUDED.bracket_reset_enabled,
          third_place_enabled = EXCLUDED.third_place_enabled,
          stage_order = EXCLUDED.stage_order, stage_spec = EXCLUDED.stage_spec
    RETURNING t.id, t.format_stage_key, t.format_group)
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'key', u.format_stage_key, 'group', u.format_group)), '[]'::jsonb)
    INTO v_stages FROM up u;

  PERFORM public.format__sync_league_roster(p_season_id, true, NULL);

  -- Rulesets the previous attach created that this one no longer uses (after the phases point at the new ones).
  v_removed_rulesets := public.phase_format_delete_unused_preset_rulesets(v_previous, p_preset_rulesets);

  RETURN jsonb_build_object(
    'replaced', v_replaced, 'stages', v_stages,
    'removed_stage_ids', to_jsonb(v_removed), 'removed_ruleset_ids', to_jsonb(v_removed_rulesets),
    'cleared', v_cleared);
END $$;

COMMIT;

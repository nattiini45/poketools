BEGIN;
SET LOCAL lock_timeout = '5s';

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

  -- Rulesets the previous attach created that this one no longer uses (after the phases point at the new ones).
  v_removed_rulesets := public.format_delete_unused_preset_rulesets(v_previous, p_preset_rulesets);

  RETURN jsonb_build_object(
    'replaced', v_replaced, 'stages', v_stages,
    'removed_stage_ids', to_jsonb(v_removed), 'removed_ruleset_ids', to_jsonb(v_removed_rulesets),
    'cleared', v_cleared);
END $$;

CREATE OR REPLACE FUNCTION public.format_detach_season(p_season_id uuid, p_confirm_clear boolean DEFAULT false, p_confirmed_counts jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_removed          uuid[];
  v_recorded         jsonb;
  v_removed_rulesets uuid[];
  v_cleared          jsonb;
BEGIN
  IF current_user <> 'postgres' AND public.phase_storage_mode() IS DISTINCT FROM 'legacy' THEN
    RAISE EXCEPTION 'phase_storage_not_ready' USING ERRCODE = 'P0001';
  END IF;
  PERFORM 1 FROM public.seasons s WHERE s.id = p_season_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FORMAT_SEASON_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  SELECT f.preset_rulesets INTO v_recorded FROM public.season_formats f WHERE f.season_id = p_season_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FORMAT_NOTHING_ATTACHED' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.format__lock_phases(p_season_id);
  IF public.format_season_started(p_season_id) THEN
    RAISE EXCEPTION 'FORMAT_SEASON_STARTED' USING ERRCODE = 'P0001';
  END IF;
  v_cleared := public.format__guard_runtime_clear(p_season_id, coalesce(p_confirm_clear, false), p_confirmed_counts);
  -- A teams row that points at a stage raises 23503 here and rolls everything back.
  WITH gone AS (
    DELETE FROM public.tournaments t
     WHERE t.season_id = p_season_id AND t.format_stage_key IS NOT NULL
    RETURNING t.id)
  SELECT coalesce(array_agg(g.id), ARRAY[]::uuid[]) INTO v_removed FROM gone g;
  PERFORM public.format__clear_runtime(p_season_id);
  DELETE FROM public.season_formats f WHERE f.season_id = p_season_id;
  v_removed_rulesets := public.format_delete_unused_preset_rulesets(v_recorded, '{}'::jsonb);
  RETURN jsonb_build_object('removed_stage_ids', to_jsonb(v_removed), 'removed_ruleset_ids', to_jsonb(v_removed_rulesets),
                            'cleared', v_cleared);
END $$;

CREATE OR REPLACE FUNCTION public.competition_create_from_format(
  p_actor uuid, p_season jsonb, p_format jsonb, p_rulesets jsonb, p_stages jsonb, p_grant_creator boolean)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_season_id     uuid;
  v_definition_id uuid;
  v_version_no    integer;
  v_fork          jsonb;
  v_candidates    jsonb;
  v_count         integer;
  v_inserted      uuid;
  v_ruleset       jsonb;
  v_ruleset_id    uuid;
  v_version_id    uuid;
  v_version_of    jsonb := '{}'::jsonb;
  v_preset_map    jsonb := '{}'::jsonb;
  v_ruleset_ids   uuid[] := ARRAY[]::uuid[];
  v_stages        jsonb;
  v_attached      jsonb;
BEGIN
  IF current_user <> 'postgres' AND public.phase_storage_mode() IS DISTINCT FROM 'legacy' THEN
    RAISE EXCEPTION 'phase_storage_not_ready' USING ERRCODE = 'P0001';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'competition_create_from_format: p_actor is required' USING ERRCODE = '22023';
  END IF;
  IF p_season IS NULL OR jsonb_typeof(p_season) <> 'object' THEN
    RAISE EXCEPTION 'competition_create_from_format: p_season must be a json object' USING ERRCODE = '22023';
  END IF;
  IF p_format IS NULL OR jsonb_typeof(p_format) <> 'object' THEN
    RAISE EXCEPTION 'competition_create_from_format: p_format must be a json object' USING ERRCODE = '22023';
  END IF;
  IF p_rulesets IS NULL OR jsonb_typeof(p_rulesets) <> 'array' THEN
    RAISE EXCEPTION 'competition_create_from_format: p_rulesets must be a json array' USING ERRCODE = '22023';
  END IF;
  IF p_stages IS NULL OR jsonb_typeof(p_stages) <> 'array' THEN
    RAISE EXCEPTION 'competition_create_from_format: p_stages must be a json array' USING ERRCODE = '22023';
  END IF;

  v_season_id     := (p_season ->> 'id')::uuid;
  v_definition_id := (p_format ->> 'definition_id')::uuid;
  v_fork          := p_format -> 'fork';

  -- 1. The format: a fork of an example is inserted and published here; a stored format brings its published version.
  IF v_fork IS NOT NULL AND jsonb_typeof(v_fork) = 'object' THEN
    v_candidates := v_fork -> 'slug_candidates';
    IF v_candidates IS NULL OR jsonb_typeof(v_candidates) <> 'array' OR jsonb_array_length(v_candidates) = 0 THEN
      RAISE EXCEPTION 'competition_create_from_format: fork.slug_candidates must be a non-empty json array' USING ERRCODE = '22023';
    END IF;
    v_count := jsonb_array_length(v_candidates);
    v_inserted := NULL;
    FOR i IN 0 .. v_count - 2 LOOP
      INSERT INTO public.format_definitions
             (id, slug, name, description, kind, owner_id, visibility, forked_from, current_draft, draft_rev)
      VALUES (v_definition_id, v_candidates ->> i, v_fork -> 'name', nullif(v_fork -> 'description', 'null'::jsonb),
              'custom', p_actor, 'private', NULL, v_fork -> 'document', 1)
      ON CONFLICT (slug) DO NOTHING
      RETURNING id INTO v_inserted;
      EXIT WHEN v_inserted IS NOT NULL;
    END LOOP;
    IF v_inserted IS NULL THEN
      INSERT INTO public.format_definitions
             (id, slug, name, description, kind, owner_id, visibility, forked_from, current_draft, draft_rev)
      VALUES (v_definition_id, v_candidates ->> (v_count - 1), v_fork -> 'name', nullif(v_fork -> 'description', 'null'::jsonb),
              'custom', p_actor, 'private', NULL, v_fork -> 'document', 1);
    END IF;
    SELECT p.out_version_no INTO v_version_no
      FROM public.format_publish_version(
             v_definition_id, 1, (p_format -> 'spec' ->> 'schema_version')::integer, p_format -> 'spec',
             p_format ->> 'spec_hash', nullif(v_fork -> 'changelog', 'null'::jsonb), p_actor) AS p;
  ELSE
    v_version_no := (p_format ->> 'version_no')::integer;
  END IF;

  -- 2. One published ruleset per rule preset the stages name, owned by the new league.
  FOR v_ruleset IN SELECT r.value FROM jsonb_array_elements(p_rulesets) AS r LOOP
    v_ruleset_id := (v_ruleset ->> 'id')::uuid;
    v_candidates := v_ruleset -> 'slug_candidates';
    IF v_candidates IS NULL OR jsonb_typeof(v_candidates) <> 'array' OR jsonb_array_length(v_candidates) = 0 THEN
      RAISE EXCEPTION 'competition_create_from_format: ruleset slug_candidates must be a non-empty json array' USING ERRCODE = '22023';
    END IF;
    v_count := jsonb_array_length(v_candidates);
    v_inserted := NULL;
    FOR i IN 0 .. v_count - 2 LOOP
      INSERT INTO public.ruleset_definitions
             (id, slug, name, description, kind, owner_id, visibility, season_id, forked_from, current_draft, draft_rev)
      VALUES (v_ruleset_id, v_candidates ->> i, v_ruleset -> 'name', NULL, 'custom', p_actor, 'private', v_season_id, NULL,
              v_ruleset -> 'document', 1)
      ON CONFLICT (slug) DO NOTHING
      RETURNING id INTO v_inserted;
      EXIT WHEN v_inserted IS NOT NULL;
    END LOOP;
    IF v_inserted IS NULL THEN
      INSERT INTO public.ruleset_definitions
             (id, slug, name, description, kind, owner_id, visibility, season_id, forked_from, current_draft, draft_rev)
      VALUES (v_ruleset_id, v_candidates ->> (v_count - 1), v_ruleset -> 'name', NULL, 'custom', p_actor, 'private', v_season_id,
              NULL, v_ruleset -> 'document', 1);
    END IF;
    SELECT p.out_version_id INTO v_version_id
      FROM public.ruleset_publish_version(
             v_ruleset_id, 1, (v_ruleset -> 'document' ->> 'schema_version')::integer, v_ruleset -> 'document',
             v_ruleset ->> 'content_hash', v_ruleset -> 'resolved', v_ruleset ->> 'resolved_hash',
             v_ruleset ->> 'catalog_version', (v_ruleset -> 'resolved' ->> 'gen')::integer,
             v_ruleset -> 'resolved' ->> 'format_key', (v_ruleset -> 'resolved' ->> 'doubles')::boolean,
             nullif(v_ruleset -> 'changelog', 'null'::jsonb), p_actor) AS p;
    v_version_of  := v_version_of || jsonb_build_object(v_ruleset_id::text, v_version_id);
    v_preset_map  := v_preset_map || jsonb_build_object(v_ruleset ->> 'preset', v_ruleset_id);
    v_ruleset_ids := v_ruleset_ids || v_ruleset_id;
  END LOOP;

  -- 3. The league. Language and route theme keep their column defaults unless the request names them.
  INSERT INTO public.seasons (id, name, description, format_type, ruleset_id, start_date, end_date)
  VALUES (v_season_id, p_season ->> 'name', coalesce(p_season ->> 'description', ''), 'custom',
          (p_season ->> 'ruleset_id')::uuid, (p_season ->> 'start_date')::date, (p_season ->> 'end_date')::date);
  IF p_season ? 'route_theme' OR p_season ? 'language' THEN
    UPDATE public.seasons s
       SET route_theme = coalesce(p_season ->> 'route_theme', s.route_theme),
           language    = coalesce(p_season ->> 'language', s.language)
     WHERE s.id = v_season_id;
  END IF;

  -- 4. A creator who is not a site admin administers the league they created.
  IF coalesce(p_grant_creator, false) THEN
    INSERT INTO public.resource_admins (player_id, resource_type, resource_id) VALUES (p_actor, 'season', v_season_id);
  END IF;

  -- 5. The stages, through the one attach path. Preset stages pin the version published in step 2.
  SELECT coalesce(jsonb_agg(
           CASE WHEN v_version_of ? (t.stage ->> 'ruleset_id')
                THEN jsonb_set(t.stage, '{ruleset_id}', v_version_of -> (t.stage ->> 'ruleset_id'))
                ELSE t.stage END
           ORDER BY t.ord), '[]'::jsonb)
    INTO v_stages
    FROM jsonb_array_elements(p_stages) WITH ORDINALITY AS t(stage, ord);

  v_attached := public.format_attach_season(
    v_season_id, v_definition_id, v_version_no, p_format -> 'spec', p_format ->> 'spec_hash', p_format ->> 'seed',
    v_stages, v_preset_map, false);

  -- The league row as stored, so the caller answers without a read after the commit.
  RETURN jsonb_build_object(
    'season', (SELECT to_jsonb(s) FROM public.seasons s WHERE s.id = v_season_id),
    'season_id', v_season_id,
    'definition_id', v_definition_id,
    'version_no', v_version_no,
    'stages', coalesce(v_attached -> 'stages', '[]'::jsonb),
    'ruleset_ids', to_jsonb(v_ruleset_ids));
END $$;

COMMIT;

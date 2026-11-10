-- The new-competition wizard (plan "site-implementation", section 5): one call that creates a custom league from a format in
-- ONE transaction, so a failure at any step leaves nothing behind. `POST /api/seasons` with `from_format` resolves, compiles
-- and plans everything in TypeScript first (no write), then calls this function once (src/lib/format-studio/create-league.ts).
--
-- In order, inside the caller's transaction:
--   1. from an example (`p_format.fork` present): insert a private `format_definitions` row owned by the actor under the first
--      free slug of `fork.slug_candidates` (the last candidate is inserted plainly, so a taken slug raises 23505 on
--      `format_definitions_slug_key`), then publish it as version 1 through `format_publish_version` (its row lock and checks
--      apply). From a stored format, the definition and its published `version_no` are used as they are;
--   2. one ruleset definition per rule preset the stages name (`p_rulesets`), owned by the actor and the new league
--      (`season_id`, no foreign key by design), published as version 1 through `ruleset_publish_version`;
--   3. the `seasons` row (`format_type = 'custom'`), under the id the caller generated;
--   4. with `p_grant_creator` (a creator who is not a site admin), the `resource_admins` row for the new league;
--   5. `format_attach_season` with the planned stages. A stage whose `ruleset_id` is the id of a ruleset DEFINITION created in
--      step 2 gets that definition's published version id instead (what a phase pins).
--
-- Every row lands in a table the league recycle bin already classifies (`seasons`, `resource_admins`, `season_formats`,
-- `tournaments`), in the format library (not league data), or in `ruleset_definitions`, which outlives a league by design.
-- No table, foreign key or trigger is created, so `league_trash__inventory()` is unchanged.

BEGIN;

CREATE OR REPLACE FUNCTION public.competition_create_from_format(
  p_actor uuid, p_season jsonb, p_format jsonb, p_rulesets jsonb, p_stages jsonb, p_grant_creator boolean)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
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

REVOKE ALL ON FUNCTION public.competition_create_from_format(uuid, jsonb, jsonb, jsonb, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.competition_create_from_format(uuid, jsonb, jsonb, jsonb, jsonb, boolean) TO service_role;

COMMENT ON FUNCTION public.competition_create_from_format(uuid, jsonb, jsonb, jsonb, jsonb, boolean) IS
  'Service-role only. The new-competition wizard: a custom league from a format (an example forked and published, or a published version), its preset rulesets, the creator grant and the attached stages, in one transaction.';

COMMIT;

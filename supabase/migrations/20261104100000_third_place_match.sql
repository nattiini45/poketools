-- Format engine: the third-place match of a single-elimination phase.
--
-- tournaments.third_place_enabled   A single-elimination bracket with at least four players adds a match for third
--                                   place between the two semifinal losers, played in the final's round. Default
--                                   false: every existing bracket keeps its graph. Ignored by every other bracket type.
-- format_attach_season()            reads third_place_enabled from each stage (absent: false) and writes it with the
--                                   other stage columns. Same signature; the body is the 20261026090000 one plus
--                                   the new column, and a replace keeps the league's engine (legacy | shadow | kit)
--                                   instead of resetting it to kit: the engine is the admin's choice, not the format's.
--
-- Service-role only, like the function it replaces (src/lib/supabase/__tests__/migration-api-grants.test.ts).
-- Deploy order: before the code.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.tournaments
  ADD COLUMN third_place_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tournaments.third_place_enabled IS
  'Single elimination only: play a third-place match between the semifinal losers in the final''s round (four or more players).';

-- Attach: one transaction. p_stages is a jsonb array of
-- {key, name, bracket_type, ruleset_id, best_of_default, bo_overrides, is_doubles, bracket_reset_enabled,
--  third_place_enabled, stage_order, stage_spec}.
-- p_preset_rulesets is {rule preset id: ruleset uuid} for the rule-preset stages of the spec ('{}' when none).
-- Returns {replaced, stages: [{id, key}], removed_stage_ids, removed_ruleset_ids}.
--   FORMAT_SEASON_NOT_FOUND / FORMAT_SEASON_NOT_CUSTOM / FORMAT_SEASON_STARTED
--   FORMAT_SEASON_HAS_MANUAL_PHASES  (DETAIL {count}): a phase that was not created from a format blocks the attach
CREATE OR REPLACE FUNCTION public.format_attach_season(
  p_season_id uuid, p_definition_id uuid, p_version_no integer, p_spec jsonb, p_spec_hash text, p_seed text, p_stages jsonb,
  p_preset_rulesets jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_format           public.season_format_type;
  v_replaced         boolean;
  v_manual           integer;
  v_keys             text[];
  v_removed          uuid[];
  v_stages           jsonb;
  v_previous         jsonb;
  v_removed_rulesets uuid[];
BEGIN
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
  INSERT INTO public.season_formats AS f (season_id, definition_id, version_no, spec, spec_hash, seed, preset_rulesets)
  VALUES (p_season_id, p_definition_id, p_version_no, p_spec, p_spec_hash, p_seed, p_preset_rulesets)
  ON CONFLICT (season_id) DO UPDATE
    SET definition_id = EXCLUDED.definition_id, version_no = EXCLUDED.version_no, spec = EXCLUDED.spec,
        spec_hash = EXCLUDED.spec_hash, seed = EXCLUDED.seed, tunables = '{}'::jsonb,
        amendments = '[]'::jsonb, preset_rulesets = EXCLUDED.preset_rulesets, frozen_at = now();

  SELECT array_agg(x.key) INTO v_keys FROM jsonb_to_recordset(p_stages) AS x(key text);

  -- Stages that left the spec are removed. The started check above proves they are upcoming and have no rounds.
  WITH gone AS (
    DELETE FROM public.tournaments t
     WHERE t.season_id = p_season_id AND t.format_stage_key IS NOT NULL
       AND t.format_stage_key <> ALL (coalesce(v_keys, ARRAY[]::text[]))
    RETURNING t.id)
  SELECT coalesce(array_agg(g.id), ARRAY[]::uuid[]) INTO v_removed FROM gone g;

  WITH up AS (
    INSERT INTO public.tournaments AS t
           (season_id, format_stage_key, name, bracket_type, ruleset_id, best_of_default, bo_overrides, is_doubles,
            bracket_reset_enabled, third_place_enabled, stage_order, stage_spec)
    SELECT p_season_id, x.key, x.name, x.bracket_type, x.ruleset_id, x.best_of_default,
           coalesce(x.bo_overrides, '{}'::jsonb), x.is_doubles, x.bracket_reset_enabled,
           coalesce(x.third_place_enabled, false), x.stage_order, x.stage_spec
      FROM jsonb_to_recordset(p_stages) AS x(
             key text, name text, bracket_type public.bracket_type, ruleset_id uuid, best_of_default integer,
             bo_overrides jsonb, is_doubles boolean, bracket_reset_enabled boolean, third_place_enabled boolean,
             stage_order integer, stage_spec jsonb)
    ON CONFLICT (season_id, format_stage_key) WHERE format_stage_key IS NOT NULL DO UPDATE
      SET name = EXCLUDED.name, bracket_type = EXCLUDED.bracket_type, ruleset_id = EXCLUDED.ruleset_id,
          best_of_default = EXCLUDED.best_of_default, bo_overrides = EXCLUDED.bo_overrides,
          is_doubles = EXCLUDED.is_doubles, bracket_reset_enabled = EXCLUDED.bracket_reset_enabled,
          third_place_enabled = EXCLUDED.third_place_enabled,
          stage_order = EXCLUDED.stage_order, stage_spec = EXCLUDED.stage_spec
    RETURNING t.id, t.format_stage_key)
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'key', u.format_stage_key)), '[]'::jsonb)
    INTO v_stages FROM up u;

  -- Rulesets the previous attach created that this one no longer uses (after the phases point at the new ones).
  v_removed_rulesets := public.format_delete_unused_preset_rulesets(v_previous, p_preset_rulesets);

  RETURN jsonb_build_object(
    'replaced', v_replaced, 'stages', v_stages,
    'removed_stage_ids', to_jsonb(v_removed), 'removed_ruleset_ids', to_jsonb(v_removed_rulesets));
END $$;

REVOKE ALL ON FUNCTION public.format_attach_season(uuid, uuid, integer, jsonb, text, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.format_attach_season(uuid, uuid, integer, jsonb, text, text, jsonb, jsonb) TO service_role;

COMMIT;

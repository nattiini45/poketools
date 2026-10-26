-- Format Studio, step 3 of 3: attaching a format to a custom league, and the stages it creates.
--
-- season_formats            the frozen copy of the attached format version for one league (the spec itself, its hash
--                           and a seed), so a later publish never changes a running league.
-- tournaments.format_stage_key  the kit stage key of a phase that was created from the format (null for every phase
--                           that was created by hand, so existing rows are unchanged). Unique per league.
-- tournaments.stage_spec    a frozen copy of that one kit stage ({v, spec_hash, stage, mapped_bracket_type}).
-- format_attach_season()    one transaction: lock the league, refuse unless it is a custom league that has not
--                           started and has no hand-made phase, store the frozen spec, upsert one phase per stage by
--                           (season_id, format_stage_key) and delete the phases that left the spec.
-- format_detach_season()    one transaction: the reverse (phases created from the format and the frozen copy go).
-- format_season_started()   the "has this league started" rule of src/lib/season/season-started.ts, in SQL.
-- seasons trigger           a custom league without an attached format cannot become active (FORMAT_NOT_ATTACHED).
--
-- Existing leagues: nothing is custom yet, so the trigger never fires for them; the two new tournaments columns are
-- null for every existing row and the partial unique index only covers rows with a key.
--
-- Errors: SQLSTATE P0001 with the code as message and a JSON detail (see src/lib/format-studio/errors.ts). A phase
-- that a team still points at (teams.tournament_id has no delete action) makes the detach / attach delete fail with
-- 23503 and rolls everything back.
--
-- Service-role only: RLS enabled with no policies, grants to service_role only
-- (src/lib/supabase/__tests__/migration-api-grants.test.ts).
--
-- Deploy order: after 20261024100000_season_format_type_custom.sql has COMMITTED (this file uses the new value) and
-- after 20261024100100_format_definitions.sql, before the code.
BEGIN;

CREATE TABLE public.season_formats (
  season_id     uuid        PRIMARY KEY REFERENCES public.seasons(id) ON DELETE CASCADE,
  definition_id uuid        REFERENCES public.format_definitions(id) ON DELETE SET NULL,
  version_no    integer     NOT NULL,
  spec          jsonb       NOT NULL,
  spec_hash     text        NOT NULL,
  tunables      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  engine        text        NOT NULL DEFAULT 'kit',
  seed          text        NOT NULL,
  frozen_at     timestamptz NOT NULL DEFAULT now(),
  amendments    jsonb       NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT season_formats_version_no_check    CHECK (version_no >= 1),
  CONSTRAINT season_formats_spec_object         CHECK (jsonb_typeof(spec) = 'object'),
  CONSTRAINT season_formats_spec_size           CHECK (octet_length(spec::text) <= 262144),
  CONSTRAINT season_formats_hash_check          CHECK (spec_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT season_formats_tunables_object     CHECK (jsonb_typeof(tunables) = 'object'),
  CONSTRAINT season_formats_engine_check        CHECK (engine IN ('legacy', 'shadow', 'kit')),
  CONSTRAINT season_formats_seed_check          CHECK (char_length(seed) BETWEEN 8 AND 64),
  CONSTRAINT season_formats_amendments_array    CHECK (jsonb_typeof(amendments) = 'array')
);

CREATE INDEX idx_season_formats_definition ON public.season_formats (definition_id);

ALTER TABLE public.tournaments
  ADD COLUMN format_stage_key text,
  ADD COLUMN stage_spec jsonb,
  ADD CONSTRAINT tournaments_format_stage_key_check CHECK (format_stage_key IS NULL OR format_stage_key ~ '^[a-z][a-z0-9_]{0,31}$'),
  ADD CONSTRAINT tournaments_format_stage_season_check CHECK (format_stage_key IS NULL OR season_id IS NOT NULL),
  ADD CONSTRAINT tournaments_stage_spec_check CHECK (stage_spec IS NULL OR (jsonb_typeof(stage_spec) = 'object' AND octet_length(stage_spec::text) <= 262144));

CREATE UNIQUE INDEX uq_tournaments_season_format_stage ON public.tournaments (season_id, format_stage_key)
  WHERE format_stage_key IS NOT NULL;

-- The started rule of src/lib/season/season-started.ts: the league is active or completed, or any of its phases is
-- past 'upcoming' or already has a round.
CREATE OR REPLACE FUNCTION public.format_season_started(p_season_id uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce((SELECT s.status IN ('active', 'completed') FROM public.seasons s WHERE s.id = p_season_id), false)
      OR EXISTS (SELECT 1 FROM public.tournaments t
                  WHERE t.season_id = p_season_id
                    AND (t.status <> 'upcoming'
                         OR EXISTS (SELECT 1 FROM public.rounds r WHERE r.tournament_id = t.id)))
$$;

-- Attach: one transaction. p_stages is a jsonb array of
-- {key, name, bracket_type, ruleset_id, best_of_default, bo_overrides, is_doubles, bracket_reset_enabled, stage_order, stage_spec}.
-- Returns {replaced, stages: [{id, key}], removed_stage_ids}.
--   FORMAT_SEASON_NOT_FOUND / FORMAT_SEASON_NOT_CUSTOM / FORMAT_SEASON_STARTED
--   FORMAT_SEASON_HAS_MANUAL_PHASES  (DETAIL {count}): a phase that was not created from a format blocks the attach
CREATE OR REPLACE FUNCTION public.format_attach_season(
  p_season_id uuid, p_definition_id uuid, p_version_no integer, p_spec jsonb, p_spec_hash text, p_seed text, p_stages jsonb)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_format   public.season_format_type;
  v_replaced boolean;
  v_manual   integer;
  v_keys     text[];
  v_removed  uuid[];
  v_stages   jsonb;
BEGIN
  IF p_stages IS NULL OR jsonb_typeof(p_stages) <> 'array' THEN
    RAISE EXCEPTION 'format_attach_season: p_stages must be a json array' USING ERRCODE = '22023';
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

  v_replaced := EXISTS (SELECT 1 FROM public.season_formats f WHERE f.season_id = p_season_id);
  INSERT INTO public.season_formats AS f (season_id, definition_id, version_no, spec, spec_hash, seed)
  VALUES (p_season_id, p_definition_id, p_version_no, p_spec, p_spec_hash, p_seed)
  ON CONFLICT (season_id) DO UPDATE
    SET definition_id = EXCLUDED.definition_id, version_no = EXCLUDED.version_no, spec = EXCLUDED.spec,
        spec_hash = EXCLUDED.spec_hash, seed = EXCLUDED.seed, tunables = '{}'::jsonb, engine = 'kit',
        amendments = '[]'::jsonb, frozen_at = now();

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
            bracket_reset_enabled, stage_order, stage_spec)
    SELECT p_season_id, x.key, x.name, x.bracket_type, x.ruleset_id, x.best_of_default,
           coalesce(x.bo_overrides, '{}'::jsonb), x.is_doubles, x.bracket_reset_enabled, x.stage_order, x.stage_spec
      FROM jsonb_to_recordset(p_stages) AS x(
             key text, name text, bracket_type public.bracket_type, ruleset_id uuid, best_of_default integer,
             bo_overrides jsonb, is_doubles boolean, bracket_reset_enabled boolean, stage_order integer, stage_spec jsonb)
    ON CONFLICT (season_id, format_stage_key) WHERE format_stage_key IS NOT NULL DO UPDATE
      SET name = EXCLUDED.name, bracket_type = EXCLUDED.bracket_type, ruleset_id = EXCLUDED.ruleset_id,
          best_of_default = EXCLUDED.best_of_default, bo_overrides = EXCLUDED.bo_overrides,
          is_doubles = EXCLUDED.is_doubles, bracket_reset_enabled = EXCLUDED.bracket_reset_enabled,
          stage_order = EXCLUDED.stage_order, stage_spec = EXCLUDED.stage_spec
    RETURNING t.id, t.format_stage_key)
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'key', u.format_stage_key)), '[]'::jsonb)
    INTO v_stages FROM up u;

  RETURN jsonb_build_object('replaced', v_replaced, 'stages', v_stages, 'removed_stage_ids', to_jsonb(v_removed));
END $$;

-- Detach: one transaction. Returns {removed_stage_ids}.
--   FORMAT_SEASON_NOT_FOUND / FORMAT_NOTHING_ATTACHED / FORMAT_SEASON_STARTED
CREATE OR REPLACE FUNCTION public.format_detach_season(p_season_id uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_removed uuid[];
BEGIN
  PERFORM 1 FROM public.seasons s WHERE s.id = p_season_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FORMAT_SEASON_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.season_formats f WHERE f.season_id = p_season_id) THEN
    RAISE EXCEPTION 'FORMAT_NOTHING_ATTACHED' USING ERRCODE = 'P0001';
  END IF;
  IF public.format_season_started(p_season_id) THEN
    RAISE EXCEPTION 'FORMAT_SEASON_STARTED' USING ERRCODE = 'P0001';
  END IF;
  -- A teams row that points at a stage raises 23503 here and rolls everything back.
  WITH gone AS (
    DELETE FROM public.tournaments t
     WHERE t.season_id = p_season_id AND t.format_stage_key IS NOT NULL
    RETURNING t.id)
  SELECT coalesce(array_agg(g.id), ARRAY[]::uuid[]) INTO v_removed FROM gone g;
  DELETE FROM public.season_formats f WHERE f.season_id = p_season_id;
  RETURN jsonb_build_object('removed_stage_ids', to_jsonb(v_removed));
END $$;

-- A custom league without an attached format cannot become active.
CREATE OR REPLACE FUNCTION public.seasons__require_attached_format() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.season_formats f WHERE f.season_id = NEW.id) THEN
    RAISE EXCEPTION 'FORMAT_NOT_ATTACHED' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('season_id', NEW.id)::text;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_seasons_require_attached_format BEFORE UPDATE OF status, format_type ON public.seasons
  FOR EACH ROW WHEN (NEW.format_type = 'custom' AND NEW.status = 'active'
                     AND (OLD.status IS DISTINCT FROM NEW.status OR OLD.format_type IS DISTINCT FROM NEW.format_type))
  EXECUTE FUNCTION public.seasons__require_attached_format();

-- RLS on, no policies, service_role only
ALTER TABLE public.season_formats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.season_formats FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.season_formats TO service_role;
REVOKE ALL ON FUNCTION public.format_season_started(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.format_season_started(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.format_attach_season(uuid, uuid, integer, jsonb, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.format_attach_season(uuid, uuid, integer, jsonb, text, text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.format_detach_season(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.format_detach_season(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.seasons__require_attached_format() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seasons__require_attached_format() TO service_role;

COMMENT ON TABLE public.season_formats IS
  'Service-role only. The frozen copy of the format version attached to a custom league (spec, hash, seed). No RLS policies by design.';
COMMENT ON COLUMN public.tournaments.format_stage_key IS
  'Kit stage key of a phase created from the league''s attached format; null for hand-made phases.';
COMMENT ON COLUMN public.tournaments.stage_spec IS
  'Frozen copy of the kit stage this phase was created from: {v, spec_hash, stage, mapped_bracket_type}.';

COMMIT;

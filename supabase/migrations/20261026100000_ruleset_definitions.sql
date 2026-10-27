-- Ruleset Studio, step 1 of 3: stored ruleset definitions and their immutable published versions.
--
-- ruleset_definitions          one row per ruleset: identity, owner, visibility and the working draft (a JSON document
--                              in the shape of src/lib/ruleset-kit; a draft may be invalid, only publish requires a
--                              clean compile). `season_id` marks a ruleset a format attach created for one league.
-- ruleset_definition_versions  immutable published snapshots, numbered per definition: the document (`spec`), the
--                              FROZEN effective rules (`resolved`: ids, computed once at publish) and their hashes.
--                              A version row IS the thing a league pins: seasons.ruleset_id and tournaments.ruleset_id
--                              point at a version (re-pointed by the two files after this one). A converted legacy
--                              ruleset keeps its old id as the id of its version 1.
-- ruleset_publish_version()    the atomic publish: locks the definition, compares the draft revision, numbers the
--                              version, points current_version_id at it and refreshes the list columns, in one
--                              transaction.
--
-- A version is immutable (trigger) and a pinned version cannot be deleted: the pin foreign keys (added by
-- 20261026100100) have the default NO ACTION, checked at the end of the statement, so a definition delete that cascades
-- over a pinned version fails with 23503 and the application answers `ruleset_in_use`.
--
-- Sizes: the CHECKs measure the jsonb TEXT form (octet_length(x::text)); the application maps a violation to
-- ruleset_document_too_large_to_store (413).
--
-- Errors raised by the functions and the immutability trigger use SQLSTATE P0001 with the code as message and a JSON
-- detail, as in 20261024100100_format_definitions.sql; src/lib/ruleset-studio/errors.ts maps them. Constraint names
-- below are part of that mapping: do not rename them.
--
-- Service-role only: RLS enabled with no policies, privileges and EXECUTE granted to service_role only
-- (AGENTS.md "Never Do"; src/lib/supabase/__tests__/migration-api-grants.test.ts).
--
-- Rollout (expand/contract, applied by a maintainer): this file, then 20261026100100 (expand: converts every legacy
-- ruleset, replays the old resolver once, adds the pin foreign keys), then the code, then 20261026100200 (contract).
BEGIN;

CREATE TABLE public.ruleset_definitions (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug               text        NOT NULL,
  name               jsonb       NOT NULL,
  description        jsonb,
  -- The list name: the base-language text of `name`, for embeds and sorting.
  name_text          text        GENERATED ALWAYS AS (
                       coalesce(name #>> ARRAY[name ->> 'base', 'v'], name #>> '{en,v}', name #>> '{de,v}')) STORED,
  kind               text        NOT NULL DEFAULT 'custom',
  owner_id           uuid        REFERENCES public.players(id) ON DELETE SET NULL,
  visibility         text        NOT NULL DEFAULT 'private',
  -- The league a format attach created this ruleset for. NO foreign key on purpose: the league recycle bin deletes
  -- the season and its restore needs the definition to outlive it.
  season_id          uuid,
  forked_from        uuid        REFERENCES public.ruleset_definitions(id) ON DELETE SET NULL,
  current_draft      jsonb       NOT NULL,
  draft_rev          integer     NOT NULL DEFAULT 1,
  current_version_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ruleset_definitions_slug_key         UNIQUE (slug),
  CONSTRAINT ruleset_definitions_slug_format      CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  CONSTRAINT ruleset_definitions_name_object      CHECK (jsonb_typeof(name) = 'object'),
  CONSTRAINT ruleset_definitions_description_obj  CHECK (description IS NULL OR jsonb_typeof(description) = 'object'),
  CONSTRAINT ruleset_definitions_kind_check       CHECK (kind IN ('preset', 'custom')),
  CONSTRAINT ruleset_definitions_visibility_check CHECK (visibility IN ('private', 'league', 'gallery')),
  CONSTRAINT ruleset_definitions_draft_object     CHECK (jsonb_typeof(current_draft) = 'object'),
  CONSTRAINT ruleset_definitions_draft_size       CHECK (octet_length(current_draft::text) <= 262144),
  CONSTRAINT ruleset_definitions_draft_rev_check  CHECK (draft_rev >= 1)
);

CREATE TABLE public.ruleset_definition_versions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id   uuid        NOT NULL REFERENCES public.ruleset_definitions(id) ON DELETE CASCADE,
  version_no      integer     NOT NULL,
  schema_version  integer     NOT NULL,
  -- Frozen with the version: the name a league page shows for a pin does not change when the definition is renamed.
  name_text       text        NOT NULL,
  spec            jsonb       NOT NULL,
  resolved        jsonb       NOT NULL,
  content_hash    text        NOT NULL,
  resolved_hash   text        NOT NULL,
  -- PRESET_RULES_VERSION the resolved rules were computed with ('legacy' for a converted row).
  catalog_version text        NOT NULL,
  -- Denormalised from `resolved` for embeds: the generation, the format key of usage stats / tiers (a catalog id such
  -- as gen9ou, or the legacy base_format verbatim) and the game type.
  gen             smallint    NOT NULL,
  format_key      text        NOT NULL,
  is_doubles      boolean     NOT NULL,
  changelog       jsonb,
  created_by      uuid        REFERENCES public.players(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ruleset_definition_versions_definition_version_key UNIQUE (definition_id, version_no),
  CONSTRAINT ruleset_definition_versions_version_no_check       CHECK (version_no >= 1),
  CONSTRAINT ruleset_definition_versions_schema_version_check   CHECK (schema_version >= 1),
  CONSTRAINT ruleset_definition_versions_spec_object            CHECK (jsonb_typeof(spec) = 'object'),
  CONSTRAINT ruleset_definition_versions_resolved_object        CHECK (jsonb_typeof(resolved) = 'object'),
  CONSTRAINT ruleset_definition_versions_spec_size              CHECK (octet_length(spec::text) <= 262144),
  CONSTRAINT ruleset_definition_versions_resolved_size          CHECK (octet_length(resolved::text) <= 262144),
  CONSTRAINT ruleset_definition_versions_hash_check             CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ruleset_definition_versions_resolved_hash_check    CHECK (resolved_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ruleset_definition_versions_gen_check              CHECK (gen BETWEEN 1 AND 9),
  CONSTRAINT ruleset_definition_versions_name_check             CHECK (btrim(name_text) <> ''),
  CONSTRAINT ruleset_definition_versions_changelog_obj          CHECK (changelog IS NULL OR jsonb_typeof(changelog) = 'object')
);

ALTER TABLE public.ruleset_definitions
  ADD CONSTRAINT ruleset_definitions_current_version_fkey
  FOREIGN KEY (current_version_id) REFERENCES public.ruleset_definition_versions(id) ON DELETE SET NULL;

CREATE INDEX idx_ruleset_definitions_owner               ON public.ruleset_definitions (owner_id);
CREATE INDEX idx_ruleset_definitions_forked_from         ON public.ruleset_definitions (forked_from);
CREATE INDEX idx_ruleset_definitions_current_version     ON public.ruleset_definitions (current_version_id);
CREATE INDEX idx_ruleset_definitions_visibility_updated  ON public.ruleset_definitions (visibility, updated_at DESC);
CREATE INDEX idx_ruleset_definitions_season              ON public.ruleset_definitions (season_id) WHERE season_id IS NOT NULL;
CREATE INDEX idx_ruleset_definition_versions_created_by  ON public.ruleset_definition_versions (created_by);

CREATE TRIGGER trg_ruleset_definitions_updated BEFORE UPDATE ON public.ruleset_definitions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Published versions are immutable (UPDATE only; DELETE stays possible so ON DELETE CASCADE from the definition works).
-- The changelog and created_by are not part of the frozen content.
CREATE OR REPLACE FUNCTION public.ruleset_definition_versions__immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.spec            IS DISTINCT FROM OLD.spec
  OR NEW.resolved        IS DISTINCT FROM OLD.resolved
  OR NEW.content_hash    IS DISTINCT FROM OLD.content_hash
  OR NEW.resolved_hash   IS DISTINCT FROM OLD.resolved_hash
  OR NEW.catalog_version IS DISTINCT FROM OLD.catalog_version
  OR NEW.schema_version  IS DISTINCT FROM OLD.schema_version
  OR NEW.version_no      IS DISTINCT FROM OLD.version_no
  OR NEW.definition_id   IS DISTINCT FROM OLD.definition_id
  OR NEW.name_text       IS DISTINCT FROM OLD.name_text
  OR NEW.gen             IS DISTINCT FROM OLD.gen
  OR NEW.format_key      IS DISTINCT FROM OLD.format_key
  OR NEW.is_doubles      IS DISTINCT FROM OLD.is_doubles
  OR NEW.id              IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'RULESET_VERSION_IMMUTABLE' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('version_id', OLD.id)::text;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_ruleset_definition_versions_immutable BEFORE UPDATE ON public.ruleset_definition_versions
  FOR EACH ROW EXECUTE FUNCTION public.ruleset_definition_versions__immutable();

-- Atomic publish: lock the definition row, compare the draft revision the caller saw, refuse a version identical to the
-- current one (both the document hash AND the resolved-rules hash: a republish with an unchanged document but changed
-- resolved rules is a deliberate "rebase on the updated catalog"), number the version, point current_version_id at it.
-- The same UPDATE refreshes the list columns from the published document: name = identity.name, description =
-- identity.summary (NULL when the document has none).
--   RULESET_NOT_FOUND            no such definition
--   RULESET_STALE_REVISION       the draft was saved since the caller read it (DETAIL {draft_rev: <current>})
--   RULESET_NOTHING_TO_PUBLISH   both hashes equal the current version's
--   RULESET_QUOTA_EXCEEDED       the definition already has 100 versions (DETAIL {max: 100})
CREATE OR REPLACE FUNCTION public.ruleset_publish_version(
  p_definition_id uuid, p_expected_rev integer, p_schema_version integer,
  p_spec jsonb, p_content_hash text, p_resolved jsonb, p_resolved_hash text, p_catalog_version text,
  p_gen integer, p_format_key text, p_is_doubles boolean, p_changelog jsonb, p_actor uuid)
RETURNS TABLE (out_version_id uuid, out_version_no integer)
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_rev           integer;
  v_current_hash  text;
  v_current_rhash text;
  v_next          integer;
  v_id            uuid;
  v_name          jsonb;
  v_description   jsonb;
  v_name_text     text;
BEGIN
  SELECT d.draft_rev INTO v_rev FROM public.ruleset_definitions d WHERE d.id = p_definition_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'RULESET_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_rev <> p_expected_rev THEN
    RAISE EXCEPTION 'RULESET_STALE_REVISION' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('draft_rev', v_rev)::text;
  END IF;
  SELECT v.content_hash, v.resolved_hash INTO v_current_hash, v_current_rhash
    FROM public.ruleset_definitions d
    JOIN public.ruleset_definition_versions v ON v.id = d.current_version_id
   WHERE d.id = p_definition_id;
  IF FOUND AND v_current_hash = p_content_hash AND v_current_rhash = p_resolved_hash THEN
    RAISE EXCEPTION 'RULESET_NOTHING_TO_PUBLISH' USING ERRCODE = 'P0001';
  END IF;
  SELECT coalesce(max(v.version_no), 0) + 1 INTO v_next
    FROM public.ruleset_definition_versions v WHERE v.definition_id = p_definition_id;
  IF v_next > 100 THEN
    RAISE EXCEPTION 'RULESET_QUOTA_EXCEEDED' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('max', 100)::text;
  END IF;
  v_name        := p_spec #> '{identity,name}';
  v_description := p_spec #> '{identity,summary}';
  v_name_text   := coalesce(v_name #>> ARRAY[v_name ->> 'base', 'v'], v_name #>> '{en,v}', v_name #>> '{de,v}');
  INSERT INTO public.ruleset_definition_versions
         (definition_id, version_no, schema_version, name_text, spec, resolved, content_hash, resolved_hash,
          catalog_version, gen, format_key, is_doubles, changelog, created_by)
  VALUES (p_definition_id, v_next, p_schema_version, v_name_text, p_spec, p_resolved, p_content_hash, p_resolved_hash,
          p_catalog_version, p_gen, p_format_key, p_is_doubles, p_changelog, p_actor)
  RETURNING id INTO v_id;
  UPDATE public.ruleset_definitions d
     SET current_version_id = v_id,
         name               = CASE WHEN jsonb_typeof(v_name) = 'object' THEN v_name ELSE d.name END,
         description        = CASE WHEN jsonb_typeof(v_description) = 'object' THEN v_description ELSE NULL END
   WHERE d.id = p_definition_id;
  out_version_id := v_id;
  out_version_no := v_next;
  RETURN NEXT;
END $$;

-- RLS on, no policies, service_role only (both tables and both functions)
ALTER TABLE public.ruleset_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ruleset_definition_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ruleset_definitions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.ruleset_definition_versions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ruleset_definitions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ruleset_definition_versions TO service_role;
REVOKE ALL ON FUNCTION public.ruleset_definition_versions__immutable() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ruleset_definition_versions__immutable() TO service_role;
REVOKE ALL ON FUNCTION public.ruleset_publish_version(uuid, integer, integer, jsonb, text, jsonb, text, text, integer, text, boolean, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ruleset_publish_version(uuid, integer, integer, jsonb, text, jsonb, text, text, integer, text, boolean, jsonb, uuid) TO service_role;

COMMENT ON TABLE public.ruleset_definitions IS
  'Service-role only. Stored ruleset definitions (draft body, owner, visibility). Documents follow src/lib/ruleset-kit. No RLS policies by design.';
COMMENT ON TABLE public.ruleset_definition_versions IS
  'Service-role only. Immutable published rulesets; the id is what seasons.ruleset_id / tournaments.ruleset_id pin. resolved = frozen effective rules (ids). No RLS policies by design.';
COMMENT ON COLUMN public.ruleset_definitions.season_id IS
  'The league a format attach created this ruleset for (no foreign key: the league recycle bin restore needs the row to outlive the season).';
COMMENT ON COLUMN public.ruleset_definition_versions.format_key IS
  'The format key of usage stats, tiers and AI context: a catalog format id (gen9ou), or the legacy base_format of a converted ruleset verbatim.';

COMMIT;

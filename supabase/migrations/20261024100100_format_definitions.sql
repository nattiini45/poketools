-- Format Studio, step 2 of 3: stored format definitions and their published versions.
--
-- format_definitions        one row per format: identity, owner, visibility and the working draft (a JSON document
--                           in the shape of src/lib/format-kit; a draft may be invalid, only publish and attach
--                           require a clean compile).
-- format_definition_versions  immutable published snapshots, numbered per definition, with the canonical content hash.
-- format_publish_version()   the atomic publish: locks the definition, compares the draft revision, numbers the
--                           version, points current_version_id at it and sets the list columns (name, description)
--                           from the published spec's identity, in one transaction.
--
-- Sizes: the CHECKs measure the jsonb TEXT form (octet_length(x::text)), which has a space after every ':' and ','
-- that the canonical JSON of the kit does not, so a document very close to the 262144-byte kit limit can pass the kit
-- check and fail a CHECK here. The application maps that to format_document_too_large_to_store (413).
--
-- Errors raised by the functions and the immutability trigger use SQLSTATE P0001 with the code as message and a
-- JSON detail, as in 20261018202000_league_groups_locks.sql; src/lib/format-studio/errors.ts maps them. Constraint
-- names below are part of that mapping: do not rename them.
--
-- Service-role only: RLS enabled with no policies, table privileges and EXECUTE granted to service_role only
-- (AGENTS.md "Never Do"; src/lib/supabase/__tests__/migration-api-grants.test.ts).
--
-- Deploy order: after 20261024100000_season_format_type_custom.sql (this file does not use the new enum value),
-- before 20261024100200_season_formats_and_stage_columns.sql and before the code.
BEGIN;

CREATE TABLE public.format_definitions (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug               text        NOT NULL,
  name               jsonb       NOT NULL,
  description        jsonb,
  kind               text        NOT NULL DEFAULT 'custom',
  owner_id           uuid        REFERENCES public.players(id) ON DELETE SET NULL,
  visibility         text        NOT NULL DEFAULT 'private',
  forked_from        uuid        REFERENCES public.format_definitions(id) ON DELETE SET NULL,
  current_draft      jsonb       NOT NULL,
  draft_rev          integer     NOT NULL DEFAULT 1,
  current_version_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT format_definitions_slug_key         UNIQUE (slug),
  CONSTRAINT format_definitions_slug_format      CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  CONSTRAINT format_definitions_name_object      CHECK (jsonb_typeof(name) = 'object'),
  CONSTRAINT format_definitions_description_obj  CHECK (description IS NULL OR jsonb_typeof(description) = 'object'),
  CONSTRAINT format_definitions_kind_check       CHECK (kind IN ('preset', 'custom')),
  CONSTRAINT format_definitions_visibility_check CHECK (visibility IN ('private', 'league', 'gallery')),
  CONSTRAINT format_definitions_draft_object     CHECK (jsonb_typeof(current_draft) = 'object'),
  CONSTRAINT format_definitions_draft_size       CHECK (octet_length(current_draft::text) <= 262144),
  CONSTRAINT format_definitions_draft_rev_check  CHECK (draft_rev >= 1)
);

CREATE TABLE public.format_definition_versions (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id  uuid        NOT NULL REFERENCES public.format_definitions(id) ON DELETE CASCADE,
  version_no     integer     NOT NULL,
  schema_version integer     NOT NULL,
  spec           jsonb       NOT NULL,
  content_hash   text        NOT NULL,
  status         text        NOT NULL DEFAULT 'draft',
  changelog      jsonb,
  created_by     uuid        REFERENCES public.players(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT format_definition_versions_definition_version_key UNIQUE (definition_id, version_no),
  CONSTRAINT format_definition_versions_version_no_check       CHECK (version_no >= 1),
  CONSTRAINT format_definition_versions_schema_version_check   CHECK (schema_version >= 1),
  CONSTRAINT format_definition_versions_spec_object            CHECK (jsonb_typeof(spec) = 'object'),
  CONSTRAINT format_definition_versions_spec_size              CHECK (octet_length(spec::text) <= 262144),
  CONSTRAINT format_definition_versions_hash_check             CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT format_definition_versions_status_check           CHECK (status IN ('draft', 'published')),
  CONSTRAINT format_definition_versions_changelog_obj          CHECK (changelog IS NULL OR jsonb_typeof(changelog) = 'object')
);

ALTER TABLE public.format_definitions
  ADD CONSTRAINT format_definitions_current_version_fkey
  FOREIGN KEY (current_version_id) REFERENCES public.format_definition_versions(id) ON DELETE SET NULL;

CREATE INDEX idx_format_definitions_owner               ON public.format_definitions (owner_id);
CREATE INDEX idx_format_definitions_forked_from         ON public.format_definitions (forked_from);
CREATE INDEX idx_format_definitions_current_version     ON public.format_definitions (current_version_id);
CREATE INDEX idx_format_definitions_visibility_updated  ON public.format_definitions (visibility, updated_at DESC);
CREATE INDEX idx_format_definition_versions_created_by  ON public.format_definition_versions (created_by);

CREATE TRIGGER trg_format_definitions_updated BEFORE UPDATE ON public.format_definitions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Published versions are immutable (UPDATE only; DELETE stays possible so ON DELETE CASCADE from the definition works).
-- The changelog and created_by are not part of the frozen content.
CREATE OR REPLACE FUNCTION public.format_definition_versions__immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status = 'published' AND (
       NEW.spec           IS DISTINCT FROM OLD.spec
    OR NEW.content_hash   IS DISTINCT FROM OLD.content_hash
    OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
    OR NEW.version_no     IS DISTINCT FROM OLD.version_no
    OR NEW.definition_id  IS DISTINCT FROM OLD.definition_id
    OR NEW.status         IS DISTINCT FROM OLD.status) THEN
    RAISE EXCEPTION 'FORMAT_VERSION_IMMUTABLE' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('version_id', OLD.id)::text;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_format_definition_versions_immutable BEFORE UPDATE ON public.format_definition_versions
  FOR EACH ROW EXECUTE FUNCTION public.format_definition_versions__immutable();

-- Atomic publish: lock the definition row, compare the draft revision the caller saw, refuse a spec identical to the
-- current version, number the version, point current_version_id at it. The same UPDATE sets the list columns from the
-- published spec: name = identity.name, description = identity.summary (NULL when the spec has none). A private
-- definition already follows its draft on every save, but once it is shared (league, gallery) a draft save leaves the
-- columns alone, so a publish is the only write that refreshes what the lists show.
--   FORMAT_NOT_FOUND            no such definition
--   FORMAT_STALE_REVISION       the draft was saved since the caller read it (DETAIL {draft_rev: <current>})
--   FORMAT_NOTHING_TO_PUBLISH   the content hash equals the current version's
CREATE OR REPLACE FUNCTION public.format_publish_version(
  p_definition_id uuid, p_expected_rev integer, p_schema_version integer,
  p_spec jsonb, p_content_hash text, p_changelog jsonb, p_actor uuid)
RETURNS TABLE (out_version_id uuid, out_version_no integer)
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_rev          integer;
  v_current_hash text;
  v_next         integer;
  v_id           uuid;
  v_name         jsonb;
  v_description  jsonb;
BEGIN
  SELECT d.draft_rev INTO v_rev FROM public.format_definitions d WHERE d.id = p_definition_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FORMAT_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_rev <> p_expected_rev THEN
    RAISE EXCEPTION 'FORMAT_STALE_REVISION' USING ERRCODE = 'P0001',
      DETAIL = jsonb_build_object('draft_rev', v_rev)::text;
  END IF;
  SELECT v.content_hash INTO v_current_hash
    FROM public.format_definitions d
    JOIN public.format_definition_versions v ON v.id = d.current_version_id
   WHERE d.id = p_definition_id;
  IF v_current_hash IS NOT DISTINCT FROM p_content_hash THEN
    RAISE EXCEPTION 'FORMAT_NOTHING_TO_PUBLISH' USING ERRCODE = 'P0001';
  END IF;
  SELECT coalesce(max(v.version_no), 0) + 1 INTO v_next
    FROM public.format_definition_versions v WHERE v.definition_id = p_definition_id;
  INSERT INTO public.format_definition_versions
         (definition_id, version_no, schema_version, spec, content_hash, status, changelog, created_by)
  VALUES (p_definition_id, v_next, p_schema_version, p_spec, p_content_hash, 'published', p_changelog, p_actor)
  RETURNING id INTO v_id;
  v_name        := p_spec #> '{identity,name}';
  v_description := p_spec #> '{identity,summary}';
  UPDATE public.format_definitions d
     SET current_version_id = v_id,
         name               = CASE WHEN jsonb_typeof(v_name) = 'object' THEN v_name ELSE d.name END,
         description        = CASE WHEN jsonb_typeof(v_description) = 'object' THEN v_description ELSE NULL END
   WHERE d.id = p_definition_id;
  out_version_id := v_id;
  out_version_no := v_next;
  RETURN NEXT;
END $$;

-- RLS on, no policies, service_role only (both tables and both functions)
ALTER TABLE public.format_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.format_definition_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.format_definitions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.format_definition_versions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.format_definitions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.format_definition_versions TO service_role;
REVOKE ALL ON FUNCTION public.format_definition_versions__immutable() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.format_definition_versions__immutable() TO service_role;
REVOKE ALL ON FUNCTION public.format_publish_version(uuid, integer, integer, jsonb, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.format_publish_version(uuid, integer, integer, jsonb, text, jsonb, uuid) TO service_role;

COMMENT ON TABLE public.format_definitions IS
  'Service-role only. Stored league format definitions (draft body, owner, visibility). Documents follow src/lib/format-kit. No RLS policies by design.';
COMMENT ON TABLE public.format_definition_versions IS
  'Service-role only. Immutable published snapshots of a format definition; content_hash is the canonical hash of spec. No RLS policies by design.';

COMMIT;

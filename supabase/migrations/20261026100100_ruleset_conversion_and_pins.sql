-- Ruleset Studio, step 2 of 3 (EXPAND): converts every legacy ruleset into a definition with one published version,
-- replays the old resolver once, and adds the pin foreign keys. Safe for the code that is still deployed when it is
-- applied: public.rulesets is not touched, its foreign keys stay, and every id the old code reads still exists.
--
-- 1. CONVERSION (ruleset_convert_missing, idempotent). Each public.rulesets row r becomes
--      * a definition (new id) with the owner r.created_by, visibility `gallery` (every old ruleset was world-readable
--        and writable by site admins only, which is the gallery rule set), `private` + season_id for a ruleset a
--        format attach created (named in season_formats.preset_rulesets), kind `preset` for the rows the seed route
--        wrote (created_by NULL, base_format genN..., name 'Gen N ...');
--      * ONE published version whose id IS r.id. seasons.ruleset_id and tournaments.ruleset_id therefore keep pointing
--        at the same uuid, and every URL, request body and golden file that carries it keeps its meaning: the id now
--        names an immutable version.
--    The document is behaviour-exact (decision A3): a blank base of the old generation and game type, STANDARD
--    universe, the old ban arrays as ids (epb_fold_id, the SQL twin of toID: Flabébé -> flabebe, Nidoran♀ -> nidoranf),
--    the old added_pokemon minus the banned ones as `unban` (the ban won before, it still wins), the old clause names as
--    clause ids, shared-type percentage, team constraints and custom rules unchanged. The resolved rules are the same
--    arrays as ids; `format_key` is the old base_format VERBATIM (usage stats, tiers and the AI keep their key),
--    catalog_version is 'legacy'. Hashes of converted rows are sha256 of the jsonb text (the application hashes the
--    canonical JSON), so at worst one identical extra version can be published later.
--    An old entry that was a typo or a different spelling ('Tapu-Koko', 'Mr Mime') never matched the exact-name
--    comparison of the old validator; its id now matches the entity it obviously meant. scripts/ruleset/
--    report-unknown-ids.mjs lists every such entry BEFORE this file is applied (a pre-flight gate).
--
-- 2. REPLAY OF THE OLD RESOLVER (ruleset_replay_preview / ruleset_replay_pins). The old code chose the enforced ruleset
--    of a phase at read time: its own ruleset if "custom" (team constraints, custom rules or added Pokémon), else the
--    league's if custom, else (not for single_elim / double_elim / swiss) the oldest custom ruleset named like the
--    league, else its own. The result is written into tournaments.ruleset_id, and the league's own default is replaced
--    the same way (a league whose default is a plain tier ruleset but whose name matches a custom ruleset would
--    otherwise lose the custom rules on its next phase). Every changed row is logged in ruleset_pin_backfill_log
--    (the previous id), so the change can be reverted. Afterwards an effective ruleset is simply the pin.
--    ruleset_replay_preview() is the same logic without writes (the hosted dry run: how many phases change).
--
-- 3. PINS. seasons.ruleset_id and tournaments.ruleset_id get a SECOND foreign key to ruleset_definition_versions
--    (default NO ACTION: a pinned version cannot be deleted). The old keys to public.rulesets stay until the contract
--    file. Until then a version published AFTER this file cannot be pinned (the old key rejects its id), and a ruleset
--    created or edited with the OLD code after this file is not seen by the new code: pause ruleset creation and
--    editing from applying this file to applying 20261026100200.
--
-- 4. LEAGUE RECYCLE BIN. league_trash_rulesets.ruleset_id now references versions (same constraint name, so the error
--    mapping of src/lib/league-trash/db-error.ts holds); league_trash__external_parents lists the versions table next to
--    rulesets; league_trash__protect puts the HEAD version of every definition named in season_formats.preset_rulesets
--    (a map of rule preset id to DEFINITION id since the Ruleset Studio) into the junction.
--
-- 5. FORMAT ATTACH. format_delete_unused_preset_rulesets now deletes league-owned DEFINITIONS (recorded by the attach,
--    not kept, season_id set, none of their versions pinned by a phase or a league or held by a league in the trash). format_attach_season and
--    format_detach_season call it unchanged.
--
-- Service-role only (src/lib/supabase/__tests__/migration-api-grants.test.ts).
BEGIN;

-- ------------------------------------------------------------------------------------------------------------------
-- Helpers (one-time; dropped by 20261026100200 except ruleset_fold_ids)
-- ------------------------------------------------------------------------------------------------------------------

-- Folded ids of names: sorted, unique, empty results dropped.
CREATE OR REPLACE FUNCTION public.ruleset_fold_ids(p_names text[]) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT coalesce(array_agg(DISTINCT s.f ORDER BY s.f), ARRAY[]::text[])
    FROM (SELECT public.epb_fold_id(x) AS f FROM unnest(coalesce(p_names, ARRAY[]::text[])) AS x) s
   WHERE s.f <> ''
$$;

-- JavaScript's String.prototype.trim() set: the old "custom ruleset" test trimmed with it.
CREATE OR REPLACE FUNCTION public.ruleset_js_blank(p_text text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT p_text IS NULL OR translate(p_text,
    E' \t\n\v\f\r                 　﻿',
    '') = ''
$$;

-- The old isCustomLeagueRuleset: team constraints set (any JSON value but null), non-blank custom rules, or added Pokémon.
CREATE OR REPLACE FUNCTION public.ruleset_legacy_custom(r public.rulesets) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT coalesce(
           (r.team_constraints IS NOT NULL AND jsonb_typeof(r.team_constraints) <> 'null')
        OR NOT public.ruleset_js_blank(r.custom_rules_string)
        OR coalesce(cardinality(r.added_pokemon), 0) > 0,
         false)
$$;

-- The generation digit of a legacy base_format (gen9ou -> 9, gen91v1 -> 9, gen9 -> 9); 9 for anything else.
CREATE OR REPLACE FUNCTION public.ruleset_legacy_gen(p_base_format text) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT coalesce(substring(p_base_format from '^gen([1-9])')::integer, 9)
$$;

CREATE OR REPLACE FUNCTION public.ruleset_legacy_name(r public.rulesets) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT coalesce(nullif(btrim(r.name), ''), 'Ruleset')
$$;

-- The document (src/lib/ruleset-kit/types.ts RulesetDocument) of a legacy row.
CREATE OR REPLACE FUNCTION public.ruleset_legacy_spec(r public.rulesets) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'schema_version', 1,
    'identity', jsonb_build_object(
        'name', jsonb_build_object('base', 'en', 'en', jsonb_build_object('v', public.ruleset_legacy_name(r), 's', 'human')))
      || CASE WHEN r.base_format <> 'blank' AND btrim(r.base_format) <> '' THEN jsonb_build_object('based_on', r.base_format) ELSE '{}'::jsonb END,
    'base', jsonb_build_object('kind', 'blank', 'gen', public.ruleset_legacy_gen(r.base_format), 'doubles', r.is_doubles, 'universe', 'standard'),
    'clauses', jsonb_build_object('add', to_jsonb(public.ruleset_fold_ids(r.clauses)), 'remove', '[]'::jsonb),
    'pokemon', jsonb_build_object(
        'ban', to_jsonb(public.ruleset_fold_ids(r.banned_pokemon)),
        'unban', to_jsonb(ARRAY(
           SELECT u FROM unnest(public.ruleset_fold_ids(r.added_pokemon)) AS u
            WHERE u <> ALL (public.ruleset_fold_ids(r.banned_pokemon)) ORDER BY u)),
        'allow', 'null'::jsonb),
    'moves',     jsonb_build_object('ban', to_jsonb(public.ruleset_fold_ids(r.banned_moves)),     'unban', '[]'::jsonb, 'allow', 'null'::jsonb),
    'items',     jsonb_build_object('ban', to_jsonb(public.ruleset_fold_ids(r.banned_items)),     'unban', '[]'::jsonb, 'allow', 'null'::jsonb),
    'abilities', jsonb_build_object('ban', to_jsonb(public.ruleset_fold_ids(r.banned_abilities)), 'unban', '[]'::jsonb, 'allow', 'null'::jsonb),
    'min_shared_type_pct', coalesce(r.min_shared_type_pct, 0),
    'team_constraints', coalesce(r.team_constraints, 'null'::jsonb),
    'custom_rules', coalesce(r.custom_rules_string, ''))
$$;

-- The frozen effective rules (src/lib/ruleset-kit/types.ts ResolvedRules) of a legacy row.
CREATE OR REPLACE FUNCTION public.ruleset_legacy_resolved(r public.rulesets) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'v', 1,
    'gen', public.ruleset_legacy_gen(r.base_format),
    'format_key', coalesce(nullif(btrim(r.base_format), ''), 'blank'),
    'universe', 'standard',
    'doubles', r.is_doubles,
    'clauses', to_jsonb(public.ruleset_fold_ids(r.clauses)),
    'pokemon',   jsonb_build_object('mode', 'block', 'ids', to_jsonb(public.ruleset_fold_ids(r.banned_pokemon))),
    'moves',     jsonb_build_object('mode', 'block', 'ids', to_jsonb(public.ruleset_fold_ids(r.banned_moves))),
    'items',     jsonb_build_object('mode', 'block', 'ids', to_jsonb(public.ruleset_fold_ids(r.banned_items))),
    'abilities', jsonb_build_object('mode', 'block', 'ids', to_jsonb(public.ruleset_fold_ids(r.banned_abilities))),
    'added_pokemon', to_jsonb(ARRAY(
       SELECT u FROM unnest(public.ruleset_fold_ids(r.added_pokemon)) AS u
        WHERE u <> ALL (public.ruleset_fold_ids(r.banned_pokemon)) ORDER BY u)),
    'min_shared_type_pct', coalesce(r.min_shared_type_pct, 0),
    'team_constraints', coalesce(r.team_constraints, 'null'::jsonb),
    'custom_rules', coalesce(r.custom_rules_string, ''))
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- 1. Conversion
-- ------------------------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ruleset_convert_missing() RETURNS integer
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  r          public.rulesets;
  v_def      uuid;
  v_spec     jsonb;
  v_resolved jsonb;
  v_slug     text;
  v_base     text;
  v_league   uuid;
  v_n        integer := 0;
BEGIN
  FOR r IN
    SELECT rs.* FROM public.rulesets rs
     WHERE NOT EXISTS (SELECT 1 FROM public.ruleset_definition_versions v WHERE v.id = rs.id)
     ORDER BY rs.created_at, rs.id
  LOOP
    v_def      := gen_random_uuid();
    v_spec     := public.ruleset_legacy_spec(r);
    v_resolved := public.ruleset_legacy_resolved(r);
    v_base     := btrim(regexp_replace(
                    regexp_replace(lower(normalize(public.ruleset_legacy_name(r), NFKD)), E'[̀-ͯ]', '', 'g'),
                    '[^a-z0-9]+', '-', 'g'), '-');
    v_base     := btrim(left(v_base, 44), '-');
    IF v_base = '' THEN v_base := 'ruleset'; END IF;
    v_slug     := 'r-' || v_base || '-' || substr(md5(r.id::text), 1, 12);

    -- A ruleset a format attach created belongs to that league and stays private to its owner.
    SELECT f.season_id INTO v_league
      FROM public.season_formats f, jsonb_each(f.preset_rulesets) e
     WHERE (e.value #>> '{}') = r.id::text
     LIMIT 1;

    INSERT INTO public.ruleset_definitions
           (id, slug, name, description, kind, owner_id, visibility, season_id, current_draft, draft_rev, created_at)
    VALUES (v_def, v_slug, v_spec #> '{identity,name}', NULL,
            CASE WHEN v_league IS NULL AND r.created_by IS NULL AND r.base_format ~ '^gen[1-9]' AND r.name ~ '^Gen [1-9] '
                 THEN 'preset' ELSE 'custom' END,
            r.created_by,
            CASE WHEN v_league IS NULL THEN 'gallery' ELSE 'private' END,
            v_league, v_spec, 1, r.created_at);

    INSERT INTO public.ruleset_definition_versions
           (id, definition_id, version_no, schema_version, name_text, spec, resolved, content_hash, resolved_hash,
            catalog_version, gen, format_key, is_doubles, changelog, created_by, created_at)
    VALUES (r.id, v_def, 1, 1, public.ruleset_legacy_name(r), v_spec, v_resolved,
            encode(sha256(convert_to(v_spec::text, 'UTF8')), 'hex'),
            encode(sha256(convert_to(v_resolved::text, 'UTF8')), 'hex'),
            'legacy', public.ruleset_legacy_gen(r.base_format), v_resolved ->> 'format_key', r.is_doubles,
            jsonb_build_object('base', 'en', 'en', jsonb_build_object('v', 'Converted from the legacy rulesets table', 's', 'human')),
            NULL, r.created_at);

    UPDATE public.ruleset_definitions SET current_version_id = r.id WHERE id = v_def;

    -- The recorded map of a format attach holds DEFINITION ids from now on.
    UPDATE public.season_formats f
       SET preset_rulesets = (
             SELECT jsonb_object_agg(e.key, CASE WHEN (e.value #>> '{}') = r.id::text THEN to_jsonb(v_def::text) ELSE e.value END)
               FROM jsonb_each(f.preset_rulesets) e)
     WHERE EXISTS (SELECT 1 FROM jsonb_each(f.preset_rulesets) e WHERE (e.value #>> '{}') = r.id::text);

    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

-- ------------------------------------------------------------------------------------------------------------------
-- 2. Replay of the old resolver
-- ------------------------------------------------------------------------------------------------------------------

CREATE TABLE public.ruleset_pin_backfill_log (
  id             bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind           text        NOT NULL,
  target_id      uuid        NOT NULL,
  old_ruleset_id uuid        NOT NULL,
  new_ruleset_id uuid        NOT NULL,
  step           text        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ruleset_pin_backfill_log_kind_check CHECK (kind IN ('tournament', 'season'))
);
ALTER TABLE public.ruleset_pin_backfill_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ruleset_pin_backfill_log FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ruleset_pin_backfill_log TO service_role;
COMMENT ON TABLE public.ruleset_pin_backfill_log IS
  'Service-role only. One row per phase or league whose ruleset_id the Ruleset Studio migration rewrote to the ruleset the old resolver enforced; old_ruleset_id is the value before. Dropped by the cleanup migration.';

-- The rows whose ruleset_id the replay changes. Read-only.
CREATE OR REPLACE FUNCTION public.ruleset_replay_preview()
RETURNS TABLE (kind text, target_id uuid, old_ruleset_id uuid, new_ruleset_id uuid, step text)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH named AS (            -- the oldest custom ruleset of each name (the old code took the first of an unordered limit 5)
    SELECT DISTINCT ON (r.name) r.name, r.id
      FROM public.rulesets r
     WHERE public.ruleset_legacy_custom(r)
     ORDER BY r.name, r.created_at, r.id),
  phase AS (
    SELECT t.id AS target_id, t.ruleset_id AS old_id,
           CASE
             WHEN public.ruleset_legacy_custom(rt) THEN rt.id
             WHEN rs.id IS NOT NULL AND public.ruleset_legacy_custom(rs) THEN rs.id
             WHEN s.id IS NOT NULL AND lower(t.bracket_type::text) NOT IN ('single_elim', 'double_elim', 'swiss') AND n.id IS NOT NULL THEN n.id
             ELSE rt.id
           END AS new_id,
           CASE
             WHEN public.ruleset_legacy_custom(rt) THEN 'tournament'
             WHEN rs.id IS NOT NULL AND public.ruleset_legacy_custom(rs) THEN 'season'
             WHEN s.id IS NOT NULL AND lower(t.bracket_type::text) NOT IN ('single_elim', 'double_elim', 'swiss') AND n.id IS NOT NULL THEN 'name-match'
             ELSE 'fallback'
           END AS step
      FROM public.tournaments t
      JOIN public.rulesets rt ON rt.id = t.ruleset_id
      LEFT JOIN public.seasons s ON s.id = t.season_id
      LEFT JOIN public.rulesets rs ON rs.id = s.ruleset_id
      LEFT JOIN named n ON n.name = s.name),
  league AS (                -- the league default: the same steps for a group-phase pseudo-phase
    SELECT s.id AS target_id, s.ruleset_id AS old_id,
           CASE WHEN public.ruleset_legacy_custom(rs) THEN rs.id WHEN n.id IS NOT NULL THEN n.id ELSE rs.id END AS new_id
      FROM public.seasons s
      JOIN public.rulesets rs ON rs.id = s.ruleset_id
      LEFT JOIN named n ON n.name = s.name)
  SELECT 'tournament'::text, p.target_id, p.old_id, p.new_id, p.step FROM phase p WHERE p.new_id <> p.old_id
  UNION ALL
  SELECT 'season'::text, l.target_id, l.old_id, l.new_id, 'name-match'::text FROM league l WHERE l.new_id <> l.old_id
$$;

CREATE OR REPLACE FUNCTION public.ruleset_replay_pins() RETURNS integer
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_n integer;
BEGIN
  -- Snapshot first: the league updates must not feed the phase decisions.
  CREATE TEMP TABLE _ruleset_replay ON COMMIT DROP AS SELECT * FROM public.ruleset_replay_preview();
  INSERT INTO public.ruleset_pin_backfill_log (kind, target_id, old_ruleset_id, new_ruleset_id, step)
    SELECT p.kind, p.target_id, p.old_ruleset_id, p.new_ruleset_id, p.step FROM _ruleset_replay p;
  UPDATE public.tournaments t SET ruleset_id = p.new_ruleset_id
    FROM _ruleset_replay p WHERE p.kind = 'tournament' AND t.id = p.target_id;
  UPDATE public.seasons s SET ruleset_id = p.new_ruleset_id
    FROM _ruleset_replay p WHERE p.kind = 'season' AND s.id = p.target_id;
  SELECT count(*) INTO v_n FROM _ruleset_replay;
  RETURN v_n;
END $$;

-- ------------------------------------------------------------------------------------------------------------------
-- Run: convert, replay, pin
-- ------------------------------------------------------------------------------------------------------------------

SELECT public.ruleset_convert_missing();
SELECT public.ruleset_replay_pins();

-- Both keys exist from here to the contract file. Names: the contract file renames the new ones to the old names.
ALTER TABLE public.seasons
  ADD CONSTRAINT seasons_ruleset_version_fkey FOREIGN KEY (ruleset_id) REFERENCES public.ruleset_definition_versions(id);
ALTER TABLE public.tournaments
  ADD CONSTRAINT tournaments_ruleset_version_fkey FOREIGN KEY (ruleset_id) REFERENCES public.ruleset_definition_versions(id);

-- ------------------------------------------------------------------------------------------------------------------
-- 4. League recycle bin
-- ------------------------------------------------------------------------------------------------------------------

ALTER TABLE public.league_trash_rulesets DROP CONSTRAINT league_trash_rulesets_ruleset_id_fkey;
ALTER TABLE public.league_trash_rulesets
  ADD CONSTRAINT league_trash_rulesets_ruleset_id_fkey
  FOREIGN KEY (ruleset_id) REFERENCES public.ruleset_definition_versions(id) ON DELETE RESTRICT;
COMMENT ON TABLE public.league_trash_rulesets IS
  'Ruleset VERSIONS referenced by the captured rows of a trashed league (the pins of its phases and of the league, the head versions of the rulesets of its format). ON DELETE RESTRICT. Service-role only.';

CREATE OR REPLACE FUNCTION public.league_trash__external_parents()
RETURNS TABLE (parent text, protection text, junction text, jcol text)
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT * FROM (VALUES
    ('players',                    'junction', 'league_trash_players',              'player_id'),
    ('rulesets',                   'junction', 'league_trash_rulesets',             'ruleset_id'),
    ('ruleset_definition_versions','junction', 'league_trash_rulesets',             'ruleset_id'),
    ('point_buy_list_versions',    'junction', 'league_trash_point_buy_versions',   'list_version_id'),
    ('point_buy_list_entries',     'nulled',   NULL,                                NULL),
    ('format_definitions',         'nulled',   NULL,                                NULL)
  ) AS v(parent, protection, junction, jcol)
$$;

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
  -- The rulesets of the league's format are not foreign keys: season_formats.preset_rulesets maps a rule preset to a
  -- ruleset DEFINITION; the junction holds its head version (a delete of the definition cascades over every version).
  INSERT INTO public.league_trash_rulesets (trash_id, ruleset_id)
    SELECT DISTINCT p_trash, d.current_version_id
      FROM public.league_trash_tables lt, jsonb_array_elements(lt.rows) x, jsonb_each(coalesce(x -> 'preset_rulesets', '{}'::jsonb)) v,
           public.ruleset_definitions d
     WHERE lt.trash_id = p_trash AND lt.rel = 'season_formats'
       AND jsonb_typeof(x -> 'preset_rulesets') = 'object'
       AND (v.value #>> '{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND d.id = (v.value #>> '{}')::uuid
       AND d.current_version_id IS NOT NULL
    ON CONFLICT DO NOTHING;
END $$;

-- ------------------------------------------------------------------------------------------------------------------
-- 5. Format attach
-- ------------------------------------------------------------------------------------------------------------------

-- Deletes the league-owned ruleset definitions of a recorded map that are not in the kept map and whose versions no
-- phase or league pins. Returns the deleted definition ids. A version a league in the trash holds (league_trash_rulesets,
-- ON DELETE RESTRICT) is a pin like any other: its definition is kept, so the delete never raises 23503 and an attach or
-- detach is never rolled back by the recycle bin.
CREATE OR REPLACE FUNCTION public.format_delete_unused_preset_rulesets(p_recorded jsonb, p_kept jsonb)
RETURNS uuid[]
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_deleted uuid[];
BEGIN
  WITH gone AS (
    DELETE FROM public.ruleset_definitions d
     WHERE d.id IN (SELECT (e.value #>> '{}')::uuid FROM jsonb_each(coalesce(p_recorded, '{}'::jsonb)) e
                     WHERE (e.value #>> '{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
       AND d.id NOT IN (SELECT (e.value #>> '{}')::uuid FROM jsonb_each(coalesce(p_kept, '{}'::jsonb)) e
                         WHERE (e.value #>> '{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
       AND d.season_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.tournaments t JOIN public.ruleset_definition_versions v ON v.id = t.ruleset_id
                        WHERE v.definition_id = d.id)
       AND NOT EXISTS (SELECT 1 FROM public.seasons s JOIN public.ruleset_definition_versions v ON v.id = s.ruleset_id
                        WHERE v.definition_id = d.id)
       AND NOT EXISTS (SELECT 1 FROM public.league_trash_rulesets j JOIN public.ruleset_definition_versions v ON v.id = j.ruleset_id
                        WHERE v.definition_id = d.id)
    RETURNING d.id)
  SELECT coalesce(array_agg(g.id), ARRAY[]::uuid[]) INTO v_deleted FROM gone g;
  RETURN v_deleted;
END $$;

-- ------------------------------------------------------------------------------------------------------------------
-- Grants of the one-time helpers (service role only)
-- ------------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.ruleset_fold_ids(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ruleset_fold_ids(text[]) TO service_role;
REVOKE ALL ON FUNCTION public.ruleset_js_blank(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ruleset_js_blank(text) TO service_role;
REVOKE ALL ON FUNCTION public.ruleset_legacy_custom(public.rulesets) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ruleset_legacy_custom(public.rulesets) TO service_role;
REVOKE ALL ON FUNCTION public.ruleset_legacy_gen(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ruleset_legacy_gen(text) TO service_role;
REVOKE ALL ON FUNCTION public.ruleset_legacy_name(public.rulesets) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ruleset_legacy_name(public.rulesets) TO service_role;
REVOKE ALL ON FUNCTION public.ruleset_legacy_spec(public.rulesets) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ruleset_legacy_spec(public.rulesets) TO service_role;
REVOKE ALL ON FUNCTION public.ruleset_legacy_resolved(public.rulesets) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ruleset_legacy_resolved(public.rulesets) TO service_role;
REVOKE ALL ON FUNCTION public.ruleset_convert_missing() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ruleset_convert_missing() TO service_role;
REVOKE ALL ON FUNCTION public.ruleset_replay_preview() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ruleset_replay_preview() TO service_role;
REVOKE ALL ON FUNCTION public.ruleset_replay_pins() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ruleset_replay_pins() TO service_role;
REVOKE ALL ON FUNCTION public.league_trash__external_parents() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.league_trash__external_parents() TO service_role;
REVOKE ALL ON FUNCTION public.league_trash__protect(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.league_trash__protect(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.format_delete_unused_preset_rulesets(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.format_delete_unused_preset_rulesets(jsonb, jsonb) TO service_role;

-- ------------------------------------------------------------------------------------------------------------------
-- Self-check
-- ------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE v_missing integer; v_rulesets integer; v_versions integer;
BEGIN
  SELECT count(*) INTO v_rulesets FROM public.rulesets;
  SELECT count(*) INTO v_missing FROM public.rulesets r
   WHERE NOT EXISTS (SELECT 1 FROM public.ruleset_definition_versions v WHERE v.id = r.id AND v.version_no = 1);
  SELECT count(*) INTO v_versions FROM public.ruleset_definition_versions WHERE catalog_version = 'legacy';
  IF v_missing <> 0 THEN
    RAISE EXCEPTION 'ruleset conversion incomplete: % of % rulesets have no version', v_missing, v_rulesets;
  END IF;
  IF v_versions <> v_rulesets THEN
    RAISE EXCEPTION 'ruleset conversion mismatch: % legacy versions for % rulesets', v_versions, v_rulesets;
  END IF;
  IF EXISTS (SELECT 1 FROM public.ruleset_definitions WHERE current_version_id IS NULL AND season_id IS NULL AND kind = 'preset') THEN
    RAISE EXCEPTION 'ruleset conversion left a preset definition without a head version';
  END IF;
END $$;

COMMIT;

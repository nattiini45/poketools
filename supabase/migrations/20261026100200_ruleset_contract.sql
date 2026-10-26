-- Ruleset Studio, step 3 of 3 (CONTRACT): the legacy rulesets table goes away. Apply it ONLY after the code of the
-- Ruleset Studio is deployed: the code that is still deployed after 20261026100100 reads public.rulesets and its
-- foreign keys. Apply it right after the deploy and verify with READS only (a league page, a team validation, a format
-- attach whose stages all use the league's ruleset or name a stored one): until this file runs, the pin keys of
-- seasons and tournaments still point at public.rulesets, so anything that publishes a new version and pins it fails
-- with 23503 (a format attach with a rule-preset stage, the first point-buy league, a league or phase given a ruleset
-- published after the expand file). Do not run those in the window.
--
--  * A catch-up conversion runs first (ruleset_convert_missing: rulesets created in the window). A ruleset that was
--    EDITED in the window (any rule, or its name) no longer equals its version 1; the self-check lists those ids and
--    aborts, because the right answer (publish the edit as a new version, or discard it) is the maintainer's. Pause
--    ruleset editing with the old builder from the expand file to this one.
--  * Format drafts that name a stored ruleset (stage.ruleset.id) named a legacy ruleset id; a converted ruleset's old id
--    is now the id of its version 1, and the format editor lists DEFINITION ids. The drafts are rewritten to the
--    definition id (draft_rev + 1, so an open editor gets a conflict instead of silently restoring the old id).
--    Published format versions and attached copies (season_formats.spec) are immutable and hashed: they keep the old
--    id, which the attach resolves to the definition of that version (resolveNamedRulesets).
--  * seasons_ruleset_id_fkey and tournaments_ruleset_id_fkey (to rulesets) are dropped; the version keys added by the
--    expand file take their names, so PostgREST hints and error mapping keep the names they had.
--  * rulesets is renamed rulesets_legacy, closed to every API role and kept for one release as the revert source
--    (ruleset_pin_backfill_log holds the previous ruleset_id of every phase and league the replay changed). The
--    cleanup migration that follows the next release drops both.
--  * league_trash__external_parents no longer lists rulesets.
--  * The one-time conversion helpers are dropped (they read the legacy table). ruleset_fold_ids stays.
--
-- Service-role only (src/lib/supabase/__tests__/migration-api-grants.test.ts).
BEGIN;

SELECT public.ruleset_convert_missing();

DO $$
DECLARE v_drift text;
BEGIN
  SELECT string_agg(r.id::text, ', ' ORDER BY r.id) INTO v_drift
    FROM public.rulesets r
    JOIN public.ruleset_definition_versions v ON v.id = r.id AND v.version_no = 1
   WHERE v.resolved IS DISTINCT FROM public.ruleset_legacy_resolved(r)
      OR v.name_text IS DISTINCT FROM public.ruleset_legacy_name(r)
      OR v.spec IS DISTINCT FROM public.ruleset_legacy_spec(r);
  IF v_drift IS NOT NULL THEN
    RAISE EXCEPTION 'rulesets edited after the conversion (publish the edit as a new version, or restore the row, then retry): %', v_drift;
  END IF;
END $$;

-- Format drafts: a stage that names a converted ruleset by its legacy id names its definition instead.
UPDATE public.format_definitions fd
   SET current_draft = jsonb_set(fd.current_draft, '{stages}', (
         SELECT jsonb_agg(
                  CASE WHEN m.definition_id IS NULL THEN t.stage
                       ELSE jsonb_set(t.stage, '{ruleset,id}', to_jsonb(m.definition_id::text)) END
                  ORDER BY t.ord)
           FROM jsonb_array_elements(fd.current_draft -> 'stages') WITH ORDINALITY AS t(stage, ord)
           LEFT JOIN LATERAL (
             SELECT v.definition_id
               FROM public.ruleset_definition_versions v
              WHERE (t.stage #>> '{ruleset,kind}') = 'ruleset'
                AND v.id::text = (t.stage #>> '{ruleset,id}')
                AND v.version_no = 1 AND v.catalog_version = 'legacy') m ON true)),
       draft_rev = fd.draft_rev + 1
 WHERE jsonb_typeof(fd.current_draft -> 'stages') = 'array'
   AND EXISTS (
     SELECT 1
       FROM jsonb_array_elements(fd.current_draft -> 'stages') AS t(stage)
       JOIN public.ruleset_definition_versions v
         ON v.id::text = (t.stage #>> '{ruleset,id}') AND v.version_no = 1 AND v.catalog_version = 'legacy'
      WHERE (t.stage #>> '{ruleset,kind}') = 'ruleset');

ALTER TABLE public.seasons DROP CONSTRAINT seasons_ruleset_id_fkey;
ALTER TABLE public.seasons RENAME CONSTRAINT seasons_ruleset_version_fkey TO seasons_ruleset_id_fkey;
ALTER TABLE public.tournaments DROP CONSTRAINT tournaments_ruleset_id_fkey;
ALTER TABLE public.tournaments RENAME CONSTRAINT tournaments_ruleset_version_fkey TO tournaments_ruleset_id_fkey;

DROP POLICY IF EXISTS "Public read rulesets" ON public.rulesets;
ALTER TABLE public.rulesets RENAME TO rulesets_legacy;
REVOKE ALL ON TABLE public.rulesets_legacy FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.rulesets_legacy IS
  'Service-role only. The legacy rulesets table, kept for one release as the revert source of the Ruleset Studio migration. Replaced by ruleset_definitions / ruleset_definition_versions (a converted version keeps the id of its legacy row). Dropped by the cleanup migration.';

CREATE OR REPLACE FUNCTION public.league_trash__external_parents()
RETURNS TABLE (parent text, protection text, junction text, jcol text)
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT * FROM (VALUES
    ('players',                    'junction', 'league_trash_players',              'player_id'),
    ('ruleset_definition_versions','junction', 'league_trash_rulesets',             'ruleset_id'),
    ('point_buy_list_versions',    'junction', 'league_trash_point_buy_versions',   'list_version_id'),
    ('point_buy_list_entries',     'nulled',   NULL,                                NULL),
    ('format_definitions',         'nulled',   NULL,                                NULL)
  ) AS v(parent, protection, junction, jcol)
$$;
REVOKE ALL ON FUNCTION public.league_trash__external_parents() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.league_trash__external_parents() TO service_role;

DROP FUNCTION public.ruleset_replay_pins();
DROP FUNCTION public.ruleset_replay_preview();
DROP FUNCTION public.ruleset_convert_missing();
DROP FUNCTION public.ruleset_legacy_resolved(public.rulesets_legacy);
DROP FUNCTION public.ruleset_legacy_spec(public.rulesets_legacy);
DROP FUNCTION public.ruleset_legacy_name(public.rulesets_legacy);
DROP FUNCTION public.ruleset_legacy_gen(text);
DROP FUNCTION public.ruleset_legacy_custom(public.rulesets_legacy);
DROP FUNCTION public.ruleset_js_blank(text);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tournaments t WHERE NOT EXISTS (SELECT 1 FROM public.ruleset_definition_versions v WHERE v.id = t.ruleset_id)) THEN
    RAISE EXCEPTION 'a phase points at a ruleset without a version';
  END IF;
  IF EXISTS (SELECT 1 FROM public.seasons s WHERE s.ruleset_id IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM public.ruleset_definition_versions v WHERE v.id = s.ruleset_id)) THEN
    RAISE EXCEPTION 'a league points at a ruleset without a version';
  END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE conname IN ('seasons_ruleset_id_fkey', 'tournaments_ruleset_id_fkey')
        AND confrelid = 'public.ruleset_definition_versions'::regclass) <> 2 THEN
    RAISE EXCEPTION 'the pin foreign keys do not reference ruleset_definition_versions';
  END IF;
END $$;

COMMIT;

-- Ruleset Studio, step 3 of 3 (CONTRACT): the legacy rulesets table goes away. Apply it ONLY after the code of the
-- Ruleset Studio is deployed and verified (a league page, a team validation, a format attach): the code that is still
-- deployed after 20261026100100 reads public.rulesets and its foreign keys.
--
--  * A catch-up conversion runs first (ruleset_convert_missing: rulesets created in the window). A ruleset that was
--    EDITED in the window no longer equals its version 1; the self-check lists those ids and aborts, because the right
--    answer (publish the edit as a new version, or discard it) is the maintainer's. Pause ruleset editing with the
--    old builder from the expand file to this one.
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
   WHERE v.resolved IS DISTINCT FROM public.ruleset_legacy_resolved(r);
  IF v_drift IS NOT NULL THEN
    RAISE EXCEPTION 'rulesets edited after the conversion (publish the edit as a new version, or restore the row, then retry): %', v_drift;
  END IF;
END $$;

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

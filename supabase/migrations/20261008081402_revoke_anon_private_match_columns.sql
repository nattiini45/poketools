-- Revoke every privilege anon and authenticated hold on public.matches.
--
-- Option B in docs/security/anon-match-columns.md (decision D1).
-- Option C, the follow-up
-- 20261008081443_close_public_api_roles.sql, closes the rest of public the
-- same way; this file stays so that matches is closed even where only this
-- one is re-run.
--
-- The file name carries the version that schema_migrations recorded when
-- it was applied (20261008081402); keep it, or a later db push re-runs the
-- file (CONTRIBUTING.md "Supabase Migration History").
-- Expected post-check results and the rollback procedure: the status
-- section and section 5 of docs/security/anon-match-columns.md.
--
-- Why
--   The baseline grants ALL on public.matches to anon and authenticated
--   (20260608100000_baseline_professional_schema.sql:3462-3463). The policy
--   "Public read matches" (FOR SELECT USING (true), :2957) has no TO clause,
--   so both roles may read every row. The anon key ships in the browser
--   bundle, so `GET /rest/v1/matches?select=notes,submitter_id` returns the
--   admin notes / dispute log, the submitter, auto_confirm_at and
--   confirmed_at of every match. Anyone can sign up and read the same rows
--   as authenticated.
--
--   The app never reads tables as anon or authenticated. Every table read
--   and write goes through the service-role client
--   (src/lib/supabase/client.ts). The browser anon key is used only for
--   Realtime broadcast, and the server anon key only for GoTrue.
--
-- What it does
--   Removes every privilege anon and authenticated hold on public.matches:
--   SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER (and
--   MAINTAIN on PostgreSQL 17). service_role keeps its own grant and bypasses
--   RLS. postgres owns the table. Neither is touched.
--
--   It creates no policy and drops no policy. With no table privilege, the
--   "Public read matches" policy no longer has any effect. Dropping it is a
--   separate owner decision (see the proposal).
--
--   Re-running it is safe: REVOKE of a privilege that is not held changes
--   nothing, and the self-check passes again.
--
-- Dumps and restores do NOT carry this revoke
--   pg_dump writes a table's ACL as a difference from the owner-only
--   default, so a dump taken after this file contains
--   `GRANT ALL ON TABLE public.matches TO service_role` and no REVOKE. When
--   that dump is restored into a Supabase database, CREATE TABLE picks up the
--   target's default privileges for postgres in public, which grant ALL to
--   anon and authenticated, and the leak is back. This applies to a squashed
--   baseline, to a dump restored into a new project (psql -f <dump>), and to any later
--   migration that recreates or renames a table into public.matches. Each of
--   them must end with this REVOKE (re-running this whole file is enough),
--   and the target must then pass V1 in the proposal.

BEGIN;

REVOKE ALL ON TABLE public.matches FROM anon, authenticated;

-- Self-check. Aborts the transaction (nothing is applied) when an API role
-- can still reach the table, for example through PUBLIC, through a grant
-- made by a different grantor (a REVOKE run as postgres removes only the
-- grants postgres made), or through role membership. It also aborts when an
-- API role can still read matches through an object that runs with its
-- owner's rights (V6 in the proposal), and checks that service_role kept the
-- access the app needs.
DO $$
DECLARE
  api_role text;
  findings text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_any_column_privilege(api_role, 'public.matches', 'SELECT, INSERT, UPDATE, REFERENCES')
       OR has_table_privilege(api_role, 'public.matches', 'DELETE, TRUNCATE, TRIGGER') THEN
      RAISE EXCEPTION 'revoke_anon_private_match_columns: % still holds a privilege on public.matches; run the raw ACL query (V3) in docs/security/anon-match-columns.md', api_role;
    END IF;
    IF current_setting('server_version_num')::int >= 170000 THEN
      IF has_table_privilege(api_role, 'public.matches', 'MAINTAIN') THEN
        RAISE EXCEPTION 'revoke_anon_private_match_columns: % still holds MAINTAIN on public.matches', api_role;
      END IF;
    END IF;
  END LOOP;
  -- Read paths a table REVOKE does not close, because the object reads
  -- matches with its owner's rights:
  --   * a view or materialized view over matches that an API role can read
  --     (rule dependencies only: classid = pg_rewrite);
  --   * a SECURITY DEFINER function or procedure that an API role can
  --     execute and that reads matches. A SQL-standard body (BEGIN ATOMIC /
  --     RETURN) records a pg_depend row and leaves prosrc empty; any other
  --     body is matched on its text. Trigger and event-trigger functions
  --     cannot be called directly, so they are skipped.
  -- The migrations create neither. This catches objects made on live. If it
  -- aborts, revoke the API roles' access to the object it names, in this
  -- same migration, and run it again.
  SELECT string_agg(f, '; ' ORDER BY f) INTO findings FROM (
    SELECT format('view %s', v.oid::regclass) AS f
    FROM pg_depend d
    JOIN pg_rewrite rw ON rw.oid = d.objid
    JOIN pg_class v ON v.oid = rw.ev_class
    WHERE d.classid = 'pg_rewrite'::regclass
      AND d.refclassid = 'pg_class'::regclass
      AND d.refobjid = 'public.matches'::regclass
      AND v.oid <> 'public.matches'::regclass
      AND (has_any_column_privilege('anon', v.oid, 'SELECT')
           OR has_any_column_privilege('authenticated', v.oid, 'SELECT'))
    UNION
    SELECT format('function %s', p.oid::regprocedure)
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.prosecdef
      AND p.prokind IN ('f', 'p')
      AND p.prorettype NOT IN ('trigger'::regtype, 'event_trigger'::regtype)
      AND (has_function_privilege('anon', p.oid, 'EXECUTE')
           OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
      AND (EXISTS (SELECT 1 FROM pg_depend d
                   WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid
                     AND d.refclassid = 'pg_class'::regclass
                     AND d.refobjid = 'public.matches'::regclass)
           OR ((n.nspname IN ('public', 'graphql_public') OR p.proowner = 'postgres'::regrole)
               AND (CASE WHEN p.prokind IN ('f', 'p') THEN pg_get_functiondef(p.oid) END) ~* '\mmatches\M'))
  ) s;
  IF findings IS NOT NULL THEN
    RAISE EXCEPTION 'revoke_anon_private_match_columns: an API role can still read public.matches through: %; see V6 in docs/security/anon-match-columns.md', findings;
  END IF;

  IF NOT (
    has_table_privilege('service_role', 'public.matches', 'SELECT')
    AND has_table_privilege('service_role', 'public.matches', 'INSERT')
    AND has_table_privilege('service_role', 'public.matches', 'UPDATE')
    AND has_table_privilege('service_role', 'public.matches', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'revoke_anon_private_match_columns: service_role lost access to public.matches';
  END IF;
END
$$;

-- Ask PostgREST to reload its schema cache. Privileges are enforced by
-- Postgres on every query either way; this only refreshes what PostgREST
-- lists. Delivered at COMMIT.
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ---------------------------------------------------------------------------
-- ROLLBACK (owner only). This re-opens the leak.
-- ---------------------------------------------------------------------------
-- Ship it as a FORWARD migration (<ts>_restore_api_role_match_grants.sql),
-- applied and reconciled like any other, never as ad-hoc SQL on live: a
-- live-only GRANT leaves every `supabase db reset` revoking and live
-- granting. In the same change, remove or narrow the static guard
-- (src/lib/supabase/__tests__/migration-api-grants.test.ts) and the AGENTS.md
-- Never-Do bullet, or `npm run test` fails. Build the GRANT list from the V3
-- output recorded before this file was applied; the line below is the
-- baseline ACL and is right only if V3 showed exactly that.
-- BEGIN;
-- GRANT ALL ON TABLE public.matches TO anon, authenticated;
-- NOTIFY pgrst, 'reload schema';
-- COMMIT;

-- ---------------------------------------------------------------------------
-- POST-APPLY VERIFICATION (read-only; dashboard SQL editor, as postgres)
-- ---------------------------------------------------------------------------
--
-- V1. Effective SELECT per column. Expected: anon_sel and auth_sel false on
--     all 18 rows; svc_sel true on all 18 rows.
-- SELECT a.attnum, a.attname,
--   has_column_privilege('anon',          a.attrelid, a.attnum, 'SELECT') AS anon_sel,
--   has_column_privilege('authenticated', a.attrelid, a.attnum, 'SELECT') AS auth_sel,
--   has_column_privilege('service_role',  a.attrelid, a.attnum, 'SELECT') AS svc_sel
-- FROM pg_attribute a
-- WHERE a.attrelid = 'public.matches'::regclass AND a.attnum > 0 AND NOT a.attisdropped
-- ORDER BY a.attnum;
--
-- V2. Table-level summary. Expected: every column false for anon and
--     authenticated; service_role true for tbl_select, ins, upd, del.
-- SELECT r.rolname, r.rolbypassrls,
--   has_table_privilege(r.oid, 'public.matches'::regclass, 'SELECT')      AS tbl_select,
--   has_any_column_privilege(r.oid, 'public.matches'::regclass, 'SELECT') AS any_col_select,
--   has_table_privilege(r.oid, 'public.matches'::regclass, 'INSERT')      AS ins,
--   has_table_privilege(r.oid, 'public.matches'::regclass, 'UPDATE')      AS upd,
--   has_table_privilege(r.oid, 'public.matches'::regclass, 'DELETE')      AS del,
--   has_table_privilege(r.oid, 'public.matches'::regclass, 'TRUNCATE')    AS trunc,
--   has_table_privilege(r.oid, 'public.matches'::regclass, 'REFERENCES')  AS refs,
--   has_table_privilege(r.oid, 'public.matches'::regclass, 'TRIGGER')     AS trig
-- FROM pg_roles r
-- WHERE r.rolname IN ('anon', 'authenticated', 'service_role', 'postgres')
-- ORDER BY 1;
--
-- V3. Raw ACL entries with grantor. Expected: no row whose grantee is anon,
--     authenticated or PUBLIC, at table or column level.
-- SELECT 'table' AS level, NULL::name AS col,
--        CASE x.grantee WHEN 0 THEN 'PUBLIC' ELSE x.grantee::regrole::text END AS grantee,
--        x.grantor::regrole::text AS grantor, x.privilege_type, x.is_grantable
-- FROM pg_class c, LATERAL aclexplode(c.relacl) x
-- WHERE c.oid = 'public.matches'::regclass
-- UNION ALL
-- SELECT 'column', a.attname,
--        CASE x.grantee WHEN 0 THEN 'PUBLIC' ELSE x.grantee::regrole::text END,
--        x.grantor::regrole::text, x.privilege_type, x.is_grantable
-- FROM pg_attribute a, LATERAL aclexplode(a.attacl) x
-- WHERE a.attrelid = 'public.matches'::regclass AND a.attnum > 0 AND NOT a.attisdropped
-- ORDER BY 1, 2 NULLS FIRST, 3, 5;
--
-- V5. RLS and policies. Expected: relrowsecurity true; the one policy
--     "Public read matches" still listed (inert) unless the owner dropped it.
-- SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public.matches'::regclass;
-- SELECT policyname, permissive, roles, cmd, qual, with_check
-- FROM pg_policies WHERE schemaname = 'public' AND tablename = 'matches';
--
-- HTTP probes (owner's own shell, own URL and anon key). Expected for each:
-- HTTP 401 with "code":"42501" ("permission denied for table matches").
--   H=(-H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY")
--   curl -si "$SUPABASE_URL/rest/v1/matches?select=notes,submitter_id&limit=1" "${H[@]}"
--   curl -si "$SUPABASE_URL/rest/v1/matches?select=*&limit=1" "${H[@]}"
--   curl -si "$SUPABASE_URL/rest/v1/matches?select=id&notes=ilike.*a*&limit=1" "${H[@]}"
--   curl -si "$SUPABASE_URL/rest/v1/matches?select=id,status&limit=1" "${H[@]}"

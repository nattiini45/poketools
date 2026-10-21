-- Close schema public to the API roles (anon, authenticated, PUBLIC),
-- including objects created later.
--
-- Option C in docs/security/anon-match-columns.md (decision D3),
-- adopted as the follow-up to
-- 20261008081402_revoke_anon_private_match_columns.sql (Option B, matches
-- only). B is a strict subset of C; both stay in the folder.
--
-- The file name carries the version that schema_migrations recorded when
-- it was applied (20261008081443); keep it, or a later db push re-runs the
-- file (CONTRIBUTING.md "Supabase Migration History").
-- Expected post-check results and the rollback procedure: the status
-- section and section 5 of docs/security/anon-match-columns.md.
--
-- Why
--   The baseline grants ALL on every table, sequence and function in public
--   to anon and authenticated, and its default privileges do the same for
--   every object postgres creates there later
--   (20260608100000_baseline_professional_schema.sql:3612-3635). The anon
--   key ships in the browser bundle and anyone can sign up for an
--   authenticated token, so whatever those roles can reach is public:
--     * players: discord_id, auth_user_id, is_admin, ban_reason and the other
--       private columns, through "Public read players" USING (true);
--     * match_evolution_snapshots: created without RLS
--       (20260727141225_match_evolution_snapshots.sql). Where RLS is off,
--       anon can read, write and wipe it, also through
--       rpc/epb_replace_match_snapshots (SECURITY INVOKER, starts with a
--       DELETE);
--     * the semi-private rows behind the other 30 "Public read ..." policies;
--     * EXECUTE on every function, some of them commented "service-role
--       only" but never revoked.
--
--   The app never reads or writes public as anon or authenticated. Every
--   table read, write and rpc goes through the service-role client
--   (src/lib/supabase/client.ts). The browser anon key is used only for
--   Realtime broadcast, the server anon key only for GoTrue. Triggers run
--   their functions without an EXECUTE check, and no storage, auth or
--   realtime policy calls a function in public.
--
-- What it does
--   1. Enables RLS on match_evolution_snapshots, the one table created
--      without it. A hosted project with the ensure_rls event trigger may
--      already have it on; this makes every replay of the migrations agree.
--   2. Revokes every privilege anon, authenticated and PUBLIC hold on every
--      existing table, view, sequence, function and procedure in public.
--      service_role keeps its explicit grants; EXECUTE is re-granted to it
--      on every routine because some may have relied on PUBLIC.
--   3. Closes the default privileges postgres hands to new objects in
--      public. The PUBLIC EXECUTE default on functions is global (a
--      per-schema command cannot remove it), so it is revoked for functions
--      postgres creates in ANY schema, and service_role is granted EXECUTE
--      on them in its place so it keeps the access it had through PUBLIC.
--      Objects created by another role (supabase_admin, for example in the
--      dashboard) follow that role's defaults, which postgres cannot change
--      and which on hosted projects may still grant anon and authenticated (V7):
--      after creating one there, run V7 and V10 in the proposal and revoke
--      what the API roles received in a migration.
--   4. Verifies the result inside the transaction and aborts otherwise.
--
--   It creates no policy and drops no policy. The 31 "Public read ..."
--   policies stay but no longer have any effect, because the roles they
--   would apply to hold no privilege (owner decision D2: keep them).
--   Schema USAGE on public is not touched, so a refused request still
--   answers 42501 (permission denied for table/function).
--
--   Re-running it is safe: REVOKE of a privilege that is not held changes
--   nothing, the GRANTs and ALTER DEFAULT PRIVILEGES are idempotent, and the
--   self-check passes again.
--
-- New migrations
--   A new table's migration enables RLS on it, and grants nothing to anon,
--   authenticated or PUBLIC. From 2026-10-30 Supabase no longer grants new
--   tables to service_role automatically on hosted projects (changelog
--   45329); grant it explicitly. src/lib/supabase/__tests__/
--   migration-api-grants.test.ts replays this folder and fails on any
--   grant, default privilege, role membership or table without RLS that
--   reopens public.
--
-- Dumps and restores do NOT carry this file
--   pg_dump writes ACLs as differences from the owner-only default, so a
--   dump has no REVOKE in it, and its own ALTER DEFAULT PRIVILEGES lines
--   come after the tables. Restored into a Supabase database, every
--   CREATE TABLE and CREATE FUNCTION picks up the target's default grants to
--   anon and authenticated. After any restore (psql -f <dump>) or
--   squashed baseline, re-run this whole file on the target, then check V1
--   and V7 in the proposal.

BEGIN;

-- 1. The one table created without RLS.
ALTER TABLE public.match_evolution_snapshots ENABLE ROW LEVEL SECURITY;

-- 2. Existing objects.
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;
-- ROUTINES covers functions and procedures (ALL FUNCTIONS skips procedures).
REVOKE ALL ON ALL ROUTINES  IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON ALL ROUTINES IN SCHEMA public TO service_role;

-- 3. Objects postgres creates later.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
-- Global: applies to functions postgres creates in ANY schema.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO service_role;

-- 4. Self-check. Aborts the transaction (nothing is applied) unless:
--    * no table, view, sequence, column or routine in public grants anything
--      to PUBLIC, anon or authenticated (a grant made by another grantor
--      survives a REVOKE run as postgres, so it shows up here);
--    * neither API role is a member of another role (membership inherits
--      that role's privileges);
--    * postgres's default privileges give new objects in public nothing for
--      the API roles, and new functions anywhere nothing for PUBLIC;
--    * every table in public has RLS on;
--    * service_role can still read every table and view, use every
--      sequence and execute every routine in public.
DO $$
DECLARE
  findings text;
BEGIN
  SELECT string_agg(f, '; ' ORDER BY f) INTO findings FROM (
    SELECT format('%s -> %s', c.oid::regclass,
                  CASE x.grantee WHEN 0 THEN 'PUBLIC' ELSE x.grantee::regrole::text END) AS f
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(c.relacl) x
    WHERE n.nspname = 'public'
      AND x.grantee IN (0, 'anon'::regrole::oid, 'authenticated'::regrole::oid)
    UNION ALL
    SELECT format('%s.%s -> %s', a.attrelid::regclass, a.attname,
                  CASE x.grantee WHEN 0 THEN 'PUBLIC' ELSE x.grantee::regrole::text END)
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(a.attacl) x
    WHERE n.nspname = 'public' AND a.attnum > 0 AND NOT a.attisdropped
      AND x.grantee IN (0, 'anon'::regrole::oid, 'authenticated'::regrole::oid)
    UNION ALL
    -- A NULL routine ACL means the built-in default, which grants EXECUTE to PUBLIC.
    SELECT format('%s -> %s', p.oid::regprocedure,
                  CASE x.grantee WHEN 0 THEN 'PUBLIC' ELSE x.grantee::regrole::text END)
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
    WHERE n.nspname = 'public'
      AND x.grantee IN (0, 'anon'::regrole::oid, 'authenticated'::regrole::oid)
    UNION ALL
    SELECT format('%s is a member of %s', m.member::regrole, m.roleid::regrole)
    FROM pg_auth_members m
    WHERE m.member IN ('anon'::regrole::oid, 'authenticated'::regrole::oid)
    UNION ALL
    SELECT format('default privileges of postgres in public on %s -> %s', d.defaclobjtype,
                  CASE x.grantee WHEN 0 THEN 'PUBLIC' ELSE x.grantee::regrole::text END)
    FROM pg_default_acl d
    CROSS JOIN LATERAL aclexplode(d.defaclacl) x
    WHERE d.defaclrole = 'postgres'::regrole
      AND d.defaclnamespace = 'public'::regnamespace
      AND x.grantee IN (0, 'anon'::regrole::oid, 'authenticated'::regrole::oid)
    UNION ALL
    -- No global entry means the built-in default, which grants EXECUTE to PUBLIC.
    SELECT format('global default privileges of postgres on %s -> %s', t.objtype,
                  CASE x.grantee WHEN 0 THEN 'PUBLIC' ELSE x.grantee::regrole::text END)
    FROM (VALUES ('r'::"char"), ('S'::"char"), ('f'::"char")) AS t(objtype)
    CROSS JOIN LATERAL aclexplode(coalesce(
      (SELECT d.defaclacl FROM pg_default_acl d
       WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 0 AND d.defaclobjtype = t.objtype),
      acldefault(t.objtype, 'postgres'::regrole))) x
    WHERE x.grantee IN (0, 'anon'::regrole::oid, 'authenticated'::regrole::oid)
    UNION ALL
    SELECT format('%s has RLS off', c.oid::regclass)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
    UNION ALL
    SELECT format('%s not readable by service_role', c.oid::regclass)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND NOT has_table_privilege('service_role', c.oid, 'SELECT')
    UNION ALL
    SELECT format('%s not usable by service_role', c.oid::regclass)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    -- CASE keeps the planner from calling has_sequence_privilege on a
    -- relation that is not a sequence (it raises 42809 there).
    WHERE n.nspname = 'public'
      AND CASE WHEN c.relkind = 'S' THEN NOT has_sequence_privilege('service_role', c.oid, 'USAGE') ELSE false END
    UNION ALL
    SELECT format('%s not executable by service_role', p.oid::regprocedure)
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
  ) s;
  IF findings IS NOT NULL THEN
    RAISE EXCEPTION 'close_public_api_roles: %; see V3, V7 and V10 in docs/security/anon-match-columns.md', findings;
  END IF;
END
$$;

-- Ask PostgREST to reload its schema cache. Privileges are enforced by
-- Postgres on every query either way. Delivered at COMMIT.
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ---------------------------------------------------------------------------
-- ROLLBACK (owner only). This reopens players, match_evolution_snapshots and
-- the rest of public.
-- ---------------------------------------------------------------------------
-- Ship it as a FORWARD migration, applied and reconciled like any other,
-- never as ad-hoc SQL on a deployment. In the same change, narrow the static guard
-- (src/lib/supabase/__tests__/migration-api-grants.test.ts) and the AGENTS.md
-- Never-Do bullet, or `npm run test` fails. Rebuild the GRANT list from the
-- V7 and V10 output saved from the target before this file was applied
-- (keep that snapshot outside the repository); the template in
-- section 5 (Rollback) of docs/security/anon-match-columns.md restores the
-- state the migrations describe, keeps matches (Option B) and the two
-- functions advisor_fixes closed, and leaves RLS on match_evolution_snapshots
-- enabled.

-- ---------------------------------------------------------------------------
-- POST-APPLY VERIFICATION (read-only; dashboard SQL editor, as postgres)
-- ---------------------------------------------------------------------------
-- Re-run the self-check above (the DO block alone): it raises nothing.
-- V1 and V2 for public.matches and public.players: anon and authenticated
-- false everywhere, service_role true. V7: no row with anon, authenticated or
-- PUBLIC for creator postgres. V9: relrowsecurity true.
--
-- HTTP probes (owner's own shell, own URL and anon key). Expected for each:
-- HTTP 401 with "code":"42501".
--   H=(-H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY")
--   curl -si "$SUPABASE_URL/rest/v1/matches?select=id&limit=1" "${H[@]}"
--   curl -si "$SUPABASE_URL/rest/v1/players?select=id,discord_id&limit=1" "${H[@]}"
--   curl -si "$SUPABASE_URL/rest/v1/match_evolution_snapshots?select=id&limit=1" "${H[@]}"

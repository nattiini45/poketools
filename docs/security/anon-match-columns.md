# Closing anon REST reads of private match columns

> **Status: implemented.** Option B ships as `20261008081402` and Option C as `20261008081443`. Both migrations verify their own result inside the transaction. Decisions (section 4): **D1** Option B; **D2** keep every policy (none dropped); **D3** Option C as a follow-up migration; **D4** closed by Option C step 1; **D5** the AGENTS.md wording, in its Option C variants (7.8); **D7** no pre-revoke dump is kept, and every restore re-runs both migration files.
>
> Files:
> - Option B: [`supabase/migrations/20261008081402_revoke_anon_private_match_columns.sql`](../../supabase/migrations/20261008081402_revoke_anon_private_match_columns.sql) (with its self-check).
> - Option C: [`supabase/migrations/20261008081443_close_public_api_roles.sql`](../../supabase/migrations/20261008081443_close_public_api_roles.sql).
> - Static guard (in `npm run test`): [`src/lib/supabase/__tests__/migration-api-grants.test.ts`](../../src/lib/supabase/__tests__/migration-api-grants.test.ts).
> - LIVE-LOCAL test (opt-in): [`src/lib/supabase/__tests__/api-role-grants.local.test.ts`](../../src/lib/supabase/__tests__/api-role-grants.local.test.ts).
> - Post-restore step: re-run both migration files on the target, then check V1 and V7 ([Dumps and restores](#dumps-and-restores-do-not-carry-any-of-these-fixes)).
>
> Below the status section, the document is the proposal as approved, kept for its reasoning. It describes the state before the two migrations ("today" means before Option B).

## Status

### What the migrations close, and what they cannot

After both files, on a stack built from `supabase/migrations/`:

| Check | Expected result |
|---|---|
| V1 on `matches`: columns `anon` / `authenticated` can SELECT | none; `service_role` all |
| The same on `players` | none |
| Tables in `public` with any privilege for an API role | none |
| Functions in `public` an API role can execute | none; `service_role` executes all |
| Tables with RLS off | none |
| V7, defaults for creator `postgres` in `public` | only `postgres` and `service_role` |
| V7, defaults for creator `supabase_admin` in `public` | **may still grant `anon` and `authenticated`** on tables, sequences and functions |

- **The `supabase_admin` caveat.** `postgres` cannot change another role's default privileges, so neither migration can close them. An object created from the dashboard as `supabase_admin` can be open to both API roles from the start. After creating anything outside a migration, run V7 and V10, close what the API roles received with a migration, and re-run the Option C self-check (its `DO` block), which names anything still reachable.
- **HTTP probes (anon key):** GETs of `matches` (`select=notes`, `select=*`, a `notes` filter, the submitter embed, `select=id,status`), `players`, `match_evolution_snapshots` and `seasons` should all return HTTP 401 with code 42501.
- **App:** the app's pages and API routes read through the service role or Realtime broadcast, as section 2 predicts, so they are unaffected.
- **Environments can differ on V9.** A hosted project with Supabase's `ensure_rls` event trigger may already have RLS on for `match_evolution_snapshots`; every stack built from the migrations (`supabase db reset`, preview branches) has it off until Option C step 1 enables it. Option C makes them agree.

### Local validation (an isolated local stack)

Run on a separate local Supabase stack (CLI 2.98.1, PostgreSQL 17.6, its own `project_id` and ports).

1. **Before** the two files, after a fresh migration replay: the LIVE-LOCAL test failed every one of its 20 "cannot" cases. Matches, players, `match_evolution_snapshots` and `seasons` all answered 200 with data, and an `update` answered 204. The two service-role controls passed. So the test sees the leak. The local replay also had RLS **off** on `match_evolution_snapshots`, because there is no `ensure_rls` trigger locally.
2. **`supabase db reset` with both files:** both self-checks passed. Re-running each file on the result was a no-op that passed again. Negative runs aborted as intended: `GRANT service_role TO authenticated` aborted both files, and a function in `public` owned by another role (`supabase_admin`) aborted Option C.
3. **After:** the LIVE-LOCAL test passed 22 of 22. Every API-role probe got HTTP 401 (anon) or 403 (authenticated) with 42501, the rpc calls included ("permission denied for function"). The service-role LIVE-LOCAL test `postgrest-shapes.local.test.ts` still passed 12 of 12, so the app's own client is unaffected.
4. **Types:** `supabase gen types typescript --local` produced byte-identical output before and after the two files, so `src/types/database.ts` needs no change. The generator's output differs from the committed file in ordering and formatting, and did so before this change too: that is unrelated drift.
5. **New objects after Option C:** a table or function that postgres creates in `public` is closed to the API roles and open to `service_role`. A function postgres creates in another schema no longer gets PUBLIC EXECUTE; `service_role` still gets EXECUTE through the new global default. Any other role that needs such a function (for example `supabase_auth_admin` for an auth hook) needs an explicit grant.

## Summary

- According to the migrations, anyone holding the public anon key can read `matches.notes` (the admin notes and dispute log), `submitter_id`, `auto_confirm_at` and `confirmed_at` for every match, straight from `/rest/v1/matches`. The anon key ships in the browser bundle.
- Nothing in the app, scripts, tests, overlays or crons needs `anon` or `authenticated` to hold any privilege on any table in `public`.
- **Recommendation: Option B.** Run `REVOKE ALL ON TABLE public.matches FROM anon, authenticated;`. It closes the leak completely, a new column stays closed without anyone remembering to close it, and no policy is created or dropped. The Option B migration does this and verifies the result.
- Two things the revoke does not cover by itself. (1) **Dumps and restores.** No dump carries the revoke. Every restore into a new project or local stack, and every squashed baseline, has to re-run it (section 3). (2) Any **earlier copy of the tables** in another project keeps the old grants.
- The same audit found two exposures that are **more severe** than the match notes: (1) `match_evolution_snapshots` has RLS off, so anon can read, write and wipe it; (2) the private `players` columns (`discord_id`, `auth_user_id`, `is_admin`, `ban_reason`, …) are readable the same way. Both are closed by Option C, which should follow as its own migration. Check (1) on live first (V9 below).

## 1. Problem

### What anon and authenticated can do today (per the migrations)

| Fact | Evidence |
|---|---|
| `matches` has RLS enabled | `supabase/migrations/20260608100000_baseline_professional_schema.sql:3110` |
| One policy: `"Public read matches" FOR SELECT USING (true)`, with no `TO` clause, so it applies to every role | baseline:2957 |
| `GRANT ALL ON TABLE "public"."matches"` to `anon` and to `authenticated` | baseline:3462-3463 |
| No migration revokes a table privilege. The only `REVOKE`s in the folder are on two functions | `20260608100003_advisor_fixes.sql:118-124` |
| `public` is exposed through PostgREST and pg_graphql | `supabase/config.toml:13` |
| The anon key is in the browser bundle (Cast Studio Realtime broadcast) | `src/lib/supabase/realtime-client.ts` |
| Anyone can sign up through GoTrue and get an `authenticated` token. The app's own signup route depends on signups being enabled | `src/app/api/auth/signup/route.ts`, `supabase/config.toml:169` |

`matches` has 18 columns: 16 from the baseline (baseline:1223-1240), plus `bracket_side` and `bracket_pos` (`20260822190000_league_phase_revamp_wave1.sql:6-9`). No other migration adds a column, and `src/types/database.ts` agrees.

| Private (`PRIVATE_MATCH_FIELDS`, `src/lib/match/public-match.ts`) | Public `matches` columns (the column subset of `PUBLIC_MATCH_FIELDS`) |
|---|---|
| `notes`, `submitter_id`, `auto_confirm_at`, `confirmed_at` | `id`, `round_id`, `tournament_id`, `player_1_id`, `player_2_id`, `winner_id`, `status`, `date_played`, `scheduled_at`, `social_image_url`, `bracket_side`, `bracket_pos`, `created_at`, `updated_at` |

The other `PUBLIC_MATCH_FIELDS` entries (`player_1_name`, `player_2_name`, `player_1_avatar_url`, `player_2_avatar_url`, `winner_name`, `round_status`, `games`) are joined or derived. They are not columns.

The result: the app has stopped sending the four private fields to public clients, but the database still serves them to anyone.

- `GET /rest/v1/matches?select=id,notes,submitter_id,auto_confirm_at,confirmed_at` returns every match. It pages 1000 rows at a time (`max_rows`, `config.toml:18`).
- A filter works too, for example `?notes=ilike.*dispute*`. So does an embed through the private foreign key: `?select=id,players!matches_submitter_id_fkey(name)`.
- The same rows are readable with an `authenticated` token, because the policy has no `TO` clause.
- If pg_graphql is enabled, the same columns are readable through `/graphql/v1`.

Writes are not open today. INSERT, UPDATE and DELETE have no policy for these roles, so INSERT fails and UPDATE and DELETE change no rows. `GRANT ALL` also gives `TRUNCATE`, `REFERENCES` and `TRIGGER` (and `MAINTAIN` on PostgreSQL 17). RLS does not govern these, but neither PostgREST nor pg_graphql can issue them.

The Supabase Security Advisor will not report this. Its lint 0024 (`rls_policy_always_true`) flags only `UPDATE`, `DELETE` and `ALL` policies. Its own comment says `SELECT` with `(true)` is often intentional.

### Live may differ

All of the above is reconstructed from `supabase/migrations/`. The live project was built from a dump, and someone may have changed grants in the dashboard since. Before deciding, run the read-only checks V1–V9 in [section 5](#5-rollout) and the "before" HTTP probe. If V1 shows `anon_sel = false` for `notes` on live, the leak is closed there already, but the migration is still needed so that `supabase db reset` and preview branches, which replay the migrations, do not reopen it. A restore from a dump is a different case: no dump carries the revoke (see [Dumps and restores](#dumps-and-restores-do-not-carry-any-of-these-fixes)).

## 2. What depends on anon or authenticated table access

The investigation read the repo, the migrations, `node_modules/@supabase/realtime-js` 2.99.2 and the public Supabase docs. It made no connection to any Supabase database. The Option B self-check, V6 and the Option C rollback were run on a throwaway local PostgreSQL 13 cluster, with stand-in roles and tables. PostgreSQL 13 cannot run two of the self-check's branches: the SQL-standard function bodies of PostgreSQL 14+ (found through `pg_depend`) and the `MAINTAIN` check of PostgreSQL 17.

| Consumer | Key and role | Touches `public` as anon or authenticated? |
|---|---|---|
| Server client `src/lib/supabase/client.ts` (every `queries/*.ts`, every `supabase.rpc(...)` call, 21 call sites) | service role | No |
| Scripts (`scripts/**`: import, wipe, audit, world-assets) | service role, Management API token or `db query --linked` (postgres) | No |
| LIVE-LOCAL and live-gated tests (`postgrest-shapes.local.test.ts`, `ai/agent` tests) | service role | No. `postgrest-shapes` takes the anon key on its command line but never uses it |
| Browser Realtime client `realtime-client.ts` → `src/lib/broadcast/channel.ts` | anon | No. It uses public broadcast channels only (no `private: true`). The repo has no `postgres_changes`, presence or `track(`, and no table is in the `supabase_realtime` publication |
| GoTrue client `src/lib/supabase/auth-client.ts` (signup, sign-in, OTP, reset) | anon, server-side, `auth.*` endpoints only | No. GoTrue runs as `supabase_auth_admin` in schema `auth`, and there is no trigger on `auth.users` |
| Storage (`avatars`, `social-images`, `world-assets`) | service role writes; reads via public URLs | No. These objects are in schema `storage` |
| Triggers, foreign-key checks and cascades | table owner | No. EXECUTE on a trigger function is checked at `CREATE TRIGGER`, not when it fires |
| SECURITY DEFINER functions (`check_and_record_admin_export`, `rls_auto_enable`) | already revoked from anon, authenticated and PUBLIC (`advisor_fixes.sql:118-124`) | No. Neither function touches `matches` |
| OBS overlays, broadcast pages, Vercel crons | the app's own `/api/*` routes | No |
| Maintainer deferred-work check D-003 (anon probe of `/rest/v1/seasons`) | anon | Reads `seasons`, not `matches`. It is unaffected by A and B. Under C it gets 42501 instead of data, still prints "reachable" and exits 0, so its meaning degrades |
| Supabase dashboard, MCP, type generation | postgres | No |

**For `matches`:** nothing breaks if `anon` and `authenticated` lose every privilege on it. As a side effect, an anon call to `rpc/get_total_games_in_scope`, which reads `matches` and runs as the caller, now fails with 42501. Only the service role calls it.

**For every table, sequence and function in `public`:** nothing in the repo breaks either. The only side effects are the D-003 probe above and doc lines that describe the current design (section 7).

**Unknowns** (no evidence either way in the repo):

- An out-of-repo consumer that a maintainer runs against the anon key.
- Whether `matches` was added to the `supabase_realtime` publication from the dashboard (V6). If it was, revoking SELECT also closes that path.
- The live Realtime setting "Allow public access" has to stay on for Cast Studio. It does not depend on table grants.

## 3. Options

Each option runs as `postgres`, which owns every table.

### Background: why `REVOKE SELECT (notes)` alone does nothing

PostgreSQL keeps table privileges and column privileges separately. A role may read a column if it holds SELECT on the table **or** on that column. `GRANT ALL` put a table-level entry in the ACL. `REVOKE SELECT (notes, …) ON public.matches FROM anon` edits only the column ACL, which is empty, so nothing changes. The PostgreSQL REVOKE page says so: if a role holds privileges on a table, revoking the same privileges from individual columns has no effect. The working pattern revokes at table level first, and that also removes any column grants. If some columns should stay readable, grant them back by name.

### Option A: column-level grants (keep public columns readable over REST)

```sql
REVOKE ALL ON TABLE public.matches FROM anon, authenticated;
GRANT SELECT (id, round_id, tournament_id, player_1_id, player_2_id, winner_id, status,
              date_played, scheduled_at, social_image_url, bracket_side, bracket_pos,
              created_at, updated_at)
  ON TABLE public.matches TO anon, authenticated;
```

The list is the 14 `matches` columns in `PUBLIC_MATCH_FIELDS`, checked against the baseline, every later migration and `src/types/database.ts`.

- **Reads:** a request that names only public columns works, and so does `Prefer: count=exact`. A request that touches a private column anywhere fails with 42501 (HTTP 401 for anon, 403 for a signed-in token). That covers selects, filters (`?notes=ilike.*`), sorts and embeds over `matches_submitter_id_fkey`.
- **`select=*`:** fails with 42501, because `*` expands to every column. The same goes for `matches(*)` embedded from another table.
- **Writes:** INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER and MAINTAIN are all removed.
- **New columns:** closed by default. A new column gets no column grant, and the roles have no table-level SELECT.
- **Policy:** has to stay. Without it, RLS returns no rows and Option A behaves like Option B.
- **Realtime `postgres_changes`** (unused): subscribers would receive only the 14 granted columns.
- **Dumps and restores:** the fix does not survive them. A dump taken after the change keeps the column-level `GRANT SELECT ("id", …)` lines. But when it is restored into a Supabase database, `CREATE TABLE` picks up the target's default `GRANT ALL ... TO anon, authenticated`. That table-level grant overrides the column grants. Replaying the old baseline does the same. See [Dumps and restores](#dumps-and-restores-do-not-carry-any-of-these-fixes).
- **Risk:** this adds a second allowlist, in SQL, that has to track `PUBLIC_MATCH_FIELDS` by hand. It also keeps open a read path that nothing uses.

### Option B: revoke every privilege on `matches` from the API roles (recommended)

```sql
REVOKE ALL ON TABLE public.matches FROM anon, authenticated;
```

- **Reads:** every direct read of `matches` as anon or authenticated fails with 42501: any column, `select=*`, `count`, filters, embeds into `matches` from other tables, and pg_graphql, where `matches` disappears from those roles' schema. An object that reads `matches` with its owner's rights is not covered: an owner-rights view, or a SECURITY DEFINER function, that an API role can use. The migrations create none. The Option B self-check aborts if one exists, and V6 lists them.
- **Writes:** every privilege is removed, as in A.
- **New columns:** closed by default, with no list to maintain.
- **Policy:** `"Public read matches"` stays but has no effect. Dropping it is optional (see the decisions in section 4).
- **Realtime `postgres_changes`** (unused): a subscription to `matches` would be refused (walrus answers 401 when the role cannot select the primary key). Broadcast is unaffected.
- **Dumps and restores:** the fix does not survive them. A dump taken after the change contains `GRANT ALL ON TABLE public.matches TO service_role` and no `REVOKE`. Restoring it into a Supabase database reopens the leak, because `CREATE TABLE` picks up the target's default grants to `anon` and `authenticated`. Every restore and every regenerated baseline has to re-run the revoke. See [Dumps and restores](#dumps-and-restores-do-not-carry-any-of-these-fixes). Replaying the old baseline, or copying its `GRANT ALL` lines into a new migration, also reopens it. The static guard in section 6 catches these when they happen inside `supabase/migrations/`.
- **Rollback:** a forward migration that re-grants what V3 recorded before the change (section 5, Rollback).
- **Risk:** an out-of-repo consumer that reads match data with the anon key would break. None is known.

### Option C: revoke API-role access to everything in `public`, including future objects

> **Adopted** as `supabase/migrations/20261008081443_close_public_api_roles.sql`. It differs from the SQL below in five ways. (1) It uses `ALL ROUTINES`, because `ALL FUNCTIONS` skips procedures. (2) It also revokes PUBLIC on tables and sequences. (3) It adds `ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO service_role`, so service_role keeps, for functions postgres creates in any schema, the EXECUTE it used to get through PUBLIC. (4) Its self-check also covers role membership, postgres's default privileges (per schema and global) and service_role's sequence and routine access. (5) It wraps `has_sequence_privilege` in a `CASE`: unguarded, the planner calls it on non-sequences and the check raises 42809.

```sql
BEGIN;

-- 1. The one table created without RLS (20260727141225_match_evolution_snapshots.sql:9).
ALTER TABLE public.match_evolution_snapshots ENABLE ROW LEVEL SECURITY;

-- 2. Existing objects. service_role keeps its explicit grants; EXECUTE is
--    re-asserted because some functions may have relied on PUBLIC.
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- 3. Objects postgres creates later (the baseline defaults at :3612-3635).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
-- The PUBLIC EXECUTE default on functions is global; a per-schema command cannot remove it.
-- This applies to functions postgres creates in ANY schema.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- 4. Self-check: abort unless nothing in public is reachable by an API role,
--    every table has RLS on, and service_role can still read every table.
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
    WHERE n.nspname = 'public' AND a.attnum > 0
      AND x.grantee IN (0, 'anon'::regrole::oid, 'authenticated'::regrole::oid)
    UNION ALL
    -- A NULL function ACL means the default, which grants EXECUTE to PUBLIC.
    SELECT format('%s -> %s', p.oid::regprocedure,
                  CASE x.grantee WHEN 0 THEN 'PUBLIC' ELSE x.grantee::regrole::text END)
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
    WHERE n.nspname = 'public'
      AND x.grantee IN (0, 'anon'::regrole::oid, 'authenticated'::regrole::oid)
    UNION ALL
    SELECT format('%s has RLS off', c.oid::regclass)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
    UNION ALL
    SELECT format('%s not readable by service_role', c.oid::regclass)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')
      AND NOT has_table_privilege('service_role', c.oid, 'SELECT')
  ) s;
  IF findings IS NOT NULL THEN
    RAISE EXCEPTION 'close_public_api_roles: %', findings;
  END IF;
END
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
```

- **Reads:** anon and authenticated can read no table, view or sequence in `public`, and call no function there. The 31 `"Public read …"` policies (baseline:2905-3025) all stop having any effect. That closes `players`, the semi-private public-read data listed in section 4, and schema listing through the PostgREST OpenAPI root and GraphQL introspection.
- **Writes:** closed on every table, including `match_evolution_snapshots` (RLS on, no privilege) and the `rpc/epb_replace_match_snapshots` path.
- **New tables, functions and sequences** created by `postgres`: closed by default. Objects created by another role, such as `supabase_admin`, follow that role's defaults. Postgres cannot change those, and on live they still grant both API roles (Status), so check V7 and V10 after any dashboard-created object.
- **New columns:** closed, as in B.
- **Realtime and Storage:** unaffected. Broadcast needs no table grants, and Storage lives in schema `storage`.
- **Dumps and restores:** same as B, for every table, sequence and function. The dump's own `ALTER DEFAULT PRIVILEGES` lines do not help. They are written after the tables, so they come too late. They also hold only the grants that remain (`service_role`), with no `REVOKE`, so they cannot remove the target's defaults. After any restore, re-run the whole Option C migration on the target.
- **Risk:** this is broader, so it is an architecture decision. `ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` covers every schema. Any extension function sitting in `public` that is not owned by postgres makes the self-check abort. List them with V10 first. Rollback is a forward migration rebuilt from the V7 and V10 snapshots taken before C (section 5).

### Dumps and restores do not carry any of these fixes

`pg_dump` writes an object's ACL as a difference from `acldefault()`, which for a table is the owner alone. After Option B, a dump of `matches` contains `GRANT ALL ON TABLE public.matches TO service_role` and nothing about `anon` or `authenticated`. A dump has no way to say "and not to anon". A restore runs `CREATE TABLE` as postgres in the target database, so the table takes that database's default privileges. A Supabase database already has `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated` in place before the restore runs. No legacy migration (the pre-baseline history, maintainers only) created those lines, yet the committed baseline dump contains them (baseline:3633-3634), and so did the June dump used to build production, so they come from the platform. Local stacks keep them. Hosted projects keep them at least until the 2026-10-30 change in section 4, and no restore should rely on a target having dropped them. The restored table therefore grants ALL to `anon` and `authenticated` again, and the leak is back with no error.

Paths that hit this:

1. **A squashed baseline.** The current baseline is itself a dump ("Generated via: supabase db dump --linked --schema public", baseline:3). It replaced 56 migrations. A new squash that drops the revoke file loses the fix in every `supabase db reset` and preview branch.
2. **A restore into a new project.** `supabase db dump --schema public`, then `psql "$NEW_DB_URL" -f <dump>`. That is how production was built. A dump taken before the revoke carries `GRANT ALL ON TABLE "public"."matches" TO "anon"` and `TO "authenticated"` (D7). Every such restore must end by re-running both migration files.
3. **A migration that recreates `public.matches`**, or renames another table to it. The new table takes the default grants in the same way.

The rule, for every option: any restore into a new project or a local stack, and any regenerated baseline, must end with the revoke after the `CREATE TABLE` statements. For B, that is `REVOKE ALL ON TABLE public.matches FROM anon, authenticated;`. Re-running the whole migration file is enough, because it is idempotent and runs its own self-check. For A, re-run A's migration, which does the `REVOKE` and then the column `GRANT`. For C, re-run the whole Option C migration, step 3 included, so that the target's own defaults are closed too. Then run V1 against the target. The static guard in section 6 covers paths 1 and 3, inside `supabase/migrations/`. It cannot see path 2, so every restore re-runs both migration files and then V1.

### Comparison

| | A: column grants | B: revoke on `matches` | C: revoke on all of `public` |
|---|---|---|---|
| Closes the 4 private columns (REST, filters, embeds, GraphQL) | yes | yes | yes |
| Public match columns readable as anon | yes, named columns only | no | no |
| `select=*` as anon | 42501 | 42501 | 42501 |
| Write privileges (`GRANT ALL`) on `matches` | removed | removed | removed on every table |
| A new `matches` column | closed | closed | closed |
| A new table or function | open (default privileges) | open (default privileges) | closed |
| Survives a dump restore or a re-dumped baseline without re-running the revoke | no | no | no |
| Extra allowlist to maintain | SQL column list | none | none |
| "Public read matches" policy | required | inert | all public-read policies inert |
| Closes `players` and `match_evolution_snapshots` | no | no | yes |
| Breaks anything in the repo | no | no | no (D-003 probe degrades) |
| Policies created or dropped | none | none | none |

## 4. Recommendation

**Apply Option B now, with the Option B migration.**

1. It closes reads of the four columns in every form: select, filter, sort, embed, GraphQL and Realtime.
2. It fails safe for new columns with nothing to maintain. Option A fails safe too, but it adds a second column allowlist in SQL that has to follow `PUBLIC_MATCH_FIELDS` by hand.
3. It removes nothing anyone uses (section 2). Option A would keep a read path that has no consumer.
4. It is a pure `REVOKE`. It creates no policy (AGENTS.md Never-Do: "Create Postgres RLS policies") and drops none. One `GRANT`, shipped as a forward migration, undoes it.
5. It matches the documented architecture: "All tables use the Supabase service role key (server-side only)" (`docs/poketools-spec.md:86`), and AGENTS.md:37 allows the browser anon key only for Realtime.

Choose Option A instead only if a maintainer knows of an out-of-repo consumer that reads public match columns with the anon key.

The Option B migration verifies its own result inside the transaction. It aborts if either API role can still reach `matches`, through PUBLIC, through role membership, or through a grant made by another grantor that a `REVOKE` run as postgres cannot remove. It also aborts if an API role can still read `matches` through an object that runs with its owner's rights: a view or materialized view over `matches` that the role can select, or a SECURITY DEFINER function or procedure that the role can execute and that reads `matches`. A function that does so is found by its `pg_depend` row (SQL-standard bodies) or by its definition text. Finally, it aborts if service_role lost access. These checks were run on a scratch PostgreSQL 13 cluster: on a clean fixture, and run twice to confirm it is idempotent, the migration commits. It aborts on an anon-readable view and materialized view, on a SECURITY DEFINER function granted to `authenticated` only, and on `GRANT service_role TO authenticated`. It ignores a trigger function, an invoker-rights function, a function that only calls `regexp_matches`, and a revoked view and function.

### More severe exposures found by the same audit (ranked)

These are outside this task, but they are worse than the match notes. Each deserves its own migration. Option C closes all of them at once.

1. **Critical: `match_evolution_snapshots` is open for reads and writes.** It is the only one of 67 tables created without `ENABLE ROW LEVEL SECURITY` (`20260727141225_match_evolution_snapshots.sql:9`; no later migration enables it), and the default privileges give anon `ALL` on it. anon can `GET`, `POST`, `PATCH` and `DELETE` it directly. `POST /rest/v1/rpc/epb_replace_match_snapshots {"p_match_id":"<any>","p_snapshots":[]}` wipes any match's snapshots: the function runs as the caller and starts with a `DELETE` (`20260728120000_epb_kilo_review_fixes.sql:6-67`). Historical match pages render from this table. The baseline contains `rls_auto_enable()` (baseline:639-668), the function behind Supabase's opt-in `ensure_rls` event trigger. If that trigger existed on live on 2026-07-27, live has RLS on and this is latent. Every environment built from the migrations (`supabase db reset`, preview branches, a rebuild) has it off. **Run V9 on live before anything else.** If live shows `relrowsecurity = false`, close it the same day. The smallest fix is `ALTER TABLE public.match_evolution_snapshots ENABLE ROW LEVEL SECURITY;`. The app is unaffected, because service_role bypasses RLS.
2. **High: private `players` columns are readable by anyone.** The setup is the same as `matches`: `"Public read players" USING (true)` (baseline:2985) and `GRANT ALL` to anon and authenticated (baseline:3504-3505). The readable columns are `discord_id`, `auth_user_id`, `is_admin`, `status`, `suspended_until`, `ban_reason` and `avatar_config` (baseline:1351-1371), plus `is_test_account`, `is_guest` and `world_experience` (later migrations). This contradicts the contract in `src/lib/players/public-player.ts:10-13`. It links Discord identities to Supabase Auth ids, lists every admin and publishes moderation reasons. Option B's pattern applied to `players` would close it, but Option C is the cleaner fix.
3. **Medium (root cause of 1): the default privileges hand every new object to the API roles.** `ALTER DEFAULT PRIVILEGES FOR ROLE postgres … GRANT ALL ON TABLES|FUNCTIONS|SEQUENCES TO anon, authenticated` (baseline:3612-3635). Every new table is anon-writable until its migration remembers RLS. Every new function can be executed by anon and, through the Postgres default, by PUBLIC. Several "service-role only" comments in migrations (for example `20260727150755_epb_recalculate_evolution_points.sql:80-81`) are not enforced.

Lower-ranked findings (Option C closes them too):

- The 31 blanket public-read policies expose semi-private data. Examples: `seasons.is_test_season` and the rows of test seasons; hidden `achievement_definitions` with their `criteria`; the moderation fields on approved `wiki_notes` (`approved_by`, `rejected_by`, `rejection_reason`, `moderation_flags`); `tournaments.enrollment_source`; `draft_pool_templates`; and the EPB internals in `evolution_tracker`.
- anon has EXECUTE on 24 SECURITY INVOKER functions. RLS bounds them, apart from the snapshot RPC. `epb_execute_redraft` and `epb_set_redraft_phase_open` take an advisory lock before they fail.
- `TRUNCATE`, `REFERENCES` and `TRIGGER` are granted on every table. They are not reachable today.
- `authenticated` has exactly anon's access, and anyone can sign up.

Secrets are already safe. `discord_webhooks`, `social_integrations`, `audit_log`, `cast_sessions.realtime_key`, `teams.share_token`, `agent_conversations` and the other service-role-only tables have RLS on and no anon policy.

### Decisions

| # | Decision | Outcome |
|---|---|---|
| D1 | Option B, or A | B |
| D2 | Drop the inert `"Public read matches"` policy | Kept. With B it has no effect. Dropping it would add a second layer (if a table-level grant came back, RLS would return no rows instead of every row), but under AGENTS.md a drop is one-way (restoring it means creating a policy), and the Advisor would raise lint 0008 (RLS enabled, no policy; INFO). All 31 blanket policies were kept with C as well |
| D3 | Option C as a follow-up migration | Yes. B is a strict subset of C, so B first and C later is safe |
| D4 | The snapshot RLS fix | Closed by Option C step 1. Check V9 on any project built some other way |
| D5 | The AGENTS.md wording changes in section 7 | Adopted in the Option C variants (7.8) |
| D7 | A schema dump taken before the revoke (it still grants `matches` to anon) | Not kept. Every restore re-runs both migration files (section 3, Dumps and restores) |

### Related: the Supabase platform change on 2026-10-30

Supabase changelog 45329: from 2026-10-30, tables created in `public` on existing projects are no longer granted automatically to `anon`, `authenticated` and `service_role` for the Data API. "Existing tables are not affected." This does not fix the leak, because `matches` keeps its grants. It does mean that after that date a new table needs explicit grants, **including to `service_role`**, or the app's own server client gets 42501 on it. Local stacks keep the baseline defaults, so local and live may then behave differently. Check V7 on live after 2026-10-30. Write new migrations with an explicit `GRANT ... TO service_role` and no grant to the API roles.

## 5. Rollout

### Pre-checks (read-only, dashboard SQL editor as postgres)

```sql
-- V1. Effective SELECT per column. Today (per migrations): all true, 18 rows.
SELECT a.attnum, a.attname,
  has_column_privilege('anon',          a.attrelid, a.attnum, 'SELECT') AS anon_sel,
  has_column_privilege('authenticated', a.attrelid, a.attnum, 'SELECT') AS auth_sel,
  has_column_privilege('service_role',  a.attrelid, a.attnum, 'SELECT') AS svc_sel
FROM pg_attribute a
WHERE a.attrelid = 'public.matches'::regclass AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY a.attnum;

-- V2. Table-level summary per role.
SELECT r.rolname, r.rolbypassrls,
  has_table_privilege(r.oid, 'public.matches'::regclass, 'SELECT')      AS tbl_select,
  has_any_column_privilege(r.oid, 'public.matches'::regclass, 'SELECT') AS any_col_select,
  has_table_privilege(r.oid, 'public.matches'::regclass, 'INSERT')      AS ins,
  has_table_privilege(r.oid, 'public.matches'::regclass, 'UPDATE')      AS upd,
  has_table_privilege(r.oid, 'public.matches'::regclass, 'DELETE')      AS del,
  has_table_privilege(r.oid, 'public.matches'::regclass, 'TRUNCATE')    AS trunc,
  has_table_privilege(r.oid, 'public.matches'::regclass, 'REFERENCES')  AS refs,
  has_table_privilege(r.oid, 'public.matches'::regclass, 'TRIGGER')     AS trig
FROM pg_roles r WHERE r.rolname IN ('anon', 'authenticated', 'service_role', 'postgres') ORDER BY 1;

-- V3. Raw ACL entries with grantor. A grantor other than postgres means the
--     REVOKE will not remove that entry (the Option B self-check then aborts).
SELECT 'table' AS level, NULL::name AS col,
       CASE x.grantee WHEN 0 THEN 'PUBLIC' ELSE x.grantee::regrole::text END AS grantee,
       x.grantor::regrole::text AS grantor, x.privilege_type, x.is_grantable
FROM pg_class c, LATERAL aclexplode(c.relacl) x WHERE c.oid = 'public.matches'::regclass
UNION ALL
SELECT 'column', a.attname,
       CASE x.grantee WHEN 0 THEN 'PUBLIC' ELSE x.grantee::regrole::text END,
       x.grantor::regrole::text, x.privilege_type, x.is_grantable
FROM pg_attribute a, LATERAL aclexplode(a.attacl) x
WHERE a.attrelid = 'public.matches'::regclass AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY 1, 2 NULLS FIRST, 3, 5;

-- V4. Same, from information_schema (complete only when run as the grantor).
SELECT grantee, grantor, privilege_type, is_grantable FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'matches' ORDER BY grantee, privilege_type;

-- V5. RLS and policies on matches.
SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public.matches'::regclass;
SELECT policyname, permissive, roles, cmd, qual, with_check FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'matches';

-- V6. Other read paths that a table REVOKE does not close. Run it before
--     AND after the change. Expected after: no row with anon_sel, auth_sel,
--     anon_exec or auth_exec true. The Option B self-check aborts on the same
--     conditions (its text match is narrower: functions in public or
--     graphql_public, or owned by postgres).
-- (a) Views and materialized views that read matches (rule dependencies
--     only). A view without security_invoker in reloptions reads as its owner.
SELECT DISTINCT v.oid::regclass AS dependent, v.relkind, v.reloptions,
  has_any_column_privilege('anon',          v.oid, 'SELECT') AS anon_sel,
  has_any_column_privilege('authenticated', v.oid, 'SELECT') AS auth_sel
FROM pg_depend d
JOIN pg_rewrite rw ON rw.oid = d.objid
JOIN pg_class v ON v.oid = rw.ev_class
WHERE d.classid = 'pg_rewrite'::regclass
  AND d.refclassid = 'pg_class'::regclass
  AND d.refobjid = 'public.matches'::regclass
  AND v.oid <> 'public.matches'::regclass
ORDER BY 1;
-- (b) SECURITY DEFINER functions and procedures that EITHER API role can
--     execute (anyone can sign up, so authenticated counts) and that read
--     matches. Found by pg_depend (a SQL-standard BEGIN ATOMIC / RETURN body
--     records the dependency and leaves prosrc empty) or by the text of the
--     full definition. Trigger functions cannot be called directly.
SELECT p.oid::regprocedure AS fn, pg_get_userbyid(p.proowner) AS owner,
  has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_exec,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
FROM pg_proc p
WHERE p.prosecdef
  AND p.prokind IN ('f', 'p')
  AND p.prorettype NOT IN ('trigger'::regtype, 'event_trigger'::regtype)
  AND (has_function_privilege('anon', p.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  AND (EXISTS (SELECT 1 FROM pg_depend d
               WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid
                 AND d.refclassid = 'pg_class'::regclass
                 AND d.refobjid = 'public.matches'::regclass)
       OR (CASE WHEN p.prokind IN ('f', 'p') THEN pg_get_functiondef(p.oid) END) ~* '\mmatches\M')
ORDER BY 1;
-- (c) The Realtime publication and pg_graphql.
SELECT pubname FROM pg_publication_tables WHERE schemaname = 'public' AND tablename = 'matches';
SELECT extname, extversion FROM pg_extension WHERE extname = 'pg_graphql';

-- V7. Default privileges in public (who gets new objects).
SELECT d.defaclrole::regrole AS creator, d.defaclobjtype AS objtype,
       CASE x.grantee WHEN 0 THEN 'PUBLIC' ELSE x.grantee::regrole::text END AS grantee,
       string_agg(x.privilege_type, ',' ORDER BY x.privilege_type) AS privs
FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace,
     LATERAL aclexplode(d.defaclacl) x
WHERE n.nspname = 'public' GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;

-- V8. Migration history (for the file-name reconciliation).
SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 15;

-- V9. The critical snapshot finding: is RLS on, and does ensure_rls exist?
SELECT relrowsecurity FROM pg_class WHERE oid = 'public.match_evolution_snapshots'::regclass;
SELECT evtname, evtevent, evtfoid::regproc, evtenabled FROM pg_event_trigger;

-- V10. Option C only: owner and ACL of every table and function in public.
--      Save this output together with V7. It is the snapshot that C's rollback
--      is rebuilt from.
SELECT c.oid::regclass, c.relkind, pg_get_userbyid(c.relowner) AS owner, c.relrowsecurity, c.relacl
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f') ORDER BY 1;
SELECT p.oid::regprocedure, pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proacl
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' ORDER BY 1;
```

Save the V3 output (and, for Option C, V7 and V10) before applying anything. A rollback is rebuilt from it.

HTTP probe before the change. Run it in your own shell, with your project's URL and anon key. With a new `sb_publishable_…` key, the `apikey` header alone is enough.

```bash
H=(-H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY")
curl -si "$SUPABASE_URL/rest/v1/matches?select=notes,submitter_id&limit=1" "${H[@]}"
# Today: 200 with data means the leak is live.
```

### Apply order

1. **Approve.** D1 is signed off (and D2–D7 as they come), and the Option B file goes into `supabase/migrations/` with a timestamp later than the newest file.
2. **Local stack first.**
   1. `supabase start`.
   2. Before adding the file, run `supabase db reset` and then the LIVE-LOCAL test from section 6. It must **fail** (the update and delete probes return no error, and `select=notes` returns data). That proves the test can see the leak.
   3. Add the file. Run `supabase db reset` again. The migration's self-check must pass.
   4. Run the LIVE-LOCAL test again. It must pass.
   5. Run `npm run test`, `npm run typecheck` and `npm run lint`.
   6. `supabase gen types typescript --local` must produce no change to `src/types/database.ts`, because privileges are not part of the generated types.
3. **Production (maintainer).**
   1. Run V1–V10 and the "before" probe, and save V3 (and V7 and V10) for a rollback.
   2. Confirm that `supabase migration list` (or `supabase db push --dry-run`) shows only the expected files as unapplied. CONTRIBUTING.md documents the rename hazard.
   3. Apply it with `supabase db push`, or through the SQL Editor. The SQL Editor records no history row, so a later `db push` would re-run the file. That is harmless, because the file is idempotent, but record the version or run `supabase migration repair`.
   4. Rename the local file to the version that `schema_migrations` recorded, if it differs.
4. **Post-checks** (below). Then smoke-test the app.
   - A public match page (`/tournaments/<id>/matches/<mid>`).
   - A tournament page and a league page.
   - `GET /api/matches/<id>`.
   - A match result submission and confirmation in a test season.
   - Cast Studio sync between two tabs (Realtime broadcast).

   All of these use the service role or broadcast, so all should be unchanged.

### Post-checks

> The expected counts are in the Status table at the top. V7 can also show that the defaults for creator `supabase_admin` still grant both API roles, which these migrations cannot change (Status, the `supabase_admin` caveat).

- **V1:** `anon_sel` and `auth_sel` are false on all 18 rows. `svc_sel` is true.
- **V2:** every column is false for `anon` and `authenticated`. `service_role` keeps `tbl_select`, `ins`, `upd` and `del`.
- **V3:** no row has `anon`, `authenticated` or `PUBLIC` as grantee.
- **V5:** RLS is still on. The policy is still listed (inert), unless D2 dropped it.
- **V6:** no view or function row has `anon_sel`, `auth_sel`, `anon_exec` or `auth_exec` true. The self-check already enforced this at apply time. Re-running it confirms nothing changed afterwards.

HTTP probes (your own shell). For each, expect `HTTP 401` with `"code":"42501"` (permission denied for table matches). A signed-in user token gets 403 with the same code. The embed probe writes PostgREST's `!` as `%21`. Inside double quotes, interactive bash (Git Bash included) and zsh treat `!` as history expansion. They print `event not found` and never run the command.

```bash
curl -si "$SUPABASE_URL/rest/v1/matches?select=notes,submitter_id&limit=1" "${H[@]}"
curl -si "$SUPABASE_URL/rest/v1/matches?select=*&limit=1" "${H[@]}"
curl -si "$SUPABASE_URL/rest/v1/matches?select=id&notes=ilike.*a*&limit=1" "${H[@]}"
curl -si "$SUPABASE_URL/rest/v1/matches?select=id,players%21matches_submitter_id_fkey(id)&limit=1" "${H[@]}"
curl -si "$SUPABASE_URL/rest/v1/matches?select=id,status&limit=1" "${H[@]}"   # Option A: 200; Option B: 401/42501
```

### Rollback

A rollback reopens the leak, so use it only if a real consumer breaks. Every rollback below follows the same rules:

- **Ship it as a forward migration**, for example `<ts2>_restore_api_role_match_grants.sql`. Apply it and reconcile its file name like any other migration. Never run it as ad-hoc SQL on live. A live-only GRANT leaves the repo still revoking. Every `supabase db reset` and preview branch would then differ from live, and the next dump-based baseline would quietly pick up the live GRANT.
- **In the same change**, remove or narrow the static guard (`migration-api-grants.test.ts`) and the AGENTS.md Never-Do bullet from 7.2. The rollback migration fails the guard, so `npm run test` and CI fail without this. The migration header says why the grant came back.
- **Restore the state before the change, not the baseline.** Build the GRANT list from the V3 output saved before the change (for C, V7 and V10). Live may differ from the baseline, and later migrations did change it.

Option B. Use the V3 snapshot. The line below is right only if V3 showed exactly the baseline ACL:

```sql
BEGIN;
GRANT ALL ON TABLE public.matches TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
```

Option A uses the same statement. It also replaces the column grants, because the table-level grant covers every column.

Option C reverses every step, including the defaults. Rebuild it from the V7 and V10 snapshots taken before the change. They record what the template below does not: the `supabase_admin` default privileges and the exact ACL of each function. Use the template only if the snapshots are unavailable. Without the snapshots, the template below restores the state the migrations describe, which is not the baseline dump. `20260608100003_advisor_fixes.sql:118-124` had already closed two SECURITY DEFINER functions, and the blanket function grant would reopen both. Anon could then call `rpc/check_and_record_admin_export`, which writes `admin_export_limits` as its owner for any `p_player_id`. If B shipped before C (D3), `matches` was closed too and has to stay closed. A scratch PostgreSQL 13 run confirmed both: the older template, without the three `REVOKE` lines, re-granted both functions and `matches` to the API roles. This one keeps them closed.

```sql
BEGIN;
GRANT ALL ON ALL TABLES    IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;
-- Closed before C (advisor_fixes.sql:118-124, Advisor lints 0028/0029): keep them closed.
REVOKE ALL ON FUNCTION public.check_and_record_admin_export(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
-- Closed before C when B shipped first: keep it closed.
REVOKE ALL ON TABLE public.matches FROM anon, authenticated;
-- Re-grant PUBLIC EXECUTE only if a function needs it; the baseline relied on the implicit default.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
-- Leave RLS on match_evolution_snapshots enabled.
NOTIFY pgrst, 'reload schema';
COMMIT;
```

## 6. Test plan

- **Unit tests:** unaffected. `npm run test` mocks the Supabase client and never reaches a database (AGENTS.md). The service-role client keeps every privilege it has.
- **Type check:** unaffected. No column changes, so `src/types/database.ts` does not change.
- **LIVE-LOCAL test** (new, opt-in, local stack only, never CI). It is modelled on `src/lib/supabase/queries/__tests__/postgrest-shapes.local.test.ts`. Path: `src/lib/supabase/__tests__/api-role-grants.local.test.ts` (implemented, see below). It signs up a throwaway user through local GoTrue to get the `authenticated` view an attacker would have, and it deletes that user and every seeded row afterwards. It passes `npm run typecheck` as written (checked against this branch).
- **Static guard** (new, runs in `npm run test`, no database). It replays `supabase/migrations/` in order and fails if an API role can reach `matches` after the last file. The fix can be silently undone in four ways, and the guard covers three of them, as long as they happen in the migration folder:
  1. An object grant on `matches` (table or column) or on every table in `public`.
  2. Role membership (`GRANT service_role TO authenticated`). The member inherits every table privilege of the granted role.
  3. A `CREATE TABLE` of `public.matches`, or a rename into it, with no revoke after it. This includes a squashed baseline that drops the revoke file.
  4. A restore from a dump outside the folder (`psql -f <dump>`), or a grant made in the dashboard. The guard cannot see these. Re-running both migration files after a restore (section 3) and V1 cover them.

  Its control cases prove the matcher reads pg_dump's quoted form and every reopen path above, so the check is never vacuous.

### LIVE-LOCAL test: `src/lib/supabase/__tests__/api-role-grants.local.test.ts`

Implemented as proposed, with the Option C cases built in. It has no `columns` mode, because Option A was not adopted. It is opt-in (`LOCAL_SUPABASE_GRANTS=1`), refuses any host but `127.0.0.1` or `localhost`, takes its keys from the command line only, never loads `.env` and never runs in CI. It signs up a throwaway user through local GoTrue (the `authenticated` view an attacker gets) and seeds a ruleset, two players (private sentinels in `discord_id` and `ban_reason`), a tournament, a round, a match carrying `PRIVATE_MATCH_SENTINELS`, and one `match_evolution_snapshots` row. Afterwards it deletes every seeded row and the user.

```bash
# Local keys: `supabase status -o env` (ANON_KEY, SERVICE_ROLE_KEY).
LOCAL_SUPABASE_GRANTS=1 NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
NEXT_PUBLIC_SUPABASE_ANON_KEY=<local anon> SUPABASE_SERVICE_ROLE_KEY=<local service_role> \
npx vitest run src/lib/supabase/__tests__/api-role-grants.local.test.ts
```

What each case proves, on a local replay of the migrations (both columns were observed on the isolated local stack, see Status):

| Case (as `anon` and as `authenticated`) | Before B and C | After B and C |
|---|---|---|
| service_role reads the full rows and calls an rpc (controls) | passes | passes |
| private match column, `select=*`, filter, sort, submitter embed | 200 with data: **fails** | 42501 |
| embed `tournaments → matches(id, notes)` | 200 with data: **fails** | 42501 (on `tournaments`) |
| match insert | 42501 (RLS) | 42501 |
| match update, delete | 204, no error, zero rows: **fails** | 42501 |
| the 14 public match columns | 200: **fails** | 42501 |
| `players`, private columns and `id, name` | 200 with data: **fails** | 42501 |
| `match_evolution_snapshots` select, insert, delete; `rpc/epb_replace_match_snapshots` | 200 with data (RLS off locally): **fails** | 42501 |
| `seasons`, `tournaments`, `rpc/get_total_games_in_scope` | 200: **fails** | 42501 |

anon gets HTTP 401 and `authenticated` HTTP 403, both with SQLSTATE 42501.

### Static guard: `src/lib/supabase/__tests__/migration-api-grants.test.ts`

Implemented, and extended to all of `public` as this section proposed for Option C. It runs in `npm run test` with no database. It splits each file in `supabase/migrations/` into statements with a small tokenizer: comments are dropped, strings and dollar-quoted bodies are blanked, and pg_dump's quoted names are read. It then replays them in order, tracking:

- for each table, view, sequence, function and procedure in `public`, which of `anon`, `authenticated` and `PUBLIC` can reach it;
- postgres's default privileges, both global and `IN SCHEMA public`. The replay starts from a fresh Supabase database: new tables, sequences and functions in `public` are open to both API roles, and every new function is open to PUBLIC;
- RLS on every table.

After the last file it asserts that nothing is reachable, that the defaults are closed, that every table has RLS, that `matches` is closed even without the Option C file, and that no migration makes an API role a member of another role.

Every reopen path it catches has a control case:

- An object grant: table, column, `ALL ... IN SCHEMA public`, PUBLIC, sequence, function or procedure.
- An `ALTER DEFAULT PRIVILEGES` grant, and every object created after it.
- An object created while the defaults are open, without the close-out after it. This includes a squashed baseline or any dump.
- A rename into a name, or `SET SCHEMA public`.
- `DISABLE ROW LEVEL SECURITY`, or a new table without `ENABLE`.
- Role membership.

Partial revokes (`REVOKE SELECT (notes)`, `REVOKE GRANT OPTION FOR`) close nothing. A per-schema revoke cannot remove the global PUBLIC EXECUTE default, just as in Postgres.

Some choices are deliberately conservative. `CREATE OR REPLACE` of an existing function or view adds the current defaults, because the guard cannot tell a new overload from a replacement; after Option C the defaults are closed, so this costs nothing. `DROP FUNCTION` is ignored, again because of overloads. The guard does not see restores outside the folder, dashboard grants, objects created by another role, or owner-rights views and SECURITY DEFINER functions. V1, V6, V7 and the two migrations' self-checks cover those.

It is not vacuous. Run against a copy of the folder without the Option C file, it fails four tests: 213 reachable object-and-role pairs, 7 open default privileges, and `match_evolution_snapshots` without RLS.

A squash is checked by the same replay. A new baseline (a dump) that does not end with the statements of both close-out files fails the test, because its `CREATE` statements run under the platform's open defaults. Whoever squashes carries both files' statements into the new baseline, after its `CREATE` statements (section 3, Dumps and restores). Unlike the B-only guard first proposed here, a later `CREATE TABLE IF NOT EXISTS public.matches` after Option C does not fail: by then postgres's defaults are closed, on local replays and on live alike.

## 7. Code and docs that would change

> **Applied** in the Option C variants (7.8), and worded for the applied state: AGENTS.md, `docs/security-patterns.md`, `docs/supabase.md`, `docs/match.md`, both mapper headers, the maintainers' deferred-work row D-003 and the post-restore step (re-run both migration files, D7).

`<ts>` is the migration's final timestamp. The wording below is for Option B. Section 7.8 gives the Option C variants.

### 7.1 `AGENTS.md`, Hard Rules, the "RLS enabled as defense-in-depth" bullet (line 38)

Current:

> - **RLS enabled as defense-in-depth** — all tables have RLS with permissive service role policies; the service role key bypasses RLS entirely, so auth guards in API routes remain the primary authorization layer. Public read tables have permissive SELECT policies; restricted tables (teams, credentials, cast sessions) are service-role-only. See `supabase/migrations/20260520000000_add_rls_policies.sql`.

The current text already says "all tables have RLS", and that is false: `match_evolution_snapshots` was created without it (section 4, finding 1), and Option B does not change that. The new text names the exception. Drop the exception clause in the same change that enables RLS on that table (D4). Option C enables it, so 7.8 keeps the unqualified wording.

New (the old path now lives in the pre-baseline migration history, maintainers only):

> - **RLS enabled as defense-in-depth** — every table except `match_evolution_snapshots` has RLS (that table was created without it; see `docs/security/anon-match-columns.md`, D4); the service role key bypasses RLS entirely, so auth guards in API routes remain the primary authorization layer. Many tables still carry a permissive public SELECT policy from the baseline, but a policy only filters rows: it exposes every column the role holds a privilege on. `anon` and `authenticated` hold no privilege on `public.matches` (`supabase/migrations/<ts>_revoke_anon_private_match_columns.sql`), so the browser anon key reads no match column. Restricted tables (teams, credentials, cast sessions) are service-role-only. Policies and grants: `supabase/migrations/20260608100000_baseline_professional_schema.sql`, `20260608100003_advisor_fixes.sql`, `<ts>_revoke_anon_private_match_columns.sql`.

### 7.2 `AGENTS.md`, Never Do, new bullet after "Create Postgres RLS policies"

> - Grant a privilege on `public.matches` (table or column) to `anon`, `authenticated` or `PUBLIC`, copy the baseline's `GRANT ALL ON TABLE ... TO "anon"` lines into a new migration, or make an API role a member of another role (`GRANT service_role TO authenticated`). Do not recreate `public.matches`, rename a table into it, restore a dump or regenerate the baseline without ending with `REVOKE ALL ON TABLE public.matches FROM anon, authenticated;`. A dump does not carry the revoke, and the new table picks up the default grants to the API roles. Any of these silently republishes the admin notes to anyone holding the anon key. `src/lib/supabase/__tests__/migration-api-grants.test.ts` fails on them inside `supabase/migrations/`. A restore outside that folder needs the post-restore step (section 3, Dumps and restores).

### 7.3 `AGENTS.md`, Never Do, a new sub-bullet under the full-match-rows bullet

> - The database draws the same line for direct callers: `anon` and `authenticated` hold no privilege on `public.matches`, so `/rest/v1/matches` serves nothing to the browser anon key. Read matches only through the service-role query modules.

### 7.4 `docs/security-patterns.md`, A05 Security Misconfiguration, new bullet

> - **API roles hold no table privileges on private data.** The anon key ships in the browser bundle, so anything `anon` or `authenticated` can read through PostgREST (`/rest/v1/*`) or pg_graphql is public, whatever the app renders. Anyone can sign up, so `authenticated` is no more trusted than `anon`. An RLS policy filters rows, not columns: `USING (true)` exposes every column the role is granted. `public.matches` grants nothing to either role (`supabase/migrations/<ts>_revoke_anon_private_match_columns.sql`). A new migration never grants to `anon`, `authenticated` or `PUBLIC`; the service-role client is the only reader. To hide some columns but keep others readable, revoke the table privilege and grant a column list: revoking single columns under a table-level grant does nothing. The Security Advisor does not catch this (lint 0024 skips `SELECT` policies); verify with `has_column_privilege` (`docs/security/anon-match-columns.md`, V1).

### 7.5 `docs/supabase.md`

Under "Realtime Client Exception", "Guardrails", append:

> The anon key it carries cannot read `matches` over REST: `anon` holds no privilege on that table.

Under "Current Schema Notes", new bullet:

> - `matches`: `anon` and `authenticated` hold no privilege (`<ts>_revoke_anon_private_match_columns.sql`). The baseline policy "Public read matches" remains but has no effect. Only the service-role client reads the table; `notes`, `submitter_id`, `auto_confirm_at` and `confirmed_at` are admin-only (see [Match Module](./match.md)).

### 7.6 `docs/match.md`, "Public Match Shape", new bullet after "Who gets full rows"

> - **Database boundary**: the same four columns are closed at the database for direct REST and GraphQL callers. `anon` and `authenticated` hold no privilege on `public.matches` (`supabase/migrations/<ts>_revoke_anon_private_match_columns.sql`), so the browser anon key reads no match column at all. The opt-in LIVE-LOCAL test `src/lib/supabase/__tests__/api-role-grants.local.test.ts` proves it on a local stack; `src/lib/supabase/__tests__/migration-api-grants.test.ts` fails if a migration reopens the table (a grant, role membership, or a recreated table without the revoke). A restored dump does not carry the revoke, so every restore re-runs it.

Under "Testing", append to the Test Files line:

> The database grants: `src/lib/supabase/__tests__/api-role-grants.local.test.ts` (LIVE-LOCAL, opt-in with `LOCAL_SUPABASE_GRANTS=1`) and `src/lib/supabase/__tests__/migration-api-grants.test.ts` (static, in CI).

### 7.7 `src/lib/match/public-match.ts`, header comment

Insert after the paragraph that ends "… receives `PublicMatch`.":

```ts
 * The database draws the same line for direct callers: `anon` and
 * `authenticated` hold no privilege on `public.matches`
 * (`supabase/migrations/<ts>_revoke_anon_private_match_columns.sql`), so the
 * anon key in the browser bundle cannot read any match column over REST or
 * GraphQL. Only the service-role client reads the table, and this mapper is
 * the boundary for everything it returns. Classifying a new column here does
 * not grant it to anyone in the database.
```

### 7.8 If Option C is adopted instead of, or after, B

- AGENTS.md:38: replace "every table except `match_evolution_snapshots` has RLS (…)" with "all tables have RLS", because C step 1 enables it. Replace "`anon` and `authenticated` hold no privilege on `public.matches` (`…`), so the browser anon key reads no match column" with "`anon` and `authenticated` hold no privilege on any table, sequence or function in `public`, now or created later (`supabase/migrations/<ts>_close_public_api_roles.sql`), so the public SELECT policies left from the baseline have no effect and the browser anon key reads nothing from `public`. Every table has RLS on; a new table's migration enables it."
- The AGENTS.md Never-Do bullet in 7.2 becomes: "Grant any privilege in schema `public` to `anon`, `authenticated` or `PUBLIC` (table, column, sequence, function or default privilege), or create a table without `ENABLE ROW LEVEL SECURITY`."
- `docs/supabase.md`: the `wiki_notes` line ("public RLS reads are limited to `approved = true`") becomes "`wiki_notes` is read only through service-role API routes; its baseline policy (`approved = true`) has no effect, because `anon` holds no privilege."
- The maintainers' deferred-work row D-003 (closed): its probe would get 42501 instead of data. Leave it closed. If it is re-run, read 42501 as "table reachable, privileges closed".
- `src/lib/players/public-player.ts` header: the same paragraph as 7.7, about `public.players`.

### Not changed

- `docs/poketools-spec.md:86` already says service-role only.
- AGENTS.md:37 (Realtime-only browser exception) already matches.
- `openwiki/` is a hand-maintained summary and does not restate these rules.
- No application code or query module changes under any option.

## 8. Sources

- PostgreSQL REVOKE (table vs column privileges; a table revoke also revokes column privileges): https://www.postgresql.org/docs/current/sql-revoke.html
- PostgreSQL GRANT: https://www.postgresql.org/docs/current/sql-grant.html
- PostgreSQL privileges: https://www.postgresql.org/docs/current/ddl-priv.html
- PostgreSQL ALTER DEFAULT PRIVILEGES (the global PUBLIC EXECUTE default): https://www.postgresql.org/docs/current/sql-alterdefaultprivileges.html
- PostgreSQL row security (TRUNCATE and REFERENCES are not subject to RLS): https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- PostgREST errors (42501 is 403 when authenticated, else 401): https://github.com/PostgREST/postgrest/blob/main/docs/references/errors.rst
- Supabase column-level security (revoke then grant columns; no `*`): https://supabase.com/docs/guides/database/postgres/column-level-security
- Supabase event triggers (`ensure_rls`): https://supabase.com/docs/guides/database/postgres/event-triggers
- Supabase changelog 45329 (Data API grants from 2026-10-30): https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically
- Supabase Realtime authorization (public broadcast needs no table access): https://supabase.com/docs/guides/realtime/authorization
- Splinter lint 0024 (`rls_policy_always_true` flags only UPDATE, DELETE, ALL): https://github.com/supabase/splinter/blob/main/lints/0024_rls_policy_always_true.sql

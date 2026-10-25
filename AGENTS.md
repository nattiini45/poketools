# PokéTools — AGENTS.md

> Canonical agent instructions for this repository. `CLAUDE.md` is a thin Claude Code wrapper around this file. You implement what is specified — do not invent new patterns, rename components, or deviate from the spec or explicit task instructions without flagging it first.

## Read Order

1. Read this file first.
2. Read the nested `AGENTS.md` when touching `src/app/`, `src/components/`, or `src/lib/`.
3. Read `docs/poketools-spec.md` for every schema, route, component, or data flow touched by the task.
4. Use `docs/modules-index.md` only as a router to the specific module docs needed for the files you are editing.

Do not recursively open every linked markdown by default. Load only the docs required for the current task.

## Project Snapshot

- **App:** competitive Pokémon league and tournament manager (self-hosted, one deployment per community)
- **Stack:** Next.js 16 App Router, React 19, TypeScript (strict), Tailwind CSS 3, NextAuth v5 (Discord OAuth), Supabase/Postgres, Vercel
- **Canonical product spec:** `docs/poketools-spec.md`

## Operating Rules

1. Implement steps in order. Do not start Step N+1 until Step N builds cleanly.
2. When uncertain, stop and ask. An explicit question beats an undocumented assumption.
3. Follow existing patterns. Before writing a new API route, read an existing one (e.g. `src/app/api/players/route.ts`). Before writing a query module, read an existing one (e.g. `src/lib/supabase/queries/players.ts`).
4. If a dependency needs installing, flag it instead of installing it.
5. Prefer targeted doc reads over blanket doc loading.
6. When external review or CI findings arrive, follow `docs/review-remediation.md`.
7. If explicit task instructions conflict with the spec or current codebase, pause and escalate instead of guessing.

## Hard Rules

Non-negotiable. Violations must be caught and corrected immediately.

- **Supabase is the sole writer** — all writes go through API routes, never the dashboard. Client: `src/lib/supabase/client.ts`. Queries: `src/lib/supabase/queries/*.ts` (one module per table or domain; `ls` the folder for the current list).
- **Service role key stays server-side** — `SUPABASE_SERVICE_ROLE_KEY` must NEVER reach the client. Client components fetch from API routes only.
- **Browser Supabase exception is Realtime-only** — `NEXT_PUBLIC_SUPABASE_ANON_KEY` is allowed in the browser only through `src/lib/supabase/realtime-client.ts` and `src/lib/broadcast/channel.ts` for Cast Studio broadcast channels. Do not use browser Supabase for table reads or writes. On the server it is read only by the stateless GoTrue client `src/lib/supabase/auth-client.ts` (email/password sign-in) through the env schema in `src/lib/env.ts`.
- **RLS enabled as defense-in-depth** — all tables have RLS; the service role key bypasses RLS entirely, so auth guards in API routes remain the primary authorization layer. `anon` and `authenticated` hold no privilege on any table, sequence or function in `public`, now or created later by `postgres` (`supabase/migrations/20261008081443_close_public_api_roles.sql`; `public.matches` was closed first by `20261008081402_revoke_anon_private_match_columns.sql`; both applied in production 2026-10-08), so the public SELECT policies left from the baseline have no effect and the browser anon key reads nothing from `public`. Exception: postgres cannot change `supabase_admin`'s default privileges, and on a hosted project they still grant ALL to both API roles, so an object created from the dashboard (as `supabase_admin`) is open from the start. After creating one that way, run checks V7 and V10 from `docs/security/anon-match-columns.md` and revoke whatever the API roles received in a migration. A policy only filters rows: it exposes every column the role holds a privilege on. A new table's migration enables RLS on it and grants it to `service_role` explicitly (Supabase stops doing that automatically from 2026-10-30). Restricted tables (teams, credentials, cast sessions) are service-role-only. Policies and grants: `supabase/migrations/20260608100000_baseline_professional_schema.sql`, `20260608100003_advisor_fixes.sql` and the two files above; background, the live post-checks and the read-only checks: `docs/security/anon-match-columns.md`.
- **Pre-compute aggregates** — stats pages read `aggregates` by default. Never scan `battle_stats` at read time for usage, standings, or move stats. Targeted server-side reads of `battle_stats` are allowed only when aggregate tables lack the required granularity (kill rankings, scouting, match detail). Every write to `games` / `battle_stats` enqueues an aggregate job (`enqueueAggregateJob`), applied atomically with the game's `aggregate_applied_at` marker by `apply_aggregate_job`; admin edits, deletes and resets roll a counted game back through `rollback_game_aggregates` (deltas from `buildGameAggregateDeltas`).
- **Explicit match state transitions** — validated through `src/lib/tournament/match-state.ts`. Legal transitions: spec Section 8. No direct status overwrites.
- **TypeScript strict, no `any`** — row types in `src/types/database.ts`, domain types in per-entity files.
- **Schema changes require type regen** — update `src/types/database.ts` after any Supabase schema change. Migrations: `supabase/migrations/`.
- **AI stays server-side** — server SDK wrappers live in `src/lib/ai/`.
- **Server components by default** — `'use client'` only when interactivity is required.
- **All API errors use `safeErrorResponse()`** — from `src/lib/api/error-response.ts`; it logs server-side and returns safe fallback messages to clients.
- **No error generalization, suppression, or masking** — distinct failure causes stay distinguishable in the response and the server logs; see Security Requirements rule 5 and `docs/security-patterns.md`.
- **Automation never spends the Supabase quota** — hosted Supabase egress and query volume are metered and billed, and a loop multiplies a per-load cost thousands of times. This covers capture harnesses, Playwright/e2e runs, preview loops and subagents: none of them fetch from Supabase Storage or query the live project.
  - Dev servers run with the local asset mirror: `--require ./.claude/local-assets.cjs` sets `NEXT_PUBLIC_WORLD_ASSETS_URL=/models/world` and `NEXT_PUBLIC_SPRITES_URL=/sprites` (the broadcast sprite renders). Every `next dev`/`next start` config in `.claude/launch.json` carries it; a new config must too. For `next start` the base is baked in at build time: build with `NEXT_PUBLIC_WORLD_ASSETS_URL=/models/world` (the maintainers' production-capture arming script refuses a build that baked another base); the preload refuses to serve a build that baked the world-assets or the sprites bucket.
  - Route worlds are captured from `/route-preview` fixtures, not live league pages.
  - Every capture sidecar must show `assetOrigin.sources.bucket === 0`. `scripts/capture-route.mjs` enforces it: the `next dev` it boots gets `NEXT_PUBLIC_WORLD_ASSETS_URL=/models/world`, and a load that made any bucket request fails the run (exit 1). `--allow-bucket` lifts the guard for a deliberate production check only.
  - Query cost is measured against a local stack (`supabase start`), never against the project. `SUPABASE_METER=1` (ignored in production) meters every request of the server client (`src/lib/supabase/metering.ts`); `node scripts/data/meter-report.mjs <log>` summarises the dev log.
  - `npm run test` never reaches a real database. Unit tests mock the Supabase client. A test that needs a real DB is opt-in behind its own env flag (`AGENT_MEMORY_LIVE_DB=1`, `AGENT_TOOLS_LIVE_DB=1`), never runs in CI, loads `.env` only when opted in, and runs against a local stack. Never write a test that loads `.env` unconditionally.
    - The draft RPC parity suite (`DRAFT_RPC_LIVE_DB=1`, local stack only) replays `src/lib/draft/__tests__/fixtures/queue-vectors.json` against the league's list fixture. It is maintainer-only and lives in the private companion overlay (`docs/format-packs.md`), not in a public checkout.
  - World assets are published only with a maintainer's explicit approval. `scripts/world-assets/upload-supabase.mjs` is a dry run unless `--live`, and every `--live` run is bound to a dry run's plan (`--expect-plan`; flow in `scripts/world-assets/README.md`). Published assets carry content-hashed names and a one-year cache; the manifest (`manifest.v3.json`) keeps a stable name, is uploaded last with `max-age=0`, and is fetched with `cache: 'no-cache'`. No object named `manifest.json` is ever written: that name belongs to the v2 manifest that older builds read. Never overwrite a hashed object or hand-upload a file: republish the set.
  - Why: a capture run loads several MB of world assets per cold page load, so a capture loop served from the bucket multiplies into Storage egress that can use up a hosted plan's allowance within days.
- **Avatar images are served as thumbnails** (D37). Every original in the `avatars` bucket gets a 256 px WebP (≤ 30 KB) next to it at `<original>.thumb.webp`, and `players.avatar_url` points at that thumbnail; `ai_avatar_gallery.image_url` keeps the original.
  - New objects get immutable names (a UUID, or `<playerId>.<sha256-16>.<ext>`) with `cacheControl: '31536000'`. Never overwrite an object in place: the one-year cache would serve the stale image. The same rule covers match social images in the `social-images` bucket: every upload is a new `matches/<matchId>/<uuid>.png` (`upsert: false`), the replaced object is kept so old shared links keep working, and a stored URL becomes a removable path only through `socialImagePathFromUrl` (`src/app/api/matches/[id]/social-image/storage-path.ts`, a whitelist of that match's own paths).
  - Naming lives in `src/lib/avatar/thumbnail-path.ts` (client-safe); writing lives in `src/lib/avatar/thumbnail.ts` (server, sharp).
  - The backfill is the admin-only `POST /api/admin/avatars/thumbnails`, a dry run unless the body says `"dryRun": false`. Agents never run it live: a maintainer confirms the live run.
  - A stored avatar URL becomes a Storage path only through `avatarStoragePathFromUrl(url, supabasePublicOrigin())`, and only paths that pass `isAvatarOriginalPath` (a strict UUID-name whitelist) are thumbnailed or removed (see Never Do). A Showdown avatar is stored only as the canonical URL that `parseShowdownTrainerSpriteUrl` (`src/lib/avatar/showdown-sprite.ts`) returns.
  - Server-side renderers must not hand an avatar URL to satori (`next/og`): it cannot decode WebP and drops the image. Fetch the avatar and pass a PNG data URI instead (`avatarPngDataUri` in `src/lib/discord/match-card-image.tsx`).
- **Live draft screens poll through `useVisiblePoll`** (`src/lib/draft/use-visible-poll.ts`, D37). Never a bare `setInterval`: an open draft tab used to cost about 66 queries every few seconds. Exception (maintainer decision, 2026-10): the pick screen's turn watch polls `GET /api/drafts/[id]/my-turn` every 60 s even while the tab is hidden; it is one guard read + one RPC, and it runs only while a draft-room tab is open. No other endpoint polls while hidden.
  - Cadence: 3 s while the draft is live and the tab visible; paused while `document.hidden`, with one refetch on return; at least 60 s (DraftBoard) or stopped (arena) once the pool is `complete`; stopped on 401/403. Ticks chain with `setTimeout`, so requests never overlap.
  - One request per tick: EPB boards read trackers from `GET /api/drafts/[id]/state?include=trackers`, never from per-player `/api/evolutions/trackers` calls.
  - Complete-pool token math reads one ledger per season (`loadDraftTokenLedger` + `computeRemainingPointsFromLedger` / `hasAllocatedDraftTokensFromLedger` in `src/lib/draft/progress-engine.ts`), never the per-participant functions in a loop. The budget test `src/app/api/drafts/[id]/state/__tests__/query-budget.test.ts` holds a 12-player completed pool to ≤ 12 queries.
  - A write from a draft screen (pick, undo, status change, draft-token allocation) calls the poller's `refresh()`, so it shows at once; a complete pool would otherwise wait for its 60 s tick. Token screens (`src/components/draft-tokens/TokenCenter.tsx`) replace their state with the fresh overview that every purchase or spend returns.
- **Authorize writes with the live `require*` guards, never with the session copy** (D37). The session JWT re-reads its player at most every 5 minutes (`SESSION_PLAYER_TTL_MS` in `src/auth.ts`), or at once on a forced refresh (`useSession().update({})`, trigger `'update'`).
  - `getSession()`, `getSessionPlayer()`, `isAdmin()`, `isAnyAdmin()` and `isCreator()` read that copy, which can be up to 5 minutes stale. Use them for display only (names, avatars, which buttons to show). `getSession()` is wrapped in React `cache()`, so one render runs `auth()` once.
  - Gate a VIEW on roles with `getLiveAccess()` (or `getLiveSessionPlayer()`), never with the token checks: `AdminGuard`, `CreatorGuard`, the admin layout and any page that renders admin-only data such as full `players` rows. It makes the same decision as the matching guard from one narrow live read, memoised per render (layout, page and guards share it), returns false instead of throwing, and rethrows a failed read (fail closed).
  - Every guard in `src/lib/auth/helpers.ts` (`requireAuth` included) re-reads status and roles with one narrow select and decides from that row. A ban, suspension or role revocation therefore applies on the next guarded call. A failed read throws (fail closed).
  - The session read selects explicit columns (`SESSION_PLAYER_COLUMNS` in `src/lib/supabase/queries/players.ts`, with the `resource_admins` count embedded). Never add identity or moderation columns to it. Never copy `refreshedAt`, or data a client sends with `update()`, into the session.
  - `SessionProvider` does not refetch on focus. A visible, signed-in tab forces a refresh every 4 minutes (`SESSION_KEEP_FRESH_INTERVAL_MS`, one minute inside the TTL; tabs share one localStorage stamp, so several tabs still cost one read per interval). Server-side `auth()` cannot rewrite the cookie, so that refresh is what keeps the token from falling due; a due token makes every server render and API call re-read the player. The root layout reads only the language cookies, through `getLocale()` / `getDataLocale()` / `getTimeZone()` in `src/i18n/server.ts` (React `cache()`), and the sprite-style cookie through `getSpriteStylePreference()` (`src/lib/pkmn/sprite-style.server.ts`, docs/pkmn.md "Sprite styles"); every route is therefore dynamic by design (i18n D6). Never read the session there.
  - **`update()` without an argument is a GET and re-reads nothing inside the TTL.** Force a refresh with `update({})`, or better `useRefreshSessionPlayer()` from `src/components/shared/SessionProvider.tsx` (retries while another update is in flight, never throws).
  - A client flow that edits the signed-in player's own name, usernames or avatar awaits `useRefreshSessionPlayer()()` after the write succeeds, before it navigates or calls `router.refresh()`. A hard navigation alone does not re-read the player inside the TTL, so the dashboard and the NavBar would keep the old value for up to 5 minutes. For an avatar, that old URL's Storage object is already deleted.
- **Public pages read narrow shapes, once per render** (D36 fixes 4, 6, 11).
  - The league page resolves its world from the season row BEFORE any branch read. The route-world branch reads the season, stages and public participants once, then hands them to `buildWorldRouteData(id, { league, stages, participants })`: one wave of at most eight reads (the eighth, the rounds of the Swiss stages for their scoring byes, only in a non-EPB league with a Swiss stage). The anonymous DEFAULT render (no `?tab=`, or `?tab=standings`) reads none of the ruleset, aggregates, game total or battle_stats: the default league-hub tab (season standings) renders from that payload. A selected league-hub tab adds only its own reads, in the same wave: insights the aggregate counters, game total and battle_stats; rules the live ruleset; the other tabs their phases' rounds, participants, battle stats or reports through the phase pages' `publicReads` entries, and groups through `publicReads.tournamentGroups` (a league-page entry) plus each Swiss stage's rounds. Per-tab budgets: `src/app/(public)/leagues/[id]/__tests__/hub-tab-budget.test.ts`. `src/lib/league-hub/load.ts` (`loadLeagueHubPanel`) owns these per-tab reads. The DefaultWorld fallback still reads the ruleset, aggregates, game total and battle_stats. The budget test `src/app/(public)/leagues/[id]/__tests__/page-query-budget.test.ts` holds an anonymous view to 11 queries or fewer (EPB 11, other formats 10, 11 with a Swiss stage).
  - Usage tables read `getAggregatesSummary` (no `move_counts`). Only a view that shows move usage calls `getAggregates`.
  - `TournamentBattleStat` carries no `moves_used`, `turns_active`, `match_won` or row `id`. Match detail and scouting read full rows through their own getters.
  - Read a league's stage matches with one `getMatchesByTournamentIds` (it pages past `max_rows` with `.range()`), never one `getMatchesByTournament` per stage. Compute several standings tables from one `SeasonStandingsContext` (`src/lib/tournament/season-standings.ts`: format, evolution points and, for Evolution Point Buy, the stored tiebreaker order), never one `computeStandingsForSeason` per table in a loop. An Evolution Point Buy table ranks by `effectiveTiebreakerChain` and scores `effectiveMatchPoints` (`src/lib/tournament/standings-rules.ts`); never read `epbPack.tiebreakerChain` or hard-code round robin points to rank or score one.
  - List and detail selects count child rows with `child ( count )` embeds instead of fetching child id arrays.
  - `getSeasonWithDetails`, `getSeasonById` and `getPublicSeasonParticipants` are wrapped in React `cache()`. They return shared objects, so never mutate their results.
  - Matches reach public pages, public cache entries and public responses as `PublicMatch` (`src/lib/match/public-match.ts`): `MatchWithPlayers` without `notes`, `submitter_id`, `auto_confirm_at` and `confirmed_at`. `assembleLeagueSchedule` maps the fixtures (so `LeagueFixture.match` is `PublicMatch`) and `assembleWorldRouteData` maps them again; `publicReads.tournamentMatches` maps inside its cache callback; the creator `/content` page, `GET /api/matches/[id]` and `GET /api/tournaments/[id]/rounds/[rid]` map before they hand rows out; `GET /api/matches/head-to-head` serves the pair-scoped `publicReads.tournamentHeadToHead` (only that pair's matches, never the whole tournament), which maps inside its cache callback. The match detail page renders the admin notes only behind `getLiveAccess()`.
- **Public pages read through the tagged read cache** (`publicReads` in `src/lib/cache/public-reads.ts`, D36 fix 5, D37). The query budgets above are cold-cache budgets; a warm render issues only the viewer-scoped reads.
  - `unstable_cache` (this app has no `cacheComponents`): 60 s for lists, 30 s for one league, tournament or player. A cached read takes ids and limits only: never the session, cookies or headers. Viewer-scoped reads (session, world preference, wiki notes) stay live in the page.
  - A cached result holds players in a public shape only. A read whose query returns full `players` rows maps them field by field with the allowlist mappers of `src/lib/players/public-player.ts` inside the cache callback, before the value is stored: the profile's player becomes the `PublicPlayer` card (`toPublicPlayer`), tournament participants `PublicTournamentParticipant`. Never spread a row into a cached value: no entry may hold `ban_reason`, `suspended_until`, `status`, `is_admin`, `is_test_account`, `avatar_config`, `discord_id` or `auth_user_id`. `src/lib/cache/__tests__/public-reads.test.ts` checks the stored entries.
  - Every cached read carries a tag from `publicTags` (`src/lib/revalidation.ts`). Write paths revalidate through `revalidateMatchPages` or `revalidatePublicPath`, which call `revalidateTag(tag, { expire: 0 })` next to each `revalidatePath`. Never add a bare `revalidatePath` to `revalidation.ts` or `aggregate-rebuild.ts`.
  - A write that expires no tag is NOT bounded by the TTL: once an entry is past its TTL, `unstable_cache` serves it once more, whatever its age, and refreshes it in the background, so after an idle spell the first viewer still sees the pre-write data. Every write players must see on the next view (pairings, brackets, rounds, tournament or season status, phases, participants, seeds, format rules, draft picks, redraft drops and picks, evolution progress) therefore expires its tags right after the write commits: tournament and league-stage writes call `expireTournamentReads(id, seasonId)`, league writes `expireSeasonReads(id, stageIds)`, draft writes `expireDraftReads(seasonId)`. A new write handler under `/api/tournaments/[id]`, `/api/seasons` or `/api/drafts/[id]` calls one of them, or joins the `EXEMPT` list of `src/lib/__tests__/write-route-tags.test.ts` with its reason. That walk, `src/lib/__tests__/revalidation-tags.test.ts` and `src/lib/cache/__tests__/public-reads.test.ts` enforce this. A route test that runs such a handler mocks `next/cache` or the helper (outside a Next request `revalidateTag` throws) and asserts the expiry.
  - Cached values come back from JSON: no `Map`, `Set` or `Date` in a cached result, and never mutate one.
  - Keep `force-dynamic` on `/leagues` and `/tournaments`: without it `next build` prerenders them against Supabase, and CI builds with a placeholder URL.
- **Reads stay complete under `max_rows`** (D36 fixes 9, 10). PostgREST caps every response at 1000 rows and truncates silently.
  - Page a list with `.range()` plus `{ count: 'exact' }`, and count rows with `{ count: 'exact', head: true }` (`listReplayLibraryPage`, `getAggregateJobStats`). A read that truly needs every row pages in `.range()` chunks up to the exact count (`listReplayLibraryRows`).
  - A read that needs every row and may pass 1,000 rows uses `readBoundedPages` (`src/lib/supabase/read-bounded-pages.ts`: a stable total order ending in a unique column, 1,000-row `.range()` pages, a short page ends the read, a hard bound that warns) or `readAllPages` (`src/lib/supabase/read-all-pages.ts`: no bound, one extra empty request on a short page). `src/lib/supabase/queries/__tests__/no-oversized-limit.test.ts` fails on `.limit(N)` above 1,000 in `src/lib/supabase/queries`.
  - An AI route serves its cached or in-flight result before `checkAndRecordAiGeneration`, so only a generation that actually starts spends a daily slot.
  - The `process-aggregates` cron runs every 10 minutes (D37). It is the safety net for jobs `after()` missed.
- **Text goes through `src/i18n`** (English default, German; module doc `docs/i18n.md`).
  - No hard-coded user-facing literals in `src/app`, `src/components` or user-facing `src/lib`. Each string lives in a namespace under `src/i18n/messages/<ns>/{en,de,index}.ts` and renders through `useT(ns)` (client) or `getT(ns)` (server). Dates and numbers go through `useFormatter()` / `<LocalTime>`; never `toLocale*String()` without a locale or a hard-coded `'en-US'` / `'de-DE'`.
  - `en` messages are the source; `de` must type-check against them (`defineDe`), so a missing key or a renamed placeholder fails `tsc`. German copy follows the style guide and glossary in `docs/i18n.md` (casual *du*).
  - Cached reads never hold localized text. `t()`, `getT`, `getFormatter`, `getLocale`, `Intl` formatting and Pokémon-name localization never run inside a `cachedRead` / `unstable_cache` callback; cached values hold DB data and English engine strings only and are translated after the read; no cache key includes a locale. Precomputing both locales into a cached value (`station-digest.ts`) is the only sanctioned exception. `src/i18n/__tests__/cache-boundary.test.ts` enforces this.
  - Servers return the English `error` plus a `code` (and `params`) from an `src/i18n/messages/errors/*` catalog; clients render it with `useApiErrorText(...)`. Never change an existing English `error` text: route tests assert it.
  - Viewerless text (Discord, social images and posts, stored AI reports, overlays without `?lang=`) uses the league's language through `resolveContentLocale()` (`seasons.language`, default `'de'`), never the viewer's cookie.
  - `node scripts/check-i18n-strings.mjs --paths "<your files>"` lists new literals and locale hazards; a deliberate exception carries `// i18n-ignore: <reason>` on the line above. CI runs it with `ENFORCE=1 … --all`, so a new literal fails the build.
  - Rule prose that is league tuning lives in the format pack's `messages` and is spliced into its namespace; the example pack's English tree is the contract (`definePackEn`). See `docs/format-packs.md`.

## Security Requirements

Apply to every line of code you write. Violations are blocking. Full OWASP catalog and code patterns: `docs/security-patterns.md`.

### Every API Route Must

1. **Guard protected endpoints** — call the correct auth helper as the first operation:
   ```typescript
   const player = await requirePlayer();  // or requireAdmin(), requireCreator(), etc.
   ```
   Public routes must have a comment: `// Public: no auth required`
2. **Validate all input** — required fields and types; enums against `VALID_*` whitelists; string length limits; numeric ranges; regex for structured strings (URLs, IDs).
3. **Use `safeErrorResponse()`** for all catch blocks (import from `src/lib/api/error-response.ts`); never `console.error(err); return NextResponse.json(...)`.
4. **Never leak internals** — error responses use static fallback messages, not `err.message` or stack traces. Applies to *unexpected* errors only — rule 5 covers the opposite failure mode.
5. **Never generalize, suppress, or mask errors** — distinct failure causes must remain distinguishable (specific safe message, or a distinct `code` per cause) in the response and the server logs; any branch that returns an error response without `safeErrorResponse()` must `console.error` the original error first; domain errors whose messages are user-facing by design extend `UserFacingError` from `src/lib/api/user-facing-error.ts` instead of hardcoded generic replacement strings in routes. CI enforces this: `ENFORCE=1 node scripts/check-safe-error-response.mjs` fails the build on any raw `NextResponse` return inside a route catch block that doesn't `console.error` the caught error first (escape hatch: `// safe-error-response-allow: <reason>` on the preceding line).
6. **Verify resource ownership** — check that the authenticated user owns/has access to the resource they're modifying.

### Never Do

- Import `@supabase/supabase-js` or the service role client in client components. The only browser Supabase path is `src/lib/supabase/realtime-client.ts` for Cast Studio Realtime broadcasts.
- Use `eval()`, `Function()`, `new Function()`, or `child_process.exec()`
- Use `dangerouslySetInnerHTML` with user-controlled content
- Build SQL strings via concatenation
- Log secrets, tokens, or API keys
- Create Postgres RLS policies
- Grant any privilege in schema `public` to `anon`, `authenticated` or `PUBLIC` (table, column, sequence, function or default privilege), make an API role a member of another role (`GRANT service_role TO authenticated`), or create a table without `ENABLE ROW LEVEL SECURITY`. Never copy the baseline's `GRANT ALL ON ... TO "anon"` lines into a new migration. A restored dump, or a regenerated or squashed baseline, must end by re-running `supabase/migrations/20261008081402_revoke_anon_private_match_columns.sql` and `20261008081443_close_public_api_roles.sql`: a dump carries no REVOKE, and every object it creates picks up the default grants to the API roles. Any of these silently republishes the admin match notes, the private `players` columns or writable tables to anyone holding the anon key. `src/lib/supabase/__tests__/migration-api-grants.test.ts` fails on them inside `supabase/migrations/`; a restore outside that folder must end by re-running both migration files, then V1 (`docs/security/anon-match-columns.md`, 'Dumps and restores').
- Expose service role key to the browser
- Turn a stored or user-supplied URL into a Storage object path without checking both its origin (the project's `NEXT_PUBLIC_SUPABASE_URL`) and a strict path whitelist. The service-role storage client concatenates the path unencoded, and fetch resolves `../`, so a decoded `..%2F` reaches other buckets.
- Pass raw `players` rows, or types built on them such as `SeasonParticipant` or `ParticipantWithSeed`, from a server component into a `'use client'` component, or out of an API route to anyone but the player themself or an admin. `discord_id`, `auth_user_id`, `ban_reason`, `suspended_until`, `status`, `avatar_config` and the admin/test flags would be serialized into the page or the response. Map on the server with a mapper from `src/lib/players/public-player.ts`; its header lists each shape and who may receive it (`PublicPlayer` is the profile card allowlist). The mappers copy fields one by one, never a spread with a few keys removed, so a new `players` column cannot leak through them.
  - Public pages read participants with `getPublicSeasonParticipants`, which never selects the private columns. `getSeasonParticipants` and `getParticipants` return full rows for server-internal use.
  - A public participant route returns the roster admin shape only when `canViewAdminRoster` (`src/lib/players/roster-access.ts`, decided by the live `requireResourceAdmin`) says so. Self and admin checks use the live player a `require*` guard returns.
  - Every route that returns player data has a test that runs `expectNoPrivatePlayerData` (`src/lib/players/__tests__/private-player-fields.ts`) on the serialized response.
- Pass full match rows (`Match`, `MatchWithPlayers`) from a server component into a `'use client'` component, store them in a public read-cache entry, or return them from a public API route. `notes` (the admin notes / dispute log), `submitter_id`, `auto_confirm_at` and `confirmed_at` would be published. Map on the server with `toPublicMatch` / `toPublicMatches` from `src/lib/match/public-match.ts`; its header lists who may receive full rows (admins, resource admins, the match's own participants). The mapper copies fields one by one, and a compile-time check makes every new `matches` column fail until it is classified public or private.
  - A test of a public match payload runs `expectNoPrivateMatchData` (`src/lib/match/__tests__/private-match-fields.ts`) on the serialized value.
  - The database draws the same line for direct callers: `anon` and `authenticated` hold no privilege on `public.matches` (or anywhere else in `public`; `20261008081402` and `20261008081443`), so `/rest/v1/matches` answers the browser anon key with 401 / 42501. Read matches only through the service-role query modules.
- `await` Discord webhook fires — use `void emitDiscordEvent(...)`; notification failures must not break the write path.

## Pokémon Data Rules

- Use `new Generations(Dex)` from `@pkmn/data` + `@pkmn/dex`. Not `Dex.forFormat()`.
- Replay parsing: `@pkmn/protocol` + `@pkmn/client`. NOT `@pkmn/logs` (doesn't exist).
- Keep static format defaults in `src/lib/pkmn/formats.ts`.
- Never hardcode Pokémon names, moves, types, or stat data — always query `@pkmn/data`.
  - Exception: league configuration ids are authored `@pkmn` ids validated against `@pkmn/dex` by a server test; display names still come from `src/lib/pkmn/i18n`. They are the format pack's `epb.utility`, `epb.workbook.utilitySheet` and `epb.reconciliation` id tables (the workbook tables map the sheet's spellings onto `@pkmn` names/ids; validated by `src/lib/format-pack/__tests__/pack-pkmn.server.test.ts`), and the immunity-ability table in `src/lib/draft-finder/ability-defense.ts`.
- Display names of species, moves, items, abilities, types, natures and stats come from `src/lib/pkmn/i18n` (`localize*`, `<PkmnName>`) with the viewer's data locale; the stored, imported, exported and computed values stay English `@pkmn` names/ids.
- Never import `@pkmn/dex` in client components — it is 2MB+; use `/api/pkmn/*` routes.
- Gotcha-prone dependency notes: `docs/dependencies.md`.

## Component Decision Tree

- Needs interactivity, local form state, event handlers, or effects? → `'use client'`
- Only displays props or server-fetched data? → Server component
- Needs auth session? → Server component with `getServerSession()`, or pass session-derived data as props

## Key File Locations

| What | Where |
|------|-------|
| Auth helpers | `src/lib/auth/helpers.ts` |
| Auth configuration | `src/auth.ts` |
| Supabase client (service role) | `src/lib/supabase/client.ts` |
| Supabase request meter (dev only, `SUPABASE_METER=1`) | `src/lib/supabase/metering.ts`, report: `scripts/data/meter-report.mjs` |
| World-asset publish (dry run unless `--live`) | `scripts/world-assets/upload-supabase.mjs`, `scripts/world-assets/publish-set.mjs` |
| Pokémon sprite styles (every sprite URL; viewer preference) / broadcast-render mirror and publish (download only with `--download`, upload dry run unless `--live`) | `src/lib/pkmn/sprite-styles.ts` / `scripts/sprites/mirror-broadcast.mjs`, `scripts/sprites/upload-supabase.mjs` |
| Supabase query modules | `src/lib/supabase/queries/` |
| Public player shapes and mappers (client and public-response boundary) | `src/lib/players/public-player.ts` |
| Public match shape and mapper (client, public-cache and public-response boundary) | `src/lib/match/public-match.ts` |
| Public read cache (tags and write-side helpers `expireTournamentReads` / `expireSeasonReads` / `expireDraftReads`: `src/lib/revalidation.ts`) | `src/lib/cache/public-reads.ts` |
| API error response helper | `src/lib/api/error-response.ts` |
| User-facing domain error base class | `src/lib/api/user-facing-error.ts` |
| Pagination parsing helper | `src/lib/api/pagination.ts` |
| Match state transitions | `src/lib/tournament/match-state.ts` |
| Live draft poller (visibility-aware) | `src/lib/draft/use-visible-poll.ts` |
| Aggregate updater | `src/lib/match/aggregation.ts` |
| Pokémon format metadata | `src/lib/pkmn/formats.ts` |
| Pokémon validation | `src/lib/pkmn/validation.ts` |
| AI wrapper | `src/lib/ai/client.ts` |
| Avatar rate limiter | `src/lib/avatar/rate-limit.ts` |
| Avatar thumbnails (naming / writer) | `src/lib/avatar/thumbnail-path.ts` / `src/lib/avatar/thumbnail.ts` |
| AI rate limiter | `src/lib/ai/rate-limit.ts` |
| Request rate limiter (Postgres `rate_limit_hit` on Vercel, in-process elsewhere: `RATE_LIMIT_STORE`; auth-route keys in `src/lib/auth/rate-limits.ts`) | `src/lib/utils/rate-limit.ts` |
| Server env schema (`readEnv`, `requireEnv`) | `src/lib/env.ts` |
| Match finalize steps and heal policy (`matches.finalized_at`) | `src/lib/match/finalize.ts` |
| Draft pool completability (twin of `draft__pool_completable`) | `src/lib/draft/completability.ts` |
| Draft clock and quiet hours (TS mirror of the SQL clock) | `src/lib/draft/time.ts` |
| Backups, restore drill, migration lock safety | `docs/operations-backup.md` |
| Social credential encryption | `src/lib/social/encryption.ts` |
| Database types | `src/types/database.ts` |
| API response types | `src/types/api.ts` |
| Env var template | `.env.example` |
| SQL migrations | `supabase/migrations/` |
| Safe-error CI guard | `scripts/check-safe-error-response.mjs` |
| i18n server helpers (`getLocale`, `getDataLocale`, `getT`, `getFormatter`) | `src/i18n/server.ts` |
| i18n client provider and hooks (`I18nProvider`, `useT`, `useFormatter`) | `src/i18n/client.tsx` |
| i18n message namespaces (`<ns>/{en,de,index}.ts`) | `src/i18n/messages/` |
| Language switch (sets the language cookies) | `src/app/api/locale/route.ts` |
| Pokémon display names (DE/EN) | `src/lib/pkmn/i18n/` |
| Hard-coded string check (i18n) | `scripts/check-i18n-strings.mjs`, allowlist `scripts/i18n-allowlist.json` |
| Security headers | `next.config.mjs` |
| Format pack contract and accessors (import only `@/lib/format-pack`) | `src/lib/format-pack/` |
| Example format pack (public; contract owner of the pack messages) | `src/format-packs/example/` |
| Format packs: `@format-pack` alias, `FORMAT_PACK`, writing a pack | `docs/format-packs.md` |

## AI Debug Route

- **Local:** `npm run dev` logs to the same stdout as the `next dev` banner; focused tests run via `npx vitest run <path>` and print to stdout (no log capture configured).
- **Tags:** API errors log with `[API]` through `safeErrorResponse()`; AI routes log `[ai/*]` tags; Supabase query modules rethrow query errors (`if (error) throw error`) and the route's `safeErrorResponse()` logs them (a few modules also log a `[<query-name>] Query error:` line first); `src/lib/logger.ts` emits JSON logs for AI/Kale paths (`KALE_DEBUG=true` enables truncated request/response body logging).
- **Deployed:** Vercel runtime logs (cron routes in `vercel.json`; Function 5xx alerts per the README's Deployment notes). AI token usage goes to Braintrust.
- **Known gap:** no request/correlation id exists — do not assume one when diagnosing.
- Logging policy: `docs/security-patterns.md` (A10 — Logging & Monitoring).

## Branching

- Follow branch instructions in the task; if a task defines a required branch name, use that exact name. If a task depends on an unmerged branch, branch from that branch rather than from `main`. Do not merge your own pull request unless the task explicitly asks you to.
- Typical loop: implement → `npm run build` → stage specific files → commit `feat: <description>` → push only when the task says to.

## Before Marking Work Complete

Applies to every change — `src/`, `scripts/`, config, tooling, and docs-adjacent code alike.

1. `npm run build` passes with zero errors
2. `npm run lint` passes with zero errors and zero new warnings (`npm run lint` covers `src/` and the tracked `scripts/` — lint root files such as `next.config.mjs` with `npx eslint <file>`)
3. `npm run test` passes without regressions
4. No `any` types introduced
5. All protected API routes use correct auth guards
6. All API route catch blocks use `safeErrorResponse()`; no error branch generalizes, suppresses, or masks the underlying error
7. All request bodies validated (types, lengths, enums)
8. No service role secrets exposed client-side
9. No `dangerouslySetInnerHTML` with user content
10. Component names match spec Section 12
11. New env vars added to `.env.example`
12. Kale remains soft-deprecated and disabled by default; do not remove it in cleanup tasks
13. Teambuilder routes use v3 `TeamsEditor` via `TeambuilderClient`; do not reintroduce V1/V2 workspaces — see `docs/deprecations.md` and `docs/teambuilder-editor.md`
14. Discord webhooks fire-and-forget; visibility/auth logic lives in API routes, never in components
15. Changes are on the branch the task specified and ready for review or merge as instructed
16. After the final edit, run `npm run typecheck` and `npm run test:changed` (or the focused test for the changed area); the result must postdate the last edit, and the commit or PR must state which check covered the change

## Escalate When

- A database schema change is needed
- A migration implies type regeneration or broader schema coordination
- A new data flow is required that is not in the spec or task instructions
- A library API does not match what the spec expects
- An architectural decision is needed (new shared pattern or utility)
- The spec conflicts with the existing code
- A new file seems necessary but is not covered by the spec or task instructions
- You encounter a security concern not covered by the patterns above

## Coordination

- **Claude Code** owns: architecture, schema decisions, ambiguity resolution, security review, `CLAUDE.md`.
- **Codex** owns: implementation within the approved spec and explicit task instructions.
- `docs/poketools-spec.md` is the single source of truth when behavior is in question.
- When agents disagree, the spec wins. When the spec is silent, escalate to the human.

## Deeper Context (load on demand)

- Security patterns (OWASP, error-handling, input validation): `docs/security-patterns.md`
- Dependency gotchas: `docs/dependencies.md`
- Internationalization (DE/EN), German style guide and glossary: `docs/i18n.md`
- League tuning (format packs, the private overlay): `docs/format-packs.md`
- External review / CI remediation loop: `docs/review-remediation.md`
- OpenWiki (hand-maintained repo wiki): start at `openwiki/quickstart.md`; it summarises the canonical docs, so when it disagrees with `AGENTS.md` or `docs/poketools-spec.md` those win — update the wiki page in the same change.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

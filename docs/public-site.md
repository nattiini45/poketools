# Public Site / Homepage

> Covers the `(public)` App Router route group — the no-login browse experience
> and the homepage that surfaces it. Source of truth for routes:
> [`poketools-spec.md`](./poketools-spec.md) §5.

## Overview

The `(public)` route group is the unauthenticated face of PokéTools. It renders
under `src/app/(public)/layout.tsx`, which wraps every child page in `<NavBar />`
plus a `<PageTransitionWrapper>`. No route in this group requires Discord login
to view, though several (wiki notes, full player profiles) gate *parts* of their
content behind `requirePlayer()`-protected API calls.

The **homepage** (`src/app/(public)/page.tsx`) is the primary entry surface: it
shows a hero with a Discord sign-in CTA, mounts the AI Agent chat widget,
surfaces one "featured" active event (league preferred over tournament) with a
top-3 standings preview, and links out to Insights, Wiki, recent tournaments,
and recent leagues.

## File Structure

```
src/app/(public)/
├── layout.tsx                 # NavBar + <main> chrome (no auth)
├── page.tsx                   # Homepage (this module's focus)
├── tournaments/
│   ├── page.tsx               # Tournament list
│   ├── [id]/page.tsx          # Bracket view + match list
│   ├── [id]/matches/[mid]/page.tsx   # Match detail
│   ├── [id]/stats/page.tsx    # 308 → /insights?scope=tournament&id=
│   └── [id]/matches/[mid]/page.tsx
├── leagues/
│   ├── page.tsx               # League list
│   ├── [id]/page.tsx          # League page — renders the resolved world (see worlds.md)
│   ├── [id]/teams/page.tsx            # All registered teams (post-reveal)
│   ├── [id]/teams/[pid]/page.tsx      # Per-player team page
│   ├── [id]/stats/page.tsx    # 308 → /insights?scope=league&id=
│   └── [id]/draft/page.tsx
├── insights/page.tsx          # Stats + rankings hub (see insights.md)
├── leaderboard/page.tsx       # 308 → /insights?tab=ratings
├── replays/page.tsx           # Spoiler-free replay library (see replays.md)
├── wiki/                      # Encyclopedia (see wiki.md)
├── pokemon/[name]/page.tsx    # Canonical species page
└── players/
    ├── page.tsx               # Public directory
    └── [id]/page.tsx          # Public sections for guests; full when logged in
```

## Homepage (`src/app/(public)/page.tsx`)

### Caching & rendering
- `export const dynamic = 'force-dynamic'`: rendered per request, because it
  reads the viewer's session. There is no page-level `revalidate` (it had one;
  `force-dynamic` overrode it).
- The lists and the featured standings come from the public read cache
  (60 s, see [Public read cache](#public-read-cache)), so a warm render issues
  no Supabase query; only the session read remains.

### Data flow

The homepage runs three reads in parallel up front:

```typescript
const [tournaments, leagues, sessionPlayer] = await Promise.all([
  publicReads.tournamentList(), // cached listTournaments (tag `tournaments`, 60 s)
  publicReads.seasonList(),     // cached listSeasons (tag `seasons`, 60 s; leagues = seasons)
  getSessionPlayer(),           // src/lib/auth/helpers — live, null when anonymous
]);
```

Then it computes the **featured card**:

1. Pick the first `status === 'active'` league; fall back to the first
   `status === 'active'` tournament; otherwise render the empty-state message.
2. For the featured entity, call
   `publicReads.standingsPreview(type, id, 3)` (cached `getStandingsPreview`,
   tags `season:<id>` or `tournament:<id>` plus `players`) → top-3 standings
   rows for the card.

> **`getStandingsPreview` dependency** (in
> [`src/lib/stats/standings-preview.ts`](../src/lib/stats/standings-preview.ts)):
> builds standings from **completed match records** via
> `buildStandingsRowsFromMatchRecords`. Per `CLAUDE.md`'s "pre-compute
> aggregates" rule, standings are derived from match records at read time only
> for this small top-N preview; high-cardinality usage/standings reads go through
> the pre-computed aggregates path (see [Insights](./insights.md)).
>
> An Evolution Point Buy league (or one of its phases) ranks the preview by its stored
> tiebreaker order and evolution points, like its tables (`loadEpbStandingsContext`: two more
> reads, only for such a league). The preview carries no battle stats, so a kill difference step
> ties there, as in the season table. Other leagues keep the generic wins ranking.

### Featured card anatomy

| Element | Source | Notes |
|---|---|---|
| Title / participant count | `featured.item.{name,participant_count}` | League preferred over tournament |
| "View live" button | `/leagues/[id]` or `/tournaments/[id]` | Depends on `featured.type` |
| "Open insights" button | `/insights?scope={league\|tournament}&id=[id]` | Same scope model as `/insights` |
| Top-3 standings | `getStandingsPreview(...)` | Hidden when empty |

### Agent chat widget

```tsx
<AgentChatWidget isAuthenticated={isAuthenticated} />
```

- **Client island** (`src/components/agent/AgentChatWidget.tsx`, `'use client'`).
- Visible to everyone; **send is gated behind login** — anonymous visitors see a
  Discord-login prompt via `<DiscordLoginButton />`.
- Streams responses from `/api/ai/agent/chat` via `streamAgentText`
  (`src/lib/ai/agent/client-stream.ts`).
- Branded as "Professor Linden" — the same persona wired through
  [`runAgent()`](./ai-agent.md). Cross-link: [AI Agent → surfaces](./ai-agent.md).

### Outbound links

The homepage advertises the four core public destinations:

| CTA | URL | Module |
|---|---|---|
| Browse tournaments | `/tournaments` | [Tournament](./tournament.md) |
| Browse leagues | `/leagues` | (seasons — see Supabase queries) |
| Insights | `/insights?tab=ratings` | [Insights](./insights.md) |
| Wiki | `/wiki` | [Wiki](./wiki.md) |

Plus the recent-tournaments / recent-leagues grids (`.slice(0, 3)` of each list).

## Dependencies

### Internal modules
- **Auth** — `getSessionPlayer()` to derive `isAuthenticated`.
- **Public read cache** — `publicReads` from `src/lib/cache/public-reads.ts`
  (wraps `listTournaments`, `listSeasons`, `getStandingsPreview`).
- **Stats** — `getStandingsPreview` (homepage + dashboard mini-standings).
- **AI Agent** — `<AgentChatWidget>` mount point.
- **Insights / Wiki / Tournament / Match** — destinations of outbound links.

### Components
- `ui/{PageContainer, Card, Badge, Button}` ([Design](./design.md))
- `shared/DiscordLoginButton` ([Auth](./auth.md))
- `agent/AgentChatWidget` ([AI Agent](./ai-agent.md))

## Related Modules

- [AI Agent](./ai-agent.md) — backs the homepage chat widget.
- [Insights](./insights.md) — linked from the featured card and homepage CTAs.
- [Wiki](./wiki.md) — homepage CTA + shares the `(public)` layout.
- [Replays](./replays.md) — newer public surface, same layout group.
- [Tournament](./tournament.md) / [Match](./match.md) — provide the lists and
  standings the homepage surfaces.
- [Auth](./auth.md) — drives the `isAuthenticated` prop.

## Public read cache

D36 fix 5, freshness policy D37. Every public data read of the pages below goes
through `publicReads` in [`src/lib/cache/public-reads.ts`](../src/lib/cache/public-reads.ts),
which wraps the query modules in the Next data cache.

### Mechanism

- **`unstable_cache`**, because `next.config.mjs` does not enable
  `cacheComponents` (so `'use cache'` and `cacheTag` are unavailable). It works
  in `force-dynamic` pages: `force-dynamic` only stops the *page* from being
  cached, not the data cache.
- **Data is cached, never a page that reads the session.** A cached read takes
  ids and limits only, never the session, cookies or headers. Its key is the
  read's name plus those arguments, so one entry serves every visitor.
  Viewer-scoped reads (session, world preference, wiki notes)
  stay live in the page.
- **Public shapes only.** A read whose query returns full `players` rows maps
  them field by field (the allowlist mappers of
  [`src/lib/players/public-player.ts`](../src/lib/players/public-player.ts))
  before the value is stored: tournament participants to
  `{ id, name, avatar_url, seed, starting_bracket }`, the profile's player to
  the `PublicPlayer` card (`{ id, name, avatar_url, ps_username,
  champions_username, joined_date, is_creator, is_guest }`), streak rows to a
  name and an avatar. No entry holds a moderation, role or identity column
  (`ban_reason`, `suspended_until`, `status`, `is_admin`, `is_test_account`,
  `avatar_config`, `discord_id`, `auth_user_id`);
  `src/lib/cache/__tests__/public-reads.test.ts` checks the stored entries.
- **JSON values.** A hit is `JSON.parse`d, so every cached value is plain data
  (a `Map`-returning query is flattened in the wrapper). Results are shared:
  never mutate them.
- Each getter is also wrapped in React `cache()`, so one render looks an entry
  up once.

### TTL

| Data | TTL |
|---|---|
| Lists: season and tournament lists, player directory, rating and streak leaderboards, all-time aggregates, catalogues, home standings preview | 60 s |
| One league, tournament or player: rows, stages, participants, matches, records, battle stats, league- and tournament-scope aggregates, world payload, schedule, profile | 30 s |

The TTL is Next's `revalidate`. Once an entry is older than its TTL, the next
read gets the cached value **once more**, whatever its age, and refreshes it in
the background. So a write that expires no tag (see below) shows within one TTL
on a busy page, but after an idle spell the first viewer still gets the
pre-write data, and only the second view shows the write. That is why every
write players must see on the next view expires its tags.

### Tags and invalidation

The tag builders are `publicTags` in [`src/lib/revalidation.ts`](../src/lib/revalidation.ts).
They live there so that API routes do not import the read cache.

| Tag | Carried by |
|---|---|
| `seasons` / `tournaments` | the season / tournament lists |
| `season:<id>` | every read about one league: row, stages, participants, gym bands, trackers, format rules, evolution points, battle stats, match records, world payload, schedule |
| `tournament:<id>` | every read about one tournament or league stage: row, rounds, matches, participants, records, battle stats, reports, groups |
| `aggregates:<scope>:<id>`, `aggregates:all_time` | aggregate counters and game totals of a scope (species page, insights, stats tabs) |
| `ratings` | rating and streak leaderboards, player directory, rating history, profiles |
| `players` | every read that embeds player names or avatars |
| `player:<id>`, `player-profiles` | one profile / every profile |
| `achievements`, `team-roles`, `meta-usage`, `point-buy-list:<id>` | catalogues, expired by their own write routes (below) |

Every `revalidatePath` in `revalidateMatchPages` and in
`src/lib/match/aggregate-rebuild.ts` goes through a helper that also calls
`revalidateTag` for the path's tags (`tagsForPath`), with `{ expire: 0 }`.
The next read is then a blocking miss, so a match result, game edit, reset or
aggregate rebuild shows on the next view. (`'max'` would serve the old entry
once more, and `updateTag` works in Server Actions only.) A match write also
expires `player-profiles`.

- `src/lib/__tests__/revalidation-tags.test.ts` walks both modules. It fails on
  a bare `revalidatePath` or on a revalidated path that maps to no tag and is
  not listed as uncached.
- `src/lib/cache/__tests__/public-reads.test.ts` proves that a match write
  expires every cached read except the four catalogues.

**Tournament, league and draft write routes.** These revalidate no path, so
they expire their tags themselves, right after the write commits, through the
helpers in `src/lib/revalidation.ts`:

| Helper | Expires | Called by |
|---|---|---|
| `expireTournamentReads(id, seasonId)` | `tournament:<id>`, `tournaments`, `player-profiles`; for a league stage also `season:<seasonId>`, `seasons` | `POST /api/tournaments`; `PATCH`/`DELETE /api/tournaments/[id]`; `generate-bracket`, `generate-all-rounds`, `regenerate-bracket`, `repair-bracket`; `POST /api/generate-round/[tid]`; `rounds/manual`, `PATCH rounds/[rid]`; the participant add, remove and seed writes. The phase routes under `/api/seasons/[id]/phases/[phaseId]/**` (phase edit and delete, groups, group members, phase participants, seed by rating, standings sync) pass the phase and its league. |
| `expireSeasonReads(id, stageIds)` | `season:<id>`, `seasons`, `tournaments`, `player-profiles`, plus `tournament:<stageId>` for each phase the write touched | `POST /api/seasons`; `PATCH`/`DELETE /api/seasons/[id]`; `advance`; phase create and reorder; roster add, remove and edit; `substitute` (not on a dry run); cores and core assignment; `format-rules`; `progress`; `evolution-points/recalculate` |
| `expireDraftReads(seasonId)` | `season:<seasonId>` only (a live draft writes every few seconds) | `POST /api/drafts/[id]/picks`, `undo`, `PATCH`/`DELETE /api/drafts/[id]`; draft and kill token allocation; the redraft phase toggle |

`src/lib/__tests__/write-route-tags.test.ts` walks every write handler under
`/api/tournaments/[id]`, `/api/seasons` and `/api/drafts/[id]` (plus
`POST /api/tournaments` and `POST /api/generate-round/[tid]`) and fails on one
that calls no expiry helper. Its exemptions, each with a reason: the draft
replay-event log and the retired endpoints that answer 410 (token routes and
`POST /api/seasons/[id]/redraft`, whose free swap and trades are retired). Where a write route has a unit test, its success path asserts the
expired tags.

The avatar routes expire their tags too: `POST`/`DELETE
/api/players/[id]/avatar` expire `players` and `player:<id>` next to their
`revalidatePath` calls, and a live thumbnail backfill (`POST
/api/admin/avatars/thumbnails`, `scope: 'players'`) expires `players`.
`PATCH`/`DELETE /api/players/[id]` (names, usernames) expire `players` and
`player:<id>`.

The catalogue writes expire their tag right after the write commits:
`achievements` (the admin achievement routes), `team-roles` (`POST
/api/team-roles`, the team-roles import), `meta-usage` (the usage-stats
imports and the `refresh-usage-stats` cron) and `point-buy-list:<id>` (the
list entries route and the point-buy import). Cached reads that embed a
catalogue carry its tag too (the player profile embeds achievements).

**Writes that expire no tag.** Their effect is bounded by the TTL, and after an
idle spell they show on the second view:

- the CLI catalogue imports (`scripts/import-point-buy.ts`,
  `scripts/import-team-roles.ts`), which run outside the Next runtime where no
  tag can be expired;
- team submissions and edits (`/api/teams/**`, `/api/import-team`), which
  change the lead species on the league world's team walls (`season:<id>`);
- evolution-tier configuration (`/api/evolutions/**`), which no cached read
  includes today.

**Not cached (read live):** rulesets (their routes revalidate
`/admin/rulesets` only), `/players` searches (the key space is whatever a
visitor types), wiki notes, and everything viewer-scoped. Draft, draft-room,
replays, live match and signed-in pages are outside this cache.

### Page rendering

| Page | Rendering | Why |
|---|---|---|
| `/` | `force-dynamic` | reads the session |
| `/leagues`, `/tournaments` | `force-dynamic` | They read no session, but without it `next build` would prerender them and query Supabase at build time; CI builds against a placeholder URL. |
| `/players` | dynamic (reads `searchParams`) | no session; `force-dynamic` removed |
| `/insights` | dynamic (reads `searchParams`) | no session; `force-dynamic` removed |
| `/tournaments/[id]` | dynamic (dynamic segment, `searchParams`) | no session; `force-dynamic` removed |
| `/leagues/[id]/matchup` | dynamic (dynamic segment) | no session |
| `/leagues/[id]`, `/players/[id]`, `/pokemon/[name]` | `force-dynamic` | read the session |

Every page still renders per request; the saving is in Supabase reads.

- With the meter on (`SUPABASE_METER=1`, local stack), a second anonymous
  render of `/leagues` within the TTL shows no Supabase request.
- `src/app/(public)/__tests__/list-pages-read-cache.test.ts` holds that for the
  list pages, and `src/app/(public)/leagues/[id]/__tests__/page-query-budget.test.ts`
  for `/leagues/[id]`.
- In `next dev` the data cache is on too; a hard reload (`Cache-Control:
  no-cache`) bypasses it. Under `next start`, entries persist in
  `.next/cache/fetch-cache` until they expire.

## Notes

- The featured-card rule (league-over-tournament) is intentional — leagues are
  the higher-engagement long-running entity.
- Do **not** add new Supabase reads to the homepage without considering the
  `Promise.all` blast radius; it's the most-visited page. A new public read
  goes through `publicReads`, with a tag that some write path expires.
- `participant_count` is precomputed on the `seasons` / `tournaments` rows; do
  not derive it from `matches` at read time.
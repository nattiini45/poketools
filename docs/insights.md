# Insights

> Unified stats + rankings hub at `/insights`. `/leaderboard` 308-redirects here.
> Scope model also reused by [Wiki](./wiki.md) and [Teambuilder](./teambuilder-editor.md).
> Route contract: [`poketools-spec.md`](./poketools-spec.md) §5.

## Overview

Insights is the single public surface for cross-cutting stats: ratings,
usage, kill rankings, head-to-head, move usage, and streak leaderboards. It
replaces the older standalone `/leaderboard` page (which now redirects to
`/insights?tab=ratings`) and the per-entity `/stats` pages (which redirect to
`/insights?scope=…&id=…`).

A single page renders every scope via a URL-driven scope selector and a tabbed
content area, so a visitor can compare global meta usage against a single
tournament without changing pages.

## File Structure

```
src/lib/insights/
├── scope.ts                       # InsightsScope type, parsing, helpers
└── __tests__/
    └── scope.test.ts

src/app/(public)/insights/page.tsx # Server component — Suspense-wrapped

src/components/
├── shared/ScopeSelector.tsx       # global | league | tournament dropdown
└── insights/InsightsTabs.tsx      # Client tabbed content (ratings/usage/...)
```

## Scope Model — `src/lib/insights/scope.ts`

```typescript
export type InsightsScope =
  | { type: 'global' }
  | { type: 'league'; id: string }
  | { type: 'tournament'; id: string };

export type InsightsTab =
  | 'ratings' | 'usage' | 'moves' | 'kills' | 'h2h' | 'streaks';
```

### Core functions
- **`parseScopeFromSearchParams(input)`** — reads `scope` (default `global`) +
  `id`, returns a typed `InsightsScope`. Accepts `URLSearchParams` or the
  Next.js searchParams record (handles `string | string[]`).
- **`parseInsightsTab(value)`** — validates against `VALID_TABS`, defaults to
  `usage`.
- **`scopeToQueryString(scope)`** — inverse of parse; used by `ScopeSelector`.
- **`scopeAggregateKey(scope)`** — maps to `{ scopeType: AggregateScope,
  scopeId: string | null }` for aggregate queries (`all_time | league |
  tournament`).
- **`scopeLabel(scope)`** — short label ("Global" / "League" / "Tournament").

## Data Flow

```
/insights?scope=…&id=…&tab=…
  └─ page.tsx (Suspense-wrapped InsightsPageContent)
      ├─ parseScopeFromSearchParams + parseInsightsTab
      └─ Promise.all:
          ├─ listSeasons(), listTournaments()   → ScopeSelector options
          ├─ getLeaderboardEntries(5)           → ratings tab (always global top-5)
          ├─ loadScopeData(scope)               → scoped stats (see below)
          └─ getStreakLeaderboard()             → streaks tab
      └─ <ScopeSelector> + <InsightsTabs>
```

### `loadScopeData(scope)`
- Always: `getAggregates(scopeType, scopeId)` + `getTotalGamesInScope(...)` →
  `aggregatesToUsageRows(...)` for the usage tab.
- **Global fallback**: if no scoped aggregates exist, falls back to
  `getUsageByFormat(DEFAULT_GLOBAL_META_FORMAT, …)` → `metaUsageToUsageRows`
  (Smogon meta-usage import — see [Smogon](./smogon.md)).
- **Tournament scope**: `getTournamentWithDetails`, `getParticipants`,
  `getCompletedMatchRecords`, `getBattleStatsForTournament` → standings +
  kill ranking.
- **League scope**: `getSeasonWithDetails`, `getSeasonParticipants`,
  `getBattleStatsForSeason`, plus batched `getCompletedMatchRecordsBatch`
  across the season's tournaments → standings + kill ranking.

> Per `CLAUDE.md`'s "pre-compute aggregates" rule: the **usage** tab reads
> pre-computed `aggregates`; the **standings / kills** tabs read completed match
> records + `battle_stats` because they need player/match granularity that
> aggregates don't carry.

## Tabs

| Tab | Scope availability | Source |
|---|---|---|
| `usage` | all scopes | pre-computed aggregates (global fallback: meta-usage) |
| `moves` | scoped (league/tournament) | derived from battle_stats |
| `kills` | scoped | `buildKillRanking(battleStats)` |
| `h2h` | tournament scope (and the tournament page's insights section) | `HeadToHeadMatrix` → `GET /api/matches/head-to-head` (see below) |
| `ratings` | **global only** (`globalOnly` prop on `<ScopeSelector>`) | `getLeaderboardEntries` |
| `streaks` | all scopes | `getStreakLeaderboard()` |

### Head-to-head (`h2h`)

`HeadToHeadMatrix` (`src/components/stats/HeadToHeadMatrix.tsx`) loads a pair's
record on demand from
`GET /api/matches/head-to-head?tournament_id=&player_1_id=&player_2_id=`
(public; `src/app/api/matches/head-to-head/route.ts`). The route returns the
pair's **completed** matches in that tournament, either seat order, with their
games, oldest first, as `PublicMatch` (no admin notes, submitter or
confirmation timestamps). It serves the pair-scoped cached read
`publicReads.tournamentHeadToHead(tournamentId, a, b)`
(`src/lib/cache/public-reads.ts`): one query for the pair's matches
(`getH2HBetweenPlayers`), never the whole tournament, so the size of the stage
cannot hide a meeting. The entry is keyed by the tournament and the sorted pair
(A-vs-B and B-vs-A share it), maps the rows to `PublicMatch` inside the cache
callback, and is tagged `tournament:<id>` + `players` (30 s), so every match
write in the tournament and every player write expires it. A warm call costs
no query. A missing or malformed id is **400** (`MISSING_PARAM` /
`INVALID_PARAM`), the same id twice **400** `SAME_PLAYER`.

The card shows a failed load as an error with a Retry; "No matches between
these players" means they did not meet. (It used to call `GET /api/matches?…`,
which does not exist, so every pair showed 0 matches.)

## Redirects

- `/leaderboard` → `/insights?tab=ratings` (308).
- `/tournaments/[id]/stats` → `/insights?scope=tournament&id=[id]` (308).
- `/leagues/[id]/stats` → `/insights?scope=league&id=[id]` (308).

## Dependencies

- **Rating** — `getLeaderboardEntries` powers the ratings tab ([Rating](./rating.md)).
- **Stats** — `aggregatesToUsageRows`, `buildKillRanking`,
  `buildStandingsRowsFromMatchRecords`.
- **Gamification** — `getStreakLeaderboard` ([Gamification](./gamification.md)).
- **Supabase queries** — `aggregates`, `meta-usage`, `games`, `matches`,
  `tournaments`, `seasons`, `players`, `ratings`, `streaks`.
- **Smogon** — global-scope usage fallback ([Smogon](./smogon.md)).
- **Public Site** — featured card on the homepage links here
  ([Public Site](./public-site.md)).

## Testing

```bash
npm run test -- src/lib/insights/__tests__/scope.test.ts
npx vitest run src/app/api/matches/head-to-head src/components/stats/__tests__/HeadToHeadMatrix.test.tsx src/lib/cache/__tests__/public-reads.test.ts
```

## Related Modules

- [Public Site](./public-site.md) — homepage links into Insights.
- [Wiki](./wiki.md) / [Teambuilder](./teambuilder-editor.md) — share the same
  scope-selector pattern.
- [Rating](./rating.md), [Gamification](./gamification.md), [Smogon](./smogon.md),
  [Stats](./utils.md) — data sources.
- [Tournament](./tournament.md) / [Match](./match.md) — own the records that
  feed scoped standings and kills.

## Notes

- `ratings` tab is global-only by design — leaderboard is a site-wide concept;
  scoped ratings would double-count across overlapping scopes.
- `force-dynamic` + `revalidate = 60`: SSR because scope/tab are URL-driven,
- The `<Suspense>` wrapper lets the static shell prerender while the scoped
  data loads.
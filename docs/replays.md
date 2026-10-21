# Replays

> Spoiler-free public replay library at `/replays`. Shipped in PR #39
> (commit `fc844aa`). Route contract: [`poketools-spec.md`](./poketools-spec.md) §5.

## Overview

The Replays module is a read-only public surface that lists every recorded
Pokémon Showdown replay attached to a parsed game, **without revealing the
winner or team composition in the list view**. Visitors can filter by league,
tournament, round, free-text search (players, Showdown usernames, league, or
round), and date range; each row links out to the canonical match page and to
the upstream PS replay.

It does **not** parse replays itself — that pipeline lives in
[PKMN](./pkmn.md) (`POST /api/parse-replay`). This module only reads from
`games` rows where `parsed = true AND source = 'ps_replay' AND replay_url <> ''`.

## File Structure

```
src/app/(public)/replays/
├── page.tsx                       # Server component — fetch + filter + render
├── replay-library-utils.ts        # Param parsing + in-memory filter/sort/option derivation
└── __tests__/
    └── replay-library-utils.test.ts

src/lib/supabase/queries/
├── replay-library.ts              # listReplayLibraryRows() + ReplayLibraryRow type
└── __tests__/
    └── replay-library.test.ts
```

The page is also linked from `src/components/shared/NavBar.tsx`.

## Core Functions

### `listReplayLibraryRows(limit?)` — `src/lib/supabase/queries/replay-library.ts`
- **Returns**: `Promise<ReplayLibraryRow[]>`
- **Query**: `games` joined through `matches` → `tournaments` → `seasons`, plus
  `players` (player_1 / player_2) and `rounds`. Filters on
  `parsed=true`, `source='ps_replay'`, non-empty `replay_url`. Ordered by
  `created_at desc`.
- **Mapping** (`toReplayLibraryRow`): produces a flat, spoiler-safe row:
  `label` (players, league, round, match number), `date`, `league`,
  `tournamentName`, `round`, `matchNumber`, both player names + PS usernames,
  `matchUrl` (`/tournaments/{tid}/matches/{mid}`), and `replayUrl`.

### `parseReplayLibraryParams(params)` — `replay-library-utils.ts`
- Validates `sort` as `{column}-{asc|desc}` for columns
  `date | players | league | round` (default `date-desc`).
- Validates `start` / `end` as `YYYY-MM-DD` (regex); empty string if invalid.
- Folds legacy `?username=` into `q` so old bookmarked links still work.
- Reads `page` and `perPage` via shared `parseTableParams()` (default 20 rows).

### `applyReplayLibraryParams(rows, params)` — `replay-library-utils.ts`
- Pure in-memory filter on the already-loaded rows.
- Free-text `q` matches across label, league, tournament, round, player names,
  and both PS usernames (no separate username param).

### `getReplayLibrary{League,Tournament,Round}Options(rows)`
- Derive the dropdown options for the filter form from the loaded rows.

## Data Flow

```
Visitor opens /replays?…
  └─ page.tsx awaits searchParams
      └─ parseReplayLibraryParams() → ReplayLibraryParams
      └─ parseTableParams() → page + perPage
      └─ listReplayLibraryRows() → ReplayLibraryRow[]      (Supabase read)
      └─ applyReplayLibraryParams(rows, params) → filtered rows
      └─ paginateArray(filtered, page, perPage)
      └─ option-derivation helpers → dropdown options
      └─ render <form method="get"> + sortable <table> + TablePagination
          ├─ row.matchUrl  → /tournaments/{tid}/matches/{mid]   (Match page)
          └─ row.replayUrl → external PS replay (target="_blank")
```

Filtering is intentionally **client of the URL** — the form uses
`method="get"`, so every filter state is shareable and bookmarkable. Column
sorting uses `SortableTableHeader` links that rewrite the `sort` param.

## Caching

```typescript
export const dynamic = 'force-dynamic';
export const revalidate = 60;
```

Same pattern as the homepage: SSR because filters are dynamic, with a 60s
revalidate window for the public cache.

## API Routes

The library page itself consumes no API routes — it reads Supabase directly via
the server-side client. The upstream writers that populate the rows it reads:

- `POST /api/parse-replay` — fetches PS replay JSON, runs the
  `@pkmn/protocol` + `@pkmn/client` parser, writes `games` + `battle_stats` +
  aggregates. Documented in [PKMN](./pkmn.md) and [`poketools-spec.md`](./poketools-spec.md) §5.
- Admin "import replay → manual assign" entrypoint (commit `0418730`,
  [Match](./match.md)).

## Dependencies

- **Supabase** — server role client (`src/lib/supabase/client.ts`) for the read.
- **PKMN** — owns the parser that writes the rows this module reads.
- **Match** — owns the `/tournaments/{tid}/matches/{mid}` destination page.
- **Design** — `ui/{PageContainer, Card, Input, Select, SortableTableHeader, TablePagination}`, `buttonStyles`.

## Testing

```bash
npm run test -- src/app/(public)/replays/__tests__/replay-library-utils.test.ts
npm run test -- src/lib/supabase/queries/__tests__/replay-library.test.ts
```

## Related Modules

- [PKMN](./pkmn.md) — replay parser that produces the rows.
- [Match](./match.md) — destination of the "Match page" link.
- [Public Site](./public-site.md) — shares the `(public)` layout + NavBar entry.
- [Broadcast](./broadcast.md) / [Cast Studio](./cast-studio.md) — replaycast mode
  consumes the same underlying parsed games.

## Notes

- "Spoiler-free" means the list never shows scores, winners, or team sheets.
  Visitors who want detail follow the per-row links.
- Pagination uses shared `TablePagination` (20/50/100). Sort uses clickable
  column headers (Date, Players, League, Round) — no separate Sort dropdown.

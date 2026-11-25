# Stats (read models of the pre-computed aggregates)

The pure row builders the statistics pages render: usage rows, kill rankings, standings rows and previews, the Pokémon detail statistics and the combination of live aggregates with a pack extension's historical statistics. Everything here reads pre-computed `aggregates` (never a read-time scan of `battle_stats` — the hard rule); the one targeted exception is `kill-ranking.ts`, whose granularity the aggregates lack.

## File Structure

```
src/lib/stats/
├── usage-rows.ts              # aggregatesToUsageRows(): aggregate rows → usage table rows; the default meta format
├── kill-ranking.ts            # Kill ranking rows from battle_stats (tournament or league scope — the sanctioned exception)
├── standings-rows.ts          # One phase's table context: the kit data narrowed to that phase
├── standings-preview.ts       # The standings previews of the league, tournament and player pages + playerStandingFromRows
├── combined-statistics.ts     # combinePokemonUsage(): live + historical usage in one row set, with per-source counts
├── historical-statistics.ts   # readHistoricalUsage() + historicalCompetitionOptions() through packExtensions (server-only)
└── pokemon-detail.ts          # pokemonDetailStats(): the Pokémon detail page's statistics block
```

## Core Functions/Classes

- **`aggregatesToUsageRows()`** (`usage-rows.ts`) — maps pre-computed aggregate rows to usage table rows; `DEFAULT_GLOBAL_META_FORMAT` (`gen9ou`) is the Smogon meta format when global aggregates are empty.
- **`combinePokemonUsage()`** (`combined-statistics.ts`) — one row per Pokémon across the live aggregates and a pack extension's historical usage, with `sourceCounts` splitting live and historical appearances/KOs; rows whose total is unknown carry `null` rather than a wrong zero. `HistoricalStatisticsView` reports the supplement's state (`absent | excluded | not_ready | ready | failed`).
- **`readHistoricalUsage()`** (`historical-statistics.ts`) — server-only; reads the historical supplement through `packExtensions.historicalUsage` and never throws a missing pack at the page.
- **`getStandingsPreview()`** (`standings-preview.ts`) — the small standings tables of the preview surfaces; `FULL_STANDINGS_LIMIT` caps them, `playerStandingFromRows` reads one player's snapshot.
- **`standings-rows.ts`** — the context of ONE phase's table: a phase with no completed match yet ranks by its own stage, not by the season-wide fallback.
- **`kill-ranking.ts`** — builds kill ranking rows from `battle_stats` in tournament or league scope: the sanctioned targeted read, because the aggregate tables lack per-kill granularity.

## Testing

- **Test Files — `src/lib/stats/`**: `src/lib/stats/__tests__/` (7 test files): `combined-statistics.test.ts`, `kill-ranking.test.ts`, `standings-preview-byes.test.ts`, `standings-preview-errors.test.ts`, `standings-preview.test.ts`, `standings-rows.test.ts`, `usage-rows.test.ts`.
- **Running Tests**: `npx vitest run src/lib/stats/__tests__`

## Related Modules

- [Insights](./insights.md) — the stats hub these rows render in.
- [Format packs](./format-packs.md) — the historical statistics supplement contract.
- [League standings readers](./league-standings-readers.md) — how standings are computed per format.

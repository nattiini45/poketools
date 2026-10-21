# src/lib — Domain Module Rules

Module rules for `src/lib/` (265 source files). Load when a task touches domain modules here. Root policy (hard rules, pre-computed aggregates, match-state transitions) lives in [`../../AGENTS.md`](../../AGENTS.md). Each module has a doc — start at [`../../docs/modules-index.md`](../../docs/modules-index.md).

## pkmn lookups

- Detail-page lookups must use the NatDex-aware resolvers in `src/lib/pkmn/dex.ts` (`getSpeciesNatDex` / `getMoveNatDex` / `getItemNatDex` / `getAbilityNatDex`, returning `{ entity, earliestGen, resolvedGen }`); the bare gen-9-only `getSpecies` / `getMove` / `getItem` / `getAbility` 404 NatDex-only entities like Mega Evolutions, Primals, and regional forms.
- Replay roster dedup lives in `src/lib/pkmn/replay-species.ts` (hidden preview `Species-*`, same-slot formes like Mimikyu-Busted); re-submit replays to refresh existing `battle_stats` after parser changes.

## Stats locking

- `games.stats_locked` is flipped TRUE by `editGame()` in `src/lib/pkmn/game-pipeline.ts` via `setGameStatsLocked()` in `src/lib/supabase/queries/games.ts`, and acts as the "do-not-auto-re-parse" marker for replay-sourced games.

## Validation & dates

- Use `z.iso.date()` (Zod v4) for `<input type="date">` payloads that hit Postgres `date` columns (e.g. season schemas in `src/lib/validation/schemas.ts`); `z.string().datetime()` rejects `YYYY-MM-DD` and breaks date pickers.

## Audit logging

- `src/lib/audit/log.ts` is a fire-and-forget audit-trail writer — never `await` it in the main write path; errors are swallowed by design. It records who changed what, and is not a runtime-diagnostics route.

## i18n

Rules: root [`AGENTS.md`](../../AGENTS.md) "Text goes through `src/i18n`"; module doc [`../../docs/i18n.md`](../../docs/i18n.md).

- A pure function that returns display text takes a `locale: Locale` argument and translates with `createTranslator(ns, locale)`; it never reads a cookie.
- Never call `getLocale()` (or anything that reads `cookies()`) inside `unstable_cache` / `cachedRead`: Next forbids it, and a cached value must not hold localized text.
- Engine-stored English names (round, slot and group names, notes, `@pkmn` names) stay English in the DB; they are translated at display time (`translateEngineLabel`, `src/lib/pkmn/i18n`).

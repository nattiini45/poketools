# League hub

The tabbed league overview at the top of a league page (`/leagues/[id]`): standings, matches, group tables, playoff bracket, phases, insights and rules, plus the flag-gated Kale reports. The active tab lives in the URL (`?tab=`), so every view is one link away, shareable, and rendered on the server — and the page reads ONLY the selected tab's data. The components live in `src/components/league/hub/`; the hub renders inside a route world's `#pulse` ([Worlds](./worlds.md)).

## File Structure

```
src/lib/league-hub/
├── tabs.ts    # The tab whitelist and default: which ?tab= values exist and what each one costs
├── load.ts    # Server loader: reads exactly what the selected tab renders, through the tagged public read cache
├── views.ts   # Pure view builders for the tabs; every input is a row the page already holds
├── copy.ts    # League hub copy in the viewer's language (the league-hub i18n namespace)
└── hero.ts    # The league hero's view: matchday, a few counts and the versus panel's one match
```

## Core Functions/Classes

- **`load.ts`** — the server loader shapes the panel data the hub components render, through the tagged public read cache ([Cache](./cache.md)). Read cost per tab is documented in the module: standings reads nothing beyond what the page holds, the heavier tabs read exactly their own rows.
- **`views.ts`** — pure builders; nothing here reads. Standings go through the same format dispatch `computeStandingsFromContext` performs, so every table on the page is computed from ONE season context.
- **`tabs.ts`** — the `?tab=` whitelist; an unknown value falls back to the default instead of 404ing.
- **`copy.ts`** — `leagueHubCopy(locale)`: the words live in the `league-hub` namespace; status, bracket-type and format labels come from `enums`, stored engine round names go through `translateEngineLabel`.
- **`hero.ts`** — pure: reads only the world payload the league page already holds, so the hero costs no query.

Custom leagues link to the authenticated player page. For a signed-in participant in a running kit league with a public pool overview, the hub also links directly to its pools section. The hub queries only whether a public overview exists. The player page controls which pools and holdings are shown.

## Testing

- **Test Files — `src/lib/league-hub/`**: `src/lib/league-hub/__tests__/` (6 test files): `copy.test.ts`, `hero.test.ts`, `load.test.ts`, `tabs.test.ts`, `views-display.test.ts`, `views.test.ts`.
- **Running Tests**: `npx vitest run src/lib/league-hub/__tests__`

## Related Modules

- [Worlds](./worlds.md) — the route worlds the hub renders inside.
- [Cache](./cache.md) — the tagged public reads the loader goes through.
- [League standings readers](./league-standings-readers.md) — the standings computation the views dispatch to.

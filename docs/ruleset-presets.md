# Ruleset Presets (the rule catalog)

> The catalog of rule presets a ruleset starts from: Pokémon Showdown ladder formats, Smogon draft league formats and Pokémon Champions, with the data they resolve to, where it comes from and how to refresh it.

## Overview

A **preset** is a named, versioned set of rules: a generation, a game type, a universe (the generation's own Pokémon or its whole National Dex), battle clauses, ban lists or, for a roster format, allowlists, and some rule facts (level, team size, ...). A ruleset document ([`ruleset-studio.md`](./ruleset-studio.md)) names a preset as its base and states only its changes; `computeEffective` resolves the two to the effective rules, which a published version freezes.

The catalog is data, not behaviour. Two numbers keep it honest:

- `PRESET_DATA_PIN` (`src/lib/pkmn/preset-data/pin.ts`): the commit of `smogon/pokemon-showdown` the format and ruleset tables were transcribed from. The Champions roster has its own pin, `CHAMPIONS_ROSTER_PIN`, because the mod moves faster than the formats.
- `PRESET_RULES_VERSION`: the version of everything a preset resolves to (the catalog, the tables, the resolution rules). A published ruleset version stores it as `catalog_version`, so a version can say which data it was computed from and the library can flag one computed from older data (`isCatalogStale`).

The data is transcribed from Pokémon Showdown (MIT, see `NOTICE.md`).

## File Structure

```
src/lib/pkmn/
├── format-catalog.ts          Dex-free catalog: PRESETS (id, name, gen, mod, game type, source, family, universe, clause names,
│                              rule facts, tourOverlay flag), PRESET_FAMILIES, generation and tier info. Client-safe.
├── formats.ts                 Static format defaults (the legacy flat view, FORMAT_DEFAULTS, derived from PRESETS)
├── format-id.ts               The one format-id parser: gen + ONE digit + tier key (gen9ou, gen91v1, gen96v6doublesdraft)
├── clauses.ts                 The clause catalog by id; which clauses are enforced (Species, Item) and which are informational
├── preset-rules.ts            Shapes a preset resolves to (types only, client-safe)
├── preset-rules.server.ts     resolvePresetRules(id), resolveTourOverlay(id): per-mod resolution against the dex; memoised per process
├── known-ids.server.ts        knownIds(kind, gen, universe), presetKnownIds(preset, kind): the id sets behind the unknown_entry warning
├── seed-format-ids.ts         The frozen list of 88 ids POST /api/seed-rulesets creates site rulesets for
├── catalog-index(.server).ts  The entry catalog the pickers read (GET /api/pkmn/catalog/[kind])
├── sheet-cells.server.ts      Icon sheet cell numbers computed from the installed @pkmn/img
└── preset-data/
    ├── pin.ts                 PRESET_DATA_PIN, CHAMPIONS_ROSTER_PIN, PRESET_RULES_VERSION
    ├── standard.ts            Move, item and ability bans of the ladder tier families, Little Cup, Monotype, 1v1, the National Dex family, doubles
    ├── draft.ts               Bans of the draft formats, tier bans (Gen 3 Draft bans the Uber tier), combination bans the app lists but does not model
    ├── champions.ts           The Champions roster by category, from the generated lists
    ├── champions-roster.generated.ts   Written by scripts/ruleset-presets/generate-champions-roster.mjs
    └── tour-overlay.ts        Documented Smogon tournament extras per draft preset
```

## Families

A preset belongs to a **source** and a **family**, which is how the pickers group them.

| Source | Families |
|---|---|
| Pokémon Showdown (`showdown`) | Singles, Doubles, National Dex, Other (Monotype, 1v1) |
| Smogon draft leagues (`smogon-draft`) | Draft (generations 3 to 9), NatDex Draft (including NatDex LC Draft), Doubles Draft (6v6 and 4v4, also NatDex), Champions Draft (including NatDex and 4v4 doubles) |

Draft presets are not on Showdown's ladder search (`searchShow: false`). **Only the 88 standard Showdown formats** of `SEED_FORMAT_IDS` become shared site rulesets (`POST /api/seed-rulesets`); the other presets are starting points: a league or admin makes its own ruleset from one. Seeding a new preset is a decision, made by adding its id to that list.

## Resolution

Resolution is **per mod**, never "the base rulesets only": a mod can replace a rule (the Gen 3 mod replaces Standard Draft outright; the Champions mod has its own Standard AG and Flat Rules). The catalog entry's `mod` selects the table:

- tier-derived Pokémon bans (Uber, UUBL, National Dex OU, ...) are read from the dex tier fields over the preset's universe;
- explicit move, item and ability bans are the tables in `preset-data` (`standard.ts`, `draft.ts`), integrity-tested against the dex: every name must exist in the dex for its generation and universe;
- Champions presets use the generated roster, an **allowlist** (every Pokémon, Mega Evolution, battle-only and cosmetic forme the mod makes legal, the moves, items and abilities it has);
- a Little Cup preset that is not a tier family (NatDex LC Draft, Doubles LC) allows exactly the first stages that have an evolution;
- the other draft formats ban nothing by tier: a draft league's roster is the draft.

What the catalog documents but the app does **not model** is listed per preset (`unmodelled`): combination bans of the older draft formats (an ability with a move, two abilities), the "obtainable from generation N" rule, the Let's Go species the Gen 7 draft re-allows, the NatDex pool of Champions NatDex Draft, and per-species Champions move legality (the move list is the union). The ruleset editor shows these so an admin knows what the preset does not enforce.

Enforcement reminder: `validateTeam` enforces the four lists and the Species and Item Clauses; every other clause is informational (`clauses.ts`). The ban-style clauses are not expanded into move bans.

## Smogon tour overlay ("Add Smogon tour bans")

A draft preset is Showdown-faithful: it enforces exactly what the Showdown format defines. The Smogon draft league threads add rules on top. For the presets whose threads document them, `tour-overlay.ts` lists: clauses to add, clauses of the preset the tour does not use, moves, items and abilities to ban (Showdown names, item groups such as Z-crystals and non-Normal Gems expanded from the dex), the source threads, what was **skipped** (a rule the app cannot express, or one league's own tiering) and what stayed **unresolved** (sources disagree, or a name looks mistyped).

- The editor applies the overlay on request (`applyTourOverlay`, `GET /api/pkmn/presets/[id]/tour-overlay`); a new ruleset can start with it (`tour_overlay` in the create and preset fork bodies, applied on the server). The entries become ordinary, editable bans: nothing is locked, and the overlay bans no Pokémon. Entries that change nothing (an id the preset already bans, a clause it already has) are left out.
- Presets with an overlay: NatDex Draft (Gen 9), NatDex LC Draft, 6v6 Doubles Draft. The other draft presets have no documented extras and no overlay.
- Sources were read through a page summariser and verified by a second pass, so confidence is medium; each overlay names its threads.
- Open questions for the maintainers: a thread names "Razor Claw" among the NatDex LC bans, almost certainly Razor Fang (neither is applied); and the Evasion handling of the 6v6 doubles tour (Showdown repeals the Evasion Clause for the format, the threads still ban Double Team and Minimize, which is what is applied).

## Refreshing the data

Showdown changes; a refresh is a deliberate, reviewed commit.

1. **Format and ruleset tables** (`standard.ts`, `draft.ts`, the catalog). Check the changed formats against `config/formats.ts` (and, for a mod, `data/mods/<mod>/rulesets.ts`) at a newer commit. Edit the table, update `PRESET_DATA_PIN` (sha and date), and run the preset tests. Read **both** the base `data/rulesets.ts` and the mod's file: reading the base alone is wrong for Gen 3 and Champions.
2. **Champions roster.** Obtain the base data tables (`pokedex.ts`, `formats-data.ts`, `items.ts`, `abilities.ts`, `moves.ts`, `learnsets.ts` of `data/`) and the `data/mods/champions/` files from one commit, then:
   ```bash
   node scripts/ruleset-presets/generate-champions-roster.mjs --base <dir> --mod <dir> --sha <40 hex> --date <YYYY-MM-DD> [--regulation M-C]
   ```
   The script reads only the directories it is given (no network), parses the files without executing them, and writes `champions-roster.generated.ts`. Only the regulation named by the script is modelled (currently M-C); the mod changes often, so rerun the generator and bump the version before shipping a Champions change.
3. **Bump `PRESET_RULES_VERSION`** in `preset-data/pin.ts`. `preset-data-integrity.server.test.ts` hashes the catalog and every table and **fails on an edit that does not bump the version**; the failure prints the new hash. Record the new pair in `DATA_HASHES` in that test. Never change the hash of an existing version: a published ruleset version names it.
4. Run `npx vitest run src/lib/pkmn src/lib/ruleset-kit src/lib/ruleset-studio scripts/ruleset-presets`. The legacy fingerprint in `formats.test.ts` pins the 86 pre-existing non-National-Dex formats.

After a bump every preset-based published ruleset version reads as "Catalog updated" (one version string covers the whole catalog). That is intended: running leagues keep their frozen rules, and owners publish again when they want the corrected data.

## Known differences from the source (status quo, not fixed)

The tables of the older tier families (the move and item bans of OU to PU, Little Cup, Monotype, 1v1) are an older, partly approximate transcription, moved unchanged from `formats.ts`. Compared with the pinned `config/formats.ts` for Gen 9: OU lacks the abilities Arena Trap, Moody and Shadow Tag and the move Tera Blast (UU, RU, NU, PU and ZU inherit those); NU also lacks Drought, Grassy Surge and Quick Claw; ZU lacks Heat Rock; Little Cup lacks Vullaby and the ability Moody and lists Diglett where the source lists the Base forme; Monotype lacks Gliscor and the abilities Moody and Shadow Tag; 1v1 and Ubers lack the ability Moody; UU also lacks Last Respects. The rows for generations 6 to 8 share ids across generations (Last Respects appears in the Gen 6 OU row, harmless since the id does not exist there); the integrity test checks them against the Gen 9 National Dex. They stay as they are until each family is verified. The National Dex family, the doubles Ubers and the doubles Little Cup format are new and verified against the pin.

Corrections that did ship with the catalog: the format-id parser reads exactly one generation digit (a greedy parser read `gen91v1` as generation 91), and the National Dex bans were corrected.

## Testing

`src/lib/pkmn/__tests__/{clauses,format-id,seed-format-ids,preset-rules.server,preset-data-integrity.server,dex-national,format-catalog-boundary,validation-rules,sheet-cells.server}.test.ts`, `scripts/ruleset-presets/__tests__`. The catalog boundary test keeps `format-catalog.ts` free of the dex so client bundles stay small.

## Related

- [`ruleset-studio.md`](./ruleset-studio.md): documents, versions, pins.
- [`pkmn.md`](./pkmn.md): the format catalog, `validateTeam`, the catalog route.
- [`format-kit.md`](./format-kit.md): a format stage can name a preset.

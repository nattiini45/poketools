# Ruleset Presets (the rule catalog)

> The catalog of rule presets a ruleset starts from: Pokémon Showdown ladder formats, Smogon draft league formats and Pokémon Champions, with the data they resolve to, where it comes from and how to refresh it.

## Overview

A **preset** is a named, versioned set of rules: a generation, a game type, a universe (the generation's own Pokémon or its whole National Dex), battle clauses, ban lists or, for a roster format, allowlists, and some rule facts (level, team size, ...). A ruleset document ([`ruleset-studio.md`](./ruleset-studio.md)) names a preset as its base and states only its changes; `computeEffective` resolves the two to the effective rules, which a published version freezes.

The catalog is data, not behaviour. Two numbers keep it honest:

- `PRESET_DATA_PIN` (`src/lib/pkmn/preset-data/pin.ts`): the commit of `smogon/pokemon-showdown` the format and ruleset tables were transcribed from. The Champions roster has its own pin, `CHAMPIONS_ROSTER_PIN`, because the mod moves faster than the formats.
- `PRESET_RULES_VERSION`: the version of everything a preset resolves to (the catalog, the tables, the resolution rules and, through the tier-derived bans, the `@pkmn/dex` tier data). The integrity test hashes only the catalog and the tables, so a change of the resolution code or an upgrade of `@pkmn/dex` that moves a tier is bumped by hand. A published ruleset version stores it as `catalog_version`, so a version can say which data it was computed from and the library can flag one computed from older data (`isCatalogStale`).

The data is transcribed from Pokémon Showdown (MIT, see `NOTICE.md`).

## File Structure

```
src/lib/pkmn/
├── format-catalog.ts          Dex-free catalog: PRESETS (id, name, gen, mod, game type, source, family, universe, clause names,
│                              rule facts, tourOverlay flag), PRESET_FAMILIES, generation and tier info. Client-safe.
├── formats.ts                 Static format defaults (the legacy flat view, FORMAT_DEFAULTS, derived from PRESETS)
├── format-id.ts               The one format-id parser: gen + ONE digit + tier key (gen9ou, gen91v1, gen96v6doublesdraft)
├── clauses.ts                 The clause catalog by id; which clauses are enforced (Species, Item) and which are informational
├── ruleset-preset-catalog.ts  The picker view of the catalog shared by both studios: entries, getRulesetPreset, isRulesetPresetId, search, grouping (client-safe)
├── preset-rules.ts            Shapes a preset resolves to (types only, client-safe)
├── preset-rules.server.ts     resolvePresetRules(id), resolveTourOverlay(id): per-mod resolution against the dex; memoised per process
├── showdown-challenge.ts      toShowdownChallenge(resolved, lookup?): copyable custom-rules challenge string on the ruleset's own base format (client-safe)
├── showdown-challenge.server.ts challengeSpeciesLookup(gen): the dex's cosmetic-forme and other-forme facts the challenge needs
├── known-ids.server.ts        knownIds(kind, gen, universe), presetKnownIds(preset, kind): the id sets behind the unknown_entry warning
├── seed-format-ids.ts         The frozen list of 88 ids POST /api/seed-rulesets creates site rulesets for
├── catalog-index(.server).ts  The entry catalog the pickers read (GET /api/pkmn/catalog/[kind])
├── sheet-cells.server.ts      Icon sheet cell numbers computed from the installed @pkmn/img
└── preset-data/
    ├── pin.ts                 PRESET_DATA_PIN, CHAMPIONS_ROSTER_PIN, PRESET_RULES_VERSION
    ├── standard.ts            Move, item and ability bans of the ladder tier families, Little Cup, Monotype, 1v1, the National Dex family, doubles
    ├── draft.ts               Bans of the draft formats, tier bans (Gen 3 Draft bans the Uber tier), combination bans the app lists but does not model
    ├── champions.ts           The Champions roster by category, from the generated lists
    ├── wichtelcup.ts          The approved Wichtelcup pools (141 pool entries, plus the Toxtricity Low-Key forme) and item/ability bans
    ├── champions-roster.generated.ts   Written by scripts/ruleset-presets/generate-champions-roster.mjs
    └── tour-overlay.ts        Documented Smogon tournament extras per draft preset
```

## Families

A preset belongs to a **source** and a **family**, which is how the pickers group them.

| Source | Families |
|---|---|
| Pokémon Showdown (`showdown`) | Singles, Doubles, National Dex, Other (Monotype, 1v1) |
| Smogon draft leagues (`smogon-draft`) | Draft (generations 3 to 9), NatDex Draft (including NatDex LC Draft), Doubles Draft (6v6 and 4v4, also NatDex), Champions Draft (including NatDex and 4v4 doubles) |
| PokéTools (`poketools`) | Community: organizer-owned formats such as the Wichtelcup |

The per-player pools and weekly gift rules of the cup are the shipped format example `wichtelcup` (see [Format Kit](./format-kit.md#wichtelcup-example)), which names this preset as its stage ruleset.

`gen9natdexwichtelcup` starts from a blank Gen 9 National Dex ruleset, not a tier. A cup's bans come from its rule document and the Showdown ruleset: if neither bans something, the preset does not. Its allowlist is the 64 normal, 30 junk, 23 premium and 24 New Year pool entries (141) plus `Toxtricity-Low-Key` (142 ids): the document lists Toxtricity as the "standard species" with forms per the engine and the Species Clause, unlike the "base form" entries, so both formes may be brought and they count as one species. The Low-Key forme is not a pool entry (the pools keep the sizes of the rules text): the format's pool check already matches a team member by its species id or its base species id, so only this exact-id allowlist lists it (`WICHTELCUP_ENTRY_FORMES`). It bans no Pokémon and no move, and carries only the Species, Item, Terastal and Mega Rayquaza clauses; it inherits no Sleep, OHKO, Evasion or tier bans.

Every ban and closure traces to a line of the rules text (section numbers of the document) or is a direct consequence of one:

| Ban or closure | Basis |
|---|---|
| Light Clay | "Banned item" (section 2) |
| Moody, Snow Cloak | "Banned abilities" (section 2) |
| Every Mega Stone (the hold-item side of Mega Evolution) | "No Mega Evolution" (section 2) |
| Every Z-crystal | "No Z-Moves" (section 2) |
| Red Orb, Adamant Crystal, Lustrous Globe | Groudon, Dialga and Palkia are "base form" entries (section 9); the items turn them into Primal Groudon and the Origin formes |
| Ultranecrozium Z | "No Z-Moves", and Necrozma is a "base form" entry |
| Terastal Clause | "No Terastallization" (section 2); the format example's `constraint.tera` `banned` enforces it |
| Species Clause, Item Clause | Sections 2 and 11 |
| Mega Rayquaza Clause; `rayquazamega` outside the allowlist | "No Mega Evolution" and "Rayquaza (base form; no Mega)" (sections 2 and 9) |
| Any forme of a listed species that the list does not name (the Showdown challenge closes them, see below) | The legal species/forms are "the explicit weekly pools" and "only the named alternate form is allowed" (sections 2 and 6); the Mega, Primal and Origin formes also follow from "No Mega Evolution" and "base form" |

Not banned, because the document does not ban it and Showdown's rules do not either: Dragon Ascent (an ordinary attack: Mega Rayquaza is closed by the clause and the allowlist, not by the move), Toxtricity-Low-Key, Shell Smash and Belly Drum (permitted by section 2), and every move, ability and item not named above.

The pool entries that are "base form" or "standard starting form" entries are closed against the formes the pool does not list: the allowlist rejects a team member that is already such a forme (Rayquaza-Mega, Necrozma-Ultra, Meloetta-Pirouette), and the item bans close the item-forced ones: Red Orb (Primal Groudon), Adamant Crystal and Lustrous Globe (the Origin formes), Ultranecrozium Z and the Mega Stones. A data-driven test (`wichtelcup-validation.server.test.ts`) fails when a forme outside the pool gets an item that is not banned, or a Mega forme that needs a move (Rayquaza-Mega) is not covered by the Mega Rayquaza Clause. The preset documents `minTeamSize: 6` and `pickedTeamSize: 6` ("exactly six"), like the other presets' team-size facts; the validator does not enforce a minimum team size. The Terastal Clause is informational at the ruleset layer (a set with a Tera type still passes `validateTeam`); the cup's no-Terastallization rule is enforced by the format example's `constraint.tera` `banned`, which the team check and the post-match audit read, and that rule exists only in a league that attaches the example. Editing this data bumps `PRESET_RULES_VERSION` (`2026-11-08.1` carries the Low-Key forme and drops the Dragon Ascent ban).

**Showdown challenge.** `toShowdownChallenge` writes `<format> @@@ <rules>` where the format is the least restrictive Showdown format with the ruleset's generation, universe and game type (`showdownChallengeFormat`: Anything Goes for Gen 6-9 standard, National Dex AG for Gen 9 National Dex, else the generation's Custom Game). Every entry is written with its kind (`+pokemon:rayquaza`, `-item:metronome`, `-move:metronome`) because Showdown refuses an id shared by a move and an item. A rule that names a base species covers all its formes in Showdown, so an allowlisted base species is followed by an explicit `-pokemon:<forme>` for every forme the allowlist does not list, and a cosmetic forme (Vivillon patterns, Deerling and Sawsbuck seasons, which Showdown cannot tell apart) is written as its base species. Those forme facts come from the dex through the `lookup` argument (`challengeSpeciesLookup`, server only; the rules page passes it). The pinned Showdown source is not a dependency, so the exact parser behaviour is the documented one, not a tested one. The challenge cannot carry level rules, team constraints or per-player pools, and the page says so.

Draft presets are not on Showdown's ladder search (`searchShow: false`). **Only the 88 standard Showdown formats** of `SEED_FORMAT_IDS` become shared site rulesets (`POST /api/seed-rulesets`); the other presets are starting points: a league or admin makes its own ruleset from one. Seeding a new preset is a decision, made by adding its id to that list.

## Resolution

Resolution is **per mod**, never "the base rulesets only": a mod can replace a rule (the Gen 3 mod replaces Standard Draft outright; the Champions mod has its own Standard AG and Flat Rules). The catalog entry's `mod` selects the table:

- tier-derived Pokémon bans (Uber, UUBL, National Dex OU, ...) are read from the dex tier fields over the preset's universe;
- explicit move, item and ability bans are the tables in `preset-data` (`standard.ts`, `draft.ts`), integrity-tested against the dex: every name must exist in the dex for its generation and universe;
- Champions presets use the generated roster, an **allowlist** (every Pokémon, Mega Evolution, battle-only and cosmetic forme the mod makes legal, the moves, items and abilities it has);
- a Little Cup preset allows exactly the first stages that have an evolution (NatDex LC Draft, Doubles LC; the ladder Little Cup only those the dex tiers as `LC`, which leaves out the LC Uber species, in every generation), and the ladder NFE allows every species that has an evolution (its own banlist is not transcribed);
- the other draft formats ban nothing by tier: a draft league's roster is the draft.

What the catalog documents but the app does **not model** is listed per preset (`unmodelled`): combination bans of the older draft formats (an ability with a move, two abilities), the "obtainable from generation N" rule, the Let's Go species the Gen 7 draft re-allows, the NatDex pool of Champions NatDex Draft, and per-species Champions move legality (the move list is the union). The ruleset editor shows these so an admin knows what the preset does not enforce.

Enforcement reminder: `validateTeam` enforces the four lists and the Species and Item Clauses; every other clause is informational (`clauses.ts`). The ban-style clauses are not expanded into move bans.

## Smogon tour overlay ("Add Smogon tour bans")

A draft preset is Showdown-faithful: it enforces exactly what the Showdown format defines. The Smogon draft league threads add rules on top. For the presets whose threads document them, `tour-overlay.ts` lists: clauses to add, clauses of the preset the tour does not use, moves, items and abilities to ban (Showdown names, item groups such as Z-crystals and non-Normal Gems expanded from the dex), the source threads, what was **skipped** (a rule the app cannot express, or one league's own tiering) and what stayed **unresolved** (sources disagree, or a name looks mistyped).

- The editor applies the overlay on request (`applyTourOverlay`, `GET /api/pkmn/presets/[id]/tour-overlay`); a new ruleset can start with it (`tour_overlay` in the create and preset fork bodies, applied on the server). The entries become ordinary, editable bans: nothing is locked, and the overlay bans no Pokémon. Entries that change nothing (an id the preset already bans, a clause it already has) are left out.
- Presets with an overlay: NatDex Draft (Gen 9), NatDex LC Draft, 6v6 Doubles Draft. The other draft presets have no documented extras and no overlay.
- Sources were read through a page summariser and verified by a second pass, so confidence is medium; each overlay names its threads.
- Settled with the maintainers: the NatDex LC thread's "Razor Claw" ban is meant as written and is applied; the 6v6 doubles tour keeps its threads' Double Team and Minimize bans, whatever Showdown does with the Evasion Clause for that format.

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

`src/lib/pkmn/__tests__/{clauses,format-id,seed-format-ids,preset-rules.server,preset-data-integrity.server,dex-national,format-catalog-boundary,ruleset-preset-catalog,validation-rules,sheet-cells.server}.test.ts`, `scripts/ruleset-presets/__tests__`. The catalog boundary test keeps `format-catalog.ts` and `ruleset-preset-catalog.ts` free of the dex so client bundles stay small.

## Related

- [`ruleset-studio.md`](./ruleset-studio.md): documents, versions, pins.
- [`pkmn.md`](./pkmn.md): the format catalog, `validateTeam`, the catalog route.
- [`format-kit.md`](./format-kit.md): a format stage can name a preset.

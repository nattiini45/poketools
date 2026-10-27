# PKMN Module

## Overview
The PKMN module provides Pokédex access, legality checks, replay parsing, and speed/stat utilities built on the `@pkmn/*` stack.

## File Structure
```
src/lib/pkmn/
├── ball-sprites.ts  # Hardcoded Showdown spritesheet coords for the 4 rating-tier Pokéballs
├── calc-adapter.ts  # Calc request normalization helpers
├── dex.ts  # Generation/species/move/item lookup + legality helpers; bilingual (EN/DE) ranked name search
├── dex-l10n.server.ts  # Server-only `?lang=` wrappers of the dex rich/list functions (German descriptions)
├── format-mapping.ts  # Format mapping helpers
├── formats.ts  # Static format defaults in the legacy flat shape (FORMAT_DEFAULTS, derived from the preset catalog); server-side
├── format-catalog.ts  # The dex-free rule preset catalog (PRESETS, families, generations, tier labels, rule facts); client-safe
├── format-id.ts  # The one format-id parser (gen + one digit + tier key: gen91v1 is generation 9)
├── clauses.ts  # Clause catalog by id; which clauses are enforced (Species, Item) and which informational
├── preset-rules(.server).ts  # The rules a preset resolves to (types; per-mod resolution against the dex)
├── known-ids.server.ts  # Dex id sets per category, generation and universe (the unknown_entry warning)
├── seed-format-ids.ts  # The frozen 88 ids POST /api/seed-rulesets seeds
├── preset-data/  # Transcribed rule tables, the generated Champions roster, the Smogon tour overlay, pin.ts (data pins and PRESET_RULES_VERSION)
├── catalog-index(.server).ts  # The entry catalog the Ruleset Studio pickers read (rows as short arrays)
├── sheet-cells.server.ts  # Icon sheet cell numbers from the installed @pkmn/img
├── game-pipeline.ts  # Replay/manual game result pipeline helpers
├── german-names.ts  # German → English species name map (incl. import aliases), derived from i18n/data/species.de.json
├── i18n/  # German/English Pokémon data layer (see Localization below)
├── replay-binding.ts  # BoundReplay: one fetched log, its hash and its parsed stats; the replay result (winner, stats) per side
├── replay-frames.ts  # Frame extraction from replay logs
├── replay-identity.ts  # Replay hash (SHA-256 of the canonical battle log) and the backfill's collision check; dependency-free
├── replay.ts  # Replay fetch/parse
├── set-resolver.ts  # Set resolution helpers
├── speed-benchmarks.ts  # Speed benchmark helpers
├── speed-calc.ts  # Speed calculation helpers
├── spread-parser.ts  # EV/IV spread parser
├── sprite-maps/  # Generated maps: broadcast.json (species id -> stem, one set version), showdown-ids.json
├── sprite-style.server.ts  # Server-only: the viewer's sprite-style cookie (root layout)
├── sprite-styles.ts  # Sprite styles: every Pokémon sprite URL, fallback chain, site default (client-safe)
├── sprites.ts  # Sprite name helpers; item and move-category icon URLs
├── stat-calc.ts  # Stat formulas and nature modifiers
├── teams.ts  # Team parse/export helpers
├── threat-list.ts  # Threat list generation helpers
├── tiers.ts  # Tier metadata helpers (competitive tiers; not the rating-badge tiers in src/lib/rating/tiers.ts)
├── validation.ts  # Team validation helpers
└── __tests__/
    └── speed-calc.test.ts
```

## Core Functions/Classes

### Dex Access
- **File**: `dex.ts`
- **Purpose**: Unified generation-backed lookup/search/legality helpers
- **Key Methods**: `getGeneration()`, `getSpecies()`, `getMove()`, `getItem()`, `validateSetLegality()`
- **Generations rule and its one exception.** Everything goes through `new Generations(Dex)` (`getGeneration`). `listNationalSpecies()`, `listNationalMoves()` and `listNationalItems()` read `Dex.forGen(gen)` instead, because a generation's National Dex universe includes past entries (Mega Evolutions, Primal formes, Z-crystals, moves a generation dropped) that the `Generations` wrapper hides. The ruleset catalog and the preset resolution use them.

### Stat Calculator
- **File**: `stat-calc.ts`
- **Purpose**: Shared stat formula utilities
- **Key Methods**: `calcStat()`, `calcAllStats()`, `getNatureModifier()`

### Speed Calculator
- **File**: `speed-calc.ts`
- **Purpose**: Effective speed calculation with modifiers
- **Key Methods**: `calcSpeed()`, `getNatureEffect()`

### Team Validation
- **File**: `validation.ts`
- **Purpose**: Ruleset and draft-ownership validation
- **Key Methods**: `validateTeam()`, `validateDraftOwnership()`
- **What it enforces.** `validateTeam(team, ruleset, ctx)` reads the ruleset's frozen resolved rules (`ruleset.rules`, see [Ruleset Studio](./ruleset-studio.md)) and nothing else: the four lists in block or allowlist mode, the **Species Clause** and the **Item Clause**, the shared-type share (`min_shared_type_pct`) and `team_constraints`. Every other clause is informational (`clauses.ts`): shown on the rules page, not enforced. The validator needs neither the dex tier data nor the ruleset document, so it validates exactly what the league's pinned version said.

### Replay binding (one battle, one game)
- **Files**: `replay-identity.ts`, `replay-binding.ts`; consumer `game-pipeline.ts` (`recordGameResult`)
- **Rule**: a game recorded from a Showdown replay takes its winner and its battle stats from that replay, and its `games` row stores the replay's hash (`games.replay_hash`) in the same insert. A battle already bound to a game, in any match, is refused with 409 `replay_already_recorded`. The per-match URL check (`duplicate_replay`) stays in front of it.
- **What is hashed**: the replay JSON's `log`, canonicalised by `canonicalReplayLog`: line endings normalised, trailing whitespace trimmed, only protocol lines kept, chat / join / leave / rename / server HTML / timer / moderation lines dropped, `|split|` blocks reduced to their public line, everything after the first `|win|` or `|tie|` dropped. Timestamps (`|t:|`), `|player|` lines, team preview and every turn stay. The digest is `sha256("poketools-replay-hash-v1\n" + lines.join("\n"))`, 64 lowercase hex characters. The same battle as a bare id, full URL, `.json`, `?p2`, `#turn-5`, private `-<password>` link or a later upload gives the same hash; a different battle gives a different one. A rule change bumps `REPLAY_HASH_VERSION` and needs a fresh backfill.
- **`BoundReplay`**: made only by `bindReplay(url, log)` / `fetchBoundReplay(url)`, which hash and parse the same log (a brand keeps a hand-built object from type-checking). `recordGameResult` accepts a replay result only as `{ source: 'ps_replay', replay, side_player_ids }`: no winner or stats field exists on that input. `resultFromBoundReplay` maps side p1/p2 to the two given players (both must be the match's participants, one per side: 400 `match_player_not_participant` / `replay_sides_not_distinct`) and takes the winner from the side the `|win|` line names (400 `replay_winner_unknown` otherwise).
- **Callers**: `POST /api/parse-replay` (sides resolved from the PS usernames), `POST /api/admin/matches/[id]/replay-import` (sides assigned by the organizer; see [Match](./match.md#replay-binding)). `POST /api/admin/matches/[id]/replay-preview` returns the hash and refuses an already-recorded battle up front.
- **Backfill**: games recorded before 2026-10-20 have `replay_hash` NULL until a maintainer runs `scripts/backfill-replay-hashes.ts` (dry run by default; refuses to write on any collision; 1 request per second to replay.pokemonshowdown.com).

### Localization (DE/EN)
- **Directory**: `src/lib/pkmn/i18n/` (design: the Pokémon localisation spec, maintainer-only; not in this repo)
- **Data**: `i18n/data/*.json`, generated by `scripts/pkmn-i18n/generate.mjs` from PokeAPI CSVs pinned in `scripts/pkmn-i18n/source.json` (BSD-3-Clause, `i18n/NOTICE.md`), keyed by @pkmn id. Do not edit it; edit `scripts/pkmn-i18n/overrides/*` and regenerate. Name maps (`species|moves|items|abilities|misc.de.json`) are client-safe; description maps (`*.desc.de.json`) are server-only.
- **Translate at display only.** Stored values, URLs, cache keys, Showdown import/export, calc input, `ko_chance`/`description`, AI prompts and API `params` stay English. Components localize when rendering: client `const dl = useDataLocale()` (`@/i18n/client`) then `localizeSpecies(name, dl)` or `<PkmnName kind="species" name={name} />`; server `localizeX(name, await getDataLocale())` (`@/i18n/server`). Pass the canonical English **name**, not an id: `'en'` returns its input unchanged.
- **Import rule.** A module that needs one kind imports `@/lib/pkmn/i18n/names/<kind>` (`species`, `moves`, `items`, `abilities`, `misc`); the barrel `@/lib/pkmn/i18n/names` loads all five maps and is for code that needs several kinds (`PkmnName`, the draft finder, server code). `id.ts`, `names/**`, `names.ts`, `search.ts`, `types.ts` and `calc-text.ts` import no `@pkmn/*` and are client-safe. `descriptions.server.ts` (`localizeDesc`) starts with `import 'server-only'`; `client-boundary.test.ts` fails if a `'use client'` module reaches it, a `*.desc.de.json` map or `@pkmn/*`.
- **Search.** `rankedSearch` + `pkmnSearchKeys(kind, englishName)` (`@/lib/pkmn/i18n/search`, `…/names`) match English, German and the umlaut transliteration (ä→ae …), ignoring case and accents, in every locale. The `dex.ts` name searches (`searchSpecies/Moves/Items/Abilities`, the `*Rich` variants, `searchMovesForSpecies`, `searchAbilitiesForSpecies`, `searchBaseFormSpecies`) use it with a lazily built per-`(kind, gen)` index: results are ranked (exact, prefix, word prefix, substring; English name as tie-break) and `limit` applies after ranking. Server listings (`listAllSpeciesRich`, `*NatDex`, `species-list.ts`) stay English-sorted and locale-neutral; clients re-sort with `compareDisplayNames`.
- **Descriptions.** German game text exists only up to Sword/Shield (PokeAPI has none for Scarlet/Violet): SV-new entries keep the English Showdown text. Descriptions follow the UI locale (`useLocale`), not the Pokémon-terms locale. Routes call the `dex-l10n.server.ts` wrappers with `{ lang }` (read with `isLocale`, absent/invalid = `'en'`): for `'de'` each row's `shortDesc` (`desc` in `getAllItems/getAllAbilities`) becomes German and the row gains `shortDescLang` (`descLang`), so the UI can tag an English fallback with `pkmnMessages.descFallbackTag`. `dex.ts` itself cannot import the description maps: client bundles reach it through `tiers.ts` (the catalog the client imports, `format-catalog.ts`, is dex-free; `formats.ts` is server-side).
- **Stat/nature labels.** `stat-calc.ts` `STAT_LABELS` and `ALL_NATURE_NAMES` stay English (keys, Showdown "252 Atk"); `getNatureLabel(nature, locale = 'en')` delegates to `localizeNatureLabel` ("Hart (+Angr. / -Sp.-Angr.)").
- **Calc.** `CalcResult.ko` (`KoInfo`, `@/lib/pkmn/i18n/calc-text`) carries the structured KO; render it with `formatKo(r.ko, locale)` and `koLevel`.
- **Regenerating** after a `@pkmn/dex` upgrade: see [`dependencies.md`](./dependencies.md) ("German Pokémon data after a `@pkmn/dex` upgrade"). `node scripts/pkmn-i18n/generate.mjs --check` verifies the committed data.

### Sprite styles
- **Files**: `sprite-styles.ts` (client-safe resolver), `sprite-style.server.ts` (cookie read and cookie attributes), `sprite-style-signin.server.ts` (sign-in sync), `sprite-maps/` (generated), `src/components/shared/{SpriteStyleProvider,SpriteStyleAccountSync,PokemonSprite,SpriteImg,SpriteStyleOptions,SpriteStyleMenuGroup}.tsx`, `src/app/api/sprite-style/route.ts`, `supabase/migrations/20261018190000_players_sprite_style.sql`, `scripts/sprites/`.
- **Styles**: `broadcast` (high-resolution broadcast renders, self-hosted by the deployment), `home` (HOME 3D renders from img.pokemondb.net), `animated` (Showdown animated sprites), `pixel` (Showdown Gen 5 pixel sprites). The site default (`SITE_DEFAULT_SPRITE_STYLE`) is `broadcast`.
- **One place for URLs.** Every Pokémon sprite URL comes from `sprite-styles.ts`, which holds every base URL (`SPRITE_SOURCES`, `NEXT_PUBLIC_SPRITES_URL`). `spriteResolver.urlFor(style, name, { shiny, variant })` returns null when a style cannot serve a species; `spriteResolver.candidates(name, style)` is the ordered list an `<img onError>` walks: the style, then HOME, then the base form's HOME render, then a placeholder. The components keep a fixed box (`width`/`height`, `object-fit: contain`), so a fallback never shifts the layout. `PokemonSprite` picks the variant from `size` (`variantForSize`: `full` above 128 CSS px, else the 256 px thumb); `SpriteImg` from its numeric `width`/`height` (else the thumb, so a large sprite sized only by CSS classes passes `variant="full"`). Broadcast overlays always use `full`: an OBS browser source is often scaled up. `OverlayPokemonSprite` pins it, and every `SpriteImg` under `src/components/broadcast/overlays/` (the solo overlays, sized only by CSS classes) passes `variant="full"` and the site default style; `sprite-style-broadcast.test.tsx` fails on one that does not. The evolution replay bar (`CrystalXPBar`) takes species names and renders through `SpriteImg`, so it walks the same chain.
- **Broadcast**: available only when `NEXT_PUBLIC_SPRITES_URL` is set (the public bucket `sprites`, or `/sprites` in dev through `.claude/local-assets.cjs` and the capture harness) AND the species is in `sprite-maps/broadcast.json`; never shiny. Unset (a public fork, CI, tests) or unmapped means HOME. A configured but unusable value (not an http(s) URL or a root-relative path, e.g. a drive path from Git Bash's MSYS conversion) throws `SpritesBaseConfigError` when `sprite-styles.ts` loads, so `next build` and `next dev` fail instead of silently serving HOME. The map (schema 2) is `{ schema, version, entries: { <@pkmn id>: <stem> } }`: one set `version` (a content hash over every published file, `scripts/sprites/lib.mjs` `setVersion`) and the source file stem per species, so it stays small in the client bundle (about 10 KB gzipped at 1,400 species). Objects are `broadcast/{version}/256/{stem}.webp` (grids, cards, chips) and `broadcast/{version}/full/{stem}.webp` (hero, detail, overlays), cached for a year; a new set gets a new version, which busts every cached URL at once. The repository ships no art and, today, an empty map (`version` = the empty set's hash): the maintainer generates it after approving the one-time download.
- **Showdown ids**: `showdownSpriteId` splits the name at its first hyphen; the species that rule gets wrong (`Ho-Oh`, `Kommo-o-Totem`, …) are in `sprite-maps/showdown-ids.json`, generated from `@pkmn/dex` by `node scripts/sprites/build-showdown-ids.mjs` (`--check` verifies; the resolver test fails when it is stale).
- **Viewer preference**: `'site'` or a style. Signed in: `players.sprite_style` (CHECK `site|broadcast|home|animated|pixel`, default `site`; service role only), the account value. The httpOnly cookie `plc_sprite_style` is the server-render source of truth: the root layout reads only the cookie (`getSpriteStylePreference`, never the session) into `SpriteStyleProvider`, so server render and hydration agree. The account value reaches the cookie in three places:
  1. **Saving**: `POST /api/sprite-style { style }` (same-origin, zod-validated) sets the cookie for everyone and, for a signed-in caller with a player row, also the column (authorized by the live `requireAuth()`; a banned account gets 403). The column write is rate-limited to 30 per player per minute (`checkRateLimit` bucket `sprite-style`; over it: 429 `rate_limited` with `Retry-After`, no write and no cookie, so the control reverts). Anonymous calls write only their own cookie and are not limited.
  2. **Signing in**: the NextAuth jwt callback (initial sign-in only, inside the auth route handler) calls `syncSpriteStyleCookieAtSignIn`: an existing player's account value is written to the cookie when it differs, so the first page after sign-in already renders it. A player created by that sign-in has no choice yet, so a valid non-default cookie (chosen signed out) is adopted into the new account instead of being reset (it ends in the state the ruling asks for: column and cookie agree). The sync runs after the player lookup, outside its catch: a failure is logged with the full error and rethrown, so Auth.js refuses the sign-in instead of continuing with a stale cookie (AGENTS.md rule 5, no log-and-continue).
  3. **Per-tab reconcile**: `SpriteStyleAccountSync` (mounted once by the root layout) reads `GET /api/sprite-style` (`{ stored }`, `private, no-store`, the live `requireAuth()` guard) once per signed-in player and browser tab (a `sessionStorage` mark) and, when the account value differs from the cookie (changed on another device since this browser signed in), applies it and POSTs it back to the cookie. A refused or failed read (a banned account's 403, a 500) is logged once and not retried in that tab for 10 minutes (`FAILED_SYNC_RETRY_MS`), so reloads do not repeat it. The settings card does the same re-sync from its server-read value.
  The account value wins over a choice made signed out on that browser (except for a brand-new account, which adopts it). Errors: `sprite_style_invalid` (400), `sprite_style_cross_origin` (403), `rate_limited` (429), `sprite_style_save_failed` (500), `sprite_style_load_failed` (500), in `errors/common`. Deploy order: the `players.sprite_style` migration before the code (see [`supabase-environments.md`](./supabase-environments.md)).
- **Where it is chosen**: the "Sprite style" card on `/dashboard/settings` (live preview of each style) and the "Pokémon sprites" group in the NavBar language menu and the mobile drawer (the anonymous entry point). Copy: namespace `sprite-style`.
- **Surfaces that do not follow the viewer**: broadcast overlays, which are viewerless (an OBS browser source): the `(broadcast)` layout wraps every overlay page in its own `SpriteStyleProvider initialPreference="site"`, which shadows the root provider and its `plc_sprite_style` cookie, and `OverlayPokemonSprite` also pins `SITE_DEFAULT_SPRITE_STYLE` and the `full` variant; the overlay API payloads (`siteSpriteUrl`: the site default at full size); the Discord match card (`homeSpriteUrl`: the bundled satori decodes only PNG, APNG, JPEG, GIF and SVG, not WebP; lead decision 2026-10-19 keeps this HOME pin, so the mirror emits no PNG variant); the 3D route-world textures (`homeSpriteUrl` through `/api/proxy-image`, whose allowlist and the world's art direction are HOME-only).
- **The draft room's line-up picture also does not follow the viewer.** The left stage of the pick screen (`src/components/draft-tool/left/LinePreview.tsx`) pins `SITE_DEFAULT_SPRITE_STYLE` (broadcast renders, HOME where a species has none) and the `full` variant, because it shows the stages at 200 to 300 px, where a pixel or animated sprite would be scaled up blurred. Everything else in the room (the roster cards, the compact chips, the roster dock tiles and the weakness table rows) still follows the viewer's style; see [`draft-room.md`](./draft-room.md#visual-rules-pick-screen).
- **Mirroring and publishing (maintainers, approval-gated)**: `node scripts/sprites/mirror-broadcast.mjs --download` fetches the source feed and originals once (identifying User-Agent naming the public repository, at most 4 requests in flight, backoff on 429/5xx and on a body that breaks mid-stream) into `scripts/sprites/.cache/broadcast/`, writes the WebP variants into a staging directory, moves them to `public/sprites/broadcast/{version}/` and writes the map; a full run prunes other set versions, schema-1 files and the `.staging-{pid}` directories of crashed runs (a staging directory whose process still runs is left alone) from the mirror, a `--limit` trial never prunes and writes a map only to an explicit `--map` file. Without `--download` it rebuilds from the cache only and refuses when nothing is cached. `node scripts/sprites/upload-supabase.mjs --plan-dir <R1>` is a dry run that checks the mirror hashes to the map's version and writes the plan; `--live --expect-plan <R1>` refuses an existing private bucket, uploads (upsert false, max-age one year), lists every object back, fetches one through its public URL and reports (never deletes) older set versions left in the bucket. Both are maintainer-run only (AGENTS.md: automation never spends the Supabase quota). Captures are pinned to the local mirrors (`captureServerEnv` sets `NEXT_PUBLIC_SPRITES_URL=/sprites`), and the capture bucket guard (`scripts/lib/look-evidence.mjs`) fails a run that reached the `sprites` bucket as well as the `world-assets` one.

### Icon sheet cells and `SheetIcon`
- **Files**: `sheet-cells.server.ts` (server), `catalog-index.ts` (the `ic` cell of every catalog row), `src/components/shared/SheetIcon.tsx` (draws one cell with CSS).
- **Why**: the Ruleset Studio picker shows thousands of small icons. The Showdown icon sheets are one image each, so the catalog ships a cell **number** per entry and the browser draws the cell, with no request per icon and no `@pkmn/img` in a client bundle. Pokémon sheet: 12 columns of 40x30; item sheet: 16 columns of 24x24.
- **Cell 0 is "no art".** `@pkmn/img` answers cell 0 for a name it does not know, which cannot be told from the real first cell, and cell 0 of both sheets is a placeholder: 0 is reported as `null` and the picker draws its own fallback. Known gaps against the installed version: 18 Pokémon and the 16 Legends Z-A Mega Stones have no icon.
- **After upgrading `@pkmn/img`** re-check the cells: they follow the installed package, so icons drift if Showdown rebuilds a sheet and the package lags. `sheet-cells.server.test.ts` pins a few known cells (Charizard, Leftovers).

### Pokéball Spritesheet Coords
- **File**: `ball-sprites.ts`
- **Purpose**: Hardcoded Showdown itemicons spritesheet coordinates for the four balls used by the rating-tier badge (`pokeball`, `greatball`, `ultraball`, `masterball`). Consumed by `src/components/shared/PokeballIcon.tsx`. Pinning the coordinates avoids shipping `@pkmn/img` to the client bundle and avoids a network round-trip per rating badge.
- **Key Exports**: `BALL_SPRITE_SHEET_URL`, `BALL_SPRITE_CELL`, `BALL_SPRITE_COORDS`, `BallItemId`
- **Regenerate with**: `node -e "const {Icons}=require('@pkmn/img'); for(const id of ['pokeball','greatball','ultraball','masterball']) console.log(JSON.stringify({id, ...Icons.getItem(id)}))"`

## Data Flows
- **Input**: Species/format/team/replay inputs
- **Processing**:
  1. Normalize and validate entities against generation data
  2. Compute stats/speed/legality outputs
  3. Parse replay events into battle artifacts
- **Output**: Validated team/replay/stat payloads

## Dependencies
- **External Libraries**: `@pkmn/data`, `@pkmn/dex`, `@pkmn/client`, `@pkmn/protocol`, `@pkmn/sets`
- **Internal Modules**:
  - [Supabase Module](./supabase.md)
  - [Match Module](./match.md)
  - [Draft Module](./draft.md)

## API Routes
- `/api/validate-team`
- `/api/parse-replay`
- `/api/replay-frames`
- `/api/import-team`
- `/api/pkmn/search`
- `/api/pkmn/species-info`
- `/api/pkmn/moves/[species]`
- `/api/pkmn/stats`
- `/api/pkmn/catalog/[kind]` (GET, public: the entry catalog of the Ruleset Studio pickers; `kind` species | moves | items | abilities, `gen`, `scope` standard | national, `part` index | text, `lang`, `preset`; rows are short arrays so a 1,400-row National Dex index stays small, shapes in `catalog-index.ts`; ETag and a long cache, built once per process)
- `/api/pkmn/presets/[id]/rules` (GET, public: the rules a catalog preset implies, resolved for its mod and universe; the browser needs it to compute effective rules exactly as the server does without importing the dex; cacheable for an hour)
- `/api/pkmn/presets/[id]/tour-overlay` (GET, public: the documented Smogon tour extras of a draft preset, resolved to ids; 404 for a preset without)
- `/api/pkmn/speed-calc`
- `/api/pkmn/speed-search`
- `/api/pkmn/speed-tiers`
- `/api/pkmn/type-analysis`
- `/api/pkmn/evo-chain`
- `/api/pkmn/item-sprite`
- `/api/pkmn/validate-set`
- `/api/sprite-style` (POST: the viewer's sprite style; GET: the signed-in player's stored value)

## Usage Examples

```typescript
import { calcAllStats } from '@/lib/pkmn/stat-calc';

const stats = calcAllStats(baseStats, ivs, evs, 'Timid', 50);
```

## Testing
- **Test Files**: `src/lib/pkmn/__tests__/*.test.ts` (e.g. `speed-calc.test.ts`; `dex.test.ts` mocks @pkmn, `dex-l10n.test.ts` and `german-names.test.ts` use real data), `src/lib/pkmn/i18n/__tests__/*.test.ts` (names, search, descriptions, coverage, client boundary)
- Sprite styles: `src/lib/pkmn/__tests__/sprite-styles.test.ts` (resolver, maps, env base), `src/lib/pkmn/__tests__/sprite-style-signin.test.ts` (sign-in cookie sync; `src/__tests__/auth.test.ts` covers the jwt-callback wiring), `src/components/shared/__tests__/sprite-style*.test.ts(x)` (components, fallback, bucket case, overlays, the per-tab reconcile and its failure backoff), `src/app/api/sprite-style/__tests__/route.test.ts`, `src/lib/supabase/queries/__tests__/player-sprite-style.test.ts`, `scripts/sprites/__tests__/*.test.mjs` (mirror and upload with a mocked fetch and a fake Storage client), `scripts/__tests__/bucket-guard.test.mjs` (capture env pin and the sprites-bucket guard).
- **Running Tests**: `npx vitest run src/lib/pkmn`

## Related Modules
- [Match Module](./match.md)
- [Draft Module](./draft.md)
- [Supabase Module](./supabase.md)

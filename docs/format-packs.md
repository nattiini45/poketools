# Format Packs

> A league's **tuning** (numbers, per-line rulings, taxonomies, rule prose and the workbook layout) lives in a format pack. The public code keeps the **mechanics** and reads the tuning of the active pack through `@/lib/format-pack`. A public checkout runs on the neutral **example pack**; a maintainer build attaches a private pack from the companion overlay.

## Overview

PokéTools ships three league formats whose mechanics are public:

- **Evolution Point Buy** (EPB, format id `evolution_point_buy`): point-buy draft over evolution lines, progress sources, tokens, redraft. See [Evolution Point Buy](./evolution-point-buy.md).
- The legacy **`draft`** format: evolution tiers, wildcards and S/A/B/C tier limits.
- **Core Liga**: type cores and gym types on classic formats.

Everything a league tunes on top of those mechanics is pack data: the EPB defaults (budget, picks, token ratio and caps, bans), match points, Tera by stage, the tiebreaker chain, the Comeback table, the stage lock, Participation Tokens, price groups and price tabs, per-line rulings and threshold overrides, the utility categories, the workbook layout, the reconciliation tables, the `draft`-format and Core Liga UI defaults, and the rule prose shown to players.

The rule for what goes where: **mechanics are public under neutral names; tuning and league flavour belong to a pack.** A mechanic keeps a neutral public name (for example "Participation Tokens" for tokens a line earns by being brought), and the pack supplies the league's own wording through its `messages`.

## File Structure

```
src/lib/format-pack/              PUBLIC: contract and accessors; the only importer of '@format-pack'
├── types.ts                      FormatPack and its sub-types (the contract)
├── schema.ts                     zod schema + cross-field rules; parseFormatPack, formatPackIssues
├── define.ts                     definePackEn<typeof ExampleEn>() (message-tree contract)
├── stored-flags.ts               STORED_FLAG, storedFlagsOf (pack rule -> stored jsonb flags)
├── validate.ts                   server-side validation (parseFormatPack)
├── validate.browser.ts           browser twin: identity (keeps zod out of client bundles)
├── active.ts                     import raw from '@format-pack'; validate + deep-freeze
├── index.ts                      formatPack + accessors; every consumer imports from here
└── __tests__/                    pack-contract.test.ts, pack-pkmn.server.test.ts
src/format-packs/example/         PUBLIC: the neutral example pack (contract owner)
├── index.ts                      default export, `satisfies FormatPack`
├── epb.ts, utility.ts, workbook.ts, draft-format.ts, core-liga.ts
└── messages/en.ts, messages/de.ts
src/format-packs/private/         COMPANION (gitignored): the maintainers' league pack, same file set
└── __tests__/                    companion tests (golden parity, moved test copies, frozen fixtures)
docs/format-pack-private/         COMPANION (gitignored): the maintainers' league docs
scripts/draft/make-example-list-fixtures.ts   writes the example list fixtures from the example pack
```

`.gitignore` lists `/src/format-packs/private/` and `/docs/format-pack-private/` under the "private companion overlay" block. Never run `git clean -X` in a checkout that carries the overlay: it deletes the private pack.

## Choosing the Active Pack

The bare specifier `@format-pack` resolves to exactly one pack entry file:

```
FORMAT_PACK = 'example'                                  -> example
FORMAT_PACK = 'private' and the private entry is missing -> hard error
src/format-packs/private/index.ts exists                 -> private
otherwise                                                -> example
```

| `FORMAT_PACK` | Effect |
|---|---|
| unset (or empty) | The private pack when `src/format-packs/private/index.ts` is on disk, else the example pack. |
| `example` | Always the example pack, even when the private pack is present. CI and the public view use this. |
| `private` | The private pack; `next.config.mjs` throws when it is missing. Set for Production, so a build that lost the pack fails instead of silently shipping the example rules. |
| anything else | `next.config.mjs` throws. |

How each tool resolves `@format-pack`:

| Tool | Resolution |
|---|---|
| `next dev` / `next build` (Turbopack) | `next.config.mjs` computes the entry with `existsSync` and `FORMAT_PACK`, and sets `turbopack.resolveAlias['@format-pack']`. It logs `[format-pack] using private pack` or `[format-pack] using example pack` once; the Vercel build log is checked against that line. Never add a `webpack` key: it makes `next build` fail. |
| `tsc`, the IDE, the type check in `next build` | `tsconfig.json` `paths`: `"@format-pack": ["./src/format-packs/private", "./src/format-packs/example"]`. TypeScript takes the first target that resolves. Not switchable by env, which is fine: both packs satisfy one contract type, so type checking does not depend on the pick. |
| tsx scripts | tsconfig `paths`, private first. `scripts/tsconfig.audit.json` replaces `paths` wholesale, so it repeats the entry with `../src/...` targets. A script that must always use the example pack imports it by relative path (as `make-example-list-fixtures.ts` does). |
| Vitest | Per project, in `vitest.config.ts`. The public `app` project **always** aliases the example pack, so public tests never depend on the companion. The `private-pack` project exists only when the private entry is on disk and `FORMAT_PACK` is not `example`; it aliases the private pack and runs `src/format-packs/private/__tests__/**`. |

### Verification outcome

The format-pack foundation verified the alias precedence with a temporary page that imports the pack, building each case and searching the build output for the private pack's id:

| Case | Private id in the build output |
|---|---|
| private pack present, `FORMAT_PACK` unset | found (3 output files) |
| private pack present, `FORMAT_PACK=example` | none |
| private pack absent | none |

So `turbopack.resolveAlias` takes precedence over the tsconfig `paths` entry, and the fallback design (a generated `src/format-packs/active.ts`) is not used.

Type-checking the "absent" case: renaming `private/` in place does not detach it, because `tsconfig.json` includes `**/*.ts`. Move the folder outside the checkout instead, and move it back afterwards.

## Public API

Import only from `@/lib/format-pack`. `src/lib/format-pack/active.ts` is the only module that imports `@format-pack`; no other file imports a pack folder (the example fixture generator and the contract tests are the deliberate exceptions, and they import the example pack by relative path).

- **`formatPack`**: the active pack, validated with `parseFormatPack` at module load on the server (build, SSR, route handlers, scripts, Vitest) and deep-frozen everywhere. Browser bundles skip the zod parse: `next.config.mjs` aliases `@/lib/format-pack/validate` to `validate.browser.ts` under the `browser` condition, which keeps zod (about 70 kB gzip) out of every route. Copy an array before you sort or mutate it.
- **Accessors** (thin and pure): `epbPack`, `epbLineRuleForBase(base)`, `storedSpecialRulesForBase(base)`, `lineOverrideFor(lineId)`, `comebackTokensFromTable(loserSurvivors, winnerSurvivors)`, `teraEligibilityForStage(stage)`, `priceGroupForPrice(price)`, `priceTabOf(price)`, `utilityLabel(key, locale)`, `participationLineBase()`.
- **Also exported**: `STORED_FLAG`, `storedFlagsOf`, `definePackEn`, `PackEn`, and the contract types (`FormatPack`, `EpbLineRule`, `LineOverride`, `PackUtilityCategory`, `WorkbookMap`, `RuleConflict`, `RuleCheckContext`, `PackMessagesEn`, `PackMessagesDe`, `TeraEligibility`).

The module is client-safe: a pack may import only `@/types/*`, `@/i18n/define`, `@/i18n/types`, `@/lib/format-pack/types` and `@/lib/format-pack/define`, never `server-only`, `@pkmn/*`, Supabase, `next/*` or `node:*`. `src/lib/draft/__tests__/client-safe-imports.test.ts` scans the whole pack chain. The pack therefore ends up in client bundles; its prose is shown on the site anyway. Server-only work that reads pack data (learnset matching with `@pkmn/dex`, workbook parsing) stays in public library code.

## The Contract

`FormatPack` (`src/lib/format-pack/types.ts`):

| Field | What it tunes |
|---|---|
| `id` | `'example'` or the pack's own id; also the build marker searched for in the verification above. |
| `epb.defaults` | `format_rules` defaults and the fallbacks of a missing row: `draftBudget`, `draftPicks`, `tokenRatio`, `tokenMax`, `tokenMaxPerLine`, `redraftMaxLines`, `bannedMoves`, `bannedItems`. |
| `epb.matchPoints` | Points for a win and a draw. |
| `epb.teraByStage` | `any`, `stab_only` or `none` for stage 1, 2 and 3. |
| `epb.tiebreakerChain` | Ordered steps; `decision_match`, if present, is last. |
| `epb.comeback.table` | Comeback Tokens of a shutout loss (loser 0 alive): the highest row whose `minWinnerSurvivors` the winner reaches. May be empty. |
| `epb.stageLock` | Reaching `stage` by matchday `byMatchday` suspends the line for `suspendMatchdays`. |
| `epb.participationPoints` | Participation Tokens: `perMatchday` while below `untilStage`; `locksRedraft` keeps those lines out of the redraft; `awardNote` is the note stored on each award's progress-log row. |
| `epb.priceGroups`, `priceGroupOrder` | Price range per stored `PriceGroup` key (`premium`, `hoch`, `mittel`, `guenstig`, `budget`), highest first. |
| `epb.priceTabs` | The finder's price tabs (`key`, `min`, `max`), highest first. |
| `epb.lineRules` | Per-line rulings by stored base name: `participationPoints`, `redraftLocked`, `instantFinalStage`, `noCocoon`, `expectedThresholds` (importer sanity check). |
| `epb.lineOverrides` | League threshold overrides per `line_id`, with a bilingual `reason` and a `source`. |
| `epb.specialRulesEn` | Authored English special-rule text per `line_id`, keyed to the German text by `de_hash`. |
| `epb.utility` | Utility categories (`@pkmn` move and ability ids), their order and the dropped ids. |
| `epb.workbook` | The workbook layout the importers read. See [Point-Buy Workbook Format](./point-buy-format.md). |
| `epb.reconciliation` | Id tables for the reconciliation report (`knownRepoOnlyBanIds` reaches the hook as `context.knownRepoOnlyBanIds`), plus an optional pure `ruleChecks` hook over the rules-sheet rows and an `overrideRowPattern`. |
| `draftFormat` | Legacy `draft` format UI defaults: `tierLimitDefaults`, `newTier`, `newWildcard`, `hintSpecies`. |
| `coreLiga` | Core Liga UI defaults: `newTripleDefault`, `typeQuotaDefault`, `evioliteCapTierDefault`. |
| `messages` | `en` and `de` message subtrees spliced into the i18n namespaces, plus the `utility` label map. |

`parseFormatPack` (`schema.ts`) checks every section strictly and adds cross-field rules: unique and complete price groups with disjoint, descending ranges; 1 to 6 disjoint descending price tabs (no `all` key); utility keys and lower-case ids; a unique tiebreaker chain; a strictly ascending Comeback table; stage-lock and participation bounds; unique line rules and override ids; distinct workbook columns; equal en/de message keys with a label for every utility key; and exact `S`/`A`/`B`/`C` tier-limit keys. An invalid pack throws `[format-pack] invalid pack "<id>": <path>: <message>; …` at module load on the server. Import `parseFormatPack` / `formatPackIssues` from `@/lib/format-pack/schema` (server and tests only).

### Stored names stay

Pack rule names map onto the stored `point_buy_list_entries.special_rules` jsonb keys through the fixed public constant `STORED_FLAG`:

| Pack rule | Stored key |
|---|---|
| `participationPoints` | `cosmog` |
| `redraftLocked` | `no_redraft` |
| `instantFinalStage` | `scatterbug` |
| `noCocoon` | `no_cocoon_rule` |

These keys, the columns `cosmo_points` / `cosmo_point`, the error code `COSMOG_REDRAFT_LOCKED` and the TS identifiers that mirror them are stored data and keep their names. Only user-facing names come from the pack.

### SQL residuals

Applied migrations are never edited, so a few behaviours are fixed in SQL. Public TypeScript must not contradict them:

| SQL (applied migrations) | What it fixes | Agreement |
|---|---|---|
| `20261012024916_draft_rpcs.sql` (redraft pool, the `COSMOG_REDRAFT_LOCKED` raise, the `no_redraft_line_ids` snapshot), `20261012025023_redraft_rpcs.sql` | Lines flagged `no_redraft` cannot be dropped or picked in the redraft. | The importer stores `no_redraft` for every pack line with `redraftLocked`; the schema requires `redraftLocked` on every participation line when `locksRedraft` is true. |
| `20261012024202_draft_queue_engine.sql`, `20261012024916_draft_rpcs.sql` | `redraft_lock_no_redraft_lines` defaults to true. | Public mechanic. |
| `20261012024916_draft_rpcs.sql` (`draft_create_pool`), `20261012025023_redraft_rpcs.sql` (`redraft_set_submission`) | Hard-coded fallbacks. Initial pools: budget 180 and 9 picks when neither the request config nor `format_rules` supplies one (a redraft pool stores no budget and inherits the roster). Redraft line cap: `draft_create_pool` stores the request's `redraft_max_lines`, otherwise NULL for an initial pool and 3 for a redraft pool; `redraft_set_submission` takes no max and enforces `COALESCE(redraft_max_lines, 3)`. | Every EPB season gets a `format_rules` row from the pack at creation, so the budget and picks fallbacks are not reached in normal use. No pool-creation path sends the pack's `redraftMaxLines` today (the admin create actions send no config), so a live redraft cap is 3 unless an admin sets the pool's cap; the pack value only feeds the draft preview and `DEFAULT_DRAFT_CONFIG`. Where TS must agree with a NULL or missing value (the legacy pick cap, the redraft submission DTO), it mirrors the SQL literal through `src/lib/draft/sql-fallbacks.ts`, never the pack default. |
| `20260727000000_evolution_point_buy.sql` | Column defaults of `format_rules` (Tera, budget, picks, token fields). | `upsertFormatRules` always writes every column. |
| `20260727150755_epb_recalculate_evolution_points.sql` | One evolution point per player and matchday. | Fixed public mechanic, not a pack field. |
| `20261012094028_draft_review_fixes.sql` | One positive `cosmo_point` row per tracker and matchday (unique index). | `perMatchday` is the amount of that one row. |
| `20261012024254_epb_progress_sources.sql` | `total_kos` includes `cosmo_points`. | Mechanic. |
| `20260727000000_evolution_point_buy.sql` | Team-role category CHECK. | `TeamRoleCategory` stays public. |
| baseline migration | `power_tier` default `'C'`. | Public vocabulary. |

Outside the applied migrations: the pre-baseline migration history (maintainers only) seeds the Core Liga rulesets. It is reference-only, never applied, and not part of a public checkout.

The header comment of the applied `20261012024916_draft_rpcs.sql` names `rpc.live-db.test.ts`. That live-DB test is maintainer-only and lives in the companion overlay, not in a public checkout; the comment stays because applied migrations are not edited.

## Messages

Rule prose that is league tuning lives in the pack's `messages` and is **spliced** into its existing i18n namespace, so namespace ids, key paths and consumers stay unchanged:

```ts
// src/i18n/messages/world/evoliga/en.ts
import { formatPack } from '@/lib/format-pack';
const P = formatPack.messages.en.worldEvoliga;
export default { …, rules: { heading: 'Rules', …, ...P.rules } } as const;
// de.ts
const P = formatPack.messages.de.worldEvoliga;
export default defineDe<typeof en>()({ …, rules: { heading: 'Regeln', …, ...P.rules } });
```

- The subtrees are `worldEvoliga`, `draftTokens`, `draftRedraft`, `glossary`, `enums`, `paint`, `draftLegacyEvolution`, `leagueAdminSeasonPage`, `draftShared`, `adminCore`, `draftAdmin`, `draftScreen`, `worldClient` (the roster table's price groups with their ranges) and `leagueHub` (the EPB scoring and tiebreak sentences). Each mirrors the key paths of its namespace (for example `draftLegacyEvolution.summary.suspendedNext`).
- `utility` is not spliced: it holds one label per `epb.utility.order` key, read with `utilityLabel(key, locale)`.
- **The example pack's `messages/en.ts` is the contract.** Another pack declares `export default definePackEn<typeof ExampleEn>()({ … } as const)`. `definePackEn` applies the `defineDe` rules against the example tree: a missing or extra key, a renamed placeholder or tag, or a string-vs-plural mismatch fails `tsc`; the texts may differ freely. Where a pack's text needs no placeholder, the example has none either.
- The German tree uses `defineDe<typeof en>()` as usual. `src/i18n/__tests__/parity.test.ts` still covers the spliced leaves; the pack-contract test adds its own en/de key check.
- `scripts/i18n-allowlist.json` allowlists `src/format-packs/**` (data and message trees, contract-tested).

See [Internationalization](./i18n.md) for the namespace rules.

## Writing Your Own Pack

A self-hoster tunes the formats by supplying a pack in the private slot, `src/format-packs/private/`. The resolver picks it up automatically.

1. Copy `src/format-packs/example/` to `src/format-packs/private/`. Rename the exports if you like, and give `index.ts` its own `id` (it is your build marker).
2. Edit the values in `epb.ts`, `utility.ts`, `workbook.ts`, `draft-format.ts` and `core-liga.ts`. Keep `satisfies FormatPack` (or the section type) on each object, so `tsc` checks the shape.
   - `lineRules[].base` is the stored English base name of a line in your point-buy list; `lineOverrides[].line_id` is `toID(base)--toID(final stage)`.
   - Utility member ids are lower-case `@pkmn` ids.
   - Describe your workbook in `workbook.ts`; see [Point-Buy Workbook Format](./point-buy-format.md).
3. Write `messages/en.ts` as `definePackEn<typeof ExampleEn>()({ … } as const)` (import `ExampleEn` as a type from `@/format-packs/example/messages/en`) and `messages/de.ts` as `defineDe<typeof en>()({ … })`. Word the prose for your own numbers, and add one `utility` label per utility key in both languages.
4. Check it:
   - `npx tsc --noEmit` (message contract, section types);
   - `npx vitest run src/lib/format-pack` (the private-pack cases of `pack-contract.test.ts` and `pack-pkmn.server.test.ts` run when the folder exists);
   - `npm run dev` and look for `[format-pack] using private pack`.
5. Deploy: the folder is gitignored. Either un-ignore it in your fork, or deliver it to the build the way the maintainers do (below). Set `FORMAT_PACK=private` for production builds so a missing pack fails the build.

Optional: add your own tests under `src/format-packs/private/__tests__/`; the `private-pack` Vitest project runs them against your pack.

## Maintainer Builds

- The maintainers' pack lives in the companion overlay and is listed in its `PATHS`.
- `scripts/fetch-private-assets.mjs` (run by `prebuild`) extracts `src/format-packs/private/` from the private assets repository (`PRIVATE_ASSETS_REPO`, `PRIVATE_ASSETS_REF`, `PRIVATE_ASSETS_TOKEN`) with the other private assets, skipping `src/format-packs/private/__tests__/`. A tarball without the pack folder fails the fetch. Without a token the fetch is skipped and the build uses the example pack, except on a Vercel production build, which fails unless `ALLOW_PLACEHOLDER_ASSETS=1`.
- Vercel Production sets `FORMAT_PACK=private`, so `next.config.mjs` throws instead of shipping the example pack. Preview builds without a token use the example pack.
- The build log line `[format-pack] using … pack` and the pack `id` in page source tell which pack a deployment carries.

## Testing

| Command | What runs |
|---|---|
| `npm test` | `app` (example pack) + `scripts`; plus `private-pack` when the private pack is present. |
| `FORMAT_PACK=example npm test` | The public view only; this is what CI runs. |
| `npx vitest run --project private-pack` | Only the companion suite (golden parity, moved test copies). |
| `npx vitest run src/lib/format-pack` | The contract tests: `pack-contract.test.ts` (schema, message tree, example fixture, accessors, `definePackEn` type checks) and `pack-pkmn.server.test.ts` (every utility id, line-rule base and hint species against `@pkmn/dex`). |

Public tests read values from `@/lib/format-pack` when the assertion is about the mechanism; literal expectations are fine when they are the example pack's own values.

**Fixtures.** `npx tsx --tsconfig tsconfig.json scripts/draft/make-example-list-fixtures.ts` writes the example list fixtures from the example pack (it imports the pack by relative path, so the output is the same on every checkout):

- `src/lib/draft/__tests__/fixtures/example-list.json` (importer-row shape);
- `src/app/(public)/draft-preview/fixture-lines.example.json` (read-layer shape, example overrides applied).

The skeleton is synthetic: 48 lines with two- and three-stage lines, five branched bases (Pichu, Ralts, Poliwag, Oddish, Eevee), the example pack's rule lines and its override line. Prices, thresholds and ratings come from a fixed seed.

## The Example Pack

The example pack is deliberately unlike any real league. Its values:

| Field | Example value |
|---|---|
| defaults | budget 100, picks 6, token ratio 5, token max 1, max 1 per line, redraft max 2 lines; bans: move Last Respects, item Bright Powder |
| match points | win 3, draw 1 |
| Tera by stage | any / any / STAB only |
| tiebreakers | match points, kill difference, evolution points, head-to-head, decision match |
| Comeback table | winner keeps 4+ → 1 token |
| stage lock | stage 3 by matchday 2 → sits out 1 matchday |
| Participation Tokens | 1 per matchday until stage 3; the line is redraft-locked |
| price groups | Top 20–25, Upper 15–19, Middle 10–14, Lower 6–9, Bargain 1–5 |
| price tabs | `25-20`, `19-15`, `14-10`, `9-1` |
| line rules | Dratini: participation + redraft-locked (override 5 / +5); Grubbin: instant final stage (expected 1 / +0); Axew: no cocoon |
| utility | `hazards`, `hazard_control`, `recovery`, `pivot`, `priority`; Rest is a `recovery` member that matches only when selected on its own (`inParentMatch: false`) |
| workbook | sheets `Lines`, `Summary`, `Rules`, `Utility` ([layout](./point-buy-format.md)) |
| `draft` format | tier limits S 1, A 1, B 2, C 2; new tier 2 / 5 KOs, tier C; new wildcard 2 / 5; hints Bulbasaur, Pichu |
| Core Liga | new triple Normal / Fighting / Flying; type quota from the player core, min 1, no multi-count; Eviolite cap tier UU |

## Related Modules

- [Evolution Point Buy](./evolution-point-buy.md)
- [Point-Buy Workbook Format](./point-buy-format.md)
- [Import](./import.md) and [Data Import Guide](./DATA_IMPORT_GUIDE.md)
- [Draft Room](./draft-room.md)
- [Internationalization](./i18n.md)

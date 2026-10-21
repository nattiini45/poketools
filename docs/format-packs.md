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
src/lib/pack-extensions/          PUBLIC, server-only: the extension contract; the only importer of '@pack-extensions'
├── types.ts                      PackExtensions and the neutral supplementary shapes (the contract)
└── index.ts                      packExtensions, loadSupplement, siteNavExtraLinks
src/format-packs/example/         PUBLIC: the neutral example pack (contract owner)
├── index.ts                      default export, `satisfies FormatPack`
├── epb.ts, utility.ts, workbook.ts, draft-format.ts, core-liga.ts
├── messages/en.ts, messages/de.ts
└── extensions/index.ts           the example pack's extensions: `{}` (none)
src/format-packs/private/         COMPANION (gitignored): the maintainers' league pack, same file set
├── extensions/                   the private pack's extensions (server-only)
└── __tests__/                    companion tests (golden parity, moved test copies, frozen fixtures)
supabase/migrations-private/      COMPANION (self-ignoring): migrations of pack-only tables, applied by hand
docs/format-pack-private/         COMPANION (gitignored): the maintainers' league docs
scripts/draft/make-example-list-fixtures.ts   writes the example list fixtures from the example pack
```

`.gitignore` lists `/src/format-packs/private/` and `/docs/format-pack-private/` under the "private companion overlay" block. Never run `git clean -X` in a checkout that carries the overlay: it deletes the private pack.

### The overlay mirror

A pack may carry `src/format-packs/private/overlay/`: files that belong elsewhere under `src/` (routes above all, which Next.js only finds under `src/app/`). `scripts/mirror-private-overlay.mjs` (run by `predev` and `prebuild`; `npm run mirror:overlay` by hand) copies `overlay/<path>` to `src/<path>`, skipping `__tests__` folders. The copies are generated: edit the overlay file and re-run the mirror, never edit the copy.

- **Whole private folders only.** Every output belongs to an output root: the shallowest folder on its path under `src/` that holds no tracked file (`overlay/lib/x/a.ts` lands in the root `src/lib/x/`). An overlay file with no such folder would be a single private file inside a public folder and is refused (`FILE_IN_PUBLIC_DIR`): give it a private folder of its own.
- **Self-ignoring roots.** Before it copies anything into a root, the mirror writes a `.gitignore` containing `*` there (it ignores itself and everything beside it). No public file has to name a private folder, and `git add -A` can never pick an output up. A root that already holds anything the mirror did not write is refused (`ROOT_HAS_FOREIGN_FILES`), because the `*` would hide it; so is an overlay file that would replace that `.gitignore` (`RESERVED_NAME`). The "overlay mirror outputs" block of `.gitignore` names only the manifest: every root ignores itself.
- **Guards.** Before writing anything the mirror also refuses, with exit 1 and a reason per path: a destination git tracks (`TRACKED`); an output that neither the `.gitignore` files committed at HEAD nor its root's own `.gitignore` ignore (`NOT_COMMITTED_IGNORED`; an uncommitted `.gitignore` edit or a local `.git/info/exclude` does not count); a symlink (`SYMLINK`) or a path that resolves outside `src/` (`OUTSIDE_TARGET`); an output edited since it was mirrored (`EDITED_IN_PLACE`); an untracked file at a destination that differs from the overlay (`UNTRACKED_DIFFERS`; an identical one is adopted); and a git that cannot answer (`GIT_UNAVAILABLE`). One refusal stops the whole run.
- **Manifest.** `.overlay-manifest.json` (repository root, ignored; version 2) records each output with its source and sha256, and every output root. An output whose overlay file was removed is deleted on the next run, and its emptied folders are pruned; a root left without outputs loses its `.gitignore` and is pruned too. A version 1 manifest (no roots) is read and upgraded. Before its first copy or delete, a run writes a pending manifest that already lists every planned output (with the sha256 of the bytes it replaces as `prior`) and keeps every output and root still to be removed, so a run that crashes mid-way leaves only outputs the manifest knows: the next run finishes the job (`--check` reports it as not up to date until then), and a hand edit is still refused as `EDITED_IN_PLACE`. A crash in the middle of a copy can also leave a `<output>.overlay-tmp` file beside an output the manifest lists (or beside a root's `.gitignore`); the next run deletes it as the mirror's own temp instead of refusing the root, so no manual clean-up is needed. The exception is a file of that name that git tracks: it is refused (`TRACKED`) and never deleted. When the whole overlay folder is gone but the manifest still lists outputs, the run fails (`OVERLAY_MISSING_WITH_OUTPUTS`): restore the overlay, or pass `--prune` to delete the outputs.
- **Imports.** Overlay code imports public modules and other overlay outputs through their mirrored `@/...` paths, never the overlay folder itself: one module instance each, and the outputs type-check against either pack. Run the mirror before `npm run typecheck` or the `private-pack` tests on a maintainer checkout.
- **Private migrations.** Tables that only a pack uses are created by migrations in `supabase/migrations-private/`, a folder that ignores itself the same way (its `.gitignore` is `*`; the companion repository force-adds the files). The Supabase CLI never reads it: a maintainer applies those files by hand. They create new tables (RLS on, `service_role` grants only, no policies) and the SQL functions the pack's own tools call (`service_role` EXECUTE only), and never alter or drop a public table.
- **Flags.** `--check` prints what a run would change and exits 1 when anything is pending or refused (a local check; CI has no overlay). `--force` overwrites, or deletes, outputs that were edited in place. `--quiet` drops the summary line.
- **Public checkout.** Without the overlay folder and without a manifest the mirror is a no-op and does not call git. A pull that drops the overlay folder but leaves the manifest makes the next run fail with `OVERLAY_MISSING_WITH_OUTPUTS` (pass `--prune` to delete the outputs). `git clean -X` deletes the private pack, the outputs and the manifest together, so the next run is a silent no-op: restore the overlay from the companion repository and run the mirror again.

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
| `example` | Always the example pack, even when the private pack is present. CI sets it on the build step (`.github/workflows/ci.yml`, mirrored by `BUILD_ENV` in `scripts/verify-ci.mjs`), and the public view uses it. |
| `private` | The private pack; `next.config.mjs` throws when it is missing. Set for Production, so a build that lost the pack fails instead of silently shipping the example rules. |
| anything else | `next.config.mjs` throws. |

How each tool resolves `@format-pack`:

| Tool | Resolution |
|---|---|
| `next dev` / `next build` (Turbopack) | `next.config.mjs` computes the entry with `existsSync` and `FORMAT_PACK`, and sets `turbopack.resolveAlias['@format-pack']`. It logs `[format-pack] using private pack` or `[format-pack] using example pack` once; the Vercel build log is checked against that line. When `NODE_ENV` is `production` (`next build`, `next start`), the example pack is active and `FORMAT_PACK` is unset, it also prints a `[format-pack] WARNING` block (`scripts/format-pack-notice.mjs`): the example numbers would be written into new point-buy seasons. `FORMAT_PACK=example` acknowledges the example pack and silences it (CI sets it). Never add a `webpack` key: it makes `next build` fail. |
| `tsc`, the IDE, the type check in `next build` | `tsconfig.json` `paths`: `"@format-pack": ["./src/format-packs/private", "./src/format-packs/example"]`. TypeScript takes the first target that resolves, so on a maintainer checkout `npm run typecheck` checks the private pack. Not switchable by env, which is fine: both packs satisfy one contract type. |
| `npm run typecheck:example` | `tsconfig.json` extended by `tsconfig.example.json`, which pins `@format-pack` and `@pack-extensions` to the example pack and excludes the private pack folder. Outputs in self-ignoring roots stay in scope when they are on disk, which is why overlay code imports only public modules and other outputs. It checks the pack a public checkout builds; CI runs it before the build. Keep its `paths` and `exclude` in step with `tsconfig.json` (both replace the base value wholesale). |
| tsx scripts | tsconfig `paths`, private first. `scripts/tsconfig.audit.json` replaces `paths` wholesale, so it repeats the entry with `../src/...` targets. A script that must always use the example pack imports it by relative path (as `make-example-list-fixtures.ts` does). |
| Vitest | Per project, in `vitest.config.ts`. The public `app` project **always** aliases the example pack, so public tests never depend on the companion. The `private-pack` project exists only when the private entry is on disk and `FORMAT_PACK` is not `example`; it aliases the private pack and runs `src/format-packs/private/__tests__/**`. |

`@pack-extensions` (see "Pack extensions" below) follows `@format-pack` in every tool: `next.config.mjs` derives it from the chosen pack entry (`<pack>/extensions/index.ts`, a hard error when that file is missing), `tsconfig.json` and the tsx configs list the private folder first, `tsconfig.example.json` pins the example folder, and each Vitest project aliases the extensions of the pack it aliases.

### Verification outcome

The format-pack foundation verified the alias precedence with a temporary page that imports the pack, building each case and searching the build output for the private pack's id:

| Case | Private id in the build output |
|---|---|
| private pack present, `FORMAT_PACK` unset | found (3 output files) |
| private pack present, `FORMAT_PACK=example` | none |
| private pack absent | none |

So `turbopack.resolveAlias` takes precedence over the tsconfig `paths` entry, and the fallback design (a generated `src/format-packs/active.ts`) is not used.

Type-checking the "absent" case: renaming `private/` in place does not detach it, because `tsconfig.json` includes `**/*.ts`. Move the folder outside the checkout instead, and move it back afterwards.

## Pack extensions

A pack may also extend the app beyond tuning, with data or pages that only its deployment has. The public app offers neutral seams for that and consults them only when the active pack fills them, so the open-source build carries no pack-specific code, schema, wording or data. Mechanics stay public; anything only one league needs lives in its pack.

- **Contract.** `src/lib/pack-extensions/types.ts` (`PackExtensions`, server-only). Every member is optional; the example pack exports `{}`. Read the active pack's extensions only through `@/lib/pack-extensions`, the single importer of `@pack-extensions`.
- **Supplementary records.** Results a deployment keeps outside the app's own match pipeline (never in `matches`, `games`, `battle_stats`, aggregates or ratings). Providers return neutral shapes: `supplementaryKillRanking` (the Insights kills tab, global scope), `supplementaryPlayerRecord` (a profile section), `supplementaryHeadToHead` (the `supplement` member of `GET /api/matches/head-to-head`) and `supplementaryPokemonKos` (the Pokémon page). `includeSupplementaryRecords` decides per request whether they count for the viewer; without it they always count. Public pages show them beside the live statistics, labelled "Earlier records" (`supplementary-records` namespace), and never add them to the live numbers.
- **Pages and sections.** `ProfileSection` and `SettingsSection` are server components rendered on the profile and on `/dashboard/settings`; `adminLinks` and `siteNavItems` add localized links to the admin rail (same role rules as built-in items) and to the site navigation. The pages themselves are overlay routes (see "The overlay mirror").
- **When it runs.** Every provider runs per request, after the cached reads (never inside `unstable_cache` / `publicReads`), through `loadSupplement(name, provider)`: `absent` without a provider (no session read, no query, so query budgets are unchanged), `excluded` when the records do not count for the viewer, `ready`, or `failed` (logged with the provider's name; the page says the records could not be loaded instead of showing partial numbers). The request context carries the session's player id for display decisions only.
- **Error codes and audit actions.** An extension's routes send `ExtensionErrorCode`s (made by `extensionErrorCode()` in `src/lib/api/extension-error-code.ts`) from a catalog the extension ships and renders itself, and audit their writes as `extension.<name>` actions. `auditActionLabels` gives those actions localized labels for the audit log and the admin dashboard (`extensionAuditActionLabels()`, passed to `auditActionLabel`); only `extension.*` keys are taken, and an action without a label is shown humanized.
- **Link and label providers do not fail open.** `siteNavItems`, `adminLinks` and `auditActionLabels` are static pack code read through `siteNavExtraLinks()`, `extensionAdminLinks()` and `extensionAuditActionLabels()` (`src/lib/pack-extensions/index.ts`). An error they throw propagates to the page's error boundary; it is never swallowed into an empty list, because a provider that throws is a pack bug the pack's tests must catch. Data providers report instead of throwing: `loadSupplement` logs the provider's name (`[pack-extensions] <name> failed:`), returns `failed`, and the page says so.
- **Routes ignore `FORMAT_PACK`.** Next.js finds routes by file, so on a maintainer checkout the mirrored overlay routes under `src/app/` are built even with `FORMAT_PACK=example`; the seams then hide only their links. A public checkout has no overlay, so no such route exists there. To build a maintainer checkout without the pack's routes, move the private pack out of the checkout and run the mirror (it deletes the outputs it recorded, with `--prune`).
- **Client safety.** Extensions are not part of the pack chain: the client-safe scans skip a pack's `extensions/` folder, and no pack file may import it.

## Public API

Import only from `@/lib/format-pack`. `src/lib/format-pack/active.ts` is the only module that imports `@format-pack`; no other file imports a pack folder (the example fixture generator and the contract tests are the deliberate exceptions, and they import the example pack by relative path).

- **`formatPack`**: the active pack, validated with `parseFormatPack` at module load on the server (build, SSR, route handlers, scripts, Vitest) and deep-frozen everywhere. Browser bundles skip the zod parse: `next.config.mjs` aliases `@/lib/format-pack/validate` to `validate.browser.ts` under the `browser` condition, which keeps zod (about 70 kB gzip) out of every route. Copy an array before you sort or mutate it.
- **Accessors** (thin and pure): `epbPack`, `epbLineRuleForBase(base)`, `storedSpecialRulesForBase(base)`, `lineOverrideFor(lineId)`, `comebackTokensFromTable(loserSurvivors, winnerSurvivors)`, `teraEligibilityForStage(stage)`, `priceGroupForPrice(price)`, `priceTabOf(price)`, `utilityLabel(key, locale)`, `ruleConflictText(key, params, locale, pkmn?)` (optional `pkmn`: the conflict's `pkmnParams` and a move/item localizer for the data locale), `participationLineBase()`, `comebackEarnWindow()`, `comebackTokensPerProgress(isParticipationLine)`, `draftQuietHours()`; the quiet-hours validators `isValidQuietHours(window)` and `isKnownTimeZone(zone)`.
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
| `epb.comeback.earnWindow` | Which completed matches earn Comeback Tokens: `season` (every round) or `first_half` (rounds up to `floor(rounds / 2)` of the primary stage, the redraft-gate boundary). Required. Spending is not affected. Accessor `comebackEarnWindow()`. |
| `epb.stageLock` | Reaching `stage` by matchday `byMatchday` suspends the line for `suspendMatchdays`. |
| `epb.participationPoints` | Participation Tokens: `perMatchday` while below `untilStage`; `locksRedraft` keeps those lines out of the redraft; `awardNote` is the note stored on each award's progress-log row; `comebackTokensPerProgress` (integer 1..10) is how many Comeback Tokens buy 1 progress point on a participation line (1 = 1:1 like every other line; spends must be a multiple). Accessor `comebackTokensPerProgress(isParticipationLine)`. |
| `epb.draftClock.quietHours` | `null` (no quiet hours) or `{ startHour, endHour, timeZone }`: a daily window `[startHour, endHour)` on the local calendar of the IANA `timeZone` (0 <= start < end <= 24, so it never crosses local midnight) in which pick clocks do not run; picking stays allowed. The window must leave the clock running at least one hour a day (at most 23 h; a 0-24 window is refused at load) and the zone name is at most 64 characters: the same rule as `isValidQuietHours` (`src/lib/format-pack/quiet-hours.ts`, re-exported by `src/lib/draft/time.ts`) and the SQL `draft__cfg_quiet`. Accessor `draftQuietHours()`. |
| `epb.priceGroups`, `priceGroupOrder` | Price range per stored `PriceGroup` key (`premium`, `hoch`, `mittel`, `guenstig`, `budget`), highest first. |
| `epb.priceTabs` | The finder's price tabs (`key`, `min`, `max`), highest first. |
| `epb.lineRules` | Per-line rulings by stored base name: `participationPoints`, `redraftLocked`, `instantFinalStage`, `noCocoon`, `expectedThresholds` (importer sanity check). |
| `epb.lineOverrides` | League threshold overrides per `line_id`, with a bilingual `reason` and a `source`. |
| `epb.specialRulesEn` | Authored English special-rule text per `line_id`, keyed to the German text by `de_hash`. |
| `epb.utility` | Utility categories (`@pkmn` move and ability ids), their order and the dropped ids. |
| `epb.workbook` | The workbook layout the importers read. See [Point-Buy Workbook Format](./point-buy-format.md). |
| `epb.reconciliation` | Id tables for the reconciliation report (`knownRepoOnlyBanIds` reaches the hook as `context.knownRepoOnlyBanIds`), plus an optional pure `ruleChecks` hook over the rules-sheet rows and an `overrideRowPattern`. Each conflict the hook returns carries an English `message` (the markdown report) and may name a `messageKey` (default: its `code`) and `params` for its localized text in `messages.*.ruleConflicts`. |
| `draftFormat` | Legacy `draft` format UI defaults: `tierLimitDefaults`, `newTier`, `newWildcard`, `hintSpecies`. |
| `coreLiga` | Core Liga UI defaults: `newTripleDefault`, `typeQuotaDefault`, `evioliteCapTierDefault`. |
| `messages` | `en` and `de` message subtrees spliced into the i18n namespaces, plus two pack-own maps: the `utility` label map and the `ruleConflicts` texts. |

`parseFormatPack` (`schema.ts`) checks every section strictly and adds cross-field rules: unique and complete price groups with disjoint, descending ranges; 1 to 6 disjoint descending price tabs (no `all` key); utility keys and lower-case ids; a unique tiebreaker chain; a strictly ascending Comeback table; stage-lock and participation bounds; unique line rules and override ids; distinct workbook columns; equal en/de message keys with a label for every utility key and the same `{placeholders}` in both languages of each `ruleConflicts` text; a quiet-hours window that leaves the clock running (`isValidQuietHours`); and exact `S`/`A`/`B`/`C` tier-limit keys. An invalid pack throws `[format-pack] invalid pack "<id>": <path>: <message>; …` at module load on the server. Import `parseFormatPack` / `formatPackIssues` from `@/lib/format-pack/schema` (server and tests only).

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

- The subtrees are `worldEvoliga`, `draftTokens`, `draftRedraft`, `glossary`, `enums`, `paint`, `draftLegacyEvolution`, `leagueAdminSeasonPage`, `draftShared`, `adminCore`, `draftAdmin`, `draftScreen`, `worldClient` (the roster table's price groups with their ranges), `leagueAdmin` (the point-buy league type's label in the league create form and the name of its battle ruleset row, `form.leagueTypeLabel` / `form.battleRulesetName`; docs/evolution-point-buy.md) and `leagueHub` (the EPB scoring and tiebreak sentences). Each mirrors the key paths of its namespace (for example `draftLegacyEvolution.summary.suspendedNext`).
- `utility` is not spliced: it holds one label per `epb.utility.order` key, read with `utilityLabel(key, locale)`.
- `ruleConflicts` is not spliced either: one text per message key of the pack's `epb.reconciliation.ruleChecks` hook (`RuleConflict.messageKey ?? code`), with `{placeholders}` filled from the conflict's `params`. The point-buy import panel shows it through `ruleConflictText(key, params, locale, pkmn)` (move and item params localized to the viewer's data locale) and falls back to the English `message` when the pack has no text for the key. A pack without a hook has an empty map (the example pack). Like `utility`, its keys are the pack's own and are left out of the `definePackEn` contract.
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
- `scripts/fetch-private-assets.mjs` (run by `prebuild`) extracts `src/format-packs/private/` from the private assets repository (`PRIVATE_ASSETS_REPO`, `PRIVATE_ASSETS_REF`, `PRIVATE_ASSETS_TOKEN`) with the other private assets, skipping `src/format-packs/private/__tests__/`. A tarball without the pack folder fails the fetch. On a Vercel preview without `PRIVATE_ASSETS_REF`, the fetch first tries the private branch named like the public branch being built (`VERCEL_GIT_COMMIT_REF`) and falls back to `main` only when that branch does not exist (HTTP 404), so a pull request that changes both repositories previews with its matching private branch; production always fetches `PRIVATE_ASSETS_REF` or `main`. Without a token the fetch is skipped and the build uses the example pack, except on a Vercel production build, which fails unless `ALLOW_PLACEHOLDER_ASSETS=1`.
- A deployment that carries its own pack sets `FORMAT_PACK=private` for Production in its host's environment settings, so `next.config.mjs` throws instead of shipping the example pack. Preview builds without a token use the example pack and print the production warning above.
- The build log line `[format-pack] using … pack` and the pack `id` in page source tell which pack a deployment carries.

## Testing

| Command | What runs |
|---|---|
| `npm test` | `app` (example pack) + `scripts`; plus `private-pack` when the private pack is present. |
| `FORMAT_PACK=example npm test` | The public view only. CI runs plain `npm test` (no `FORMAT_PACK` on the test step) in a checkout without the private pack, which is the same set. |
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
| price groups | stored ranges 20–25, 15–19, 10–14, 6–9, 1–5; shown by their tab's range: `25–20`, `19–15`, `14–10`, `9–1` (the two bottom groups share `9–1`, one label, one colour, one legend tile, one report row) |
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

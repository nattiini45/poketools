# PokéTools Modules Documentation

This is the central documentation index for all major PokéTools modules.

## How to find a doc

- **Domain modules** map to `src/lib/*` (e.g. `src/lib/tournament` → [Tournament](./tournament.md)).
- **Route groups** map to `src/app/(public|player|broadcast)` — the public site is documented in [Public Site](./public-site.md). Nested `AGENTS.md` files add route/component/lib-specific agent rules.
- **Spec** lives in [`poketools-spec.md`](./poketools-spec.md) (single source of truth for routes, schemas, data flows).
- **Sunset policies** live in [Deprecations](./deprecations.md).
- **Challonge parity mapping** (gap analysis): [Challonge Mapping](./challonge-mapping.md).
- **Agent workflow docs** (security patterns, dependency gotchas, review remediation) are grouped under Repository & Agent Docs below.
- **Self-hosting:** [Bring your own Supabase project](./supabase-environments.md), plus the Self-hosting section of the root `README.md`.

## Modules

### Core Modules

- **Auth** — User authentication and authorization (Discord OAuth primary + email/password alternative). See [Auth](./auth.md), [Email/Password Auth](./auth-email-password.md).
- **Database (Supabase)** — Typed persistence and query layer. See [Supabase](./supabase.md); backups, restore and lock-safe migrations: [Operations: Backups](./operations-backup.md).
- **Tournament** — Pairings, standings, advancement, match-state validation. See [Tournament](./tournament.md).
- **Draft** — Draft pools, picks, and evo-league helpers. See [Draft](./draft.md).
- **Evolution Point Buy** — EPB format engine (mechanics only): point-buy lists, progress sources and tokens, redraft, format gating; the league's numbers and rulings come from the active format pack. See [Evolution Point Buy](./evolution-point-buy.md) and the [EPB Admin Guide](./ADMIN_GUIDE_EVOLUTION_POINT_BUY.md).
- **Format packs** — League tuning (EPB numbers and rulings, price groups and tabs, utility categories, workbook layout, `draft`-format and Core Liga defaults, rule prose) as data: the contract and accessors in `src/lib/format-pack`, the public example pack in `src/format-packs/example`, the `@format-pack` alias and `FORMAT_PACK`, and the optional pack-extension seam (`src/lib/pack-extensions`, `@pack-extensions`: supplementary records, extra sections and links a pack may add). See [Format Packs](./format-packs.md) and [Point-Buy Workbook Format](./point-buy-format.md).
- **Format kit** — A pure library under `src/lib/format-kit` that describes a league or tournament format as a validated, bilingual JSON document with a safe expression language, a primitive registry and a compiler that reports diagnostics with fixes. Library only: it is not wired into the app yet (no database, route or UI). See [Format Kit](./format-kit.md).
- **Season** — Season lifecycle, participants, cores, draft/kill tokens, redraft, EPB phase engine. See [Season](./season.md).
- **Match** — Match aggregation and completion workflows. See [Match](./match.md).
- **Rating** — Glicko-2 rating logic and rollback. See [Rating](./rating.md).
- **Gamification** — Achievements, streaks, signatures. See [Gamification](./gamification.md).
- **Social** — X/Threads/Bluesky publishing. See [Social](./social.md).
- **Discord** — Webhook and embed notification system. See [Discord](./discord.md).
- **AI (legacy single-shot)** — Pre-agent match/tournament analysis routes; soft-deprecated, kept as rollback. See [AI](./ai.md) and [Deprecations](./deprecations.md#legacy-ai-paths-single-shot--agent-replacements-flagged-cutover-pending).
- **AI Agent** — Multi-persona, tool-using agent (chat, match analysis, tournament report); model router with live-verified fallback, per-player memory, eval harness. Replaces the legacy AI paths on most surfaces. See [AI Agent](./ai-agent.md).
- **Feature Flags / Deprecations** — Runtime gates and sunset policies. See [Feature Flags](./feature-flags.md), [Deprecations](./deprecations.md).
- **i18n (English / German)** — `src/i18n`: typed message namespaces (`src/i18n/messages/<ns>/{en,de,index}.ts`), the language cookies and `POST /api/locale`, `I18nProvider` / `useT` / `getT`, the formatter and `<LocalTime>`, API error codes and catalogs, viewerless content language (`seasons.language`), the German style guide and glossary, and the `scripts/check-i18n-strings.mjs` guard. See [i18n](./i18n.md).

### Public Site & Surfaces

- **Public Site / Homepage** — `(public)` route group: landing page, browse, featured event card, AI chat widget mount. See [Public Site](./public-site.md).
- **Worlds** — Season-world presentation system: the world registry resolves `/leagues/[id]` (plus tournament and draft-room pages) server-side through `resolveViewerWorld` (`?world=` > admin `route_theme` pin > format auto-map) to one of four 3D route-themed worlds — plaza (EvoLiga), sakura, mountain, clouds — with a DOM-only default fallback. See [Worlds](./worlds.md).
- **Route canvas & warm** — The one 3D canvas and its GPU warm-up, in `src/components/world/route/`. `RouteWorldCanvas.tsx` is the entry (tier gate, `<Canvas>`, mount order, module-load installs); its parts live in `canvas/`, one module per concern: `frame-hold.ts` (draw wrapper, frame holds), `FrameCapDriver.tsx`, `render-gates.tsx`, `SceneReadinessReporter.tsx`, `LoadWarmer.tsx` (load warm host, point-light pad), `OtherPaletteHdriPrefetch.tsx`, `StagedWorld.tsx`, `load-bridges.tsx`, `capture-bridges.tsx` (harness present, render path, phase pin), `telemetry-bridges.tsx`, `DebugSceneAudit.tsx`, `batch-merge.ts` and `StaticBatcher.tsx`. `useStationWarmup.ts` only re-exports `warm/`: `station-lead.ts`, `compile-guard.ts` (warm window and compile guard), `staggered-mount.ts`, `skip-gate.ts`, `shadow-variants.ts`, `programs-warm.ts`, `load-warm.ts` (stages, budgets, state machine, registries), `compile-variants.ts`, `upload-deferral.ts`, `load-warm-io-helpers.ts`, `load-warm-io.ts` (`createLoadWarmIO`) and `theme-swap-retention.ts`. Source-text contract tests read the canvas or the warm as a whole through `__tests__/route-sources.ts`. See [Worlds](./worlds.md).
- **League Hub** — Tabbed league overview inside a route world's `#pulse` on `/leagues/[id]` (standings, matches, group stage, playoffs, phases, insights, rules; Kale reports behind `ENABLE_KALE_CABBAGE`). `src/lib/league-hub/` holds the `?tab=` whitelist (`tabs.ts`), pure view builders (`views.ts`), de/en copy (`copy.ts`) and the server-only per-tab loader (`load.ts`); components live in `src/components/league/hub/`. See [Worlds](./worlds.md) and the [spec](./poketools-spec.md) route map (§5).
- **Insights** — Unified stats/ratings hub at `/insights` with scope selector (`src/lib/insights/scope.ts`); `/leaderboard` redirects here. See [Insights](./insights.md).
- **Wiki** — Encyclopedia at `/wiki/*`, community notes, shared entry builders in `src/lib/wiki/entries.ts`. See [Wiki](./wiki.md).
- **Replays** — Spoiler-free public replay library at `/replays`. See [Replays](./replays.md).
- **Profile** — Player profile composition. See [Profile](./profile.md).

### Content & Broadcast

- **Broadcast** — Overlay state, draft replay, recap composition, wiki overlays. See [Broadcast](./broadcast.md).
- **Draft Room** — EPB draft room on the queue engine (`/leagues/[id]/draft-room`), redraft with secret drop, token centre, admin control panel and audit trail, trainer creator, draft overlay pages. `src/lib/draft-finder` holds the search index, the filter engine and the line catalog; `src/lib/draft-ui` the snapshot view model, clock math and pool selection; the contracts live in `src/lib/draft` and `src/types/draft-queue.ts`. See [Draft Room](./draft-room.md).
- **Cast Studio** — Cast session management, inline team editing, second-screen tools, solo streamer mode. See [Cast Studio](./cast-studio.md).
- **Creator Hub** — Content creator sub-homepage at `/creator`, routing, overlay management. See [Creator Hub](./creator-hub.md).

### Admin & Operations

- **Admin** — Admin console (`/admin/*`) and the `/api/admin/*` route namespace, for site admins and (scoped to their own leagues and tournaments) resource admins. See [Admin](./admin.md).
- **Import** — XLSX point-buy/team-roles import, sample-set/usage/stats import pipelines. See [Import](./import.md) and [Data Import Guide](./DATA_IMPORT_GUIDE.md).
- **Reconcile** — Match/season delete → derived-data rebuild (aggregates, ratings, evolution state). See [Reconcile](./reconcile.md).
- **Audit** — Audit logging (`src/lib/audit`) + `/api/admin/audit-log`. See [Audit](./audit.md).
- **Validation** — Shared Zod schemas (`src/lib/validation`) for API input validation. See [Validation](./validation.md).

### Data, Teams & Utilities

- **PKMN** — Pokémon data access, legality, parsing, speed/stat helpers. See [PKMN](./pkmn.md).
- **PKMN i18n** — `src/lib/pkmn/i18n`: official German (and English) names of species, moves, items, abilities, types, natures and stats from vendored PokeAPI data, `toID`, bilingual search keys, German game descriptions and `<PkmnName>`; display only, stored values stay English. See [PKMN](./pkmn.md).
- **Avatar** — Avatar rendering, generation, gallery support. See [Avatar](./avatar.md).
- **Design** — Shared design tokens (`poke-*` Tailwind tokens), `src/components/ui/*` primitives and site palettes (`src/lib/design/site-palettes.ts`, picker in NavBar). See [Design](./design.md).
- **Smogon** — Stats/set import pipelines. See [Smogon](./smogon.md).
- **Team** — Team visibility/redaction logic. See [Team](./team.md).
- **Teambuilder Editor (v3)** — Unified team editor (teambuilder/plan/library modes), state machine, FAB, AI panel (Assistant and Coach tabs). See [Teambuilder Editor](./teambuilder-editor.md).
- **Teambuilder Broadcast** — BroadcastTeam family (comparison/strip/tracker/preview variants), TeamCardBroadcastPrimitive. See [Teambuilder Broadcast](./teambuilder-broadcast.md).
- **Teambuilder Reference** — Cross-system map of the Teambuilder + Plan Team ("Match Prep") systems. See [Teambuilder Reference](./teambuilder-reference.md).
- **Utils** — Shared utility helpers (`src/lib/utils`, including `cn()`). See [Utils](./utils.md).
- **UI Tables** — Shared client-table sort/pagination primitives in `src/lib/ui`: `table-params.ts` (page-size clamp, 3-state sort cycle, compound sort params, nullish-safe comparator) and `use-client-table.ts` (client-side sort + pagination hook), used by `src/components/ui/Table.tsx` and the paginated list pages. See [UI Tables](./ui.md).

### Repository & Agent Docs

- **Security Patterns** — Full OWASP mapping, mandatory error-handling pattern, input-validation pattern (always-needed subset lives in `AGENTS.md`). See [Security Patterns](./security-patterns.md).
- **Dependencies** — Gotcha-prone packages (`next-auth` beta, `@pkmn/*`, `motion`, Zod date encoding). See [Dependencies](./dependencies.md).
- **Review Remediation** — Truth-grounded procedure for working automated code-review and CI findings (review bots, CI failures, `npm audit`). See [Review Remediation](./review-remediation.md).

## Module Documentation

Each module doc follows the [Module Documentation Template](./module-documentation-template.md): Overview, File Structure, Core Functions/Classes, Data Flows, Dependencies, API Routes, Usage Examples, Testing, Related Modules.

## Test Coverage

Test suites live in `__tests__/` directories adjacent to the modules they cover. Run `npm run test` (Vitest, single run) or `npm run test:watch`.

| Module | Test File | Focus |
|--------|-----------|-------|
| Rating / Glicko-2 | `src/lib/rating/__tests__/glicko2.test.ts` | `glicko2Update`, `expectedScore`, `inflateRD` — pure math |
| Rating / Tiers | `src/lib/rating/__tests__/tiers.test.ts` | `getRatingTier` — Poké/Great/Ultra/Master bands, provisional rule, Master Ball RD gate (Spec §11.5) |
| Draft Engine | `src/lib/draft/__tests__/engine.test.ts` | Snake order, pick validation, draft state, completion |
| Format pack contract | `src/lib/format-pack/__tests__/pack-contract.test.ts`, `pack-pkmn.server.test.ts` | Pack schema, en/de message contract, example fixture, accessors; `@pkmn/dex` ids of every present pack |
| Format kit / expression language | `src/lib/format-kit/expr/__tests__/*.test.ts` | Parser, printer and print-parse round trip, type check, evaluation semantics, limits fuzz, zod and browser shape parity, seeded rand vectors |
| Format kit / document and validators | `src/lib/format-kit/__tests__/{schema,validate-spec,validate-parity,registry,describe,ltext,limits}.test.ts` | Strict schema and limits, Spec interpreter, zod versus browser validator parity (seeded fuzz), registry and catalog coverage, LText fallback |
| Format kit / compile and diagnostics | `src/lib/format-kit/__tests__/{compile,diagnostics,graph,plan,fixes,capabilities,memo,render}.test.ts` | Compile pipeline, one negative fixture per diagnostic code, stage graph and plan counts, fix patches, capabilities, LRU memo, rendering in both languages |
| Format kit / boundaries | `src/lib/format-kit/__tests__/{client-boundary,source-safety,preset-parity,presets}.test.ts` | Client barrel import closure, source scan for banned constructs, preset and fixture parity between entries, preset quality |
| Broadcast Tracker | `src/lib/broadcast/__tests__/tracker-reducer.test.ts` | Reducer actions, undo, game submit/reset, payload builder |
| Team Visibility | `src/lib/team/__tests__/visibility.test.ts` | `canViewTeamPokemon`, `filterTeamVisibility` (Spec §7) |
| Auth Helpers | `src/lib/auth/__tests__/helpers.test.ts` | `requireAuth`, `requireAdmin`, `requireCreator`, sync checks |
| Admin scope and page gates | `src/lib/auth/__tests__/admin-scope.test.ts`, `resource-gate.test.ts` | `getAdminScope`, `gateResourceAdmin` |
| Tournament Engine | `src/lib/tournament/__tests__/*.test.ts` | Match state, standings, Swiss/RR/SE/DE pairing, bracket-structure, serpentine |
| League phases API | `src/app/api/seasons/[id]/phases/__tests__/route.test.ts` | Phase CRUD/list guards |
| Substitute | `src/lib/season/__tests__/substitute.test.ts`, `src/app/api/seasons/[id]/participants/substitute/__tests__/route.test.ts` | Substitute planner + API |
| Group repair | `src/lib/season/__tests__/group-repair.test.ts`, `src/app/api/seasons/[id]/phases/[phaseId]/groups/repair/__tests__/route.test.ts`, `src/components/league/__tests__/PhaseGroupRepair.test.tsx` | Planner for group rows left by pre-handover substitutions (audit pairing, chains, scope, fixture fallback) + API + admin control |
| Guest claim | `src/app/api/players/[id]/claim/__tests__/route.test.ts` | Claim guards |
| Tournament POST | `src/app/api/tournaments/__tests__/season-id-reject.test.ts` | Rejects `season_id` on standalone create |
| PKMN Utilities | `src/lib/pkmn/__tests__/*.test.ts` | Dex legality, speed calc |
| Stats / Usage Rows | `src/lib/stats/__tests__/usage-rows.test.ts` | `aggregatesToUsageRows`, `metaUsageToUsageRows` — `Eff` column derivation |
| Insights / Scope | `src/lib/insights/__tests__/scope.test.ts` | `parseScopeFromSearchParams`, `scopeAggregateKey` |
| Replays / Library utils | `src/app/(public)/replays/__tests__/replay-library-utils.test.ts` | Param parsing, filtering, sort, option derivation |
| Replays / Query | `src/lib/supabase/queries/__tests__/replay-library.test.ts` | `listReplayLibraryRows` shape + spoiler-safe field mapping |
| API / Pagination | `src/lib/api/__tests__/pagination.test.ts` | `parsePagination` — limit clamp into `[1, maxLimit]`, default fallback for absent/non-numeric input |
| Utils / LruCache | `src/lib/utils/__tests__/lru-cache.test.ts` | TTL expiry, LRU eviction, `getEntry` cached-`undefined`-vs-miss distinction |
| UI Tables | `src/lib/ui/__tests__/table-params.test.ts`, `src/lib/ui/__tests__/use-client-table.test.ts` | `parseTableParams` defaults/clamping, 3-state sort cycle, compound sort params, `compareSortValues` nullish/NaN ordering; hook sort + paginate composition |
| Utils / Date Helpers | `src/lib/utils/__tests__/date.test.ts` | `formatDateTime`, `formatDateTimeOrNull`, `formatDate`, `formatDateOnly`, `formatTimeAgo` |
| i18n core | `src/i18n/__tests__/*.test.ts(x)`, `src/i18n/content/__tests__/engine-labels.test.ts`, `src/app/api/locale/__tests__/route.test.ts` | Translator, plurals, rich text, formatter presets, provider-less hooks, cookie readers, `de`/`en` parity, error-code catalogs, cache boundary |
| CI Guard / i18n strings | `scripts/__tests__/check-i18n-strings.test.mjs` | One fixture per rule (JSX text, text attributes, setters/dialogs, label objects, locale hazards) and per ignore case; allowlist globs |
| CI Guard / safe-error-scan | `scripts/__tests__/safe-error-scan.test.mjs` | Per-return catch-block enforcement — flags raw `NextResponse`/`Response` returns unless preceded by `console.error` or a `// safe-error-response-allow:` comment |

## Getting Started

1. Start with the canonical spec: [`poketools-spec.md`](./poketools-spec.md). A navigable architecture summary lives in [`../openwiki/architecture/overview.md`](../openwiki/architecture/overview.md).
2. Read [`AGENTS.md`](../AGENTS.md) for repository-specific implementation rules.
3. Review the [Module Documentation Template](./module-documentation-template.md).
4. Read the target module doc for your current task.
5. Use that module's `## Related Modules` section to follow cross-module dependencies.

## Updating Documentation

When modifying a module:

1. Update the module doc in `docs/`.
2. If you add a new module, create a new markdown file using the [template](./module-documentation-template.md).
3. Add the new module to this index (both the overview list above and the navigation below).
4. Update related-module cross references where needed.
5. For route, IA, or API contract changes, update [`poketools-spec.md`](./poketools-spec.md) **first**, per `AGENTS.md`.

## Navigation

- [Public Site / Homepage](./public-site.md)
- [Worlds Module](./worlds.md)
- [Auth Module](./auth.md)
- [Email/Password Auth](./auth-email-password.md)
- [Supabase Module](./supabase.md)
- [Bring your own Supabase project](./supabase-environments.md)
- [Tournament Module](./tournament.md)
- [Draft Module](./draft.md)
- [Evolution Point Buy Module](./evolution-point-buy.md)
- [Format Kit](./format-kit.md)
- [Season Module](./season.md)
- [Match Module](./match.md)
- [Rating Module](./rating.md)
- [Gamification Module](./gamification.md)
- [Social Module](./social.md)
- [Discord Module](./discord.md)
- [AI Module (legacy)](./ai.md)
- [AI Agent Module](./ai-agent.md)
- [Insights Module](./insights.md)
- [Wiki Module](./wiki.md)
- [Replays Module](./replays.md)
- [Profile Module](./profile.md)
- [PKMN Module](./pkmn.md)
- [Avatar Module](./avatar.md)
- [Broadcast Module](./broadcast.md)
- [Draft Room Module](./draft-room.md)
- [Cast Studio Module](./cast-studio.md)
- [Creator Hub Module](./creator-hub.md)
- [Design Module](./design.md)
- [Smogon Module](./smogon.md)
- [Team Module](./team.md)
- [Teambuilder Editor Module](./teambuilder-editor.md)
- [Teambuilder Broadcast Module](./teambuilder-broadcast.md)
- [Teambuilder Reference](./teambuilder-reference.md)
- [Utils Module](./utils.md)
- [UI Tables Module](./ui.md)
- [Admin Module](./admin.md)
- [Import Module](./import.md)
- [Reconcile Module](./reconcile.md)
- [Audit Module](./audit.md)
- [Validation Module](./validation.md)
- [Security Patterns](./security-patterns.md)
- [Dependencies](./dependencies.md)
- [Review Remediation](./review-remediation.md)
- [Feature Flags](./feature-flags.md)
- [i18n Module](./i18n.md)
- [Deprecations](./deprecations.md)
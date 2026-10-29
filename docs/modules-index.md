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
- **Format kit** — A pure library under `src/lib/format-kit` that describes a league or tournament format as a validated, bilingual JSON document with a safe expression language, a primitive registry and a compiler that reports diagnostics with fixes. The Format Studio pages use it read-only: they describe live leagues, render their rules text in English and German and show the diagnostics on `/admin/formats` and the league admin Format tab. A storage and server layer sits behind them: a format library (drafts, immutable published versions, fork, visibility) under `/api/formats`, and attach and detach of a published version to a league of the type Custom format under `/api/seasons/[id]/format`, which creates one phase per format stage. No builder UI yet, and the engine does not run kit definitions. See [Format Kit](./format-kit.md).
- **Ruleset Studio** — Rulesets as data: a document (a base preset plus bans, unbans, allowlists and clauses per category) edited as a draft, published as an immutable numbered version whose effective rules are frozen, and pinned by leagues and phases (`seasons.ruleset_id` / `tournaments.ruleset_id` are version ids). `src/lib/ruleset-kit` (pure document logic: validate, compile, effective rules, ops, tour overlay), `src/lib/ruleset-studio` (access, guards, library, pins and the pin impact count, staleness, version changes, the legacy bridge, browser-side editor logic and picker), `src/lib/supabase/queries/{ruleset-definitions,rulesets}.ts`, `src/components/ruleset-studio` (library views `RulesetsGalleryView` and `RulesetPageView`, which the pages and the previews both render, the editor, picker, sections, summary, starts), `src/components/ruleset` (`RulesetSelect`, `RulesetPinCard`, `UsagePanel`, `PinConfirmDialog`, `PinImpactNotice`, `use-pin-impact`, `pin-change-text`, `RulesetDetail`, `RulesetPresetSelect`, `TeamConstraintsEditor`), `/admin/rulesets`, `/api/ruleset-definitions`, the public `/api/rulesets`. The dev fixture previews are `/ruleset-preview` and `/ruleset-preview/surfaces`. See [Ruleset Studio](./ruleset-studio.md).
- **Ruleset presets (rule catalog)** — The catalog of Showdown ladder, Smogon draft and Pokémon Champions rule presets and their data: `src/lib/pkmn/{format-catalog,ruleset-preset-catalog,format-id,clauses,preset-rules(.server),known-ids.server,seed-format-ids,catalog-index(.server),sheet-cells.server}.ts` and `src/lib/pkmn/preset-data/` (pinned tables, generated Champions roster, Smogon tour overlay, `PRESET_RULES_VERSION`), `scripts/ruleset-presets`. Routes `GET /api/pkmn/catalog/[kind]`, `GET /api/pkmn/presets/[id]/{rules,tour-overlay}`. See [Ruleset Presets](./ruleset-presets.md).
- **Studio core and shell** — What the Format Studio and the Ruleset Studio share: `src/lib/studio-core` (access rules, keys, canonical JSON and hashing, patch, bilingual text and identity, editor state, targets, database error mapping, bounded API body, slug retry; client-safe modules never reach zod or a kit) and `src/components/studio-shell` (editor frame and toolbar, the five dialogs, library cards and list, `useDraftEditor`, `useUnsavedGuard`, per-studio text keys).
- **League recycle bin** — A league delete moves the league to the trash for 90 days: `src/lib/league-trash` (constants, service, errors, database error mapping, social-image sweep, client reducer), `src/lib/supabase/queries/league-trash.ts`, migration `20261026091000_league_trash.sql` (+ five), `/admin/leagues/trash` and `src/components/league-trash`, `POST /api/admin/league-trash/[id]/{restore,rebuild}`, the cron `GET /api/cron/expire-league-trash`, `SuperadminGuard` (`src/components/shared`), `requireSuperadmin`; the SQL lab is `scripts/league-trash-lab`. See [Season, League recycle bin](./season.md#league-recycle-bin).
- **Season** — Season lifecycle, participants, cores, draft/kill tokens, redraft, EPB phase engine. See [Season](./season.md).
- **Match** — Match aggregation and completion workflows. See [Match](./match.md).
- **Rating** — Glicko-2 rating logic and rollback. See [Rating](./rating.md).
- **Gamification** — Achievements, streaks, signatures. See [Gamification](./gamification.md).
- **Social** — X/Threads/Bluesky publishing. See [Social](./social.md).
- **Discord** — Webhook and embed notification system. See [Discord](./discord.md).
- **Web Push** — Draft turn alerts on the player's devices: src/lib/push (VAPID configuration, endpoint allow-list, payloads, sender, claim mapping, browser layer), /api/push/subscriptions, src/lib/supabase/queries/push-subscriptions.ts, the push handlers in public/sw.js, the draft room's bell and the settings card. See [Push](./push.md).
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
- **Draft Room** — EPB draft room on the queue engine (`/leagues/[id]/draft-room`), redraft with secret drop, token centre, admin control panel and audit trail, trainer creator, draft overlay pages. `src/lib/draft-finder` holds the search index, the filter engine and the line catalog; `src/lib/draft-ui` the snapshot view model, clock math and pool selection; the contracts live in `src/lib/draft` and `src/types/draft-queue.ts`. The pick screen (`src/components/draft-tool`): the left stage (line-up picture, status strip, cost, DRAFT dock, roster dock with the team weakness table, compare tray) and the right wall (finder bar, chips, price tabs, roster cards); `hooks/use-sticky-offsets.ts` measures the site nav, the clock row and the DRAFT dock (`StickyBars`) and publishes `--nav-h`, `--draft-clock-h` and `--draft-dock-h`. See [Draft Room](./draft-room.md).
- **Cast Studio** — Cast session management, inline team editing, second-screen tools, solo streamer mode. See [Cast Studio](./cast-studio.md).
- **Creator Hub** — Content creator sub-homepage at `/creator`, routing, overlay management. See [Creator Hub](./creator-hub.md).

### Admin & Operations

- **Admin** — Admin console (`/admin/*`) and the `/api/admin/*` route namespace, for site admins and (scoped to their own leagues and tournaments) resource admins. See [Admin](./admin.md).
- **Import** — XLSX point-buy/team-roles import, sample-set/usage/stats import pipelines. See [Import](./import.md) and [Data Import Guide](./DATA_IMPORT_GUIDE.md).
- **Reconcile** — Match/season delete and league restore → derived-data rebuild (aggregates, ratings, streaks, evolution state). See [Reconcile](./reconcile.md).
- **Audit** — Audit logging (`src/lib/audit`) + `/api/admin/audit-log`. See [Audit](./audit.md).
- **Admin Assistant** — A chat for site admins (`/admin/assistant` and a drawer) that plans a league, standalone tournament or ruleset and sets it up only through approved, server-written cards: core in `src/lib/ai/admin-agent/` (loop, registry, Plan, proposals and the executor, dispatch through the real route handlers, store, evaluation), routes under `src/app/api/admin/agent/` (route bindings in `_ops/d` for the chat's private drafts and `_ops/g` for Build, Go-live and undo, the latter reachable from the approve and resume routes only), UI in `src/components/admin/assistant/`. Off by default; flags in [Feature Flags](./feature-flags.md). See spec section 18 of the [PokéTools spec](./poketools-spec.md).
- **Validation** — Shared Zod schemas (`src/lib/validation`) for API input validation. See [Validation](./validation.md).
- **Route manifest** — `scripts/route-manifest.mjs` (CLI) + `scripts/lib/route-manifest-scan.mjs` (pure scanner) record, for every route listed in `scripts/data/route-manifest-bindings.json` (the routes the planned Admin Assistant, spec section 18, dispatches to), the guard helpers it calls (`requireAnyAdmin`, `requireResourceAdmin`, `requireRulesetViewer`, `isSuperadmin`, ...), the zod schemas it parses with, `checkRateLimit` buckets, `expire*`/`revalidate*` calls, `logAuditEvent` actions, `emitDiscordEvent`/`emitSocialEvent` events and a fingerprint of its transitive import names, into the committed `scripts/data/route-manifest.json`. Only `git ls-files` files are visited (minus the roots of the gitignored `.overlay-manifest.json`), so the manifest is identical on a maintainer checkout and in CI. `node scripts/route-manifest.mjs --check` exits non-zero with a diff when it is stale and `--write` regenerates it; `npm run test` runs the same check, so changing a bound route's guard, schema, bucket or import names fails until the manifest is regenerated and the diff reviewed. `compareDeclaredGuards` (exported by both modules) is the declared-guard-equals-scanned-guard check the assistant registry will call. A scanned import that leads to a new, not-yet-`git add`ed file is recorded as unresolved and changes the manifest once the file is tracked, so `--write` refuses while that is the case (and `--check` warns; `--check --strict` exits 1): `git add` the new modules, run `--write`, and commit the manifest with them. Behaviour inside the libraries a route calls is visible only through the import fingerprint.

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
- **Dependencies** — Gotcha-prone packages (`next-auth` beta, `@pkmn/*`, `motion`, Zod date encoding, `@tanstack/react-virtual`). See [Dependencies](./dependencies.md).
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
| Format kit / rules text | `src/lib/format-kit/__tests__/describe-definition.test.ts` | Whole-definition renderer in both languages, coverage numbers, plan sentences, stage order, malformed input, plain text |
| Format Studio / league descriptor | `src/lib/format-studio/__tests__/{describe-legacy,view}.test.ts` | Legacy league rows to a definition (pairings, groups, edges, overrides, scoring and rank, modules and facts), purity, JSON round trip, compile parity between entries, `FormatView` |
| Format Studio / golden master | `src/lib/format-studio/__tests__/golden.test.ts` | Snapshots of the descriptor, its compile result and its rules text (en, de) for five fixture leagues |
| Format Studio / loader and queries | `src/lib/format-studio/__tests__/{legacy-input,loader}.test.ts`, `src/lib/supabase/queries/__tests__/{format-studio,tournaments-by-seasons}.test.ts` | Row mapping, read budget (one wave, three reads plus assignment counts for the list), chunking and paging, editor links |
| Format Studio / pages | `src/app/admin/formats/__tests__/*.test.tsx`, `src/components/format-studio/__tests__/FormatDetail.test.tsx`, `src/components/admin/__tests__/admin-nav-formats.test.ts`, `src/app/admin/leagues/[id]/__tests__/format-panel.test.tsx` | Live gates and scoping, gallery and detail pages, display component in both languages, nav item, the league Format tab |
| Format Studio / client boundary | `src/components/format-studio/__tests__/client-boundary.test.ts` | Studio client files reach only the kit client entry (no zod, server-only, `@pkmn`, Supabase, no bare kit specifier) |
| Format library / rules and errors | `src/lib/format-studio/__tests__/{access,errors,slug,document-guard,document}.test.ts`, `src/lib/studio-core/__tests__/identity.test.ts`, `src/lib/season/__tests__/season-started.test.ts` | Who may view, edit, publish, share, delete and attach (actor by definition matrix), error codes, statuses and the database signal mapping, slugs, the bounded document pre-check, the new-format skeleton, identity extraction (shared with the Ruleset Studio), the started rule |
| Format library / storage | `src/lib/supabase/__tests__/format-studio-migrations.test.ts`, `src/lib/supabase/queries/__tests__/{format-definitions,season-formats,seasons-format-not-attached}.test.ts`, `src/lib/auth/__tests__/require-format-owner.test.ts`, `src/lib/cache/__tests__/format-reads.test.ts`, `src/lib/__tests__/revalidation-format-library.test.ts` | The three migrations (splits, RLS, grants, named constraints), explicit-column bounded reads, compare-and-set draft save, the live format guards, the cached gallery shelf and its tag |
| Format library / orchestration | `src/lib/format-studio/__tests__/{api-body,api-schemas,library,materialise,attach}.test.ts` | Bounded bodies and strict envelopes, slug retry, publish gate (stale revision, compile errors, no database call on refusal), fork, visibility and delete rules, stage mapping per bracket type and override name tables, each attach refusal in order with no database function call, the type-change guard |
| Format library / routes | `src/app/api/formats/__tests__/{list-create,item,draft,publish,fork,cross-owner}.test.ts`, `src/app/api/seasons/[id]/format/__tests__/route.test.ts`, `src/app/api/seasons/[id]/__tests__/route.test.ts` | Per route: 401, 403, success, 400, 429 with no write, malformed id, no private player data, cache expiry; the cross-owner matrix with the real guards; the PATCH guard matrix for the custom league type |
| Format library / readiness | `src/app/api/generate-round/[tid]/__tests__/route.test.ts`, `src/app/api/tournaments/[id]/generate-bracket/__tests__/route.test.ts`, `src/lib/__tests__/write-route-tags.test.ts` | A custom league without a format is refused before any write and the classic types are unchanged; the `formats` route tree expires the `format-library` tag |
| Ruleset kit | `src/lib/ruleset-kit/__tests__/{validate,compile,effective,ops,overlay,describe,client-boundary}.test.ts` | Structural validator, compile diagnostics with fixes, effective rules (block, allowlist, roster), every edit op fuzzed (never throws, never mutates, never duplicates), tour overlay, plain-sentence description, client import closure |
| Ruleset Studio / library and pins | `src/lib/ruleset-studio/__tests__/{access,bodies,errors,library,guards-and-bridge,pins-and-materialise,pin-impact,pin-info,staleness-and-changes,ruleset-migrations}.test.ts`, `src/app/api/ruleset-definitions/**/__tests__`, `src/app/api/rulesets/**/__tests__` | Who may view, edit, publish, share and delete (actor by definition matrix), bounded bodies, error mapping, publish gate, pin move rules (confirm, locked, compare-and-set), the impact count (differential, bound), stale-catalog rule, version change lines, the three migrations' shape, the routes (401, 403, 409, 429) |
| Ruleset Studio / conversion and differential | `src/lib/ruleset-studio/__tests__/{legacy-differential,ruleset-conversion.local,ruleset-library.local}.test.ts` | The old resolver and validator kept as an oracle; the local rehearsal of the legacy conversion (opt-in, never CI) |
| Ruleset Studio / editor and picker | `src/lib/ruleset-studio/__tests__/editor/*.test.ts`, `src/components/ruleset-studio/__tests__/*.test.tsx` | Editor state and undo, picker layout, selection, bulk and keyboard modules, library cards, editor, summary, rebase dialog |
| Ruleset consumers | `src/components/ruleset/__tests__/*.test.tsx`, `src/app/admin/rulesets/__tests__`, `src/app/(public)/ruleset-preview` | `RulesetSelect`, pin card, usage panel, impact notice and dialogs, public rules view, preset select, i18n in both languages, the admin pages |
| Ruleset presets | `src/lib/pkmn/__tests__/{clauses,format-id,seed-format-ids,preset-rules.server,preset-data-integrity.server,dex-national,format-catalog-boundary,ruleset-preset-catalog,validation-rules,sheet-cells.server,formats}.test.ts`, `scripts/ruleset-presets/__tests__` | Clause catalog, the one format-id parser, the frozen seed list, per-mod resolution, data integrity against the dex and the version bump rule, National Dex universe, the dex-free catalog boundary, enforcement of the lists, icon cells |
| Studio core and shell | `src/lib/studio-core/__tests__/*.test.ts`, `src/components/studio-shell/__tests__/*.test.ts(x)` | Shared access rules, keys, JSON hashing, patch, identity, editor state, database error mapping; the shell contract and client boundary |
| League recycle bin | `src/lib/league-trash/__tests__/{inventory,db-error,errors,service,client,social-image-sweep}.test.ts`, `src/lib/league-admin/__tests__/season-delete.test.ts`, `src/app/api/admin/league-trash/**/__tests__`, `src/app/api/cron/expire-league-trash/**/__tests__`, `src/components/league-trash/__tests__`, local: `league-trash.local.test.ts`, `routes.local.test.ts` | The SQL inventory is complete (replayed migrations), error mapping and statuses, the service's timeout reconciliation and rebuild confirmation, the Danger tab lists follow the inventory, routes and cron, the trash page; the local database proofs are opt-in |
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
| CI Guard / route manifest | `scripts/__tests__/route-manifest.test.mjs` | Parser fixtures (aliased, namespace, re-exported and dynamic-import guards; re-exported handlers; schemas, buckets, audit/emit/expire calls; import-name fingerprint stability), overlay and untracked-file skipping, `--write`/`--check` on a scratch repo, the declared-guard comparison, and the drift check of the committed `scripts/data/route-manifest.json` |
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
- [Ruleset Studio](./ruleset-studio.md)
- [Ruleset Presets](./ruleset-presets.md)
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
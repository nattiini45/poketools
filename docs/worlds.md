# Worlds Module

> Season-world presentation system: resolves each league/tournament/draft-room
> page to a registered "world" (section manifest, draft experience, token
> namespace, optional 3D route theme) and renders it through shared shells.
> Contracts of record: this page and the multi-theme route-worlds spec and
> readiness/parity plan (maintainer-only; not in this repo).
> Route map: [poketools-spec.md](./poketools-spec.md) §5.

## Overview

A "world" is the presentation context for a season page: which in-page sections
it shows, which draft-experience key drives its interactions, which CSS token
namespace skins it, and — for 3D worlds — which route theme paints it. Worlds
are pure data registered in `src/lib/worlds/registry.ts` (`SeasonWorld` in
`src/lib/worlds/types.ts`); adding a world is an additive registry entry plus a
theme package, never a fork of an existing page.

Four 3D route-themed worlds are registered:

- **`evoliga`** — the EvoLiga plaza (theme id `plaza`, German locale); the
  auto-map for `evolution_point_buy` seasons.
- **`sakura`** — the cherry-blossom lakeside park; the auto-map default for
  every other season format (`singles` / `doubles` / `draft`) and for
  standalone tournaments (`getDefaultWorld()`). Nav manifest
  `#pulse #roster #teams #schedule #rules`.
- **`mountain`** — the alpine valley pass; matches NO format, reachable only
  through an explicit admin pin or a viewer override.
- **`clouds`** — the sky-island chain; matches NO format, pin/override only.

A DOM-only **`default`** world (anchored sections `#pulse #phases #reports
#stats #rules`, no route theme) remains as the fallback for a league pinned to
an unregistered theme id. It is deliberately **not exported**;
`getDefaultWorld()` returns the sakura world. The classic DOM tabbed league
page no longer exists — non-EPB leagues render the sakura park, and the
DOM-only fallback renders `DefaultWorld`
(`src/components/world/default/DefaultWorld.tsx`, anchored sections, not tabs).

**League hub.** The world keeps its anchored sections; the league overview
(standings, matches, group tables, playoff brackets, phases, insights, rules,
and Kale reports behind `ENABLE_KALE_CABBAGE`) is a tabbed panel INSIDE
`#pulse`, under the masthead. The four route-world roots (`EvoligaWorld`,
`SakuraWorld`, `MountainWorld`, `CloudsWorld`) take an optional `hub?: ReactNode`
prop and pass it as `children` to their `PulseSection` (the sakura, mountain
and clouds wrappers forward it to the shared
`src/components/world/sections/PulseSection.tsx`), which renders it through
`SectionShell`'s `after` slot: inside the `<section>`, outside the reveal
group, whose 15% in-view threshold a tall hub could never reach. Only `/leagues/[id]` builds
it (`src/components/league/hub/LeagueHub.tsx`); `/route-preview` passes none,
so captures are unchanged, and the DOM-only `DefaultWorld` fallback has no hub.
Tabs are server-rendered `?tab=` links whitelisted per league
(`src/lib/league-hub/tabs.ts`); the page reads only the selected tab's data in
the same wave as the world payload (`src/lib/league-hub/load.ts`), and the
default tab (standings) renders from `WorldRouteData` alone. Copy follows the
world: German on the plaza, English elsewhere (`leagueHubCopy` in
`src/lib/league-hub/copy.ts`). That includes the shared components the hub
reuses: on the plaza `hubSharedLabels('de')` hands German labels to the
elimination bracket (headings, round names, "Sieger aus M3" feeder labels,
open slots, status chips, the double-elimination loss marks), the round robin
results grid, the ruleset detail, the Core Liga card's heading and the insights
tables (columns, empty states, pagination chrome). In an English world it is
null and those components keep the English the phase pages and `/insights`
show. `.league-hub` in
`globals.css` maps `--poke-*` to `--world-*` so the reused bracket, insights
and ruleset components take the world's palette. Being part of `#pulse`, the
hub hides with the other sections while the route scene is live ("Read as
text" / `?tier=lite` shows it); under `html.world-route-live` it is
`display: none`, so its padding and margin add no box inside `#pulse` (whose
fixed 100vh keeps every station offset). The route-live rules that size
station `<section>`s to 100vh and hide their children skip dialog subtrees
(`section:not(dialog *)`): the docked overlays (`?rules=gate`,
`?board=pulse|schedule`) are `<dialog>`s inside `[data-world-route]` whose
bodies use `<section>`s, and the unscoped rule opened them as a bare title
bar. The page-header hide (`main .flex.items-start.justify-between`) skips
dialogs for the same reason (the docked `?team=` panel's header row). The
capture harness's docked-panel arm (`readDockedPanel` / `dockedPanelVerdict`
in `scripts/lib/w1-evidence.mjs`) now fails a panel whose body, outside the
title bar, renders no visible text. The plaza world's root carries
`lang="de"` (`worldLang` in `WorldShell.tsx`); the page's `<html lang>` stays
`en`. Route map: [poketools-spec.md](./poketools-spec.md) §5.

**Rules and draft CTA follow the format.** Only Evolution Point Buy seasons
have a `format_rules` row, so the English themes' `#rules` section,
`?rules=gate` panel and in-world rules plaques (torii, pass gate, halo gate)
branch on `league.format_type`, never on whether a row exists (a format change
can leave a stale one): each theme's `RulesCopyFn` takes a `RulesCopyContext`
built by `rulesCopyContext` in `src/components/world/sections/rules-context.ts`.
The best-of is the current stage's: `currentStage` (same module) is the active
stage, else the LAST one, and it is the one stage selection every world
uses, so the plaques, panels and board read the stage that Pulse names
(the English masthead and the plaza's "Aktuelle Etappe"; a finished league
names its playoffs, not its group stage). EPB is unchanged (draft numbers,
configured/defaults badge, evolution paragraph); its rule prose (the Comeback,
participation and evolution paragraphs, the gate values) comes from the active
format pack's messages (`docs/format-packs.md`). Every other format shows its
format and the current stage's best-of (the sakura ledger labels it "Mode")
and points to the league hub's Rules tab
(`/leagues/<id>?tab=rules#league-hub`), which reads the full ruleset live. Its
plaque note is the theme's `rulesFormatNote` ("… carries the same format and
best-of you read here"), never the EPB ledger note. The ruleset of record is
the season's ruleset, else its first stage's (the hub reads the same
fallback); with neither, the plaques paint the format's own name
(`rulesOfRecordName`: "Evolution Point Buy", "Singles", …), the section and
panel add " — no ruleset is assigned to this league." (the hub's own "No
ruleset assigned."), and the non-EPB pointer says that no clauses, bans or
custom rules are on record instead of promising them. The mountain and clouds
plaques fit the name on their one masthead line (96 px, else 80, else 64 px
ellipsized), inside the inner frame. The link (`RulesHubLink`, a client component) keeps the
viewer's query, `?world=` above all, minus the overlay and focus params; on
the route tier it is also the Lite exit (`?tier=lite`, a plain anchor),
because the hub hides while the scene is live. The station card's rules fact likewise reports a draft budget
for EPB only; without a ruleset it names the format and the hub's notice off
EPB ("Singles · No ruleset assigned", "Einzel · Kein Regelwerk zugewiesen")
and keeps "League default rules" for EPB, whose defaults do apply. The `#pulse` draft CTA (shared and EvoLiga) follows
`leagueDraftHref` (`src/lib/season/format-utils.ts`): EPB opens
`/draft-room`, the `draft` format `/draft`, singles/doubles get none even
with a pool row. Captures: EPB plaques are byte-identical, so default captures
and pinned references hold; only `--fixture open` rules plaques change (sakura
paints 6 lines instead of 8, mountain/clouds 2 columns instead of 4), so the
EPB-calibrated legibility regions (`sakura-rules-1440` minLines 8) do not
apply to an open capture.

The German EvoLiga plaza follows the same rule, since an admin pin or
`?world=plaza` can put any league on it. `resolveRuleSet`
(`src/components/world/evoliga/route/plaza/gate-painters.ts`) takes the same
`RulesCopyContext` and is the one shaping behind the two stone plaques, the
REGELWERK passage board (`fieldBoardPage`), the `?rules=left|right` panel
(`RulesFocusPanel`) and the Lite `#rules` section (`RulesSection`). EPB output
is byte-identical: `src/components/world/evoliga/__tests__/rules-format-aware.test.tsx`
pins the rows and SHA-256 digests of the painted canvas calls and the panel
and section markup, all captured before the format branch. For singles,
doubles and draft, Tafel I ("FORMAT") shows Regelwerk (only when a ruleset is
set), Format (`leagueHubCopy('de').formatType`: Einzel, Doppel, Draft) and
Best-of (only when the league has a stage); Tafel II ("KLAUSELN & VERBOTE")
shows Klauseln, Verbote and Eigene Regeln, each "im Regeln-Tab" (with no
ruleset, each "nicht hinterlegt"). The board's title is the ruleset, else the
format, over the format, best-of and pointer rows. A Tafel I value too long
for its row at 22 px or more (a long ruleset name) wraps to two 22 px lines,
the second ellipsized, inside its column. The section shows the format rows;
the panel shows the page of the plaque that was tapped (`?rules=left` the
format rows, `?rules=right` the clause rows, as its "Regelwerk — Klauseln"
title says); both then say "Klauseln, Verbote und eigene Regeln dieser Liga
stehen in der Liga-Übersicht." (with no ruleset: "Kein Regelwerk
zugewiesen. Klauseln, Verbote und eigene Regeln sind nicht hinterlegt.") and
end with a `RulesHubLink` "Zum Regeln-Tab". There are no draft
numbers, no Standardregeln notice and no evolution, Tera or points copy. The
threshold plate engraves "JETZT DRAFTEN" for EPB and draft and "JETZT
ANTRETEN" for singles and doubles. The station card's rules fact is the shared
`station-digest.ts` one above. Captures: the plaza preview is EPB only, so no
default or pinned capture changes. A non-EPB league on the plaza paints 1–3
plaque rows instead of 5 on Tafel I, 3 instead of 5 on Tafel II, and 4–5 board
rows instead of 6, so the EPB-calibrated `plaza-rules-*` regions do not apply
to it.

**Resolution is server-side.** `resolveViewerWorld(season, viewerOverride)`
(`src/lib/worlds/registry.ts`) assembles the whole precedence chain in one pure
function — `?world=` URL param > admin `seasons.route_theme` pin > format
auto-map. `/leagues/[id]`, `/tournaments/[id]` and `/leagues/[id]/draft-room`
call it with the search param and hand the SAME resolved `SeasonWorld` to the
scene root and to `WorldShell`, so the scene root, the token namespace, the
station manifest, the DOM sections and the palette cannot disagree. A persisted
viewer preference (`poketools:world-override` in localStorage, invisible to the
server) reaches the server through `WorldOverrideRedirect`, which mirrors the
stored pick into the `?world=` param with a same-document `router.replace` — but
only when the URL carries no registered pick of its own, so an explicit
`?world=` always beats storage. The server-resolved param is the SINGLE owner
of which world renders: the client store's only reader is that redirect (the
switcher's label names the server-resolved world, never the stored pick), and
the provider never re-resolves the theme from it, so a stored pick cannot
swap the palette over furniture the server rendered for a different world.

**Readiness and fallback.** Lite (the semantic DOM page) is the default payload;
the route tier is a lazy enhancement. `HideHtmlOnRoute` hides the semantic paint
only on the provider's `routeSceneLive` (defined at the `HideHtmlOnRoute`
entry below) — never on capability detection alone, which would leave a blank
interval while the scene streams. Until that handoff the route canvas is
mounted but inert (opacity 0, no pointer events), so the semantic page stays
readable and clickable through the whole load while the Pokéball loader
(`BallLoader`) presents the attempt; the handoff itself waits for the current
generation to present AND its assets to go idle (or a 2 s cap), and is
two-phase: the canvas first rises over the still-painted page, and the
sections are hidden only once it has composited, so no frame shows neither.
Scene errors, a 10 s readiness timeout, WebGL context
loss and an exhausted quality ladder all degrade to Lite in place — the ball
aborts in the same step, never delaying the fallback — with a bounded manual
retry offered only for retryable reasons.

**Per-viewer opt in/out.** `players.world_experience` (`auto` | `on` | `off`,
default `off` since 2026-10-06: the 3D world is opt-in) is a signed-in viewer preference edited on `/dashboard/settings`
(`WorldExperienceSection` → `WorldExperienceForm`, saved through
`PATCH /api/account/world-experience`). `/leagues/[id]` reads it once — a single
column, only on the route-world branch, degrading to the default `off`
(`DEFAULT_WORLD_EXPERIENCE`, `src/types/player.ts`) if the read fails so
a settings hiccup can never 500 a public page — and threads it to
`WorldStateProvider`. `resolveTierDecision(urlOverride, preference, caps)`
(`src/lib/route-world/quality.ts`, pure) owns the precedence: `?tier=` /
`?routeDebug=1` wins over everything; `off` forces Lite with reason
`viewer-preference` (deliberately not retryable); the HARD floors (no WebGL,
`prefers-reduced-motion`) beat `on`; `on` skips only the advisory heuristics
(save-data, low-memory, low-cores); `auto` keeps the historical `detectTier`
ladder unchanged. Signed-out visitors get the default `off` (the simple Lite
version); `/route-preview` passes `auto` so the capture harness keeps
capability detection. SSR stays
Lite-first — the server capability snapshot is a sentinel that never reaches the
resolver, so a preference cannot fork the server render.

**Capture harness.** `/route-preview` (`src/app/(public)/route-preview/`,
non-production only, 404 in prod) renders every world against deterministic
fixtures (`?world=sakura|mountain|clouds|c100probe`, `&fixture=open`);
`scripts/capture-route.mjs` drives it for batch stills with pose sidecars.

**World assets.** Figures, props, KTX2 textures and HDRIs live in the
`world-assets` Supabase Storage bucket (ADR-0002), described by a generated
manifest (`scripts/world-assets/bake-manifest.mjs`). The client reads
`WORLD_MANIFEST_FILE` = `manifest.v3.json` (`src/lib/route-world/model-manifest.ts`),
fetched once per page with `cache: 'no-cache'` so the browser revalidates it by
ETag. It points at the D42 asset set: GLBs re-encoded with lossless
`EXT_meshopt_compression` (decoded by three's `MeshoptDecoder`, wired in
`figures/figure-loader.ts` with a main-thread fallback when the worker stalls)
and uploaded under content-hashed names (`<name>.<sha256[:12]>.<ext>`, one-year
cache). The published `manifest.json` is the older v2 descriptor that builds
before D42 still read; nothing writes it any more, and only a
`?routeAssetBase=` mirror arm other than `a` reads a `manifest.json`
(`worldManifestFile()`).
Publishing (dry-run plan, offline verify, live upload) is in
`scripts/world-assets/README.md`.
The local mirror's manifests (`public/models/world/manifest*.json`) list a
league's figure pool, so they are untracked: a checkout does not include them.
A maintainer keeps them in the private companion overlay, which tracks both paths,
and restores missing copies with
`git --git-dir=<overlay> checkout -- public/models/world/manifest.json public/models/world/manifest.v3.json`.
Without them the manifest tests skip, and the route world renders at the viewer's
tier with sprite billboards instead of 3D figures and no props: the loader falls
back to an empty manifest.
Deploy your own world-assets set to show figures.

## File Structure

```
src/lib/worlds/
├── registry.ts             # WORLDS + getSeasonWorld / resolveWorld / resolveViewerWorld
│                           #   + getWorldByRouteThemeId / getDefaultWorld
│                           #   + getRegisteredRouteThemeIds
│                           #   + WORLD_OVERRIDE_STORAGE_KEY / WORLD_OVERRIDE_URL_PARAM
├── route-data.ts           # WorldRouteData contract + buildWorldRouteData fetch fan-out
├── route-theme-options.ts  # shared "Auto + registered themes" picker options
├── types.ts                # SeasonWorld / WorldSection / WorldResolvableSeason
└── __tests__/              # registry-viewer.test.ts — precedence chain

src/lib/route-world/        # theme-agnostic engine laws (pure; both sides of the RSC boundary)
├── theme-types.ts          # RouteThemeDefinition
├── quality.ts              # RouteTier / LiteReason / detectTier / resolveTierDecision
│                           #   / readCapabilities / REDUCED_MOTION_QUERY
│                           #   / QUALITY_LADDER / GOVERNOR (+ loadGraceMs, governorInLoadGrace)
│                           #   / RETRYABLE_LITE_REASONS
├── ball-loader-state.ts    # Pokéball loader state machine + reveal-gate / handoff timing (pure)
├── model-manifest.ts       # world-asset manifest loader: WORLD_MANIFEST_FILE (manifest.v3.json),
│                           #   worldManifestFile, figure index, URLs + real-world scale
├── asset-base-override.ts  # ?routeAssetBase= mirror arms (debug; read manifest.json)
└── chapters.ts, palette.ts, focus.ts, layout.ts, …

src/components/world/
├── WorldShell.tsx          # data-world token namespace + provider + RouteSceneRecovery
├── WorldNav.tsx            # sticky anchor nav + WorldThemeSwitcher mounts
├── WorldThemeSwitcher.tsx  # viewer override pill (storage + ?world= param)
├── SectionShell.tsx / ContextOverlay.tsx / Reveal.tsx / panel.ts
├── default/DefaultWorld.tsx   # DOM-only fallback world (anchored sections)
├── evoliga/                # plaza world root, sections, overlays; route/HideHtmlOnRoute.tsx
├── route/                  # engine: WorldStateProvider, RouteWorldCanvas, QualityGovernor,
│                           #   RouteSceneBoundary, RouteSceneRecovery, WorldOverrideRedirect,
│                           #   BallLoader (+ .module.css), world-override-store.ts,
│                           #   world-readiness.ts, scene-progress.ts, camera/focus/post/env;
│                           #   canvas/ (RouteWorldCanvas's parts: StagedWorld, LoadWarmer,
│                           #   SceneReadinessReporter, StaticBatcher, frame-hold, bridges),
│                           #   warm/ (useStationWarmup's parts: programs-warm, load-warm, …)
└── themes/
    ├── index.ts            # client theme registry: resolveRouteTheme(id), AnyRouteTheme
    └── plaza|sakura|mountain|clouds/   # one package per theme (spec §6 layout)
```

## Core Functions/Classes

**Registry** (`src/lib/worlds/registry.ts`, pure + server-safe):

- **`resolveViewerWorld(season, viewerOverride?)`** — the single place the
  precedence chain is assembled. A registered `?world=` id wins (array param:
  first entry); anything else falls through to `resolveWorld`. Unit-tested in
  `src/lib/worlds/__tests__/registry-viewer.test.ts`.
- **`resolveWorld(season)`** — admin-pin arm: a registered `route_theme`
  resolves to the world providing it; an unregistered pick falls back to the
  DOM-only default world with exactly one `console.warn`; `'auto'`/absent
  follows `getSeasonWorld`.
- **`getSeasonWorld(format)`** — auto-map arm: `evolution_point_buy` → evoliga;
  every other format → sakura.
- **`getWorldByRouteThemeId(id)`** — the world providing a theme id, or null
  (the default world carries no `routeThemeId`).
- **`getDefaultWorld()`** — the sakura world: the standalone-tournament
  outcome. The DOM-only default is deliberately not exported.
- **`getRegisteredRouteThemeIds()`** — picker/switcher options derive from the
  world registry, never from the DB CHECK list.
- **`WORLD_OVERRIDE_STORAGE_KEY` / `WORLD_OVERRIDE_URL_PARAM`** —
  `'poketools:world-override'` / `'world'`.

**Client engine** (`src/components/world/route/`, `src/components/world/themes/`):

- **`resolveRouteTheme(id)`** — `src/components/world/themes/index.ts`: id →
  `RouteThemeDefinition`, null for unknown/absent ids (DOM-only worlds).
- **`WorldShell`** — applies `data-world={tokenNamespace}`, installs
  `WorldStateProvider` and mounts `RouteSceneRecovery` and `BallLoader` once
  for every world (both inert on DOM-only worlds).
- **`WorldStateProvider`** — conductor (route progress), tier, `scenePhase`,
  palette (theme `paletteExtension` merged over the token-derived core,
  extension wins), the SERVER-resolved theme, `setRouteThemeOverride` (the
  write half of the override only — the mounted theme is never re-resolved
  client-side), and the read-only loader inputs: `sceneGeneration` (the
  current attempt key from `world-readiness`), `sceneProgress` (that
  generation's milestones from `scene-progress`), `routeRevealArmed` (the
  reveal gate) and `routeSceneLive` (the gated handoff; definition and
  rationale at `HideHtmlOnRoute` below). Under `?routeTrace=1` (observability
  only — it does NOT force the route tier) or `?routeDebug=1` (which implies
  it) it installs `window.__routeWorldReadiness()` — phase, generation,
  stamps, milestones, ball phase, armed/live, `deadlineMs` /
  `deadlineRelaxed` (the deadline in force, see `world-readiness.ts`), the
  tier and Lite reason, and the two handoff marks — for the capture
  harness's `--loader-trace`. `routeTrace` is how the reduced-motion Lite
  floor can be evidenced (`routeDebug` forces the route tier).
- **`world-override-store.ts`** — the repo's single owner of world/theme
  localStorage: `readStoredWorldOverride`, `writeWorldOverride`,
  `clearInvalidStoredWorldOverride`, `isRegisteredRouteThemeId`. Reads
  validate and never delete; the one cleanup is an effect-side call.
- **`WorldOverrideRedirect`** — mirrors a stored pick into the `?world=` param
  via same-document `router.replace`, preserving other params (`?team=`,
  `?mon=`) and the hash; fires only when the URL carries no REGISTERED
  `?world=` pick, so an explicit param always wins over storage. Also clears a
  stored id the registry cannot resolve, as the store's only client reader.
- **`WorldThemeSwitcher`** — cycles Auto + the registered themes; a click
  persists through the store AND sets/removes the `?world=` param so the server
  re-resolves the whole world. Its label and cycle position name the
  SERVER-resolved theme — the world actually on screen — never the persisted
  pick, which is null through SSR and disagrees permanently on route-preview.
- **`world-readiness.ts`** — module-scope store: `ScenePhase`
  (`idle | loading | presented | failed`), a monotonic generation counter,
  `SCENE_PRESENT_SETTLE_MS` (250) and `SCENE_READY_TIMEOUT_MS` (10 s), plus
  two wall-clock stamps (`getPhaseChangedAt`, `getGenerationBegunAt`) that the
  reveal gate and the governor's load grace measure from. The deadline is
  enforced by WALL CLOCK in the store too (review r2): `markScenePresented()`
  refuses a presentation landing more than `SCENE_READY_TIMEOUT_MS` after the
  generation began and marks the attempt `failed` with
  `getSceneFailure() === 'late-present'` (caller-reported failures are
  `'error'`); the provider resolves that to Lite `readiness-timeout`. Before
  this, a `presented` committed inside a long task that pre-empted the
  provider's 10 s timer won over the timeout (sakura 1440: presented at
  11.4 s, no Lite).
  **Debug-only capture relaxation** (review r2 design decision): every
  consumer reads the deadline through `getReadyDeadlineMs()`, re-resolved at
  each generation start by the pure `resolveReadyDeadline(nodeEnv, search)`.
  With `?routeDebug=1&readyDeadlineMs=N` OUTSIDE a production build it is N
  clamped to [10 000, 45 000] ms (logged once as `[route-readiness] deadline
  relaxed for capture: N ms`, surfaced as `deadlineRelaxed` in
  `__routeWorldReadiness()`); it exists so non-W7 visual evidence is not
  hostage to `next dev` compile speed on the capture box. In production
  (`process.env.NODE_ENV === 'production'`, build-inlined) the param is
  ignored and the deadline is exactly `SCENE_READY_TIMEOUT_MS` (pinned by
  `world-readiness.test.ts`). W7 evidence is captured WITHOUT it. The
  harness does not add the param by itself.
- **`scene-progress.ts`** — module-scope, generation-keyed load milestones
  the loader wobbles on: M1 `chunk` (a route canvas is mounted) and M2
  `renderer` (a WebGL renderer exists) are PRESENCE counts, exact because a
  mounted canvas is always the current attempt's; M3 `assets` (THREE's default
  loading manager went idle, or nothing loaded within `ASSET_QUIET_MS` = 300 ms)
  and M4 `firstFrame` are per-generation EVENTS, dropped unless they carry the
  current generation while it is `loading`/`presented`. M5 is `presented`
  itself, which stays in `world-readiness`. Honest limit: M3 watches only the
  default loading manager, and a single slow load that started before the
  bridge installed can read as idle early — the reveal gate's cap bounds the
  other direction. Also carries the ball's trace phase, whether a
  `BallLoader` is mounted (`hasBallLoader`), and `scheduleAtWallClock` — the
  one scheduler every readiness/reveal bound uses: a timeout AND a per-frame
  `performance.now()` check, whichever observes the target first (review r2
  evidence: a lone 2 s cap `setTimeout` did not fire for 3–4 s on the capture
  box while frames kept arriving). It never runs its callback BEFORE the
  target (review r4): browsers truncate a fractional delay, so a timer can
  land up to 1 ms early, and the old early fire handed the ball a not-yet-due
  step that changed nothing and re-armed nothing — a ball then sat in
  `releasing` for 30 s after `world-route-live`. An early timer now re-arms
  for the remainder. The ball's phase changes are also kept as a bounded,
  time-stamped log (`ballTrace` on `__routeWorldReadiness`) for the
  harness's reveal-gate failure sidecar. Review r5 adds, on the same
  bridge: `wobbleTrace` (every commit where the shake / settled shake /
  rendered `data-wobble` changed, the loader's `animationstart` / `end` /
  `cancel` with `animationName` and target, and `rockStart` — the rock's
  `Animation.startTime`, i.e. when it actually started on the document
  timeline; under a main-thread stall `animationstart` is DISPATCHED late,
  the r5 probes saw a rock's start and end events land together 1.8 s after
  it started, so wobble alignment must be judged from `rockStart`);
  `phaseTrace` and `lastFault` from `world-readiness` (every scene phase
  change time-stamped, and the last caller-reported fault with its reason —
  `context-lost`, `scene-error`, `sustained-pressure`, `late-present` —
  sticky across the Lite reset, so a `failed` that the Lite flip resets to
  `idle` inside one task is still on record); and `programsWarm`. The relay
  `bindProgramsWarmSource` carries the canvas's programs-warm latch
  (`getProgramsWarm`, `route/warm/programs-warm.ts`, re-exported by useStationWarmup) to the provider, which must not
  import the scene chunk; with no canvas bound it reads false.
- **`HideHtmlOnRoute`** (`src/components/world/evoliga/route/`) — the only
  writer of the two handoff marks on `<html>`, driven by the provider's
  `routeSceneLive`. That flag is the single home of the handoff definition:
  1. **Trusted presentation** — route tier + `scenePhase === 'presented'` + a
     presentation the PROVIDER witnessed arrive (it saw a non-presented phase
     first, so an inherited `presented` from the previous world cannot hand
     the page over). The latch lives above this component so a remount can
     never strand it.
  2. **`routeRevealArmed`** (the reveal gate, W7/D3) — additionally, for the
     CURRENT generation, (assets idle (M3) AND the renderer's shader
     programs warm — review r5, the r4 handoff-stutter veto: the beam
     played over first-use compiles) OR `revealCapAt` =
     min(`presented` + `REVEAL_GATE.assetsCapMs` (2 s),
     `ballLifeEndAt(generationBegunAt, deadline) − BALL_TIMING.openMs`), so
     the FULL ceremony still ends before the ball's life end (deadline −
     `deadlineMarginMs` 100 ms). The cap is the same whichever input is still
     missing, so waiting on cold programs can never move the reveal past the
     deadline. A presentation later than that clamp arms at once. Disclosed
     limit: under `next dev` on the capture box `programsWarm` latched only
     at 12–16.5 s, after the cap, so dev captures arm on the cap. The latch records `armedAt` / `liveAt` (exposed as
     `routeRevealArmedAt` and in the trace), so a judge can read the gate's
     lateness per run.

  `routeSceneLive` turns on in the SAME commit as the arm (review r3). The
  r2 held lead-in (a hinge `animationstart` latch with an 880 ms timer
  backstop) is gone: under main-thread stalls the latch and timers landed
  seconds late while the CSS kept running on the compositor, leaving a
  half-open ball over the data. Now one commit renders the ball's
  `data-revealing` and writes the handoff attribute, and the hinge, beam,
  iris and the ball's exit are CSS delays off it — one compositor timeline.

  **Two-phase handoff** (r3, blank-frame veto):
  1. `html[data-route-handoff]` (layout effect, on `routeSceneLive`): the
     canvas rises to opacity 1 OVER the sections, which stay painted
     underneath (the positioned canvas already lies above them) — through the
     beam's iris on the ceremony path, a 180 ms fade otherwise.
  2. `html.world-route-live` (every section-hiding rule is scoped to it):
     added only when `stepHandoffComposite` (pure, property-tested in
     `ball-loader-state.ts`) sees, on consecutive animation frames, the
     canvas's computed opacity at 1, no transition/animation (the iris)
     running, and a renderer frame drawn since (`noteRenderedFrame` in
     `scene-progress`; four settled frames stand in for a parked renderer).
  A stalled frame therefore shows the page, the world, or the world opening
  over the page — never the ground colour. Both marks drop together when the
  flag does (Lite, a new generation, unmount). Disclosed limits: phase 2 is
  sampled on rAF, so a hidden tab keeps the page painted under the world
  until visible; the phase-2 layout flip re-seats the scroll on the
  visitor's station (useScrollConductor) with the world visible, not behind
  a flash. The site NavBar leaves with the page from phase 1 (review r4:
  it floated over the sky and the beam): `html[data-route-handoff] body >
  nav` fades it to opacity 0 on the canvas's own 180 ms transition (200 ms
  linear under reduced motion), without pointer events, and keeps its flow
  slot; phase 2's rule then hides its paint.

  The arm is scheduled from a LAYOUT effect through `scheduleAtWallClock`
  and re-derived from absolute targets on every phase / generation /
  milestone notification; the 10 s deadline effect is measured from
  `generationBegunAt` (the visitor anchor — an unmount-chained re-begin
  within `ATTEMPT_CHAIN_MS` keeps the first start, so product and visitor
  clocks agree) and re-checked on each notification. Lateness is still
  bounded by the frame interval.

  The gate only ever makes the handoff LATER than `presented`, never a new
  failure source: every failure flips the tier, which drops the trusted
  presentation — and with it both flags — in the same render. Both latches
  are keyed to the generation, so a theme switch takes the page back
  (sections visible, canvas inert) until the new attempt earns it.
- **`SceneReadinessReporter`** (`route/canvas/`, mounted by `RouteWorldCanvas`) — marks `presented`
  after the first painted frame plus the settle window, guarded by the
  generation counter so an abandoned scene can never present itself; records
  M4 `firstFrame` on the first frame tick AFTER the renderer has drawn
  (`gl.info.render.frame > 0`, review r5), so the rise is not followed in
  the same task by that first draw. Disclosed limit: on sakura-1440 in dev
  the SECOND draw still blocks ~2.2 s right after the rise (first-use
  program links on the load path, where the compile guard is not active),
  so the M4 rock starts ~2 s after its rise; the M1/M2 rocks start within
  10–30 ms of theirs (`rockStart`). A sibling `LoadProgressBridge` chains the
  default loading manager (M3) in a layout effect, so it is installed before
  `onCreated` flushes the queued GLB preloads.
- **`BallLoader`** (`src/components/world/route/BallLoader.tsx`, driven by the
  pure `src/lib/route-world/ball-loader-state.ts`) — the Pokéball loading
  ceremony: DOM/CSS-3D only (no second renderer), fixed, `pointer-events:
  none`, visuals `aria-hidden`, stacked above the canvas and the sections and
  below WorldNav (z-30), the site NavBar (z-40) and the retry (z-50). One
  polite `role="status"` line speaks the theme's `loaderCopy` (German on
  EvoLiga, `DEFAULT_LOADER_COPY` otherwise). Lifecycle
  (`hidden → loading → opening → releasing → done`, any failure →
  `aborted → hidden`). A presented generation always passes opening →
  releasing → done in order, one committed phase per step on the machine
  clock anchored at the arm — a beat a stall swallowed is compressed
  (release ≥ `minReleaseMs` 200 ms), never skipped (property-tested with
  0–80 ms step lateness). On the full ceremony `releasing` also never ends
  before the beam, timed by CSS from the reveal COMMIT (the machine's
  `revealCommitAt`, which can trail the arm after a stall), has passed its
  peak (`handoffMs` + `beamPeakMs` 350 ms). Whatever the anchors say,
  `releasing` ends within `releaseBoundMs` (1320 ms) of entry (review r4).
  One phase per COMMIT (review r5: sakura-1440 published `opening → done`
  with no `releasing` — two queued steps ran in one render batch after a
  stall): a step whose previous state already advanced past the committed
  phase holds, and the wake re-arms after the commit; aborts never hold.
  Phases are published to `ballTrace` from the layout phase (at commit; a
  passive publish trailed the DOM by up to 6 s under a stall). A
  compositor-side life bound backs the machine: while the ball is visible, a
  Web Animation on the loader root pinned to the document timeline
  (`startTime` = life end − 150 ms, implicit start keyframe) fades it to 0
  by the life end even when a main-thread stall keeps the machine from
  stepping (r5 probes: a 2 s stall carried a presented-but-unarmed ball
  ~760 ms past the deadline; a 6 s stall mid-ceremony). The whole lifetime
  ends `deadlineMarginMs`
  (100 ms) before the readiness deadline from the attempt start:
  - **loading** — a compact ball docked bottom-centre with a scrim behind the
    ball alone (≤ 640 px: a 32 px ball 4 px from the right edge of the
    bottom band, in a gutter the HUD pill yields, no scrim, plus a 72 px
    spacer after the page content; at 390 the cards' text column ends
    ≈ 41 px from the edge, leaving a ≥ 5 px gap). It rocks ONCE per observed
    rise of the milestone count ABOVE the generation's high-water mark
    (review r4: a dip — a canvas remount releasing M1/M2 — and the climb
    back replayed a rock), restarting at once on a new rise (a burst
    compresses to one wobble, nothing queues, no timer-driven shake).
    `data-wobble` is rendered only for a shake whose rock has not yet ended
    and only while the ball is docked and loading (`wobblePlays`), so no
    later restyle — the reveal's `animation: none` dropping on an abort, a
    `data-reduced` flip — can replay it (r3 evidence: a rock 50 ms after
    `aborted`, and one ~850 ms after a rise with no new milestone); the
    renderer's first render is held one frame after M2 (`holdFirstRender`
    in `route/canvas/frame-hold.ts`, called from RouteWorldCanvas) so that wobble starts before the first compile.
    Only the wobble element's own rock (`data-shake` target AND the
    `wobble` keyframes) settles a shake; bubbled child animations (button
    pulse, flight enter) are ignored (review r5).
    An unpresented attempt starts its 150 ms fade at life end − 200 ms, so
    it is gone before the deadline; a presented-but-unarmed one leaves
    through the quick crossfade without claiming a failure.
  - **opening** — on the arm: the ball stays IN ITS DOCK (r3: the r2 flight
    to centre covered data for up to 2.9 s): a click (0–100 ms), then the
    lid hinges back in 3D (`hingeStartMs` 100) while the mouth glows.
    `releasing` follows at `handoffMs` (240 ms) on the machine clock.
  - **releasing** — at +240 ms the capture-release beam bursts from the
    docked ball: a white core at full intensity for ~210 ms, 12 saturated
    #e3350d shafts with white-hot cores (full for ~245 ms), a white rim ring
    with a red halo, sparks, and a white/red wavefront (`.sweep`, 155 vmax
    radius) sweeping past the farthest corner in 520 ms while the canvas is
    revealed INSIDE it — the globals.css W7 iris (same delay, curve and
    duration, origin at the dock, radius 0.94 × the wavefront's, ending past
    any viewport diagonal), scoped to `html[data-route-handoff]` and the
    ball's `data-revealing` (not `data-reduced`). The ball pops out of the
    dock (scale up + fade, 300–600 ms). `done` at +1060 ms (`openMs`). All
    beam layers are transform/opacity (the shafts' length fade is a static
    mask); the iris is clip-path. A reveal armed too late for the full
    ceremony (`quick`, rendered as `data-reduced`) plays the 200 ms
    crossfade.
  - **aborted** — only on a REAL failure: tier leaves route (readiness
    timeout, late present, context loss, ladder exhaustion, a DOM-only
    destination) or phase `failed`, or the life end of an unpresented
    attempt; it lands in the SAME step it becomes observable, with a 150 ms
    fade. On `webglcontextlost` the canvas aborts the ball INSIDE the event
    handler (`abortBallNow` → a `flushSync` commit, published at once),
    before the Lite flip whose commit unmounts the canvas tree (review r5).
    The loss R3F itself forces ~500 ms after an unmount is ignored (it used
    to re-mark the scene `failed` after the reset and overwrite the true Lite
    reason, e.g. `readiness-timeout` → `context-lost`). Disclosed limit: the
    event is only dispatched when the main thread frees up — the r4 3.3 s
    pre-abort stall is the plaza's `ProceduralCobbleFloor` texture synthesis
    (`cobbleMaps`/`cobbleField`, ~2.2 s of one uninterruptible render in
    dev), not the loss path; the ball aborts ≤ 7 ms after dispatch. A transient `idle` (StrictMode's layout cleanup, a provider
    remount) is held, and a generation bump re-presents the new attempt from
    `loading` (or straight into `opening` if already armed) — a stale
    reveal never finishes. The generation is kept through
    `aborted → hidden`, so an aborted attempt that later presents never
    re-summons the ball.
  - **Reduced motion** (reachable only through a forced `?tier=route`): a
    static ball, milestones recorded without a wobble, no beam, and a
    200 ms opacity crossfade. Latched at the reveal.
  - **Trace self-check** (`routeTrace` / `routeDebug` only): while the ball
    is over the page it checks its box against the VISIBLE text of
    `[data-world-route]` (hit-tested, so text under the opaque HUD band
    does not count) and records overlaps on
    `window.__ballTextIntersections` with one console warning per text.
  - A mounted loader never starts a ceremony for a gate that already armed,
    and a finished ceremony never replays for its generation.
- **`RouteSceneBoundary`** — catches scene chunk/model/render failures and
  degrades to Lite in place (`scene-failed`) instead of letting the route
  `error.tsx` replace good data with "League failed to load".
- **`RouteSceneRecovery`** — bounded manual retry (one explicit user action),
  shown only for `RETRYABLE_LITE_REASONS` (`context-lost`, `scene-failed`,
  `readiness-timeout`); `sustained-pressure` deliberately does NOT retry.
- **`RouteWorldCanvas`** — the one fixed canvas (its staged world, warmers,
  readiness reporter, static batcher and debug/capture bridges live in
  `route/canvas/`); three's per-program
  `checkShaderErrors` is OFF from `onCreated` for every visitor (its info-log
  reads force a synchronous link wait on first use); `?routeDebug=1` keeps
  it on unless `?routeShaderCheck=0`, so a debug trace can measure the
  production-like compile cost. The renderer parks while the
  tab is hidden (unless `?routeDebug=1`), and the static batcher's
  observe/build/revalidate intervals stop with it. Its wrapper carries
  `data-route-canvas` and is INERT until the handoff: positioned at z-0 it
  would otherwise cover the non-positioned sections and swallow their clicks
  from the moment it mounts, so the fenced W7 block in `globals.css` holds it
  at opacity 0 until `html[data-route-handoff]` (no pointer events until
  `html.world-route-live`) and reveals it through the beam's iris, or a
  180 ms fade (200 ms linear under reduced motion) without a ceremony. Opacity never parks a WebGL canvas, so shaders compile and the scene
  finishes building underneath. Every surface that mounts this canvas must
  also mount `HideHtmlOnRoute`, or its canvas stays invisible —
  `route-handoff-contract.test.ts` pins that, and that no stylesheet hides the
  canvas outside the pre-handoff scope. Mounting notes M1 and `onCreated`
  notes M2 for the loader.
- **`QualityGovernor`** — frame-time governor; steps down `QUALITY_LADDER`
  (whose rungs carry `themeFigures: number | null`, null at rung 0 to preserve
  the graded composition) and, when the bottom rung still cannot hold a frame,
  calls `onExhausted` → Lite with reason `sustained-pressure`. Suppressed when
  quality is pinned, so capture runs are unaffected. Slow frames do not count
  while the scene is loading nor for `GOVERNOR.loadGraceMs` (4 s) after it
  presents (`governorInLoadGrace`, read from the readiness store at frame
  time): shader compiles, texture uploads, the batcher merge and the reveal
  window (2 s asset cap + ≤ 0.88 s lead-in backstop + the 0.78 s release
  beat with its canvas iris) land there, and counting them would
  permanently cost a rung on a healthy device — or exhaust a weak one into
  Lite while the ball is still up.
- **`resolveTierDecision(urlOverride, preference, caps)`** — the pure tier
  decision (`src/lib/route-world/quality.ts`); `detectTier` is its
  backward-compatible facade (no URL override, `auto` preference) and
  `readCapabilities()` supplies the environment signals. The provider's
  `subscribeTier` re-runs detection when `prefers-reduced-motion` changes
  mid-session.

**Picker surfaces:**

- **`getRouteThemeOptions()`** — `src/lib/worlds/route-theme-options.ts`: Auto +
  every registered theme; shared by both admin pickers so they grow in lockstep.
- **`LeagueForm`** (`src/components/league/LeagueForm.tsx`) — creation-time
  theme select, submitted as `route_theme`.
- **`LeagueThemeControl`** (`src/components/league/LeagueThemeControl.tsx`) —
  post-create admin control; PATCHes ONLY `{ route_theme }` to
  `/api/seasons/[id]` (optimistic select, revert-on-failure). Mounted as the
  "3D World Theme" Section in `src/app/admin/leagues/[id]/page.tsx`.

## Data Flows

- **Input**: the season row (`format_type`, `route_theme`), the `?world=`
  search param, the signed-in viewer's `players.world_experience`, and the
  Supabase fan-out behind `buildWorldRouteData`
  (`src/lib/worlds/route-data.ts`).
- **Processing**:
  1. `/leagues/[id]` calls `resolveViewerWorld(league, query.world)` and
     dispatches through its `ROUTE_WORLDS` record (`evoliga` / `sakura` /
     `mountain` / `clouds` → world root); a world without a route theme
     renders `DefaultWorld`.
  2. The route world fetches through `buildWorldRouteData(id)`; each theme
     adapts the generic `WorldRouteData` once inside its own root
     (`toSakuraRouteData`, `toMountainRouteData`, …). Themes never query
     Supabase.
  3. `/tournaments/[id]`: season-backed tournaments resolve through
     `resolveViewerWorld(season, …)`; standalone tournaments take
     `getWorldByRouteThemeId(?world=) ?? getDefaultWorld()`; either way the
     page wraps in `WorldShell` so tokens carry over.
  4. `/leagues/[id]/draft-room` resolves the same way, keeping the arena in the
     same world as its league page.
  5. Viewer pick: `WorldThemeSwitcher` writes storage + sets `?world=`
     (same-document replace). On later loads `WorldOverrideRedirect` re-mirrors
     the stored pick into the param so the server resolves the whole world
     from it.
  6. Route-tier readiness: `beginSceneGeneration(themeKey)` on (theme,
     route-tier) entry — idempotent while that theme is already `loading`, so a
     retry or a soft-navigation remount cannot double-bump the generation the
     reporter compares against → the canvas mounts inert (M1), the renderer
     is created (M2) and the `BallLoader` docks and wobbles per milestone →
     assets go idle (M3) and the first frame paints (M4) →
     `SceneReadinessReporter` marks `presented` after the settle window → the
     reveal gate arms (`routeRevealArmed`: assets idle or the cap, clamped so
     the full ceremony fits before the deadline) and, in the same commit,
     `routeSceneLive` flips → `HideHtmlOnRoute` writes
     `html[data-route-handoff]` while the ball renders `data-revealing`: the
     ball clicks and opens in its dock, the beam fires at +240 ms and the
     canvas is revealed over the still-painted page inside the beam's
     wavefront → once the canvas has composited (opacity 1, iris finished,
     a renderer frame drawn) `world-route-live` hides the sections → the
     ball is done at +1060 ms. Timeout
     (10 s from `generationBegunAt`, wall clock, checked while tier is
     `route` AND the phase is `loading`, re-keyed whenever a new generation
     begins in that window — so a mid-load theme switch keeps its own
     budget; a `presented` arriving past it is refused as `late-present`),
     scene throw, context loss or ladder exhaustion → Lite in place and the
     ball aborts in the same step; `RouteSceneRecovery` offers a retry (in
     the world's `loaderCopy` language) for retryable reasons only.
     Navigation away unmounts the provider and the ball together (the layout
     cleanup resets readiness); a theme switch mid-load re-presents the new
     generation from `loading` with a fresh budget.
- **Output**: a world-shelled league/tournament/draft-room page in one of four
  3D route worlds, or the DOM-only fallback world.

## Dependencies

- **External Libraries**: none for the registry and route-data modules (pure,
  server-safe). The route-tier engine uses `three` + `@react-three/fiber`
  client-side only.
- **Internal Modules**:
  - [Season](./season.md) (`SeasonFormatType`, `RouteThemeId`,
    `getSeasonWithDetails`)
  - [Evolution Point Buy](./evolution-point-buy.md) (point-buy entries, trackers)
  - [Draft Room](./draft-room.md) (`draftExperience` key, draft pool)
  - [Admin](./admin.md) (`/admin/leagues/[id]` theme Section)
  - Supabase query helpers via `buildWorldRouteData` (`seasons`,
    `point-buy-lists`, `format-rules`, `evolutions`, `drafts`,
    `league-standings`, `tournament-reports`)

## Related Modules

- [Public Site](./public-site.md) — the `(public)` routes the worlds render in.
- [Season](./season.md) — `seasons.route_theme` pin + format auto-map input.
- [Evolution Point Buy](./evolution-point-buy.md) — the plaza world's format.
- [Draft Room](./draft-room.md) — draft-experience keys and the arena page.
- [Design](./design.md) — `--world-*` token namespaces keyed off `data-world`.

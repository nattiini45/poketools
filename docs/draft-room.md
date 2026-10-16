# Draft Room Module
> The EvoLiga draft tool for **Evolution Point Buy (EPB)** leagues: the pick screen with its finder, the secret-drop redraft, the token centre, the admin control panel with its audit trail, the draft overlays and the trainer-avatar editor. The UI is bilingual (English default, German). This page is the public reference; the original frontend and backend design specs are maintainer-only and not in this repo. The data contract is summarised in [poketools-spec.md §5](./poketools-spec.md).

## Overview
The draft room is the pick-by-pick front end for EvoLiga draft pools. It exists only for seasons whose `format_type` is EPB (`isEvolutionPointBuy`). For any other format, `/leagues/[id]/draft` shows the standard draft board, and an EPB league that opens that URL is redirected to the draft room.

The season's bound point-buy list is the only source of draftable evolution lines. Each line is keyed by a stable `line_id` (`@/lib/draft/line-identity`), so branched lines such as Oshawott → Samurott / Hisuian Samurott are separate options.

The UI is a thin client over the **queue engine**. The server owns every rule: whose turn it is, the clocks, the budgets, draftability, make-up slots and penalties. The server returns all of it in one `DraftSnapshotDTO`. The client renders the snapshot, explains why a line is or is not draftable (with `ReasonDTO` codes from the server), and sends picks.

Two rules hold throughout:
- There is no optimistic state. A pick applies the snapshot in the response and then refreshes.
- Translated text is never stored in state. State holds keys, reason codes or `ApiErrorLike`.

Kinds of pool and mode:
- **Pool kinds:** `initial` and `redraft`. The redraft adds a secret-drop submission phase, a reveal, and picks into A/B/C redraft slots.
- **Modes:** `live`, with a per-pick clock, extensions and make-up slots for timeouts, and `slow`, with long slot deadlines, a penalty ladder and reminders at 8, 4 and 1 hours.

## Routes

| Route | File | Who | What |
|---|---|---|---|
| `/leagues/[id]/draft-room` | `src/app/(public)/leagues/[id]/draft-room/page.tsx` (+ `client.tsx` re-exporting `DraftToolClient`) | public; picks need a session | The pick screen. `?pool=<uuid>` selects a pool; `?world=` overrides the world |
| `/leagues/[id]/redraft` | `src/app/(public)/leagues/[id]/redraft/page.tsx` | participants (sign-in prompt otherwise) | Secret drop submission, lock, reveal, then a link to the room |
| `/leagues/[id]/tokens` | `src/app/(public)/leagues/[id]/tokens/page.tsx` | signed in | Token centre: Participation, Draft Kill and Comeback tokens, progress sources |
| `/leagues/[id]/draft` | `src/app/(public)/leagues/[id]/draft/page.tsx` | public | Standard (non-EPB) draft board; EPB leagues redirect to the draft room |
| `/admin/leagues/[id]/draft` | `src/app/admin/leagues/[id]/draft/page.tsx` | site admin or season resource admin | Draft control panel (`DraftControlPanel`) |
| `/admin/leagues/[id]/draft/audit` | `src/app/admin/leagues/[id]/draft/audit/page.tsx` | idem | Read-only audit trail (`?pool=&action=&player=`) |
| `/draft-room/trainer-creator` | `src/app/(public)/draft-room/trainer-creator/` | signed in | 3D trainer avatar editor (saves via `PUT /api/avatar/3d`) |
| `/broadcast/draft/[did]/{live,pick,replay}` | `src/app/(broadcast)/broadcast/draft/[did]/` | OBS sources | Draft viewer, pick reveal and replay overlays |
| `/draft-preview` | `src/app/(public)/draft-preview/` | **dev only** (404 in production) | Fixture preview of every screen state (see [Dev preview](#dev-preview-draft-preview)) |

## File Structure
```
src/lib/draft-finder/                 # Finder engine (pure, client-safe; no @pkmn/* outside *.server.ts)
├── index-types.ts                    # DraftSearchIndex schema (INDEX_SCHEMA_VERSION)
├── build-index.server.ts             # Builds the index from list entries with @pkmn/data (server only)
├── line-catalog.ts                   # buildLineCatalog (narrow per-line props) + hashCatalog
├── names-port.ts                     # NameResolver over @/lib/pkmn/i18n (the only importer in this dir)
├── prepare.ts / search.ts            # Prepared index; bilingual word-prefix search (EN + DE always)
├── filter-types.ts / reducer.ts      # FinderFilters, FinderViewState, finderReducer (pin, compare, chips)
├── engine.ts                         # compileCriteria / evaluateLine / runFinder + "why it matches"
├── chips.ts / sort.ts / tabs.ts      # Active-filter chips, sort keys, price tabs (the pack's `epb.priceTabs`, plus all)
└── ability-defense.ts                # Ability-aware type defence (Levitate, Flash Fire, …)

src/lib/draft-ui/                     # Pick-screen view logic (pure, tested)
├── snapshot-types.ts                 # Re-exports of the DTOs in @/types/draft-queue
├── snapshot-adapter.ts               # toDraftViewModel: the only reader of DTO field names
├── select-pool.ts                    # Which pool the room shows (?pool > in_progress > submissions > initial)
├── clock.ts                          # computeClock, bands (ok/warn/low), formatCountdown
├── reasons.ts                        # ReasonDTO → draft/shared.reasons key + params
├── armed-confirm.ts                  # Confirm dialog arming (1200 ms) reducer
├── notify-schedule.ts                # Turn alert + slow reminders (8/4/1 h), deduped per slot
├── progress-display.ts / progress-labels.ts  # Progress-source breakdown (Kills / Draft Kill / Comeback / Participation)
├── storage.ts                        # Safe local/session storage (prefs, pin, notify opt-in, dedupe)
└── constants.ts                      # Poll cadences, hover delay, arm delay

src/components/draft-tool/            # The pick screen
├── data-source.ts                    # DraftDataSource port + createHttpDataSource (the only module with URLs)
├── DraftToolClient.tsx               # Container: poll, index, favourites, finder, clock, turn watch, dialog
├── DraftToolScreen.tsx               # Presentation; draft-tool.module.css holds the scoped tokens
├── hooks/                            # use-draft-snapshot, use-turn-watch, use-clock, use-search-index, …
├── layout/                           # ClockBar, TimerBar, UpcomingOrderStrip, PlayersSheet, PhoneSection
├── left/                             # LinePreview, InfoBox, DraftButton (+ cta-state), CostConsequence,
│                                     #   MatchExplanation, CompareTray, MyRosterDock, RecentPicks
├── right/                            # FinderBar, PriceTabs, RosterWall, RosterCard, HoverDetails,
│                                     #   FilterPanel + filters/*, ActiveFilterChips
├── dialogs/                          # ConfirmPickDialog, RedraftSlotChooser
├── feedback/                         # DraftToast, LiveAnnouncer, NotifyToggle, announcements
└── shared/ArmedConfirmDialog.tsx     # Shared armed-confirm dialog (also used by tokens and admin)

src/components/draft-redraft/         # RedraftCenter, RedraftSubmissionPanel, RedraftReveal, RedraftPhaseNotice,
                                      #   redraft-source.ts (RedraftSource port)
src/components/draft-tokens/          # TokenCenter, CosmoTokenCard, DraftKillTokenCard, ComebackTokenCard,
                                      #   ProgressSourcesTable, token-source.ts (TokenSource port), token-view.ts
src/components/draft-admin/           # DraftControlPanel, LiveControls, InstanceConfigForm, PenaltyStageEditor,
                                      #   BlockedSlotResolver, PickCorrectionTable, RedraftPhaseManager,
                                      #   TokenAdminSummary, DraftAuditViewer, admin-actions.ts
src/components/broadcast/overlays/    # DraftViewer, DraftPickReveal, DraftReplayPlayer
src/lib/draft-room/trainer-config.ts  # TrainerConfig + avatar presets

src/lib/draft/                        # Engine contracts used by the UI (backend-owned)
├── snapshot.ts                       # getDraftSnapshot / toDraftSnapshotDTO / toMyTurnDTO (server)
├── use-visible-poll.ts               # createVisiblePoller / useVisiblePoll (D37 cadence)
├── errors.ts / rpc-errors.ts / http.ts  # Draft error codes, RPC error mapping, draftErrorResponse
├── budget.ts / draftability.ts / tokens.ts / redraft-order.ts / schemas.ts
└── line-identity.ts / price-tabs.ts / utility-categories.ts / epb-thresholds.ts / progress-sources.ts

src/i18n/messages/draft/{shared,screen,finder,redraft,tokens,admin,discord,legacy}/   # UI namespaces (en/de/index)
src/i18n/messages/errors/draft/        # API error codes (errors/draft-legacy for the old routes)
```

## Core Functions/Classes

### `DraftToolClient` — `src/components/draft-tool/DraftToolClient.tsx`
The pick screen's state owner.
- **Props:** `poolId`, `seasonId`, `leagueName`, `catalog`, `initialSnapshot`, `indexUrl`, `viewer { playerId, isSiteAdmin }`, `links { redraft, tokens, admin, trainerCreator }`.
- **Optional preview props:** `initialIndex` and `dataSource`.
- **What it wires:** the snapshot poll, the lazy search index, favourites, the finder reducer and engine, the clock, the my-turn watch, the confirm dialog, the toasts and the screen-reader announcer.
- **Output:** it renders `DraftToolScreen`.

### `DraftDataSource` — `src/components/draft-tool/data-source.ts`
The data port. It exposes `fetchSnapshot(since)`, `fetchMyTurn`, `fetchIndex`, `getFavorites` / `setFavorite`, `postPick` and `postExtension`.
- Failures are values. A snapshot read returns `{ kind: 'auth' | 'error' | 'unchanged' | 'full' }`. A write returns `ApiCall<T>`, where a rule error may carry a fresh `snapshot`.
- `createHttpDataSource(poolId, seasonId)` is the production implementation.
- The redraft and token screens follow the same pattern with their own ports, `RedraftSource` and `TokenSource`, each with an HTTP default and an injectable fake.

### `toDraftViewModel` — `src/lib/draft-ui/snapshot-adapter.ts`
Turns a `DraftSnapshotDTO` into the `DraftViewModel`:
- the active slot and the viewer flags;
- the upcoming order with round breaks and make-up slots;
- the participants with their rosters;
- the recent picks;
- per-line card states (`available | drafted | blocked | mine`) with their reasons;
- `remainingAfterPick`.

It is the only module that reads DTO field names, so a field added by the backend never breaks the UI.

### `runFinder` — `src/lib/draft-finder/engine.ts`
Runs over the prepared index. It combines:
- the text query, which always searches English and German names with transliteration;
- type, move, ability, utility-category, stat, price and defence criteria, with a `same_stage | anywhere` stage mode;
- the price tab and the sort key.

It returns the matching line ids, the tab counts and a per-line explanation of why each line matched.

### `buildDraftSearchIndex` — `src/lib/draft-finder/build-index.server.ts`
Builds the per-list search index on the server from the list entries with `@pkmn/data`. The index holds stages, types, abilities, learnsets, stats, move and ability names, and the utility categories. It is served by `GET /api/point-buy-lists/[id]/search-index?v=<schema>&h=<catalogHash>`, which keeps an in-process memo and sends an immutable cache header for bound lists. An unbound version is private and `no-store` for site admins and 404 for everyone else.

### `buildLineCatalog` — `src/lib/draft-finder/line-catalog.ts`
The narrow per-line props, one row per list line: price, stages, override-aware cumulative thresholds and labels. It is built on the server and passed to the client. It deliberately leaves out the rationale, history and sources prose. `hashCatalog(entries)` versions the index URL.

### `selectPool` — `src/lib/draft-ui/select-pool.ts`
Decides which pool the room shows, in this order:
1. a valid `?pool=` that belongs to this season;
2. the pool that is `in_progress` (a redraft wins);
3. a redraft in its submissions phase (the room shows a notice linking to `/leagues/[id]/redraft`);
4. the initial pool.

### Server pages
- **`/leagues/[id]/draft-room`** loads, in two parallel waves: the session, the season, the pools and the resource-admin check; then the snapshot (`getDraftSnapshot(pool.id, viewer, { tick: false })`), the list entries and the format rules. That is at most 6 Supabase reads cold.
- **Seeds never tick.** Every page seed passes `{ tick: false }`, because a Server Component render must not advance a clock or publish a redraft (critique B9). Only the route handlers tick.
- **Narrow props.** Participants reach the client only inside the snapshot DTO, which the backend builds with an allowlist mapper. Admin pages pass `toPublicPlayerRef` rows (`{ id, name }`).

## Data Flows
- **Snapshot poll.** `useDraftSnapshot` polls `GET /api/drafts/[id]/state?since=<state_version>` every 3 s while the tab is visible and pauses while it is hidden (`useVisiblePoll`).
  - An `unchanged` answer only updates the server clock offset.
  - A 401 or 403 stops the poll and switches to the spectator view. Anonymous viewers therefore see the server seed.
  - A failed read keeps the last state and marks it `stale`.
- **Turn watch.** `useTurnWatch` calls `GET /api/drafts/[id]/my-turn` every 60 s, and only while the tab is hidden. This is the single sanctioned exception to D37.
  - It raises browser notifications when the viewer opted in for that pool and permission is granted.
  - Alerts are deduped per slot across tabs through `storage.ts`.
- **Discord notifications** (server side, `src/lib/draft/notify.ts`, embeds in `src/lib/discord/draft-embeds.ts`, texts in `draft/discord` in the league's webhook language).
  - **Turn ping, live and slow.** When a slot becomes active, the player is @mentioned once (email-only players get the embed without the mention). A live draft's embed names the pick time in minutes (`timer_seconds`; seconds when the timer is not whole minutes). A slow draft's embed names the deadline as Discord timestamps plus the league time.
  - **Reminders, slow only.** 8 h, 4 h and 1 h before the deadline; thresholds a slot started past are never sent. Live drafts get no reminders.
  - **Exactly once.** `draft_claim_notifications` claims each event under a marker on the slot (`notified_turn_at`, `reminder_mask`, `alert_notified_at`) or the pool (`publish_notified_at`) with `FOR UPDATE SKIP LOCKED`, so concurrent callers never send one event twice. A paused pool's slot is claimed after the resume.
  - **Who claims.** The pick route and the redraft publish route, inside `after()`. `scheduleDraftNotifications(poolId)` (one claim RPC inside `after()`, fire-and-forget, never throws) is called by the admin writes that can move the clock: start, resume, blocked-slot resolve, void, correct and redraft restore-drop. The polled reads (`state`, `my-turn`) call it **only** when their tick resolved a timeout (`timeouts_resolved > 0` from `draft_snapshot` / `draft_my_turn`) or published a redraft, never on a plain poll (Supabase quota). The `draft-ticks` cron sweeps whatever these miss.
  - `published_now` and `timeouts_resolved` never reach the client: the snapshot mappers return them beside the DTO.
- **Pick.**
  1. The DRAFT button opens `ConfirmPickDialog`. Cancel has focus, and the confirm button arms after 1200 ms.
  2. Confirming sends `POST /api/drafts/[id]/picks` with `{ slot_id, line_id, client_request_id, redraft_slot_id?, on_behalf_of?, override_reason? }`. The `client_request_id` is created when the dialog opens and reused on retry, so the request is idempotent.
  3. A `201` carries the new `snapshot`, which is applied at once before the poll refreshes. A rule error may also carry a snapshot, which is applied too.
- **Extensions.** In live mode, `POST …/extensions { kind: 'plus120' | 'plus60', slot_id }`.
- **Favourites.** Favourites are server-side (`GET`/`PUT …/favorites`). The pinned line and the preferences are per-tab storage only.
- **Redraft.**
  - The player's own submission is fetched client-side from the owner-guarded `GET/PUT …/redraft/submission` and is never server-rendered.
  - When the deadline passes, the submission locks. Publishing reveals the drops, and the picks then go into the redraft slots (`RedraftSlotChooser`).
- **Tokens.**
  - `TokenCenter` loads `GET /api/seasons/[id]/tokens/me`. An admin can view another player with `?player_id=`.
  - A Draft Kill Token is bought with `POST …/draft-kill-tokens`.
  - Comeback Tokens are spent with `POST …/comeback-tokens/spend`, which accepts several allocations in one call. Spending is open only while an admin has opened it.
- **Admin.**
  - Each control in the panel is one admin route: config, start/end, pause, void, correct, resolve blocked slot, penalty stage, redraft settings, publish, restore.
  - Every write refreshes the snapshot afterwards.
  - Void and correct are refused unless the pool is paused.
  - Every admin write is recorded in the audit trail with a reason.
- **Broadcast.**
  - **Locale.** The overlays resolve their language with `resolveOverlayLocale`: `?lang=` first, then the league language, and never the viewer cookie.
  - **Polling.** They poll at the cadence set by `?poll=` and send `?since=`. A 401 or 403 stops the poller.
  - **Labels.** Line labels come from `localizeLineLabel`. The replay uses `localizeSpecies`, because replay events carry no `line_id`.

## i18n
- **Namespaces.** Every visible string comes from `useT(<namespace>)` or `getT(<namespace>)`:
  - `draft/shared`: reasons, countdowns, points;
  - `draft/screen`: the pick screen and its pages;
  - `draft/finder`: filters, chips, tabs;
  - `draft/redraft`, `draft/tokens`, `draft/admin`;
  - `draft/discord`: the Discord announcement texts for draft events;
  - `draft/legacy` (with `draft/legacy/{board,evolution,pages}`): the old draft UI;
  - `glossary`: the fixed terms such as "Draft"/„Draften", "Draft paused"/„Draft pausiert" and the token names.
- **League tuning prose** (token rules, the participation line, price-group labels, the stage-lock and line-rule texts) comes from the active format pack's `messages`, spliced into these namespaces; utility-category labels come from `utilityLabel` ([Format Packs](./format-packs.md#messages)).
- **API errors** render through `useApiErrorText(errorsDraft)(err)`. An unknown code falls back to the English `error`.
- **Pokémon, move, ability and type names** never appear in message files. They come from the pkmn layer (`NameResolver`, `<PkmnName>`) in the **data locale**, which is the viewer's language unless they chose "keep Pokémon terms in English".
- **Dates and countdowns.** Client components format them with `useFormatter()`. Absolute deadlines render `<LocalTime … zone="both">`, which adds the `Europe/Berlin` league time when the viewer's zone differs.
- **Search** always matches both languages, so a German user can type "Glurak" or "Charizard".

## Visual rules (pick screen)
- **Tokens.** Colours come from scoped tokens in `draft-tool.module.css` (`.root` / `.tokens`). These map to the world tokens (`--world-*`) and fall back to the theme tokens (`--poke-*`). Dark mode is set under `[data-theme="dark"]`. There are no fixed dark slabs.
- **Red is reserved for drafted cards** (`--draft-taken-*`). A clock running low is amber, and an error toast is yellow.
- **The DRAFT button is violet** (`--draft-cta`). Disabled, it is grey, and the reason sentence shows beside it. An admin pick-on-behalf uses the outlined violet variant.
- **Layout.** The pick screen is a single column below 768 px, two panes from 768 px, and a 5/7 grid from 1024 px. On phones the roster, the picks and the compare tray become collapsible sections, and the filter panel opens as a full-screen sheet.
- **Motion** runs only under `prefers-reduced-motion: no-preference`.

## Dev preview (`/draft-preview`)
`src/app/(public)/draft-preview/` renders the real components against an in-memory `createFakeDataSource` and deterministic scenarios over the synthetic 48-line example list (`fixture-lines.example.json`, generated from the example format pack by `scripts/draft/make-example-list-fixtures.ts`; see [Format Packs](./format-packs.md#testing)).
- **No network.** The page builds the search index on the server (CPU only). Nothing reads Supabase, and the tests fail on any `fetch`.
- **Production.** The route 404s in production.
- **Query parameters:**
  - `?scenario=` takes one of `live-my-turn` (default), `live-waiting`, `live-up-next`, `live-paused`, `live-makeup`, `live-blocked`, `live-ext-used`, `live-reasons`, `live-filters`, `live-confirm`, `slow-my-turn`, `slow-penalty`, `redraft-submission`, `redraft-locked`, `redraft-reveal`, `redraft-picking`, `complete`, `spectator`, `signed-out`, `admin-panel`, `admin-audit`, `tokens-before`, `tokens-open`, `tokens-comeback` or `many-drafted`.
  - `?world=evoliga|sakura|mountain|clouds|none` picks the world. `none` shows the plain-theme fallbacks.
  - `?lang=en|de` sets the UI language for the preview only. The NavBar still follows the `plc_locale` cookie, so for a fully German screenshot also pick Deutsch in the NavBar language switch (or set `plc_locale=de`) before loading the URL.
  - `?pkmn=en|de` sets the Pokémon-name language. If `pkmn` is missing, it follows `?lang=`, so a plain `?lang=de` URL already shows German Pokémon names. `?lang=de&pkmn=en` is the "keep Pokémon terms in English" case.
- **Screens.** Each scenario mounts its real screen with every port injected (`createFakeDataSource` implements `DraftDataSource`, `RedraftSource`, `TokenSource` and `AdminDraftActions`; admin writes bump `state_version` in memory):
  - `redraft-submission`, `redraft-locked` and `redraft-reveal` mount `RedraftCenter` (`dataSource` + `redraftSource`); `redraft-picking` mounts the pick screen with its A/B/C slots, as the draft room does;
  - `tokens-before`, `tokens-open` and `tokens-comeback` mount `TokenCenter` (`source`);
  - `admin-panel` mounts `DraftControlPanel` (`dataSourceFor`, `actionsFor`, `tokenSource`) on two pools: the completed initial draft and a picking Redraft whose admin snapshot carries `redraft.admin_slots`. The Comeback switch shows there (`hasRedraft: false`) and toggles through the fake's `setComebackOpen` (`DraftControlPanel` hands its `actionsFor` to `TokenAdminSummary`), so the scenario stays fetch-free;
  - `admin-audit` mounts `DraftAuditViewer` with a `loadPage` over the fixture audit rows;
  - every other scenario mounts the pick screen (`DraftToolClient`). The presets of `live-reasons`, `live-filters` and `live-confirm` (pinned line, filters, open confirm dialog) go in through its preview-only props `initialView` and `initialConfirmLineId`, so they are in the first render; a preset view skips the stored finder prefs.
- **Picker copy** comes from `draft/screen` `preview.*` (EN/DE).
- **Theme.** There is no theme query parameter. Use the NavBar theme toggle, or emulate `prefers-color-scheme` with the stored theme set to `system`, which is the default. You can also set `localStorage.theme = 'dark' | 'light'` and reload.
- **Screenshot matrix (draft-frontend §11.2).** Scenarios `live-my-turn`, `live-paused`, `slow-my-turn`, `redraft-picking`, `spectator`, `admin-panel` and `tokens-open` (extras: `redraft-submission`, `redraft-reveal`, `tokens-comeback`, `admin-audit`, `many-drafted`). For each scenario `S` shoot three URLs (base `http://localhost:3000`):
  - EN: `/draft-preview?scenario=S&lang=en`
  - DE: `/draft-preview?scenario=S&lang=de`
  - DE with English Pokémon names: `/draft-preview?scenario=S&lang=de&pkmn=en`

  Each at viewports 375×812 and desktop (1440×900; the full matrix adds 1280×720 and 768×1024) via `resize_window`, and in light and dark via `resize_window({ colorScheme })` with the stored theme left at `system` (reset with `preset: 'desktop'` afterwards). Check each shot for:
  1. no fixed dark slab;
  2. red only on drafted cards (every other state and error text uses the amber warn tokens; destructive admin buttons may stay red);
  3. a violet DRAFT button, and a grey disabled button with its reason;
  4. a price badge on every card;
  5. distinguishable branched pairs: Pichu, Ralts, Poliwag, Oddish and Eevee;
  6. no horizontal scroll at 375 px (`document.documentElement.scrollWidth <= innerWidth`);
  7. visible focus rings;
  8. German strings that fit without clipping.

## Dependencies
- **External libraries:** none beyond the app stack. `@pkmn/data` (through `@/lib/pkmn`) is used **only** in `*.server.ts` and server pages. Client components never import `@pkmn/*`, which a test enforces.
- **Internal modules:**
  - `@/lib/draft/*`: the queue engine contracts, the snapshot, the polling, and the error codes.
  - `@/types/draft-queue`: the DTOs (`DraftSnapshotDTO`, `MyTurnDTO`, `RedraftSubmissionDTO`, `TokenOverviewDTO`, `AdminPoolSummary`, `AuditEntryDTO`).
  - `@/lib/supabase/queries/{drafts,drafts-queue,drafts-redraft,drafts-audit,drafts-favorites,point-buy-lists,format-rules}`.
  - `@/lib/pkmn/i18n`: localised names and search folding.
  - `@/i18n/*`: the runtime, the formatter, `LocalTime` and the API error text.
  - `@/lib/worlds/registry` + `@/components/world/WorldShell`: the room renders inside the season's world.
  - `@/lib/broadcast/overlay-locale`: the overlay language.

## API Routes
Backend-owned. The authoritative list is draft-backend §8.1. All routes use the `{ success, data } | { success: false, error, code?, params?, snapshot? }` envelope.
- **Player routes:**
  - `GET /api/drafts/[id]/state?since=`: the snapshot, or `unchanged`. Needs a session.
  - `GET …/my-turn`: the turn watch.
  - `POST …/picks`: makes a pick.
  - `POST …/extensions`: adds time in live mode.
  - `GET`/`PUT …/favorites`.
  - `GET`/`PUT …/redraft/submission`.
- **Tokens:**
  - `GET /api/seasons/[id]/tokens/me`.
  - `POST /api/seasons/[id]/draft-kill-tokens`.
  - `POST /api/seasons/[id]/comeback-tokens/spend`.
  - Admin: `POST …/comeback-tokens/open`.
- **Admin routes** (each write is audited and requires a reason):
  - `GET`/`POST /api/drafts`: list or create pools.
  - `PATCH …/config`.
  - `POST …/start` and `POST …/end`.
  - `POST …/pause`.
  - `POST …/picks/[pickId]/void` and `POST …/picks/[pickId]/correct`: paused only.
  - `POST …/slots/[slotId]/resolve`.
  - `POST …/participants/[playerId]/penalty`.
  - `GET …/audit`.
  - `GET …/redraft/submissions`.
  - `PATCH …/redraft`.
  - `POST …/redraft/publish`.
  - `POST …/redraft/slots/[redraftSlotId]/restore`.
- **Search index:** `GET /api/point-buy-lists/[id]/search-index?v=&h=`.
- **Replay:** `GET`/`POST …/replay-events` (POST is admin commentary). `POST …/undo` is the legacy admin undo.

## Tests
- `src/lib/draft-finder/__tests__/`: the engine vectors, search, the reducer, tabs and sort, the real index, the ability ids, and client-safe imports.
- `src/lib/draft-ui/__tests__/`: the clock, the notification schedule, the snapshot adapter, reasons, the progress display and armed confirm.
- `src/components/draft-tool/__tests__/`: the turn watch, the confirm dialog, screen rendering in EN and DE, and the CSS hex whitelist.
- `src/components/draft-{redraft,tokens,admin}/__tests__/`, the page tests under `draft-room`, `redraft`, `tokens` and `admin/leagues/[id]/draft`, and `src/components/broadcast/overlays/__tests__/draft-overlays.test.tsx`.
- **Rules all of them follow:**
  - Page tests check the query budget, assert that seeds use `{ tick: false }`, and run `expectNoPrivatePlayerData` on the serialised props.
  - All tests are DB-free, with a mocked Supabase client.
- `src/app/(public)/draft-preview/__tests__/` renders every scenario in EN and DE with `fetch` stubbed.

## Related Modules
- [Draft](./draft.md)
- [Evolution Point Buy](./evolution-point-buy.md)
- [Format Packs](./format-packs.md)
- [i18n](./i18n.md)
- [PKMN](./pkmn.md)
- [Worlds](./worlds.md)
- [Broadcast](./broadcast.md)

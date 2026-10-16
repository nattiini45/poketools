# PokéTools — Full Project Specification
> Design-phase output. To be used as the authoritative reference for Claude Code (project lead) and Codex (executive agent) during build.

---

## 0. Project Overview

A private web application for managing competitive Pokémon leagues and tournaments. Three user-facing modules — Format/Tournament management, Teambuilder, and Statistics — backed by Supabase (Postgres). Built in Next.js, deployed on Vercel, authenticated via Discord OAuth.

**Core principles:**
- Supabase (Postgres) is the database. The app is the only write interface — never edit Supabase directly.
- All visibility and permission logic lives in Next.js API routes, never in the database.
- Pre-compute reusable aggregates at write time (replay parse), not at read time for usage / standings / move stats. Use targeted raw reads only when player / match / round granularity is required and aggregates do not carry that data.
- PS ecosystem packages handle all Pokémon data — never hand-roll dex logic.

---

## 1. Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Hosting | Vercel |
| Auth | NextAuth.js with Discord OAuth provider |
| Database | Supabase (via `@supabase/supabase-js`) |
| Pokémon data | `@pkmn/data`, `@pkmn/teams`, `@pkmn/protocol`, `@pkmn/client` |
| Bracket/Swiss | `tournament` (bevacqua) or `swiss-pairing` npm package |
| Charts | Recharts |
| Sprites | PS sprite CDN: `https://play.pokemonshowdown.com/sprites/` |
| Styling | Tailwind CSS |
| Language | TypeScript throughout |

---

## 2. Supported Formats

### Game clients (input sources)
- **Pokémon Showdown** — replay import via `https://replay.pokemonshowdown.com/{id}.json`
- **Pokémon Champions** — manual stat entry form (parallel input path for all fields auto-populated by replay parser)

### Competitive formats
- Standard Smogon singles tiers (Gen 9 OU, UU, RU, NU, PU, LC, Ubers, AG)
- VGC / doubles (Bring/Lead/Win stats enabled for these formats only)
- Custom / homebrew rulesets (via ruleset builder)
- Draft leagues (data model included; UI in Phase 2)
- **Evolution Point Buy** (`evolution_point_buy`) — versioned point-buy list, budget/pick-capped draft with branched-line identity `(base, stage3)`, surviving-Pokémon Comeback Tokens, Participation Tokens and per-line rulings. The league's tuning (budget, picks, token tables, line rulings, price groups, workbook layout) comes from the active format pack (`docs/format-packs.md`). Canonical module doc: `docs/evolution-point-buy.md`.

### Bracket types
- Single elimination
- Double elimination
- Round robin
- Swiss (Monrad/Dutch system via library)

---

## 3. Authentication & Permission Model

```
Public (no auth)
  └── View: standings, brackets, team lists (post-match), stats pages, ruleset browser

Authenticated — Discord OAuth (must be in Players DB)
  └── Submit replay URLs or manual match results
  └── Register/import team for a tournament
  └── Confirm opponent's submitted result

Admin — `is_admin: true` in Players DB
  └── Create / edit / delete tournaments, leagues, rulesets
      Deleting a tournament or league (`DELETE /api/tournaments/[id]`, `DELETE /api/seasons/[id]`)
      rebuilds all data derived from its matches after the cascade: the entity's aggregate
      scopes are cleared (or the parent league's rebuilt), `all_time` aggregates are rebuilt,
      and affected players' ratings, rating history, and streaks are recomputed. EPB seasons
      also get their evolution state repaired. Rebuild failures never fail the delete — they
      are logged and surfaced by the §28 season audit (`npm run audit:seasons`) for repair.
  └── Generate next round pairings (Swiss, round robin, single/double elimination)
  └── Override or dispute match results
  └── Manage player roster and PS username mappings
```

**Identity anchor:** `discord_id` field in Players DB is the canonical user identifier. On login, NextAuth session is matched against this field. If no match → read-only access only.

---

## 4. Database Schema (Supabase / Postgres)

> All tables use the Supabase service role key (server-side only). App is sole write interface.

### 4.1 Players
| Field | Type | Notes |
|---|---|---|
| name | Title | Display name |
| discord_id | Text | OAuth identity anchor |
| ps_username | Text | For replay player matching |
| champions_username | Text | For Pokémon Champions |
| is_admin | Checkbox | Admin permission flag |
| is_guest | Checkbox | Admin-created name-only player without Discord/auth; visible in directory with Guest badge; claimable via `POST /api/players/[id]/claim` |
| joined_date | Date | |
| seasons | Relation → Seasons | |

### 4.2 Seasons / Leagues
| Field | Type | Notes |
|---|---|---|
| name | Title | |
| format_type | Select | singles / doubles / draft / evolution_point_buy |
| ruleset | Relation → Rulesets | |
| start_date | Date | |
| end_date | Date | |
| participants | Relation → Players | |
| tournaments | Relation → Tournaments | |
| status | Select | upcoming / active / completed |
| point_buy_list_id | UUID | EPB: immutable snapshot bind to `point_buy_list_versions` (first bind allowed when null; on EPB season creation the active list version is auto-bound best-effort — no active version means the season is created unbound and manual bind stays available) |
| core_pool | JSONB | Curated list of allowed type triples for Core Liga; null when unused |
| language | Text | `de` / `en`, default `de`: content language for text produced without a viewer (Discord embeds, social images and posts, stored AI reports, overlays opened without `?lang=`). Viewers always see their own UI language (§17). Migration `20261012023655_seasons_language.sql` |

**`season_participants`** (junction) — the **league roster**; single source of truth for who belongs to the league. Phase enrollment (`tournament_participants`) draws from this roster. Substitutes: `scope: 'league'` swaps roster membership and non-completed phase enrollments; `scope: <phaseId>` swaps phase enrollment only (reserve promotion allowed). Either way the incoming player takes the outgoing player's phase slot: seed, starting bracket and group row. See `POST /api/seasons/[id]/participants/substitute`.
| Field | Type | Notes |
|---|---|---|
| season_id | UUID | Reference → Seasons |
| player_id | UUID | Reference → Players |
| gym_type | Text | Optional gym-leader type (cosmetic) |
| core_types | Text[] | Three Pokémon types assigned by Core Liga draw; null when unused |
| core_assigned_at | Timestamp | Audit timestamp for `core_types` assignment |

**Season worlds.** League/season presentation is keyed off `seasons.format_type` via a world registry. `evolution_point_buy` resolves to the **evoliga** world (the EvoLiga 3D-capable scrollworld, §5, plaza theme). Since the auto-map flip, all other formats (`singles`, `doubles`, `draft`) resolve to the **sakura** world — the cherry-blossom park scrollworld (anchored sections `#pulse #roster #teams #schedule #rules` → Pulse / Roster / Teams / Schedule / Rules, replacing the former default-world manifest `#pulse #phases #reports #stats #rules`); standalone tournaments (no season row) get the same park outcome. On `/leagues/[id]` every route world's `#pulse` section carries the **league hub** — a server-rendered tab panel (`?tab=`: standings, matches, group stage, playoffs, phases, insights, rules; Kale reports behind `ENABLE_KALE_CABBAGE`) that keeps standings, brackets, group tables and insights inside the world and reads only the selected tab's data (§5). Resolution precedence, highest first: the viewer's session override (`?world=` URL parameter, then the localStorage preference — beats everything for that session), the league admin's `seasons.route_theme` pin (any registered theme; an unregistered pin falls back to a DOM-only default world with a console warning, never a crash), then the format auto-map. The full picker/auto-map contract is in the multi-theme route-worlds spec (maintainer-only; not in this repo); `docs/worlds.md` summarises it. Whether the 3D route tier renders at all is a separate, per-viewer choice: `players.world_experience` (`auto` | `on` | `off`; default `off` since 2026-10-06, the 3D world is opt-in), edited on `/dashboard/settings` and written through `PATCH /api/account/world-experience`; `off` pins the viewer to the simple DOM (Lite) version, `on` skips only the advisory heuristics (data-saver, low-memory, low-cores) while the hard floors — no WebGL, `prefers-reduced-motion` — always win, and `auto` keeps capability detection deciding. Signed-out visitors get the default `off`. Precedence and the full tier ladder: `docs/worlds.md`. A future world (e.g. a Core Liga or draft world) is an additive registry entry, not a fork of an existing page. Tournament pages render inside a world shell in **sections layout** (anchored sections replace the legacy tab bar): the parent season's world when the season is world-registered, otherwise the sakura outcome, with continuity navigation back to the season page.

### 4.3 Tournaments / League Phases
A **phase** is stored as a `tournaments` row with `season_id` set. League admin treats phases as first-class entities (`LeaguePhase` type); standalone tournaments keep `season_id = null`. Phase creation uses `POST /api/seasons/[id]/phases` — `POST /api/tournaments` rejects `season_id` payloads.

| Field | Type | Notes |
|---|---|---|
| name | Title | Clean phase name (no "{League} - " prefix stored) |
| season_id | Relation → Seasons | nullable; non-null ⇒ league phase |
| stage_order | Number | Order within the league (reorderable while `upcoming`) |
| advancement_rule | JSONB | `{ type: 'top_n', count, per_group }` — who advances into the *next* phase |
| enrollment_source | JSONB | Auto-enrollment sync: `{ type: 'standings' \| 'roster', source_phase_id, synced_at, frozen }`. Unfrozen phases silently re-sync from the source table until the first manual seed/participant edit or bracket generation. Re-sync and `POST /api/seasons/[id]/advance` refuse when frozen or rounds exist unless `{ force: true }` (`ENROLLMENT_FROZEN`, `ENROLLMENT_ROUNDS_EXIST`). Standings use EPB-aware `computeStandingsForSeason`. |
| bracket_type | Select | single_elim / double_elim / round_robin / swiss |
| ruleset | Relation → Rulesets | |
| best_of_default | Number | Default Bo per round |
| bo_overrides | JSONB | Per-round Bo overrides, e.g. `{ "Finals": 5 }` |
| is_doubles | Checkbox | Enables Bring/Lead/Win tracking |
| team_visibility | Select | hidden_until_match / always_public |
| status | Select | upcoming / active / completed |
| participants | Relation → Players | Per-phase enrollment + seeds (`tournament_participants`) |
| current_round | Number | |

**`tournament_participants`** (junction)
| Field | Type | Notes |
|---|---|---|
| tournament_id | UUID | Reference → Tournaments (PK) |
| player_id | UUID | Reference → Players (PK) |
| seed | Integer | Nullable; unique per tournament when non-null (partial unique index) |
| starting_bracket | Text | NOT NULL, default `'winners'`, CHECK IN (`'winners'`,`'losers'`) — Challonge-style losers-bracket start; consumed by bracket engine v2 |

### 4.4 Rounds
| Field | Type | Notes |
|---|---|---|
| name | Title | e.g. "Round 3", "Semifinals" |
| tournament | Relation → Tournaments | |
| round_number | Number | |
| best_of | Number | Overrides tournament default |
| status | Select | pending / active / completed |
| pairings_generated | Checkbox | |
| bracket_side | Text | nullable — `winners` / `losers` / `grand_finals` for elimination bracket columns |

### 4.5 Matches
| Field | Type | Notes |
|---|---|---|
| id | Title | Auto or slug |
| round | Relation → Rounds | |
| tournament | Relation → Tournaments | |
| player_1 | Relation → Players | |
| player_2 | Relation → Players | |
| winner | Relation → Players | nullable until complete |
| status | Select | scheduled / in_progress / pending_confirmation / completed / disputed |
| submitter | Relation → Players | who submitted the result |
| games | Relation → Games | individual Bo games |
| date_played | Date | |
| notes | Text | admin notes / dispute log |
| bracket_side | Text | nullable — `winners` / `losers` / `grand_finals` |
| bracket_pos | Number | nullable — vertical slot index within the round column for bracket rendering |

### 4.6 Games (individual Bo games within a match)
| Field | Type | Notes |
|---|---|---|
| match | Relation → Matches | |
| game_number | Number | 1, 2, 3... |
| winner | Relation → Players | |
| replay_url | URL | PS or Champions replay |
| source | Select | ps_replay / manual / champions |
| parsed | Checkbox | whether stats have been extracted |

### 4.7 Rulesets
| Field | Type | Notes |
|---|---|---|
| name | Title | |
| base_format | Select | gen9ou / gen9vgc / gen9uu / etc. / blank |
| is_doubles | Checkbox | |
| clauses | Multi-select | Sleep Clause, Species Clause, etc. |
| banned_pokemon | Multi-select | |
| banned_moves | Multi-select | |
| banned_items | Multi-select | |
| banned_abilities | Multi-select | |
| added_pokemon | Multi-select | (unbanned from base) |
| custom_rules_string | Text | raw PS rules overflow |
| min_shared_type_pct | Number | 0–100; relaxed-monotype share |
| team_constraints | JSONB | Generic composition engine — see Section 9.1 |
| created_by | Relation → Players | |

### 4.8 Teams
| Field | Type | Notes |
|---|---|---|
| player | Relation → Players | |
| tournament | Relation → Tournaments | nullable |
| season | Relation → Seasons | nullable |
| match_id | UUID | nullable FK → matches.id; partial unique on `(player_id, match_id) WHERE match_id IS NOT NULL` |
| pokemon | Text | JSON blob — full sets |
| import_source | Select | pokepastes / manual / ps_text |
| locked | Checkbox | locked after tournament starts |
| draft_pool | Relation → DraftPools | Phase 2, nullable |
| is_draft_team | Checkbox | Phase 2 |
| share_token | UUID | nullable; unique; ungessable UUID v4 for public share links |
| share_enabled_at | Timestamp | nullable; set when share link is minted |
| library_published_at | Timestamp | nullable; set when team is published to the public library |
| library_title | Text | nullable; max 50 chars; set when published |
| library_description | Text | nullable; max 500 chars; set when published |
| library_tags | Text[] | nullable; max 5 tags; set when published |
| forked_from_team_id | UUID | nullable; references another team row for fork lineage |

### 4.9 Battle Stats (one row per Pokémon per game)
| Field | Type | Notes |
|---|---|---|
| game | Relation → Games | |
| player | Relation → Players | |
| pokemon_name | Text | |
| was_brought | Checkbox | doubles: was in team of 4 |
| was_lead | Checkbox | sent out first |
| kos_dealt | Number | |
| was_koed | Checkbox | |
| moves_used | Text | JSON array of move names |
| turns_active | Number | |
| match_won | Checkbox | did player win this game |

### 4.10 Aggregates (pre-computed, written on every replay parse)
| Field | Type | Notes |
|---|---|---|
| scope_type | Select | tournament / league / all_time |
| scope_id | Text | UUID of Tournament or Season; null for all_time |
| pokemon_name | Text | |
| total_appearances | Number | |
| total_brought | Number | doubles only |
| total_led | Number | doubles only |
| total_kos_dealt | Number | |
| total_koed | Number | |
| total_wins | Number | games won when this Pokémon present |
| total_games | Number | |
| move_counts | Text | JSON: { "Earthquake": 14, ... } |
| last_updated | Date | |

### 4.11 Draft Pools (Phase 2 — schema included now)
| Field | Type | Notes |
|---|---|---|
| season | Relation → Seasons | |
| draft_type | Select | snake / auction / budget — the **pricing** of a legacy pool: snake = no points (tier limits only), budget = fixed costs (entry `point_cost`, else `default_point_cost`, else 0), auction = bids |
| pick_order | Select | snake / linear / free — the **turn order** of a legacy pool (default snake); auction requires free |
| point_budget | Number | nullable |
| status | Select | pending / in_progress / complete |

> **Legacy schema.** This table is the original (legacy-engine) shape and still describes `engine = 'legacy'` pools. The EPB queue
> engine (migration `20261012024202_draft_queue_engine.sql`) extends `draft_pools` with `engine` (`legacy` / `queue`), `kind`
> (`initial` / `redraft`), `mode` (`live` / `slow`), `phase`, the frozen config (`list_version_id`, `roster_size`, pick/make-up seconds,
> slow ladder, extensions, redraft limits and deadlines), pause columns and `state_version`, and adds `draft_participants` and
> `draft_slots`. The full shape is in that migration.
>
> **Pick order vs. pricing** (`20261013124630_draft_pools_pick_order.sql`). Legacy pools set turn order and pricing separately:
> `pick_order` (`text NOT NULL DEFAULT 'snake'`, CHECK snake / linear / free) and `draft_type` (pricing). CHECK
> `draft_type <> 'auction' OR pick_order = 'free'`: the legacy auction records the pick for the winning bidder, so no turn applies.
> Pools that existed before were backfilled (auction/budget → free) and behave as before. Engine (`src/lib/draft/engine.ts`):
> snake reverses the seat order every round, linear keeps it, free keeps a round-robin display order but sets `turn_enforced`
> false, so the picks route checks no turn (players pick for themselves any time; admins enter picks for anyone). With
> snake/linear order and fixed costs the picks route refuses a pick that leaves the picker too few points to fill their
> remaining rounds at the cheapest prices still available (`draft_pick_strands_roster`; price only, tier limits not folded in).
> Best effort: other players can still take the cheap Pokémon before the picker's next turn, which leaves the picker
> unable to make any pick and nobody else may pick for them.
>
> **Seat order** (no schema change). `season_participants` stores neither seats nor a join time and the participant read
> has no ORDER BY, so legacy turn order used to follow Postgres row order (unstable after any UPDATE of a participant
> row). The picks and state routes now seat participants with `legacySeatOrder(pool.id, ids)` (`engine.ts`): a draw
> seeded by the pool id (FNV-1a of `pool_id:player_id`, ties by player id). It is the same on every request and server,
> differs between pools (no player sits first in every league), and a newcomer does not move the other seats relative
> to each other. A participant who joins or leaves mid-draft still shifts the round's positions. Shipped 2026-10 with no
> running legacy draft on live (the one legacy pool was pending, without participants), so no order changed mid-draft.
>
> **Stalled draft** (engine stays stateless). `GET /api/drafts/[id]/state` returns `stalled_picker` (`legacyPickerStall`):
> for a running pool in snake/linear order with fixed prices (not EPB), the current picker whose open picks (this one
> included) cost more at the cheapest Pokémon still available than their points (`{ player_id, remaining, open_slots,
> min_cost }`, else null; the pool list is read only for such pools). Same rule as `draft_pick_strands_roster`: price
> only, tier limits not folded in; no Pokémon left at all is not reported. The board shows the stuck player and
> everyone else what is going on (`DraftStallNotice`); admins get **Switch to free order**:
> `POST /api/drafts/[id]/free-order` (`requireDraftAdmin`, body `{ reason? }` ≤ 500) sets `pick_order = 'free'` with one
> guarded UPDATE (engine legacy, status in_progress, order not free), audits `draft.pick_order.free` (`from`, `reason`)
> and expires the draft reads. Refusals: `404 POOL_NOT_FOUND`, `422 INVALID_CONFIG {field:'pick_order'}` (queue
> engine), `409 draft_free_order_already_free`, `409 draft_free_order_not_running`. Picks, budgets and seats stay; there
> is no switch back (free-order picks follow no turn, so the turn count would no longer fit). In free order the board
> gives admins **End Draft** (the existing `PATCH /api/drafts/[id]` status `complete`), since a player who cannot fill
> their roster keeps the draft from completing on its own. A per-turn "skip" was not chosen: the engine derives the
> turn from the pick count, so a skip would need stored state (a schema change).
> Every order caps a player at the round count (`draft_roster_full`; free order has no turn to do it).
> `POST /api/drafts` takes an optional `pick_order` (omitted = snake for snake pricing, free otherwise), refuses an auction in
> a turn order (`draft_auction_order_not_free`), and refuses fixed prices in a turn order when the budget is below rounds ×
> default price (`draft_budget_below_rounds`). In free order the board lets participants pick for themselves (auctions:
> admins only) and admins choose whose pick they enter. The queue engine ignores `pick_order`; its pools keep the default.

### 4.12 Draft Picks (Phase 2 — schema included now)
| Field | Type | Notes |
|---|---|---|
| draft_pool | Relation → DraftPools | |
| player | Relation → Players | |
| pokemon_name | Text | |
| pick_number | Number | |
| round | Number | |
| points_spent | Number | nullable |
| timestamp | Date | |

> **Legacy schema.** The original columns stay. `20261012024103_draft_line_ids.sql` adds `line_id` (picks are keyed by line,
> `toID(base)--toID(final stage)`); the queue engine (`20261012024202_draft_queue_engine.sql`) adds `slot_id`, `redraft_slot_id`,
> `client_request_id` (idempotency), `made_by` / `made_by_role` / `override_reason`, and the void columns (`voided_at`, `voided_by`,
> `void_reason`). Uniqueness holds over live (non-void) picks: one per slot and one per line per pool.

---

## 5. Full Route Map

App Router uses route groups: `(public)` (browse + NavBar), `(player)` (auth-required player tools + NavBar), `(broadcast)` (OBS overlays, no NavBar). URLs omit the group segment.

### Visibility tiers

| Tier | Routes | Notes |
|------|--------|-------|
| **Public browse** | `/`, `/tournaments/*`, `/leagues/*`, `/insights`, `/replays`, `/wiki/*`, `/pokemon/[name]`, `/players`, `/players/[id]` (public sections), `/broadcast/*` | No Discord login |
| **Player-only** | `/dashboard/*`, `/teambuilder/*`, wiki notes (read+write), `/players/[id]` private sections, match submit/confirm flows | `requirePlayer()` on APIs |
| **Admin / Creator** | `/admin/*`, `/creator/*` (except wiki redirects) | Unchanged |

### Public pages (`(public)` group)
```
/                              Landing — hero, featured event, recent lists, Insights/Wiki CTAs
/tournaments                   Tournament list
/tournaments/[id]              World-shell sections layout: anchored sections (bracket or
                               standings, stats, rounds, report, ruleset per bracket type)
                               with anchor nav; parent season's world when world-registered,
                               else the default world; continuity nav back to the season
/tournaments/[id]/stats        → 308 redirect to /insights?scope=tournament&id=
/tournaments/[id]/matches/[mid] Match detail

/leagues                       All leagues list
/leagues/[id]                  Every format renders a route world (resolveViewerWorld: ?world= >
                               admin route_theme pin > auto-map on seasons.format_type):
                               - evolution_point_buy → evoliga plaza
                               - singles / doubles / draft → sakura park
                               - mountain pass, clouds sky island → pin or ?world= only
                               World copy follows the viewer's language, not the theme (§17).
                               One scroll page with anchored sections #pulse #roster #teams
                               #schedule #rules; contextual interactions open overlays via search
                               params (?team=<pid>, ?mon=<line>) instead of subpages.
                               #pulse carries the league hub under the masthead (header links:
                               /insights?scope=league, the format's draft page via
                               leagueDraftHref — /leagues/[id]/draft-room for EPB (as the Pulse
                               CTA), /leagues/[id]/draft for draft — and /leagues/[id]/matchup
                               where the format has matchup roles; #league-hub carries
                               scroll-mt-24 so an anchor landing clears the sticky navs, and the
                               phone tab strip scrolls the active tab into view): tabs
                               Standings · Matches · Group stage (Swiss rounds when no phase is
                               round robin) · Playoffs · Phases · Insights · Rules (+ Reports
                               behind ENABLE_KALE_CABBAGE), selected by ?tab= (default
                               standings, which drops the param). Whitelisted per league: the group tab needs a
                               round-robin or Swiss phase, the playoff tab an elimination phase;
                               a missing, repeated, unknown or unavailable ?tab= falls back to
                               standings. Tabs are server-rendered links (scroll={false},
                               prefetch={false}, every other query param kept). Each tab reads
                               only its own data, in the same wave as the world payload
                               (src/lib/league-hub/load.ts, publicReads entries):
                                 standings  none — season table from WorldRouteData
                                 matches    rounds per phase (fixtures from WorldRouteData)
                                 groups     enrollment + groups per table phase; battle stats
                                            per round-robin phase
                                 playoffs   rounds + enrollment per elimination phase
                                 phases     groups + enrollment per table phase (the cards list
                                            the members the group tables list:
                                            resolveGroupMembers)
                                 insights   league aggregate counters, game total, season
                                            battle_stats (kill ranking)
                                 rules      season ruleset, else the first phase's (read live)
                                 reports    reports per phase
                               A failed tab read is logged ("[league-hub] <tab> tab read
                               failed") and the panel becomes { tab: 'unavailable' } (a notice);
                               the world payload's failure still fails the page.
                               Season table: generic formats show the Buchholz column the
                               scoring note names; EPB the evolution points. Group tables count
                               kill difference from the games of the matches they count only.
                               Phase and round chips show the stored status unless the matches
                               prove it further along (displayStageStatus/displayRoundStatus);
                               the advancement rule shows only on a table phase a later phase
                               follows (or a league's only phase). A completed match without
                               game rows shows its outcome ("W : L") instead of "vs".
                               Hub copy follows the viewer's language (§17), as do the shared
                               components the hub embeds (bracket, results grid, ruleset detail,
                               insights tables, Core Liga block), which take their default labels
                               from their own namespaces; the engines' stored English round and
                               feeder names are translated at display time (translateEngineLabel:
                               Round n → Runde n, Semifinals → Halbfinale, Winner of M3 → Sieger
                               aus M3).
                               The hub hides with the other sections while the 3D route tier is
                               live; reachable via "Read as text" / ?tier=lite.
                               - fallback: a resolved world with no route-world root (admin pin
                                 naming an unregistered theme) renders the DOM-only DefaultWorld
                                 (#pulse #phases #reports #stats #rules, sections without content
                                 omitted, + Stats link → Insights) — the graceful-degradation
                                 path, not a default layout; it has no league hub
/leagues/[id]/stats            → 308 redirect to /insights?scope=league&id=
/leagues/[id]/point-buy        → 308 redirect to /leagues/[id]#roster
/leagues/[id]/teams            → 308 redirect to /leagues/[id]#teams
/leagues/[id]/teams/[pid]      → 308 redirect to /leagues/[id]?team=<pid>#teams
/leagues/[id]/draft            Non-EPB drafts: the 2D DraftBoard (draft league flow). For EPB
                               seasons a redirect to /leagues/[id]/draft-room.
/leagues/[id]/draft-room       EPB draft room (queue engine). The draft is a persisted state
                               machine in Postgres: draft_pools (frozen config, state_version),
                               draft_participants, draft_slots (the pick queue, incl. make-up
                               slots after a timeout); every mutation is one plpgsql RPC under
                               the season advisory lock; timers are timestamps, resolved lazily
                               by route-handler RPCs and by the /api/cron/draft-ticks cron (slow
                               drafts). Live (pick clock, extensions) and slow (penalty ladder)
                               modes; admin pause works on every pick clock. The page seeds with
                               getDraftSnapshot(pool, viewer, { tick: false }) and renders
                               DraftToolClient (src/components/draft-tool): line finder
                               (filters, utility categories, price tabs, bilingual search over
                               GET /api/point-buy-lists/[id]/search-index), line wall and a
                               confirm-pick dialog. Draftability is the server's verdict per
                               line and viewer (snapshot viewer.line_status / pick_block); the
                               client never decides it. Polls GET /api/drafts/[id]/state
                               (?since=state_version) through useVisiblePoll; a draft-room tab
                               also watches GET /api/drafts/[id]/my-turn every 60 s while hidden
                               (the one D37 exception). Picks: POST /api/drafts/[id]/picks
                               ({ slot_id, line_id, client_request_id }). Lines are keyed by
                               line_id (toID(base)--toID(final stage)). Modules: src/lib/draft
                               (contracts, snapshot, errors, time), src/types/draft-queue.ts
                               (DTOs), src/lib/draft-finder (index, filter engine),
                               src/lib/draft-ui (view model, clock); module doc
                               docs/draft-room.md.
/leagues/[id]/redraft          Redraft with secret drop: during the submission phase each
                               participant submits the lines to drop (their own submission is
                               read client-side from the owner-guarded endpoint); at the
                               deadline (default: the upcoming Sunday 23:59:59 Europe/Berlin)
                               every submission is published at once, then the dropped slots
                               (A, B, C…) are re-picked in a redraft pool.
/leagues/[id]/tokens           Token centre (signed-in participants, EPB): Draft Kill Tokens
                               (bought one per request, capped per player and per line),
                               Comeback Tokens (earned from completed matches, spent after the
                               redraft or once the admin opens spending), Participation-Token rules.
/draft-preview                 Dev-only (notFound in production): the draft UI on in-memory
                               fixtures (?scenario=), no network; the visual-verification surface.

/insights                      Stats + rankings hub (scope: global | league | tournament)
/leaderboard                   → 308 redirect to /insights?tab=ratings

/wiki                          Encyclopedia home + search
/wiki/moves|items|abilities|tera/[name]  Entity entries
/wiki/pokemon                  Species index (detail at /pokemon/[name])
/pokemon/[name]                Canonical species page (dex + scoped usage + notes if logged in)

/players                       Public player directory (name, avatar, rating)
/players/[id]                  Profile: public sections for guests; full profile when logged in

/replays                       Spoiler-free public replay library (filter by league, tournament, round, players, date)

/creator/wiki/*                → 308 redirect to /wiki/*
```

### Authenticated player pages (`(player)` group)
```
/dashboard                     Command center: actions, leagues, matches, teams, rating snapshot
/dashboard/submit/[mid]        Submit replay or manual result for a match
/dashboard/confirm/[mid]       Confirm opponent's submitted result
/dashboard/team/[tid]          Edit my team for a tournament (pre-lock)
/dashboard/match-prep/[mid]    Match preparation
/dashboard/broadcast/*         Cast Studio match tracker (player)
/dashboard/settings            World experience (3D on/off) and Language (LanguageOptions, §17)

/teambuilder                   Standalone teambuilder with format selector
/teambuilder/[tid]             Teambuilder locked to tournament ruleset
/teambuilder/plan/[matchId]    Plan Team editor (fork of teambuilder, saves to match_prep_teams)
/teambuilder/library           My Library — player's published teams with fork/unpublish controls
```

### Public Teambuilder pages (`(public)` group)
```
/teambuilder/library           Public team library — browse/search/fork published teams
/teambuilder/share/[token]     Public share link — read-only team view via TeamDisplay
```

### Admin pages
```
/admin                         Admin overview
/admin/leagues/new             Create league
/admin/leagues/[id]            League hub: roster (LeagueRosterManager), PhaseTimeline
/admin/leagues/[id]/phases/[phaseId]  Phase workspace: PhaseForm, SeedingTable, PhaseGroupsPanel, RoundManager
/admin/leagues/[id]/draft      Draft control panel: pools, config, start/end, pause/resume, void and
                               correct picks (paused only), resolve blocked slots, penalty stages,
                               redraft settings and publish, the Comeback spending switch
/admin/leagues/[id]/draft/audit  Read-only draft audit trail (draft_action_log)
/admin/tournaments/new         Create standalone tournament (no season_id)
/admin/tournaments/[id]/rounds Standalone tournament rounds (season-linked → redirect to phase page)
/admin/rulesets/new            Ruleset builder
/admin/rulesets/[id]/edit      Edit existing ruleset
/admin/matches/[id]            Override / dispute match result
/admin/players                 Player roster management (guest creation + Link account)
```

**Admin navigation IA.** `/admin/*` renders a role-filtered sidebar
(`src/components/admin/adminNav.ts` is the single config) with three workflow
groups: **Competitions** (leagues + archived, tournaments + archived, matches,
rulesets), **Community** (player roster, achievements, wiki moderation, social
integration) and **System** (data tools, meta data, audit log, test players,
Kale console [superadmin, soft-deprecated]). Items flagged `siteAdminOnly`
render only for full `isAdmin`; the Kale console only for `isSuperadmin`.
Below `lg` the same config renders as grouped chip rows. The admin overview
page no longer duplicates this IA as a card grid — it shows the live
dashboard (attention queue, recent audit) only.

### API routes
```
POST /api/parse-replay          Fetch PS replay JSON, parse via @pkmn/protocol + @pkmn/client,
                                write Games + Battle Stats + Aggregates to database

POST /api/import-team           Fetch pokepast.es URL or accept raw PS text,
                                parse via @pkmn/teams, validate against ruleset,
                                return parsed team for confirmation

POST /api/manual-result         Write manually entered match result + stats to database,
                                update Aggregates

POST /api/confirm-match/[mid]   Player B confirms result → set match to completed

POST /api/generate-round/[tid]  Admin: generate next round pairings (Swiss/RR; legacy per-round elim).
                                Returns 400 BRACKET_V2_MANAGED when structure elim rounds exist.

POST /api/tournaments/[id]/generate-bracket   Admin: full SE/DE bracket (all rounds + R1 matches)
POST /api/tournaments/[id]/regenerate-bracket Admin: wipe and rebuild SE/DE bracket from current seeds
POST /api/tournaments/[id]/repair-bracket     Admin: re-run bye resolution + slot materialization
DELETE /api/admin/rounds/[id]               Admin: delete latest round or zero-game round
                                            (400 STRUCTURE_ELIM_ROUND_DELETE for v2 elim)

GET/POST /api/seasons/[id]/phases           List/create league phases
PATCH/DELETE /api/seasons/[id]/phases/[phaseId]  Phase config + destructive delete
POST /api/seasons/[id]/phases/reorder       Reorder upcoming phases (stage_order)
GET/POST/DELETE/PATCH /api/seasons/[id]/phases/[phaseId]/participants
POST .../participants/sync-standings        Import/re-sync from prior phase table (optional `force`)
POST .../participants/seed-by-rating        Order seeds by Glicko-2 rating
GET/POST/DELETE /api/seasons/[id]/phases/[phaseId]/groups
PATCH .../groups/members                    Manual group membership moves
POST .../groups/repair                      Hand group rows left by pre-handover substitutions to the
                                            enrolled substitute (`dry_run` required; audit log, else fixtures;
                                            an apply names the reviewed `moves`, 409 PLAN_CHANGED if they differ)
POST /api/seasons/[id]/participants/substitute  League (`scope: 'league'`) or phase (`scope: <phaseId>`) substitute
POST /api/seasons/[id]/advance              Advance to next phase (optional `force`; same guards as sync)
POST /api/players (admin)                   Create registered or guest (`is_guest: true`) players
POST /api/players/[id]/claim (admin)      Link Discord onto guest row (409 SOURCE_HAS_ACTIVITY if source has data)
POST /api/tournaments                       Rejects `season_id` — use phases API instead

POST /api/validate-team         Validate a team against a ruleset; returns issues with
                                stable issue_id for UI jump-to-slot

GET  /api/teams                 List teams (by tournament_id, player_id, or own)
POST /api/teams                 Create a team for a tournament (one per player per tournament)
GET  /api/teams/[id]            Get single team (with visibility redaction)
PATCH /api/teams/[id]           Update team pokemon (blocked when locked)
DELETE /api/teams/[id]          Delete team (blocked when locked; admin can force)

POST /api/teams/[id]/share      Mint a public share link (UUID v4)
DELETE /api/teams/[id]/share    Revoke share link
GET  /api/teams/share/[token]   Public: read team by share token (no auth)
POST /api/teams/[id]/library    Publish team to public library
DELETE /api/teams/[id]/library  Unpublish from library
GET  /api/teams/library         Public: list published teams (paginated, filterable)
POST /api/teams/[id]/fork       Copy a published/shared team into the caller's roster

POST /api/teams/co-pilot/slot   AI slot-level suggestions (rated, requires player auth)
POST /api/teams/co-pilot/team   AI team-level commentary (rated, requires player auth)
POST /api/teams/co-pilot/monotype  AI monotype team suggestions (rated, ruleset-gated)

POST /api/locale                Public: set the language cookies ({ locale?, pkmnTerms? }; §17)

GET  /api/drafts/[id]/state     Draft snapshot (?since=state_version short-circuits)
GET  /api/drafts/[id]/my-turn   Turn watch (60 s, also while the draft-room tab is hidden)
POST /api/drafts/[id]/picks     Confirm a pick (a rule error returns a code and a fresh snapshot)
POST /api/drafts/[id]/extensions  Use a pick-clock extension
POST /api/drafts/[id]/free-order  Legacy pools, admins: switch a running snake/linear draft to free order (audited)
GET/PUT /api/drafts/[id]/redraft/submission  Own secret-drop submission
POST /api/drafts; PATCH …/config; POST …/{start,end,pause}; POST …/picks/[pickId]/{void,correct};
POST …/slots/[slotId]/resolve; POST …/participants/[playerId]/penalty; GET …/audit;
PATCH …/redraft; POST …/redraft/publish   Admin draft controls (audited in draft_action_log)
GET  /api/seasons/[id]/tokens/me  Token overview; POST …/draft-kill-tokens, …/comeback-tokens/spend
GET  /api/point-buy-lists/[id]/search-index  Draft finder search index (immutable per list hash)
GET  /api/cron/draft-ticks      Cron (10 min): slow-draft timeouts, redraft auto-publish, Discord pings
```

The draft routes' exact contracts: `docs/draft-room.md` and the route handlers under `src/app/api/drafts/`.

---

## 6. Data Flows

### 6.1 Replay Submission Flow
```
Player pastes replay URL → POST /api/parse-replay
  1. Fetch replay JSON from replay.pokemonshowdown.com/{id}.json
  2. Parse battle log via @pkmn/protocol + @pkmn/client
  3. Extract: winner, both PS usernames, all Pokémon used,
              moves used per Pokémon, KOs, leads (doubles), turn counts
  4. Match PS usernames → Players DB (discord_id anchor)
     → If no match: flag match as disputed, notify admin, abort
  5. Write Game record to database (status: parsed)
  6. Write Battle Stats rows (one per Pokémon per player)
  7. Check if match Bo threshold reached (e.g. Bo3: someone at 2 wins)
     → If yes: set Match status = pending_confirmation, set winner
     → If no: set Match status = in_progress, await next game
  8. Trigger aggregate update:
     → Update Aggregates for tournament scope
     → Update Aggregates for parent league scope (if exists)
     → Update Aggregates for all_time scope
  9. Notify opponent to confirm (pending_confirmation state)
```

### 6.2 Manual Result Entry Flow (Pokémon Champions / override)
```
Player/Admin submits manual form → POST /api/manual-result
  Form fields mirror all Battle Stats fields:
    - Winner selection
    - Per-Pokémon: KOs dealt, was KO'd, moves used (text input), was lead (doubles)
  1. Validate form completeness
  2. Write Game record (source: manual)
  3. Write Battle Stats rows
  4. Check Bo threshold → update Match status
  5. Trigger same aggregate update pipeline as replay flow
```

### 6.3 Team Import Flow
```
Player pastes pokepast.es URL or raw PS text → POST /api/import-team
  1. If URL: fetch raw text from pokepast.es/{id}/json
  2. Parse via @pkmn/teams → typed Team object
  3. Validate against tournament ruleset:
     - Check each Pokémon against banlist
     - Check Species Clause, other active clauses
     - Check move/item legality
  4. Return parsed team + validation result to client
  5. Player reviews → confirms
  6. Write Team record to database (pokemon field: JSON blob of full sets)
```

### 6.4 Round / Bracket Generation Flow (Admin)

**Swiss / round-robin** (unchanged — sequential rounds):
```
Admin clicks "Generate Round N" → POST /api/generate-round/[tid]
  1. Fetch completed match results + standings
  2. Run bracket/pairing algorithm (Swiss Monrad / RR schedule)
  3. Write new Round + Match stubs
  4. On first-round generation: flip tournament `status` from `upcoming` to `active` (locks seeding)
  5. Notify participants of their pairings
```

**Single / double elimination (Bracket Engine v2)**:
```
Admin clicks "Generate bracket" → POST /api/tournaments/[id]/generate-bracket
  1. buildBracketStructureForParticipants() computes the full slot graph (WB/LB/GF columns)
     - SE championship round name: Finals (bo_overrides key). No starting_bracket concept.
     - DE: last LB drop-in = Losers Finals; single GF; n=2 with no LB starters = WB match + GF only
     - Double elim LB starts: one seed-ordered list; `starting_bracket = 'losers'` players enter
       Losers Round 1 as seed feeders alongside WB R1 drop-losers (Challonge). WB is sized by
       WB starters. Every structure callsite uses the same helper so generate/propagate/reset
       stay in lockstep. Legacy `computeBracketState()` still applies a nominal loss for badges.
  2. Create ALL round rows upfront (bracket_side tagged, Bo overrides applied)
  3. Materialize round-1 matches; byes resolve and propagate immediately
  4. Freeze enrollment_source on the phase

On match completion (finalizeMatchCompletion):
  5. Propagation materializes dependent matches when both feeders resolve
  6. Bracket views render skeleton TBD slots until materialized
  7. Propagation failure → propagation_failed flag + audit match.propagation_failed

Undo / repair paths:
  - resetMatch / resetRound → un-propagate downstream matches with zero games
    (409 DOWNSTREAM_PLAYED without cascade: true)
  - POST /api/tournaments/[id]/repair-bracket → re-run bye + materialization
  - DELETE /api/admin/rounds/[id] → delete latest or zero-game round
    (400 STRUCTURE_ELIM_ROUND_DELETE for v2 elim — use regenerate-bracket)
  - POST /api/tournaments/[id]/regenerate-bracket → wipe all rounds/matches and rebuild
    (409 REGENERATE_PLAYED without cascade: true; cascade resets played matches first)

Legacy elim (pre-structure rows): flat bracket rendering + per-round generate;
POST /api/generate-round/[tid] returns 400 BRACKET_V2_MANAGED when structure rounds exist.
```

**Seeding policy:** For `single_elim` and `double_elim` tournaments, participant `seed` and `starting_bracket` are editable only while `status = 'upcoming'` and no rounds exist. The bracket locks when it is generated (`status` → `active`). `PATCH /api/tournaments/[id]/participants` rejects re-seeding after start. `SeedingTable` is the canonical seeding UI (including the double-elim “start in losers” toggle). Every enrolled participant is paired — there is no unplaced pool.

### 6.5 Insights Hub Loading Strategy
```
/insights?scope=global|league|tournament&id=&tab=ratings|usage|moves|kills|h2h|streaks

  SSR (revalidate: 60s):
    → Parse scope via src/lib/insights/scope.ts
    → Standings: computeStandings from match records (league/tournament scope)
    → Usage tab: aggregates table (league/tournament/all_time) or meta_usage_cache (global)
      - Eff column = total_kos_dealt / total_brought from aggregates;
        null (rendered as "—") for the global meta_usage_cache fallback
        (Showdown meta has no KO counts).
    → Kill tab: battle_stats (scoped only; not for global)
    → Ratings tab: player_ratings (global only — per-league ratings deferred)
      - Each row is tiered into Poké / Great / Ultra / Master Ball via
        src/lib/rating/tiers.ts (see Section 11.5).

  CLIENT TABS:
    → Moves: GET /api/stats?view=moves&scope=&scope_id=
    → H2H: tournament scope only; participant pair selection
    → Streaks: GET /api/streaks/leaderboard

  Legacy URLs redirect here:
    /leaderboard → tab=ratings
    /tournaments/[id]/stats → scope=tournament&id=
    /leagues/[id]/stats → scope=league&id=
```

---

## 7. Team Visibility Rules

All visibility enforcement is in Next.js API routes. Supabase stores full data unconditionally.

```typescript
function canViewTeam(requestingUserId, teamOwnerId, match) {
  if (requestingUserId === teamOwnerId) return true      // always see own team
  if (match.status === 'completed') return true          // public after match
  if (isAdmin(requestingUserId)) return true             // admins always see
  return false                                           // hidden otherwise
}

// When hidden, return:
{ pokemon: ['hidden','hidden','hidden','hidden','hidden','hidden'] }
```

### Share Link Visibility

Teams with a non-null `share_token` are accessible via `GET /api/teams/share/[token]` without authentication. The share token is an ungessable UUID v4. When accessed via this path, the full `pokemon` array is always returned (no redaction). Owners can revoke the link by clearing `share_token` and `share_enabled_at`.

### Public Library Visibility

Teams with a non-null `library_published_at` appear in `GET /api/teams/library` (public, no auth). The full `pokemon` array is always returned. Owners can unpublish at any time by clearing `library_published_at`, `library_title`, `library_description`, and `library_tags`.

**Critical:** Team auto-populated from replay is written **only after** match is marked `completed`. Never before.

---

## 8. Match State Machine

```
scheduled
    │
    ▼
in_progress  ◄──── (additional games submitted)
    │
    ▼
pending_confirmation  (Bo threshold reached, winner determined)
    │                  24hr auto-confirm timeout
    ├──► completed  (opponent confirms OR timeout)
    │
    └──► disputed  (either player flags, or admin intervenes)
              │
              ▼
           completed  (admin manual override)
```

---

## 9. Ruleset Data Structure

```typescript
// base_format is widened to a string of shape `gen{1-9}{tier}` (or 'blank')
// to support all generation × tier combinations exposed by @pkmn/dex.
type BaseFormat = string;

interface Ruleset {
  id: string
  name: string
  base_format: BaseFormat
  is_doubles: boolean
  clauses: string[]           // e.g. ['Sleep Clause Mod', 'Species Clause']
  bans: {
    pokemon: string[]
    moves: string[]
    items: string[]
    abilities: string[]
  }
  additions: {
    pokemon: string[]         // unbanned from base format
  }
  custom_rules_string: string // raw PS rules string overflow
  min_shared_type_pct: number // 0–100; 0 disables
  team_constraints: TeamConstraints | null // see Section 9.1
}
```

**Ruleset builder UI flow:**
1. Select base format (pre-fills clauses + bans from @pkmn/data)
2. Toggle clause checkboxes (pre-filled, overrideable)
3. Banlist editor: inherited chips (removable) + search-to-add picker
4. Additions picker: search to unban from base
5. Custom rules text field (optional overflow)
6. Team constraints (optional): type quotas, tera match, evolution-stage limits, Eviolite tier cap
7. Name + save

### 9.1 Team Constraints Engine

Generic JSONB blob on `rulesets.team_constraints` that lets a ruleset express
composition rules beyond simple banlists. All fields are optional; absent or
`null` constraints behave as if disabled (existing rulesets are unaffected).

```typescript
type TierKey = 'PU' | 'PUBL' | 'NU' | 'NUBL' | 'RU' | 'RUBL' | 'UU' | 'UUBL' | 'OU' | 'Uber' | 'AG' | 'ZU';

interface TeamConstraints {
  /**
   * Per-type team requirements. When `source = 'player_core'`, each player
   * must be assigned `season_participants.core_types` and each of those types
   * must appear on at least `min_per_type` Pokémon. A multi-type Pokémon
   * counts toward each of its in-core types when `allow_multi_count = true`,
   * which can free additional slots for off-core mons.
   */
  type_quotas?: {
    source: 'player_core' | 'fixed';
    fixed_types?: string[];
    min_per_type: number;
    allow_multi_count: boolean;
  };

  /**
   * Restricts each set's tera type. `'player_core'` requires it to match one
   * of the player's assigned core types. `'team_types'` requires it to match
   * one of the Pokémon's own types. `'none'` disables the check.
   */
  tera_match?: 'player_core' | 'team_types' | 'none';

  /**
   * Restricts evolution stages. In `'nfe_only_plus_n_fe'` mode, the team
   * must consist of NFE species (no `evos`) plus at most
   * `fully_evolved_cap` fully-evolved exception(s) whose tier is at or below
   * `fully_evolved_tier_max`. Legendaries are blocked when
   * `legendaries_allowed = false`. `'unrestricted'` disables the check.
   */
  evolution_stage?: {
    mode: 'unrestricted' | 'nfe_only_plus_n_fe';
    fully_evolved_cap?: number;
    fully_evolved_tier_max?: TierKey;
    legendaries_allowed?: boolean;
  };

  /**
   * Forbids Eviolite on any NFE species whose evolution chain contains a
   * Pokémon in a tier strictly above `eviolite_tier_cap` (e.g. Bisharp →
   * Kingambit (OU), Duraludon → Archaludon (UU) both blocked when cap = 'RU').
   * The NFE species itself remains legal; it just cannot carry Eviolite.
   */
  eviolite_tier_cap?: TierKey;
}
```

The constraint engine is implemented in `src/lib/pkmn/validation.ts`
(`validateTeam(team, ruleset, ctx)`), with `ctx.playerCore` populated from
`season_participants.core_types` when validating a team for a Core Liga
tournament. See the [Core Liga ruleset](../README.md) seed migration for
end-to-end use.

### 9.2 Teambuilder Editor v3

The teambuilder was rebuilt from scratch in a ground-up rework that deleted the V1 and V2 workspaces. The new editor is a single component (`TeamsEditor`) with three modes.

#### Modes

| Mode | Save target | Pre-load source |
|------|-------------|-----------------|
| `teambuilder` | `teams` table (`POST /api/teams` or `PATCH /api/teams/[id]`) | Existing `teams` row by `tournament_id` + `player_id` |
| `plan` | `match_prep_teams` + dual-write to `teams` with `match_id` set | Existing `match_prep_teams` row, or dual-written `teams` row with `match_id`; empty if neither exists |
| `library` | Not editable — read-only view with share/fork controls | `teams` row by `id` |

#### Layout

- **Desktop**: 3-column grid (browser left, six slots middle, intel right). Each column collapsible. Sticky top bar (format/ruleset/lock status). FAB bottom-right for save/import/export.
- **Mobile**: Tab switcher (Team / Browse / Intel) with bottom drawer. FAB anchored.

#### Slot editing

Click a slot → fullscreen `SetEditorModal`. Team grid stays mounted underneath. The modal contains: species picker, item/ability/nature/tera autocomplete, 4 move slots, EV stepper grid, IV grid, stat bars, sample set picker (one-click apply Smogon sets).

#### Validation

Per-slot status icon (green/yellow/red) + FAB badge showing issue count + side panel listing all issues with "jump to slot" links. Issues have stable `issue_id` fields for the jump target.

#### AI Co-Pilot

Three tiers, all rated per `src/lib/ai/rate-limit.ts`:
1. **Slot-level** (`POST /api/teams/co-pilot/slot`): triggered by "Suggest improvements" inside SetEditorModal. Returns move/item/ability/spread suggestions with one-click apply.
2. **Team-level** (`POST /api/teams/co-pilot/team`): auto fire-and-forget on Plan Team save + manual refresh. Returns headline + per-slot commentary (strengths/weaknesses/coverage/speed/synergy).
3. **Match-level**: existing `POST /api/ai/match-prep-analysis` — surfaced as a link in the Plan Team AI panel.
4. **Monotype** (`POST /api/teams/co-pilot/monotype`): only when ruleset is monotype. Returns suggested monotype cores with one-click build.

#### Public surfaces

- **Share link** (`/teambuilder/share/[token]`): ungessable UUID v4; always shows full team; owner can revoke.
- **Public library** (`/teambuilder/library`): opt-in publishing with title/description/tags; browseable/searchable; one-click fork copies to the forker's roster.
- **My Library** (`/teambuilder/library` when authenticated): player's published teams with unpublish/fork controls.

#### First-time onboarding

3-option starter flow on first open: (a) Paste a team (PS text or pokepaste URL), (b) Browse the library, (c) Build from scratch. Dismissed after first save.

#### Performance budget

≤ 5 fetches on editor mount with a full 6-Pokémon team: initial team load, species info batch, move info batch, ruleset, validation. Pickers fetch lazily on first open.

See `docs/teambuilder-editor.md` for the full module documentation.

---

## 10. Pokémon Data Sources

```typescript
// All from @pkmn/data + @pkmn/dex — never hardcode dex data
import { Generations } from '@pkmn/data'
import { Dex } from '@pkmn/dex'

const gens = new Generations(Dex)
const dex = gens.get(9)
dex.species.get('Garchomp')     // species data, types, base stats
dex.moves.get('Earthquake')     // move data
dex.items.get('Rocky Helmet')   // item data
dex.abilities.get('Rough Skin') // ability data

// Team parsing
import { Teams } from '@pkmn/teams'
const team = Teams.importTeam(psFormatText)

// Replay parsing
import { Protocol } from '@pkmn/protocol'
import { Battle } from '@pkmn/client'

// Sprites (no hosting needed)
const spriteUrl = (name) =>
  `https://play.pokemonshowdown.com/sprites/ani/${name.toLowerCase()}.gif`
const spriteUrlStatic = (name) =>
  `https://play.pokemonshowdown.com/sprites/gen5/${name.toLowerCase()}.png`
```

---

## 11. Bring / Lead / Win Logic

Applies **only when `tournament.is_doubles === true`**.

```typescript
// From parsed replay (@pkmn/protocol + @pkmn/client):
// In doubles: player selects 4 from 6 — all 6 on team, 4 "brought"

const stats = {
  was_brought: pokemon.appeared,          // was in the 4 selected
  was_lead: pokemon.turnFirstSeen === 1,  // sent out turn 1
  match_won: match.winner === player,
}

// For singles: was_brought always true (all 6 used), was_lead tracked, no "bring rate" shown in UI
```

Stats page shows Bring/Lead/Win columns **only when viewing a doubles-format league/tournament**. Singles view shows Usage% and KO stats only.

### Pokémon Usage table columns

| Column | Source | Notes |
|--------|--------|-------|
| `#` | row index | |
| `Pokemon` | `aggregates.pokemon_name` | linked to `/pokemon/[name]` |
| `Usage%` | `total_appearances / totalGames` | rendered with `UsageBar` |
| `Eff` | `total_kos_dealt / total_brought` | nullable; `—` when brought data is missing (global meta fallback). Same formula and `.toFixed(2)` formatting as the `Eff` column on the Kill Ranking tab. |
| `KOs` | `total_kos_dealt` | |
| `KO'd%` | `total_koed / total_appearances` | |
| `Bring%` | `total_brought / total_games` | doubles only |
| `Lead%` | `total_led / total_games` | doubles only |
| `Win%` | `total_wins / total_appearances` | |

---

## 11.5 Rating Tiers (Pokéball Badge)

Each Glicko-2 rating is mapped to one of four Pokéball-themed tiers by `getRatingTier()` in `src/lib/rating/tiers.ts`. The classifier is consumed by `RatingBadge` (player surfaces) and `OverlayRatingBadge` (broadcast overlays); the tier ball is also tinted via `RATING_TIER_META[tier].overlayColor` in overlay contexts.

```
Tier         Rating window                         RD gate
-----        -----------                           -------
Poké Ball    rating < 1400                         — (or rd > 100 provisional, regardless of rating)
Great Ball   1400 ≤ rating < 1600                  —
Ultra Ball   1600 ≤ rating < 1900                  — (also catches rating ≥ 1900 with rd > 50)
Master Ball  rating ≥ 1900                         rd ≤ 50
```

**Rationale:**
- A single league sweep from the 1500 seed typically lands a player ~1650–1750 (Ultra). Reaching 1900 requires sustained dominance across multiple events.
- The Master Ball `rd ≤ 50` gate (≈ 20+ rated games at a settled rating) keeps a high-variance early spike from earning Master Ball after one event.
- `rd ≤ 0` (or `null`/`undefined`) is the "RD unknown" sentinel used by call sites that did not fetch RD (the public players directory used to do this before `PublicPlayerDirectoryEntry.rd` was added). When RD is unknown the provisional check and the Master gate are both skipped — the badge degrades gracefully to a rating-only classification capped at Ultra Ball.

Ball icons are rendered by `src/components/shared/PokeballIcon.tsx`, a server-safe component (no `'use client'`, no hooks, no network) that draws the Showdown itemicons spritesheet at fixed offsets cached in `src/lib/pkmn/ball-sprites.ts`.

---

## 12. Component Tree (abbreviated)

```
app/
  layout.tsx                  Root: html, SessionProvider, ThemeProvider (no NavBar)
                              + site-palette pre-paint script (<head>)
  (public)/layout.tsx         NavBar + main chrome
  (player)/layout.tsx         NavBar + AuthGuard redirect for unauthenticated
  (broadcast)/layout.tsx      Minimal shell (no NavBar)

  (public)/
    page.tsx                  Guest landing
    insights/page.tsx         Insights hub + InsightsTabs
    wiki/                     Encyclopedia pages
    pokemon/[name]/page.tsx   Species detail
    players/page.tsx          PlayersDirectory
    players/[id]/page.tsx     PublicProfileSections + private sections when logged in
    tournaments/ leagues/     Browse (stats subroutes redirect to /insights)

  (player)/
    dashboard/                Command center + match flows
    teambuilder/

  admin/
    page.tsx
    leagues/new/page.tsx
    leagues/[id]/page.tsx              LeagueRosterManager + PhaseTimeline
    leagues/[id]/phases/[phaseId]/page.tsx  Phase workspace
    tournaments/new/page.tsx
    tournaments/[id]/rounds/page.tsx   Round generator (redirects season-linked)
    rulesets/new/page.tsx              Ruleset builder
    rulesets/[id]/edit/page.tsx
    matches/[id]/page.tsx              Override interface
    players/page.tsx

components/
  league/
    LeagueRosterManager.tsx    League roster: bulk add, guests, substitute
    PhaseTimeline.tsx          Ordered phase cards + reorder
    PhaseForm.tsx              Phase create/edit
    PhaseGroupsPanel.tsx       Serpentine group assignment
    SubstituteDialog.tsx       Substitute preview + commit
    hub/                       League hub inside a route world's #pulse (logic: src/lib/league-hub/)
      LeagueHub.tsx            Header strip, ?tab= link bar, active panel (#league-hub-panel)
      HubStandingsTable.tsx    Standings table in the world palette (season + group tables)
      HubMatchesPanel.tsx      Phase → round → match list (scores, kickoff, status)
      HubGroupsPanel.tsx       Per-group tables (round robin + Swiss), RR results grid
      HubPlayoffsPanel.tsx     Elimination brackets via ElimBracketView
      HubPhasesPanel.tsx       Phase cards with groups and their members (as the group tables)
      HubInsightsPanel.tsx     League usage + kill ranking (ScopedInsightsView)
      HubRulesPanel.tsx        Description, ruleset, Core Liga cores
      HubReportsPanel.tsx      Kale reports per phase (ENABLE_KALE_CABBAGE only)
      HubBits.tsx              Shared status chip, empty state, links
      HubTabPending.tsx        'use client' pending mark on a clicked tab (useLinkStatus);
                               pulses only while pending
      HubTabStripScroll.tsx    'use client' scrolls the tab strip (never the page) so the
                               active tab is in view on a phone

  tournament/
    SeedingTable.tsx           Canonical seeding UI (drag, shuffle, rating, sync, DE LB-start toggle)
    ParticipantManager.tsx     Standalone tournament participants (uses SeedingTable)
    RoundManager.tsx             Rounds + delete/regenerate bracket

  shared/
    GuestBadge.tsx             Guest label on roster/participant rows
    PalettePicker.tsx          Site colour-scheme picker (NavBar + mobile drawer)
    LanguagePicker.tsx         Language picker (NavBar, mobile drawer, settings card; §17)

  bracket/
    SingleElimBracket.tsx
    DoubleElimBracket.tsx
    BracketSkeletonCard.tsx    TBD slot card for unmaterialized feeders
    ElimBracketView.tsx        SE/DE bracket prep (slot skeleton, feeder labels, DE loss
                               counts, legacy fallback); phase page + league hub playoffs.
                               Drops the DE reset slot once the winners-bracket entrant won
                               the Grand Final (bracket-reset.ts); optional `copy`
                               (labels.ts BracketCopy) overrides the localized default labels
    RoundRobinTable.tsx
    SwissStandings.tsx

  ui/                         # Spec Section 12 primitives (names unchanged; ShadCN/CVA/Radix internals)
    Button, Card, Badge, Input, Select, Textarea, Alert, Skeleton
    Modal, ConfirmDialog, Tooltip, Popover, Combobox
    Table (+ SortableTableHeader, TablePagination)
    PageContainer, Section, CollapsibleSection

  teambuilder/
    TeambuilderClient.tsx     Page-level wrapper mounting TeamsEditor
    TeamImporter.tsx          pokepast.es URL / raw text input
    SetEditor.tsx             Legacy set editor (Cast Studio only — see deprecations)

  teambuilder/v3/             2-column layout: workspace | intel panel
    editor/
      TeamsEditor.tsx         Top-level editor (3 modes: teambuilder | plan | library);
                              top bar: FormatPicker, team name, New, save badges
      FormatPicker.tsx        Gen-grouped collapsible meta switcher
      EditorContext.tsx       { state, dispatch } context
      EditorDialogs.tsx       Import / Export / Share / Publish dialogs
      SampleSetPicker.tsx     One-click apply Smogon sample sets (used by intel/SetsTab)
      MobileTabBar.tsx        <lg bottom tab bar (Intel/AI bottom sheets)
      state.ts                Reducer + createInitialState
    workspace/                Inline Showdown-style set editor (center column)
      SetWorkspace.tsx        Grid ↔ set switch, validation-jump highlight
      TeamStrip.tsx           6 mini-sprite slot switcher
      SpeciesPicker.tsx       Full-pane chooser: usage list w/ Pick% first, type
                              filters, sortable stats; draft pool constraints
      SpeciesHeader.tsx       Sprite, name, types, nickname/level/shiny, Tera
      TeraTypePicker.tsx      Dropdown sorted by tera usage %
      ItemPicker.tsx          Full panel: search + sortable Name/Use% columns
      AbilityPicker.tsx       Dropdown sorted by ability usage %
      NaturePicker.tsx        Dropdown grouped by boosted stat
      MoveSection.tsx         4 move chips opening MovePicker
      MovePicker.tsx          Learnset w/ usage%, type/category filters, sortable
      StatEditor.tsx          EV/IV editor with budget bar
      SpreadPresets.tsx       Meta spreads (usage %) + canonical presets
    intel/                    Right panel
      IntelPanel.tsx          Overview/Sets/Calc/Speed tabs
      IntelSubjectStrip.tsx   Subject picker for per-mon tabs
      OverviewTab.tsx         Type coverage + common teammates
      SetsTab.tsx             Sample sets for the subject
      CalcTab.tsx             Matchup matrix vs meta threats or scouted opponent
      SpeedTab.tsx            Merged team+meta speed list + outspeed solver
      OpponentPanel.tsx       Scouting stats (plan mode "Scout" tab)
    hooks/
      useTeamSave, useTeamValidation, useDraftContext, useSpeciesData,
      useUsageDetail, useIntelSubject, useOpponentSummary, useEditorCommands
    ai/
      AiPanel.tsx             Hosts SlotCoachPanel + TeamCoachPanel; EditorCommandApi seam
      commands.ts             Typed command contract for the future agent chat
    browser/
      BudgetMeter.tsx         Draft budget bar (rendered inside SpeciesPicker)
    primitives/
      TeamCardPrimitive.tsx   Single-Pokémon read-only card (shared primitive)
    validation/
      ValidationPanel.tsx     Issue list with jump-to-field

  stats/
    StandingsTable.tsx
    PokemonUsageTable.tsx     Usage%, Eff, KOs, KO'd% — doubles adds Bring%/Lead%/Win%
    MoveUsageTable.tsx        Lazy-loaded
    HeadToHeadMatrix.tsx      On-demand
    KillRankingTable.tsx

  insights/
    InsightsTabs.tsx          Tab shell for /insights
    InsightsScopeContext.tsx  Optional shared scope state

  shared/
    ScopeSelector.tsx         Global | League | Tournament scope picker

  profile/
    PlayersDirectory.tsx      /players grid
    PublicProfileSections.tsx Guest-visible profile blocks

  match/
    ReplaySubmitForm.tsx      URL paste + source selector (PS / Champions / manual)
    ManualStatForm.tsx        Full stat entry form
    MatchStatusBadge.tsx
    GameList.tsx              Per-game results within a match

  ruleset/
    RulesetBuilder.tsx        Multi-step: base → clauses → bans → custom
    ClauseToggleGrid.tsx
    BanlistEditor.tsx

  shared/
    PokemonSprite.tsx
    TypeBadge.tsx
    DiscordLoginButton.tsx
    AdminGuard.tsx
    AuthGuard.tsx
```

---

## 13. Environment Variables

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# Auth
NEXTAUTH_SECRET=
NEXTAUTH_URL=
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=

# AI Co-Pilot
AI_SLOT_COACH_DAILY_LIMIT=30
TEAM_LIBRARY_ENABLED=true
```

---

## 14. Database Query Strategy

Rules:
1. All database reads go through server-side Supabase client or dedicated API routes — never call Supabase from the client
2. Stats pages read from pre-computed `aggregates` tables by default — never scan `battle_stats` at read time for usage, standings, or move stats. Targeted server-side `battle_stats` reads are allowed only when the required player / match / round granularity is not present in aggregates.
3. Aggregate updates on replay parse use batched writes where possible
4. Next.js `revalidate` values: standings = 60s, full stats = 120s, bracket = 30s
5. Use Supabase select filters and limits — never fetch unbounded result sets

---

## 15. Build Phases

### Phase 1 — Foundation
- [ ] Supabase workspace setup: create all tables with correct schema
- [ ] Next.js project init with TypeScript, Tailwind, NextAuth Discord
- [ ] Environment config and Supabase client setup
- [ ] Auth layer: Discord OAuth, session → Players DB lookup, admin flag
- [ ] Ruleset builder (full UI: inheritance + clause toggles + banlist)
- [ ] Ruleset browser (public)
- [ ] Player registration + PS username mapping

### Phase 2 — Tournament Engine
- [ ] Tournament creation (all 4 bracket types)
- [ ] Round generation API (Swiss pairing library integration)
- [ ] Bracket renderer components (all 4 types)
- [ ] Match state machine implementation
- [ ] Admin round management UI

### Phase 3 — Teambuilder
- [ ] pokepast.es + raw PS text import (`@pkmn/teams`)
- [ ] Ruleset legality validation
- [ ] Team display component (sprites, types, full sets)
- [ ] Manual Pokémon picker (fallback)
- [ ] Team lock/visibility logic

### Phase 4 — Replay Pipeline & Stats
- [ ] PS replay parser (`@pkmn/protocol` + `@pkmn/client`)
- [ ] Manual stat entry form (Pokémon Champions path)
- [ ] Aggregate update pipeline (3 scopes on every write)
- [ ] Stats dashboard (progressive load: standings → usage → moves → H2H)
- [ ] Match confirmation flow (pending → completed state)

### Phase 5 — Draft Leagues
- [x] Draft Pool creation (admin draft panel; initial and redraft pools)
- [x] Draft room UI (live pick interface): EPB queue engine — `/leagues/[id]/draft-room`, `DraftToolClient`, line finder (§5)
- [x] Queue engine: persisted state machine in Postgres (`draft_participants`, `draft_slots`, plpgsql RPCs under the season advisory
      lock, `state_version` polling), live and slow modes, pick-clock extensions, admin pause, make-up slots, blocked-slot resolution,
      pick void/correct, audit trail, `/api/cron/draft-ticks`
- [x] Redraft with secret drop (`/leagues/[id]/redraft`) and the token centre (Draft Kill Tokens, Comeback Tokens; `/leagues/[id]/tokens`)
- [x] Turn alerts (in-page notifications, Discord draft events) and broadcast draft overlays
- [ ] Ownership constraints in teambuilder
- [ ] Draft-aware stats views

---

## 16. Claude Code / Codex Role Protocol

### Role Division

| Concern | Owner |
|---|---|
| Architecture decisions | Claude Code |
| Ambiguity resolution | Claude Code |
| Bulk component scaffolding | Codex |
| API route implementation | Codex |
| Schema changes | Claude Code approval required |
| New data flows | Claude Code designs, Codex implements |
| Bug triage | Claude Code diagnoses, Codex fixes |
| Performance review | Claude Code |

### Claude Code Standing Instructions

You are the **project lead and architect** for PokéTools. Your responsibilities:

1. **Own the data integrity contract.** The database schema in this spec is the source of truth. Any deviation must be explicitly decided and documented — never silently changed.

2. **Guard the visibility layer.** All team visibility and permission logic lives exclusively in Next.js API routes. If Codex ever writes visibility logic into a React component or database query, flag and correct it.

3. **Enforce the write discipline.** The app is the sole writer to Supabase. No admin edits data directly. If a feature requires data correction, it must go through an API route.

4. **Pre-computation is non-negotiable for reusable stats.** Stats pages must read from the `Aggregates DB` for usage, standings, and move stats. Targeted server-side reads of `Battle Stats` are acceptable only when the needed player / round / match granularity is absent from aggregates.

5. **Review all new API routes** before merge. Check: correct auth guard, correct database query patterns, correct state machine transition, aggregate update triggered.

6. **Phase gating.** Do not allow Phase 2+ features to be implemented before Phase 1 foundations are stable. Specifically: no replay parsing before auth and player DB are working; no stats before replay pipeline is working.

7. **Draft league schema is frozen.** The DraftPools and DraftPicks DB schema is included now and must not be changed when Phase 5 begins without explicit discussion.

### Codex Standing Instructions

You are the **executive agent** for PokéTools. You implement what Claude Code specifies.

1. **This spec is your bible.** All routes, schemas, component names, and data flows are defined here. Do not invent alternatives without flagging to Claude Code first.

2. **TypeScript strictly.** No `any` types. All database responses must be typed against the schema defined in Section 4.

3. **Never call Supabase from the client.** All database access goes through server-side Supabase client or dedicated API routes. This is a hard rule.

4. **Match state transitions are explicit.** When writing any code that changes a Match's `status`, it must go through a dedicated transition function that validates the current state is a legal predecessor. No direct status overwrites.

5. **Aggregate updates are always triggered.** Any function that writes to `Battle Stats` or `Games` must call `updateAggregates(gameId)` as part of the same operation. Never write stats without updating aggregates.

6. **Implement phases in order.** Do not begin Phase 2 work until Phase 1 is complete and reviewed by Claude Code.

7. **Component naming follows the tree in Section 12 exactly.** Do not rename components.

8. **Use `@pkmn/data` for all dex data.** Never hardcode Pokémon names, type charts, move lists, or stat values. Always query through the library.

9. **Environment variables only — no hardcoded credentials.** Supabase URL and service role key come from env vars as defined in Section 13.

10. **When uncertain, stop and ask Claude Code.** An explicit question is always better than an undocumented assumption.

## 17. Internationalization (DE/EN)

The whole site can be switched between English and German. Module doc, style guide and glossary: [`i18n.md`](./i18n.md); agent rules: `AGENTS.md` "Text goes through `src/i18n`". Pokémon data names (species, moves, items, abilities, types, natures, stats) come from `src/lib/pkmn/i18n` ([`pkmn.md`](./pkmn.md)); stored, imported, exported and computed values stay English `@pkmn` names and ids.

| # | Decision |
|---|---|
| D1 | Locales are `en` (default for first-time visitors) and `de`. No `Accept-Language` negotiation, no URL prefix, no `[locale]` segment. |
| D2 | No new npm dependency: in-house typed TS dictionaries in `src/i18n/messages/<ns>/{en,de,index}.ts`. `en` is the source of truth; a `de` that misses a key, adds one, or renames a placeholder or tag fails `tsc`. |
| D3 | Client components statically import the namespace modules they use (both languages per module). The root provider carries only `locale`, `dataLocale`, `timeZone` and `requestTime`. |
| D4 | Three cookies: `plc_locale` (`en`\|`de`), `plc_pkmn_lang` (`en`, or absent = follow the UI language) and `plc_tz` (an IANA zone written by the browser). One year, `Path=/`, `SameSite=Lax`, `Secure` in production, not `httpOnly`. |
| D5 | `getLocale()` / `getDataLocale()` / `getTimeZone()` are React `cache()` reads of `cookies()`. They never run inside `unstable_cache` / `cachedRead`; cached values never contain localized text; no cache is keyed by locale. |
| D6 | The root layout reads the locale cookie, so every route renders dynamically (the wiki pages and a few static pages stop being prerendered). Accepted. |
| D7 | A language switch is `POST /api/locale` (validates, sets the cookies), then `router.refresh()`, or `location.reload()` on a 3D route-world page so the world is rebuilt complete at reveal. |
| D8 | API errors keep the English `error` text and gain `code` plus optional `params`; `UserFacingError` carries typed `code`/`params`; clients translate the code with `useApiErrorText(...)` and fall back to the English text. |
| D9 | Times are stored in UTC and shown in the viewer's browser zone, hydration-safe (`useSyncExternalStore` plus the `plc_tz` cookie). English formats use `en-GB`, German `de-DE`, 24-hour clock. Deadlines also show the league time (`Europe/Berlin`). |
| D10 | Viewerless text (Discord, social images and posts, stored AI reports, overlays without `?lang=`) uses `seasons.language` (`'de'` default; §4.2). Text with no league uses `'de'`. Overlays use `?lang=` first, then the league language, never the cookie. |
| D11 | Worlds follow the viewer: themes carry no language (`RouteThemeDefinition.locale` and `worldLang()` are retired), and painters receive the viewer locale before textures are built. This supersedes the per-theme locale of the multi-theme route-worlds spec (§7 there). |
| D12 | German copy uses the casual *du*. `en` messages copy today's English literals verbatim, so English tests stay green. |
| D13 | i18n hooks never throw without a provider: they render English and warn once outside production. |
| D14 | One Pokémon-terms setting ("Keep Pokémon terms in English", cookie `plc_pkmn_lang`), written only by `POST /api/locale` and offered only by `LanguageOptions` (NavBar, mobile drawer, `/dashboard/settings`). |
| D15 | EPB list prose (`rationale`, `special_rules_text`, `historical_data`) is not stored in English: English mode shows the German workbook text with `lang="de"`; special-rule text has authored English for the lines that carry it (the format pack's `epb.specialRulesEn`). |
| D16 | League rule prose that is tuning (token rules, line rulings, price-group labels, utility labels) lives in the active format pack's `messages` and is spliced into its existing namespace, so namespace ids and key paths do not change; the example pack's English tree is the contract (`definePackEn`). See [`format-packs.md`](./format-packs.md#messages). |

**Not translated:** Showdown import/export text, stored DB values (engine round/slot/group names and notes stay English and are translated at display time), URLs and sprite keys, AI prompts (the output language is one instruction line), log text, Kale and test-player tooling (English-only by design decision). Crawlers and link previews see English; there is no `hreflang`.

**Emails:** the Supabase Auth templates are bilingual and branch on `user_metadata.locale`, written at sign-up; the hosted dashboard copies are pasted by the deployment operator (steps in [`i18n.md`](./i18n.md#emails)).

---

*Spec version 1.0 — Design phase complete. Ready for Phase 1 build.*

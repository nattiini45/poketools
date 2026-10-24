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
| Sprites | Viewer-selectable sprite styles (`src/lib/pkmn/sprite-styles.ts`, `docs/pkmn.md` "Sprite styles"): self-hosted broadcast renders (Storage bucket `sprites`, site default), HOME renders (`img.pokemondb.net`), Showdown animated and pixel sprites (`play.pokemonshowdown.com/sprites/`); preference: the `plc_sprite_style` cookie is the server-render source of truth, synced from the account value `players.sprite_style` on save, at sign-in and by a once-per-tab client reconcile |
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
- **Evolution Point Buy** (`evolution_point_buy`) — versioned point-buy list, budget/pick-capped draft with branched-line identity `(base, stage3)`, surviving-Pokémon Comeback Tokens, Participation Tokens and per-line rulings. The league's tuning (budget, picks, token tables, line rulings, price groups, workbook layout, draft-clock quiet hours, Comeback Token earn window and exchange ratio) comes from the active format pack (`docs/format-packs.md`). Canonical module doc: `docs/evolution-point-buy.md`.

**Mechanics public, tuning in the pack.** Every mechanic (draft engines, quiet hours, pool completability, token rules, scoring and tiebreaks) is public code under neutral names; a league's numbers and wording live in its format pack. A pack may also fill the optional, server-only **pack-extension seam** (`src/lib/pack-extensions/`: supplementary records shown beside the live statistics and never added to them, extra profile and settings sections, extra admin and site links). The example pack fills nothing, so a public build has no pack-specific code, schema or data. Contract and rules: `docs/format-packs.md` ("Pack extensions").

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
>
> Sections 4.1–4.12 describe the core tables field by field (types in the original design notation; the migrations in `supabase/migrations/` and `src/types/database.ts` are the exact shape). Section 4.13 indexes **every** table in schema `public`; `scripts/__tests__/public-docs.test.mjs` fails when a table in `src/types/database.ts` is missing from it.

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
| deadline | Timestamptz | nullable; set and cleared by admins in RoundManager (`PATCH /api/tournaments/[id]/rounds/[rid]`, audited, expires the tournament's read tags) |
| bye_player_ids | UUID[] | not null, default `{}` (migration `20261023145151_rounds_bye_player_ids.sql`). Players with a bye in this Swiss or round-robin round, written at generation (generate, generate-all, manual). Swiss: a stored bye is a win worth the stage's win points, adds no games, kills or Buchholz, and blocks a second bye. Round-robin byes score nothing; a grouped round robin phase follows the week plan and stores no bye, a grouped Swiss phase stores each group's bye; elimination byes are structural and not stored. |

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
| finalized_at | Timestamp | nullable — set only when every finalize step of a completed match succeeded; every status write clears it. A completed match with `finalized_at IS NULL` is healed by the auto-confirm cron (replay-safe steps only). Migration `20261018130000_match_finalize_integrity.sql`; runbook in `docs/match.md` ("Finalize Integrity and Heal") |

Games are unique per `(match_id, game_number)`: a concurrent submission of the same game number is refused with 409 `match_result_conflict` before anything is written.

### 4.6 Games (individual Bo games within a match)
| Field | Type | Notes |
|---|---|---|
| match | Relation → Matches | |
| game_number | Number | 1, 2, 3... |
| winner | Relation → Players | |
| replay_url | URL | PS or Champions replay |
| replay_hash | Text | nullable; SHA-256 (64 lowercase hex) of the replay's canonical battle log (`src/lib/pkmn/replay-identity.ts`), written in the insert that records a replay result; **unique where set** (one battle, one game, across all matches). NULL for manual results and for replay games recorded before 2026-10-20 until `scripts/backfill-replay-hashes.ts` fills them. Migration `20261020100000_games_replay_hash.sql` |
| source | Select | ps_replay / manual / champions |
| parsed | Checkbox | whether stats have been extracted |
| evolution_applied_at | Timestamp | nullable; EPB only: when the game's real kills were credited to the evolution trackers, which happens once, when its match reaches `completed` (finalize step `epb_real_kills`, `epb_credit_game_kills`), never at submission. NULL while not credited. Games that existed on 2026-10-20 were credited at submission and carry the backfill time. Written only by `epb_credit_game_kills` / `epb_uncredit_game_kills` / `epb_sync_game_kill_credit`, in the same transaction as the tracker writes. Migration `20261020100200_games_evolution_credit.sql`; rules in `docs/evolution-point-buy.md` ("Match Lifecycle Wiring") |

A game recorded from a replay takes its winner and its battle stats from that same hashed replay, never from a client-supplied value. A battle already bound to any game is refused with 409 `replay_already_recorded`; see `docs/match.md` ("Replay Binding").

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
| locked | Checkbox | manual lock flag (PATCH/DELETE refuse a locked row for its owner; no code path sets it today). A row linked to a **completed** match is locked independently by the `teams_completed_match_lock` trigger (see §7) |
| draft_pool | Relation → DraftPools | nullable; the draft pool a draft-league team was built from |
| is_draft_team | Checkbox | true for a team built from a draft pool |
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

One row per Pokémon per player per game: unique index `battle_stats_game_player_pokemon_key` on `(game_id, player_id, lower(regexp_replace(pokemon_name, '^[set]+|[set]+$', '', 'g')))` with `[set]` exactly JavaScript's trim set (migration `20261021100200_battle_stats_pokemon_key_js_trim.sql`, which replaced the `lower(btrim(pokemon_name))` key of `20261020100100_battle_stats_unique_pokemon.sql`), the database twin of the request schemas' rule; a violation is 409 `battle_stats_duplicate_pokemon`.

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

### 4.11 Draft Pools
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
> **Quiet hours** (`20261018140100_draft_quiet_hours.sql`). A queue pool may carry a daily quiet window
> (`quiet_start_hour`, `quiet_end_hour`, `quiet_timezone`: `[start, end)` local hours of an IANA zone, never crossing local
> midnight; all three NULL = none). Inside the window the pick clock does not run; picking stays allowed. It holds every
> pick clock of the queue engine (live and make-up slots, the slow ladder, extensions, a redraft's pick phase); the redraft
> submission deadline is a wall-clock instant and is unaffected. Deadlines stay absolute instants computed in running
> time, so no deadline falls inside a window; turn pings and reminders due inside a window are sent when it ends. The
> window is fixed when the pool is created (`POST /api/drafts` copies it from the active format pack's
> `epb.draftClock.quietHours`; a client never sends it) and cannot be patched. TS mirror: `src/lib/draft/time.ts`.
>
> **Completability** (`20261018140200_draft_pool_completability.sql`). A drafting queue pool is always completable:
> every participant can fill every open roster slot at once with distinct free lines it may take, within its remaining
> budget. So the player on the clock always has a legal pick, and no slot is ever blocked or forfeited. `draft_start`
> refuses a league that cannot complete (`LEAGUE_NOT_COMPLETABLE`); any pick, override, correction or void that would
> break the invariant is refused (`POOL_NOT_COMPLETABLE`; `POOL_CHECK_LIMIT` when the bounded exact search cannot decide);
> a void always requeues; a redraft publish that could not complete is refused (`REDRAFT_NOT_COMPLETABLE`) and keeps the
> submissions secret. The search is `draft__completable_search` in SQL and `poolCompletability` in
> `src/lib/draft/completability.ts`, step for step on shared vectors. `draft_end` aborts a running initial draft (every
> pick voided); a running redraft cannot be aborted.
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
> to each other. A participant who joins or leaves mid-draft still shifts the round's positions. No legacy draft was running
> when this shipped, so no turn order changed mid-draft.
>
> **Stalled draft** (engine stays stateless). `GET /api/drafts/[id]/state` returns `stalled_picker` (`legacyPickerStall`):
> for a running pool in snake/linear order with fixed prices (not EPB), the current picker whose open picks (this one
> included) cost more at the cheapest Pokémon still available than their points (`{ player_id, remaining, open_slots,
> min_cost }`, else null; the pool list is read only for such pools). Same rule as `draft_pick_strands_roster`: price
> only, tier limits not folded in; no Pokémon left at all is not reported. **Wildcard exception:** in an evo league the
> picks route also takes the picker's own undrafted wildcard from outside the pool list, priced at the pool default, so
> a picker who holds one is not stalled while that price plus the cheapest pool-list completion of their other open
> picks fits their points (the picker's wildcards are read only once the pool list alone leaves them stuck).
> The board shows the stuck player and
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

### 4.12 Draft Picks
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

### 4.13 Table index

Every table in schema `public`, grouped by domain. All have RLS enabled and are granted to `service_role` only (AGENTS.md).

**Players and access**

| Table | Purpose |
|---|---|
| `players` | Player identity: Discord or Supabase Auth user, guest flag, admin flag, preferences (4.1) |
| `resource_admins` | Per-resource admins (a league or tournament admin who is not a site admin) |
| `admin_export_limits` | Daily budget of the admin data export |
| `player_claim_disposable_refs` | Tables whose rows about a player are disposable per-viewer state: a guest claim deletes them with the source account instead of refusing (`claim_guest_player`) |
| `rate_limit_buckets` | Durable request rate limiter: one fixed window per hashed key (`rate_limit_hit`) |
| `audit_log` | Append-only audit trail of privileged operations |

**Leagues, tournaments and matches**

| Table | Purpose |
|---|---|
| `seasons` | Leagues (4.2) |
| `season_participants` | League roster (4.2) |
| `season_storylines` | Caster-maintained season storylines |
| `season_groups` | League groups: one row per group of a league; groups persist across its phases and draft their own pools (`season_groups_replace` is the editor's atomic write) |
| `season_group_members` | League group membership: one group per trainer per league, the trainer must be a league participant |
| `tournaments` | Standalone tournaments and league phases (4.3) |
| `tournament_participants` | Phase or tournament enrollment and seeds (4.3) |
| `tournament_groups` | Groups of a group-stage phase (`season_group_id` links one to the league group it mirrors) |
| `tournament_group_members` | Group membership |
| `rounds` | Rounds (4.4) |
| `matches` | Matches (4.5) |
| `match_proposals` | Proposed match times and their answers |
| `games` | Games of a match (4.6) |
| `rulesets` | Rulesets (4.7, 9) |
| `legacy_standings` | Baseline table; the public app neither reads nor writes it |

**Stats, ratings and achievements**

| Table | Purpose |
|---|---|
| `battle_stats` | One row per Pokémon per game (4.9) |
| `aggregates` | Pre-computed Pokémon usage per scope (4.10) |
| `player_aggregates` | Pre-computed per-player usage |
| `aggregate_jobs` | Queue of aggregate deltas, applied atomically by `apply_aggregate_job` |
| `meta_usage_cache` | Imported Smogon usage per format |
| `smogon_sample_sets` | Imported Smogon sample sets |
| `player_ratings` | Current Glicko-2 rating per player |
| `rating_history` | Rating after each completed match; a player's history is replaced atomically (`rating_replace_player_history`) |
| `player_streaks` | Current and best win, loss, KO and flawless streaks |
| `player_achievements` | Unlocked achievements |
| `achievement_definitions` | Achievement catalogue |
| `player_signatures` | Signature Pokémon per player |

**Teams**

| Table | Purpose |
|---|---|
| `teams` | Tournament, planned and library teams (4.8, 7) |
| `match_prep_teams` | Plan Team editor saves (registered team for a match) |
| `team_roles` | Role categories for species and moves (matchup roles) |

**Drafts**

| Table | Purpose |
|---|---|
| `draft_pools` | Draft pools of both engines (4.11) |
| `draft_picks` | Picks (4.12) |
| `draft_pool_entries` | Legacy pool entries and their costs |
| `draft_pool_templates` | Reusable legacy pool templates |
| `draft_tier_limits` | Legacy per-tier pick limits |
| `draft_participants` | Queue engine: frozen seat order and per-player counters |
| `draft_slots` | Queue engine: the persisted pick queue |
| `draft_line_restrictions` | Queue engine: player and line pick restrictions |
| `draft_line_favorites` | Per-player favourite lines |
| `draft_action_log` | Append-only draft audit trail |
| `draft_replay_events` | Draft replay events for broadcast overlays |

**Evolution Point Buy**

| Table | Purpose |
|---|---|
| `point_buy_list_versions` | Immutable point-buy list snapshots |
| `point_buy_list_entries` | Lines of a point-buy list version |
| `format_rules` | Per-season format rules, initialised from the active format pack |
| `evolution_tracker` | Per player and line: stage, points, tokens, suspension |
| `evolution_tiers` | Per player and line: power tier and stage thresholds |
| `evolution_events` | Development-event log |
| `evo_progress_log` | Progress log of every point source |
| `epb_kill_credit_epochs` | Per-season counter fencing EvoLiga kill credits, debits and rebuild syncs (`20261021100100`) |
| `match_evolution_snapshots` | Tracker state per match appearance, written by the match evaluator (replaced only through `epb_replace_match_snapshots`) |
| `epb_animation_views` | Which evolution replays a player has seen |
| `epb_token_grants` | One-shot gate for token allocation |
| `epb_draft_token_purchases` | Draft Kill Token purchases |
| `epb_comeback_token_spends` | Comeback Token spends |
| `redraft_submissions` | Secret redraft drop submissions until publish |
| `redraft_slots` | Published redraft replacement slots |
| `redraft_history` | Redraft drops and their transfers |
| `redraft_trade_requests` | Read-only archive of the retired consented trades |

**AI**

| Table | Purpose |
|---|---|
| `ai_generations` | AI usage per player and endpoint (daily limits) |
| `match_analyses` | Stored post-match analyses |
| `match_prep_analyses` | Stored scouting reports |
| `tournament_reports` | Stored tournament reports |
| `agent_conversations` | AI agent conversations |
| `agent_suggestions` | Teams the agent proposed and the player's answer |
| `user_agent_profile` | Per-player agent preferences |

**Broadcast, community and avatars**

| Table | Purpose |
|---|---|
| `broadcast_moments` | Marked moments of a game (turn, Pokémon, type) for broadcasts |
| `broadcast_presets` | Saved overlay presets |
| `cast_sessions` | Cast Studio sessions |
| `wiki_notes` | Community notes on wiki entries |
| `wiki_note_reports` | Reports on community notes |
| `social_integrations` | Encrypted social publishing credentials |
| `discord_webhooks` | Discord webhook targets per scope with event filters |
| `avatar_generations` | AI avatar generation usage |
| `ai_avatar_gallery` | Generated avatar choices |
| `trainer_avatars_3d` | 3D trainer avatar configuration |

---

## 5. Route Map

App Router uses route groups: `(public)` (browse + NavBar), `(player)` (auth-required player tools + NavBar), `(broadcast)` (OBS overlays, no NavBar). URLs omit the group segment.

This map covers the main pages and the routes whose contracts the rest of the spec relies on; it is not a list of every route (the handlers under `src/app/` are). Every path written here exists: `scripts/__tests__/public-docs.test.mjs` resolves each literal page and `/api` path in this section to a `page.tsx` or `route.ts` (a literal segment matches only the same folder, so `/teams/library` never falls through to a dynamic `[id]`) and checks that every cron in `vercel.json` is listed.

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
                               Comeback Tokens (earned from completed matches inside the pack's
                               earn window, spent after the redraft or once the admin opens
                               spending), Participation-Token rules.
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
```

The Plan Team editor has no page of its own: `/dashboard/match-prep/[mid]` mounts `TeamsEditor` in `plan` mode (saves to `match_prep_teams` through `POST /api/match-prep`). Sharing and publishing start from the editor's dialogs; there is no "My Library" page.

### Public team pages (`(public)` group)
```
/teams/library                 Public team library — browse/search published teams
/teams/library/[id]            Published team detail with a fork button
/teams/shared/[token]          Public share link — read-only team view (only while the link is enabled)
```

### Admin pages
```
/admin                         Admin overview
/admin/leagues/new             Create league
/admin/leagues/[id]            League admin page in URL tabs (?tab=): Overview, Participants, Draft,
                               Phases (PhaseTimeline; the old ?tab=schedule opens it), Rules, Settings,
                               Danger zone; which tabs a format shows and what each holds: docs/admin.md
                               (League admin page)
/admin/leagues/[id]/phases/[phaseId]  Phase workspace: PhaseForm, SeedingTable, PhaseGroupsPanel, RoundManager
/admin/leagues/[id]/draft      Draft control panel: pools, config, start/abort, pause/resume, void
                               (always requeues) and correct picks (paused only), penalty stages,
                               redraft settings and publish ("automatic publish refused at <time>"
                               from draft_pools.publish_refused_at, admin only). Token balances and
                               the Comeback switch: the league admin page's Draft tab. No slot is
                               ever blocked or forfeited: every pick keeps the pool completable
                               (src/lib/draft/completability.ts + draft__pool_completable)
/admin/leagues/[id]/draft/audit  Read-only draft audit trail (draft_action_log)
/admin/tournaments/new         Create standalone tournament (no season_id)
/admin/tournaments/[id]/rounds Standalone tournament rounds (season-linked → redirect to phase page)
/admin/rulesets/new            Ruleset builder
/admin/rulesets/[id]/edit      Edit existing ruleset
/admin/matches                 Match list (server-side status / league / tournament / search filters in the
                               URL, paged with an exact total; League and Phase on each row)
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

**Admin tiers.** A site admin (`isAdmin`) sees every page. A resource admin
(a league or tournament admin in `resource_admins`) sees the competition pages
of the leagues and tournaments they administer: every page is wrapped in
`AdminGuard`; pages for one league, phase or tournament also call
`gateResourceAdmin` (`src/lib/auth/resource-gate.ts`) before any read and render
`ResourceForbidden` for anyone else; `siteAdminOnly` pages use `SiteAdminGuard`.
The scoped API routes below call `requireAnyAdmin` and narrow their reads with
`getAdminScope` (`src/lib/auth/admin-scope.ts`). Details: `docs/admin.md`.

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
GET  /api/admin/dashboard               Any admin: counts, attention queue, recent audit (a resource admin gets only
                                            their own leagues and tournaments, no site-wide counts or activity)
GET  /api/admin/matches                    Any admin, scoped: status, season_id, tournament_id, q, page (1-1000), page_size;
                                            returns an exact total
GET  /api/admin/matches/filter-options     Any admin, scoped: leagues with phases, and standalone tournaments
GET  /api/admin/player-search              Any admin (a resource admin names a season_id or tournament_id they
                                            administer; the scope is a guard, not a filter): public player refs
                                            only; a resource admin sees only active, non-test accounts (what the
                                            public directory shows), a site admin every account; `registered=1`
                                            keeps accounts with a login
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
GET  /api/players (admin)                    Player directory page: `limit`, `offset`, `search`, `sort` (name | discord_id |
                                            ps_username | status), `dir` (asc | desc); default name ascending; exact total
POST /api/players (admin)                   Create registered or guest (`is_guest: true`) players
POST /api/players/[id]/claim (admin)      Link Discord onto guest row (409 SOURCE_HAS_ACTIVITY if source has data; 409 SOURCE_NOT_ACTIVE if the source is banned or suspended)
POST /api/tournaments                       Rejects `season_id` — use phases API instead

POST /api/validate-team         Validate a team against a ruleset; returns issues with
                                stable issue_id for UI jump-to-slot

GET  /api/teams                 List teams (by tournament_id, player_id, or own)
POST /api/teams                 Create a team for a tournament (one per player per tournament)
GET  /api/teams/[id]            Get single team (with visibility redaction)
PATCH /api/teams/[id]           Update team pokemon (blocked when locked; 409 team_match_completed for a
                                non-admin when the row is linked to a completed match; admins correct)
DELETE /api/teams/[id]          Delete team (blocked when locked; admin can force; 409
                                team_match_completed for a non-admin on a completed match's row)

POST /api/teams/share           Owner/admin: mint a share link ({ teamId }); the only response carrying the token
DELETE /api/teams/share         Owner/admin: revoke the share link ({ teamId })
GET  /api/teams/shared/[token]  Public: read a team by an enabled share token (no auth; token must be a UUID)
POST /api/teams/library         Owner/admin: publish to the library ({ teamId, title?, description?, tags? })
DELETE /api/teams/library       Owner/admin: unpublish ({ teamId })
GET  /api/teams/library         Public: list published teams (paginated; search, tags)
GET  /api/teams/library/[id]    Public: one published team
POST /api/teams/library/fork    Player: copy a published team, or a shared one with its shareToken,
                                into the caller's roster ({ sourceTeamId, shareToken? })

POST /api/teams/ai/slot-coach   Player: AI suggestions for one slot (free text; per-player daily limit)
POST /api/teams/ai/team-coach   Player: AI commentary on the whole team (free text; per-player daily limit)

POST /api/locale                Public: set the language cookies ({ locale?, pkmnTerms? }; §17)

GET  /api/drafts/[id]/state     Draft snapshot (?since=state_version short-circuits)
GET  /api/drafts/[id]/my-turn   Turn watch (60 s, also while the draft-room tab is hidden)
POST /api/drafts/[id]/picks     Confirm a pick (a rule error returns a code and a fresh snapshot)
POST /api/drafts/[id]/extensions  Use a pick-clock extension
POST /api/drafts/[id]/free-order  Legacy pools, admins: switch a running snake/linear draft to free order (audited)
GET/PUT /api/drafts/[id]/redraft/submission  Own secret-drop submission
POST /api/drafts; PATCH …/config; POST …/{start,end,pause}; POST …/picks/[pickId]/{void,correct};
POST …/participants/[playerId]/penalty; GET …/audit;
PATCH …/redraft; POST …/redraft/publish   Admin draft controls (audited in draft_action_log)
GET  /api/seasons/[id]/tokens/me  Token overview; POST …/draft-kill-tokens, …/comeback-tokens/spend
GET  /api/point-buy-lists/[id]/search-index  Draft finder search index (immutable per list hash)
GET  /api/cron/draft-ticks      Cron (10 min): slow-draft timeouts, redraft auto-publish, Discord pings
                                (a failing pool is logged and skipped)
GET  /api/cron/auto-confirm     Cron (15 min): confirms due pending_confirmation matches (compare-and-set),
                                then heals completed matches whose finalize did not finish
                                (finalized_at IS NULL, older than 10 min; replay-safe steps only).
                                500 auto_confirm_partial_failure when any match failed
GET  /api/cron/process-aggregates  Cron (10 min): claims and applies queued aggregate jobs; 500 on a
                                failed claim or queue write, or when jobs are stranded
GET  /api/cron/expire-suspensions  Cron (15 min): lifts timed suspensions whose end has passed (one
                                audit event per player)
GET  /api/cron/refresh-usage-stats  Cron (monthly): re-imports Smogon usage stats and current-gen sample sets
```

Every cron route but refresh-usage-stats also accepts POST for a manual run; all require `Authorization: Bearer <CRON_SECRET>` (500 `cron_not_configured` when the secret is unset, 401 `cron_unauthorized` otherwise). Schedules: `vercel.json`.

**Request rate limits.** Public and auth routes that need a limit call `checkRateLimit` (`src/lib/utils/rate-limit.ts`): a fixed window per key in Postgres (`rate_limit_buckets`, one atomic `rate_limit_hit` call per check), so limits hold across serverless instances and cold starts. Keys are hashed; signed-in routes key on the player, public routes on the client IP, auth routes on IP and normalized email. A limiter failure is logged and fails open, except signup, forgot-password, resend-verification and the bootstrap secret (`POST /api/bootstrap` and the bootstrap-secret path of `POST /api/seed-rulesets`), which fail closed with 503 `rate_limit_unavailable`. AI routes keep their own per-player daily budget (`src/lib/ai/rate-limit.ts`). Details: `docs/security-patterns.md` (A04).

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
  4a. Hash the fetched log (replay_hash, src/lib/pkmn/replay-identity.ts); the winner and
      the stats below come from this same log (BoundReplay). A battle already bound to any
      game → 409 replay_already_recorded, nothing written (docs/match.md "Replay Binding")
  5. Write Game record to database (status: parsed), replay_hash in the same insert
  6. Write Battle Stats rows (one per Pokémon per player)
  7. Check if match Bo threshold reached (e.g. Bo3: someone at 2 wins)
     → If yes: set Match status = pending_confirmation, set winner
     → If no: set Match status = in_progress, await next game
  8. Trigger aggregate update:
     → Update Aggregates for tournament scope
     → Update Aggregates for parent league scope (if exists)
     → Update Aggregates for all_time scope
  9. Notify opponent to confirm (pending_confirmation state)
  EPB seasons: no evolution progress here. The game's real kills are credited
  when the match reaches completed (§8), once per game (games.evolution_applied_at).
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
  EPB seasons: no evolution progress here either (credited at completion, §8)
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

### 6.4a League groups: schedule and standings

A league may split its trainers into league groups (`season_groups`, `season_group_members`; schema and draft engine in
`supabase/migrations/20261018180000_league_groups.sql`, see [draft-room.md](./draft-room.md)). A league without groups behaves exactly
as before: no phase group mirrors anything, no cross-group week exists and every table is the season table it always was.

- **Phase groups mirror league groups.** A table phase (round robin, Swiss) of a grouped league builds its `tournament_groups` from the
  league groups (`season_group_id` set; members = the league group's trainers enrolled in the phase, in enrollment order) before its
  first round (`ensurePhaseGroupsFromLeague`, `src/lib/tournament/group-rounds.ts`, called by `generate-round`, `generate-all-rounds` and
  the manual round route; a manual round in a round robin phase of a grouped league is refused, **409** `rounds_manual_league_grouped`,
  since it would skip the week plan).
  Once the phase has a round its groups are never rewritten. An enrolled trainer in no league group is refused (**409**
  `PHASE_PLAYER_WITHOUT_LEAGUE_GROUP`). The phase editor's regenerate, delete and member move answer **409**
  `PHASE_GROUPS_LEAGUE_MANAGED` (change the groups in the league's Participants tab instead).
- **Membership is final once a phase has a round** (`20261018202000_league_groups_locks.sql`,
  `20261018202100_league_groups_participant_lock.sql`): re-splitting, removing, a new group, a move and a first placement answer
  **409** `SEASON_GROUPS_SCHEDULED`; renames and substitutions stay possible. The roster follows the same lock: adding a trainer to a
  grouped league that has a round is refused (**409** `SEASON_GROUPS_SCHEDULED`; a replacement uses the substitution flow), and
  removing a trainer who holds a group is refused while that group has any non-cancelled draft pool or the trainer holds lines drafted in it (**409** `SEASON_GROUP_LOCKED`;
  the admin cancels a setup pool first). Every group keeps at least two trainers (**422** `SEASON_GROUP_TOO_SMALL`), a split places every participant
  (`SEASON_GROUP_MEMBERS_INVALID`), names are unique per league ignoring case, and a trainer whose group's pool is drafting cannot be
  substituted (**409** `SEASON_GROUP_SUBSTITUTION_LOCKED`: the substitution checks it before its first write, the preview included;
  the membership trigger refuses the roster swap if a draft started meanwhile). A league-scope substitution moves the league group
  slot with the roster row; a phase-scope substitution moves only the phase slot, so in a phase whose groups mirror league groups the
  incoming trainer must already be in the mirrored league group (**409** `SUBSTITUTE_LEAGUE_GROUP_MISMATCH`, checked before the
  first write, the preview included): the phase groups and the league groups never diverge.
- **The roster follows the membership lock** (lead ruling round 5). In a grouped league, adding a trainer once a phase has a round
  is refused (**409** `SEASON_GROUPS_SCHEDULED`; a replacement uses the substitution flow), and removing a trainer who holds a group
  (`season_participant_remove`, `20261018202100_league_groups_participant_lock.sql`) is refused once scheduled (**409**
  `SEASON_GROUPS_SCHEDULED`), while the group has any non-cancelled pool, setup included, or the trainer holds lines drafted in it
  (**409** `SEASON_GROUP_LOCKED`: the admin cancels a setup pool first), and when the group would keep fewer than two trainers
  (**422** `SEASON_GROUP_TOO_SMALL`). Details: [season.md](./season.md#league-groups-schedule-and-standings).
- **Weeks.** `round_number` is the week, shared phase-wide. Each group plays its own single round robin (circle method) with its own round
  count; a smaller group rests in the remaining in-group weeks. This also holds for phase-only groups (no cross play), so a 7+6 split no
  longer fails half-way. Every week is planned and validated before the first one is written.
- **Cross-group play** (groups that mirror league groups; deterministic, no randomness; `planGroupSchedule`,
  `src/lib/tournament/group-schedule.ts`). Per half, every trainer gets the same number of cross matches where possible (target 2):
  1. in every in-group week the trainers without an in-group match (the bye of an odd group, every member of a resting group) meet across
     groups, paired by seed, preferring opponents not met yet;
  2. trainers still short get dedicated cross weeks, paired across groups by mirrored seeds (a week is added only while two short trainers
     of different groups can meet; an odd total leaves one trainer short, who is served first next half; such a week can hold a single
     match when exactly two trainers are short, e.g. 3+3 week 6);
  3. the last week of each half is the placement week: the same-placed trainers of different groups meet, by the group tables after the
     previous week. It is paired only when it is generated, once every earlier match is completed (**409**
     `rounds_group_placement_not_ready` before). `generate-all-rounds` writes up to the next placement week and stops; its next call
     writes the placement week and continues. With three or more groups a trainer prefers a same-placed trainer not met yet; with two
     groups each place has one candidate, so a rematch of an earlier cross pairing is allowed (5+5 week 4).
  Both generate routes take the weeks to write from the plan (weeks without a round, and written rounds without matches), never from
  `tournaments.current_round`.
  The in-group rounds are split between the halves so the first half is exactly the first `floor(weeks / 2)` weeks: the Hinrunde stays
  "the first half of the phase's weeks". Examples: 7+7 → 11 weeks (Hinrunde 1-5), 6+6 → 9 (1-4), 5+5 → 9, 4+4+4 → 7, 7+6 → 11; a single
  group is the plain round robin. Balance limit: rule 1 pairs every trainer without an in-group match, so with unequal groups the members
  of a smaller (resting) group get more cross matches than the others; equal counts per half hold for equal groups (7+7, 6+6, 5+5,
  4+4+4) and are approximate otherwise (cross matches per trainer, placement included: 7+6 0-2 in the first half, 1-3 in the second).
  Both limits are accepted by design: a dedicated cross week with a single match (3+3) is fine, and for unequal groups balanced total
  match counts matter more than equal cross counts, so cross play stays "where possible"; the combined table's points per match keeps
  the ranking fair while match counts differ.
  A week's round and its matches are two writes: a grouped week whose round exists without matches is filled by the next generation.
- **Standings.** A group table counts all of its members' matches, cross-group matches included: one table over every trainer (format
  tiebreaks, one season context), split per group, so tiebreaks are unchanged (`src/lib/tournament/group-standings.ts`). The combined
  table holds every trainer and ranks by points per match while match counts differ, else by points. Per-group advancement
  (`advancement_rule.per_group`) uses the same group tables. These tables, the placement week and the per-group Redraft order rank
  without kill difference (no battle stats are read for them, like the season table); the hub's Group stage tab ranks round-robin
  phase groups with kill difference, so on a points tie the two can differ (not yet unified). The league hub's standings tab and the world payload
  (`WorldRouteData.groupStandings`, `standingsRanking`; absent without groups) show the group tables first and the combined table below.
- **Hinrunde per group** (for the per-group redraft order): `getGroupFirstHalfTables(seasonId)` (`src/lib/tournament/group-first-half.ts`)
  returns each league group's table over the primary phase's weeks `1..floor(weeks / 2)` from the phase's plan, not from the rounds written
  so far (generation stops in front of each placement week), best first (`computeRedraftSeats` reverses it into the worst-first seats);
  `getGroupedPhaseWeekPlan(phaseId)` gives the planned week count. The EPB Hinrunde gate (`getEpbPhaseStatus`, `getHinrundeScope`)
  uses the same planned boundary for such a primary phase, and the Hinrunde counts as complete only when every week
  `1..floor(weeks / 2)` is written and completed. A primary stage without league groups keeps the first half of its written rounds.
  The league hub shows a league with a single league group as one table.

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

Team-level routes and pages (`GET /api/teams?tournament_id=`, `GET /api/teams/[id]`, the public league team pages) apply this per team row (`src/lib/team/visibility.ts`): `match` is the match the row is linked to (`teams.match_id`). A planned row (no `match_id`) stays hidden from everyone but its owner and admins, even after its owner completed other matches. A tournament with `team_visibility = always_public` and a team published to the library are visible to everyone. Every team response is the `PublicTeam` allowlist (`src/lib/team/public-team.ts`): `share_token` and `share_enabled_at` reach only the owner, through the share route's own response.

A row linked to a **completed** match is final: its roster is public, feeds the aces, item usage and EPB participation, so a non-admin's `PATCH` or `DELETE /api/teams/[id]` answers **409** `team_match_completed` (the teambuilder library save included) and a participant's `POST /api/match-prep` answers **409** `match_prep_match_completed`. The database enforces the same rule (trigger `teams_completed_match_lock`, `supabase/migrations/20261019120000_teams_completed_match_lock.sql`), so no other write path can bypass it; a site admin's correction goes through the service-role functions `team_correct_update` / `team_correct_delete`.

The public league world's ace tiles (`buildWorldRouteData`, a cached anonymous payload) apply the same rule with no viewer: a team's lead names an ace only when the row is linked to a completed match or belongs to an `always_public` tournament (`selectAnonymousVisibleLeads`). The read (`listSeasonTeamLeadsWithFacts`) covers the season's own rows and its stages' rows, where a played match's team is stored, so a `hidden_until_match` league shows the aces of its completed matches and never a planned roster's lead. Library publication is deliberately not an ace term: it makes the roster visible (table above), but the aces show what the league's matches put on the field, so a published planned team stays out of them.

Match-scoped surfaces (the broadcast preview, the battle tracker, caster data and the cheat sheet, cast populate, the AI match context and the published round forecasts, and the match-prep rosters that pre-fill the submit-result form at `/dashboard/submit/[mid]`) decide each side against that match's own status (`decideMatchRosterVisibility`): before the match is completed a participant sees only their own roster, a creator sees none, an admin sees both; a hidden side is redacted (or left empty where it pre-fills a form). Role grants on these views come from the live player row (`getLiveAccess()`), never the session copy. Each hidden team gets its own redacted array (`redactedPokemon()`).

### Share Link Visibility

Teams with an enabled share link (`share_token` and `share_enabled_at` both set) are accessible via `GET /api/teams/shared/[token]` and the page `/teams/shared/[token]` without authentication. The share token is an unguessable UUID v4 and is the only authorization; it is never part of a response other than the owner's `POST /api/teams/share`. When accessed via this path, the full `pokemon` array is always returned (no redaction). Owners revoke the link with `DELETE /api/teams/share`.

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

**Evolution progress follows the confirmed result** (EPB seasons). A game's real kills reach the evolution trackers only when its match enters `completed` (opponent confirm, auto-confirm timeout, admin dispute resolution), in the finalize step `epb_real_kills` that runs before the EPB matchday hooks; `pending_confirmation` and `disputed` results move no tracker. Each game is credited exactly once (`games.evolution_applied_at`, §4.6), so the finalize heal and a re-confirm never count it twice. A game edit that moves a completed match back debits its credited kills (the next completion credits the edited stats); a game delete, match reset or season reconcile rebuilds the season from its completed matches and re-syncs the markers. Aggregates are unaffected: they are still counted at submission.

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

An empty block carries no rule, so the ruleset builder and `createRuleset` store
it as `null` (`normalizeTeamConstraints` in `src/lib/pkmn/team-constraints.ts`)
instead of `{}`. `isCustomLeagueRuleset` is unchanged: a ruleset whose stored
`team_constraints` is already an empty object still counts as a custom league
ruleset and resolves as before. `updateRuleset` writes the value it is given, and
the builder keeps an untouched stored empty object as it is; only a new ruleset,
or turning the toggle off, yields `null`.

The constraint engine is implemented in `src/lib/pkmn/validation.ts`
(`validateTeam(team, ruleset, ctx)`), with `ctx.playerCore` populated from
`season_participants.core_types` when validating a team for a Core Liga
tournament; the core check itself is `validateTeam`'s core-triple branch in
the same file.

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

#### AI panel

Two tabs (`src/components/teambuilder/v3/ai/AiPanel.tsx`):
1. **Assistant** (default): the tool-using agent, `POST /api/ai/agent/chat` with the teambuilding persona; it edits the team through the typed `EditorCommandApi` (`docs/ai-agent.md`).
2. **Coach**: single-shot suggestions on demand, as free text: one slot (`POST /api/teams/ai/slot-coach`) or the whole team (`POST /api/teams/ai/team-coach`). Nothing runs automatically and nothing is applied with one click. Limited per player and endpoint by `src/lib/ai/rate-limit.ts` (`AI_DAILY_LIMIT`, default 10 per rolling 24 hours).

Match-level scouting is not part of the panel: it lives on the match-prep page (`POST /api/ai/match-prep-analysis`, or the agent's `analyze-match` when `NEXT_PUBLIC_AGENT_MATCH_ANALYSIS` is on; `docs/deprecations.md`). A monotype co-pilot tier was designed but never built and is not part of this spec.

#### Public surfaces

- **Share link** (`/teams/shared/[token]`): unguessable UUID v4; always shows the full team while the link is enabled; the owner can revoke it (`DELETE /api/teams/share`).
- **Public library** (`/teams/library`, detail `/teams/library/[id]`): opt-in publishing with title/description/tags from the editor; browseable and searchable; fork copies the team to the forker's roster.
- There is no "My Library" page; unpublishing is `DELETE /api/teams/library`.

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

// Sprites: never build a URL by hand; resolve through the sprite-style module
import { spriteResolver, siteSpriteUrl } from '@/lib/pkmn/sprite-styles'
const urls = spriteResolver.candidates('Rotom-Wash', 'pixel') // pixel, then HOME, then base form, then placeholder
const overlayUrl = siteSpriteUrl('Garchomp') // viewerless: the site default
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

`.env.example` is the complete, commented list; README section 3 explains each required variable. This section names the variables the spec itself relies on. Every literal variable here is an `.env.example` key (`scripts/__tests__/public-docs.test.mjs`).

```bash
# Required: the app boots and the core flows work
NEXT_PUBLIC_SUPABASE_URL=          # http(s) URL of the project or the local stack
SUPABASE_SERVICE_ROLE_KEY=         # server only
NEXT_PUBLIC_SUPABASE_ANON_KEY=     # Realtime broadcasts in the browser; email/password sign-in on the server
NEXTAUTH_SECRET=
NEXTAUTH_URL=
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
CRON_SECRET=                       # every /api/cron/* route (Bearer token)
BOOTSTRAP_SECRET=                  # one-time first-admin and ruleset seeding

# Recommended
NEXT_PUBLIC_SITE_URL=              # canonical and Open Graph origin
SUPERADMIN_DISCORD_ID=             # the operator account, admin on every request
SUPERADMIN_EMAIL=

# Build
FORMAT_PACK=                       # unset | example | private (docs/format-packs.md, Choosing the Active Pack)

# AI (optional)
CLAUDE_API_KEY=
AI_DAILY_LIMIT=10                  # per player and AI endpoint, rolling 24 h (teambuilder coaches, analyses, reports)
AGENT_DAILY_LIMIT=20               # per player, the agent chat
```

Validation (`src/lib/env.ts`): a module validates the group of variables it reads with `readEnv` and a zod schema per group (the service-role client and the Discord provider when they load, the GoTrue client per request), and one error lists every missing or invalid key of the group by name, never by value. Empty and whitespace-only values count as missing. Single request-time reads use `requireEnv`. A route whose own secret is missing answers 500 with a distinct code (`cron_not_configured`, `bootstrap_not_configured`).

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
      lock, `state_version` polling), live and slow modes, pick-clock extensions, admin pause, make-up slots, quiet hours, pool completability (no blocked or forfeited slot),
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

5. **Aggregate updates are always triggered.** Any function that writes to `Battle Stats` or `Games` must enqueue the game's aggregate job (`enqueueAggregateJob`) as part of the same operation; `apply_aggregate_job` applies the deltas (`buildGameAggregateDeltas`) together with the game's `aggregate_applied_at` marker in one transaction, and an admin change rolls a counted game back through `rollback_game_aggregates`. Never write stats without queueing their aggregates.

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

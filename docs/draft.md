# Draft Module

## Overview
The Draft module handles draft pool lifecycle, pick validation/order, and evolution-league progression checks. Deleting a league freezes its running queue drafts and moves them to the league trash; a restore brings them back **paused** with every deadline shifted by the time spent in the trash ([Season, League recycle bin](./season.md#league-recycle-bin), [Draft Room](./draft-room.md)).

## File Structure
```
src/lib/draft/
├── engine.ts  # Draft order/state/validation helpers
├── evolution-engine.ts  # Evolution progression + evo-league helpers
├── schemas.ts  # Request schemas of the queue-engine draft, redraft and token routes
├── errors.ts  # Client-safe draft error contract
├── rpc-errors.ts  # Draft RPC error glue (server)
├── http.ts  # Draft route responses (server)
├── snapshot.ts  # Draft snapshot glue (server)
├── sql-fallbacks.ts  # Literal fallbacks of the applied draft RPCs, mirrored for the app
├── completability.ts  # Pool completability gate (twin of draft__pool_completable)
├── draftability.ts  # Viewer draftability
├── poller-state.ts  # Poller lifecycle machine (client.visible_poller) and pollOutcomeForPool
├── time.ts  # League time helpers and quiet hours (TS mirror of the SQL clock)
├── use-visible-poll.ts  # Visibility-aware poller of the live draft screens
├── notify.ts  # Draft-tool Discord notifications
├── tokens.ts  # Draft token rules
├── pool-status-state.ts, pool-phase-state.ts, slot-state.ts, token-window-state.ts  # State machines: legacy pool status, queue phase (+ pause, Redraft submission window), slot status, Draft Kill Token window (docs/state-machines.md)
├── budget.ts  # Draft budget rules
├── points-limits.ts  # Point limits of the legacy (pre-queue) engine
├── roster-split.ts  # Can a fixed-price pool list fill every roster
├── seat-draw.ts  # Random opening order of a queue draft (server)
├── redraft-engine.ts, redraft-order.ts  # Redraft helpers and redraft seat order
├── pool-format.ts  # A pool's two setup axes: turn order and pricing
├── pool-roster.ts  # The players a queue pool seats (server)
├── pool-entry-names.ts, pool-entry-sync.ts  # Same-Pokémon detection of the pool-entry writers
├── player-pool.ts  # A trainer's initial draft pool in a league
├── price-tabs.ts, utility-categories.ts  # Draft finder price tabs and utility categories
├── public-pick.ts  # The public shape of a draft pick
├── epb-team-validation.ts, epb-thresholds.ts  # EPB team validation and season line thresholds
├── evolution-points-engine.ts  # Evolution-point accounting of EPB seasons
├── point-buy-engine.ts, point-buy-pool.ts  # Point-buy format functions and tracker-to-list-line matching
├── progress-engine.ts, progress-sources.ts  # Evolution progress engine and its sources
├── league-overrides.ts  # League-level threshold overrides on the imported point-buy list
├── line-catalog-data.ts, line-identity.ts  # Line catalog data and the draft line identity
├── special-rules.ts, special-rules-text.ts  # Per-line rulings and their prose
├── reconciliation-report.ts  # EPB list reconciliation report
└── utility-matches.server.ts  # Stage-specific utility matches of a line (server)
```

## Core Functions/Classes

### Draft Engine
- **File**: `engine.ts`
- **Purpose**: Compute and validate draft state transitions
- **Key Methods**: `computeDraftState()`, `validatePick()`, `generateSnakeOrder()`, `isDraftComplete()`

### Evolution Engine
- **File**: `evolution-engine.ts`
- **Purpose**: Track and validate evolution-league state
- **Key Methods**: `checkEvolutions()`, `checkPlayerEvolutions()`, `validateEvoLeaguePick()`, `isEvoLeague()`

## Data Flows
- **Input**: Draft pool, existing picks, participant list, season evolution rules
- **Processing**:
  1. Compute current picker/order/rosters
  2. Validate pick legality (turn, duplicates, budget, tiers)
  3. Persist pick and emit downstream events
  4. Recompute evolution progression where applicable
- **Output**: Updated draft picks/state and optional evolution events

### Legacy draft: the roster is frozen
A legacy pool (`draft_pools.engine = 'legacy'`, every league that is not Evolution Point Buy) stores no seats. Every request recomputes the seat order (`legacySeatOrder`), the round, the current picker and the pick total from the **current** roster, so a trainer who joins or leaves mid-draft moves everybody's turn and the pool can skip or double-ask a trainer, jump rounds, or complete early or never (pinned by the `computeDraftState — a roster that changes mid-draft` cases in `engine.test.ts`). While the league's legacy pool has status `in_progress`, adding, removing or substituting a trainer is therefore refused with **409** `SEASON_DRAFT_LOCKED` (`season_participant_remove`, the INSERT trigger `season_participants__group_guard`, and `assertLegacyDraftNotRunning` in `src/lib/season/substitute.ts` for a league-scope substitution, preview included; migration `20261102140000_legacy_draft_roster_lock.sql`). Two triggers of `20261102150100_legacy_draft_roster_lock_serialize.sql` close the races: a legacy pool entering `in_progress` takes the season's advisory lock (the one every roster write holds while it checks; a join, removal and substitution take it before they read anything, for every league), and the substitution's roster UPDATE is refused with the same code under that lock, so a draft that starts between a route's read and its write cannot leave a live draft on a changed roster. There is no override: end the draft (free order, then complete) or move the pool back to `pending` first. `pending` and `complete` pools, leagues without a pool, Evolution Point Buy queue pools (their seats live in `draft_participants`) and a league delete or its recycle-bin restore are unaffected. Stored seats for legacy pools are a possible later step, not part of this rule.

### Legacy draft: one canonical name per pick
`POST /api/drafts/[id]/picks` on a legacy pool stores the pool entry's spelling (for a wildcard pick the tier's `base_pokemon`, found among the picker's own wildcards by the same fold: `eevee` and `Eevee` are the same wildcard), never the client's. A pool's picks are read in full (`getPicksByPool` pages past the 1,000 row cap), so a draft of 21 trainers over 50 rounds completes. Whether a species is taken, and whether it is in the pool, is decided on its id (`toID`, the TS twin of `epb_fold_id`): `Mr. Mime`, `mrmime` and `MR MIME` are one species, and a second pick of it answers 400 `POKEMON_TAKEN`. A league with no pool entries checks the name against the National Dex (`getNationalSpecies`, the season ruleset's generation, 9 without one) and stores the dex's name; an unknown name answers 400 `UNKNOWN_SPECIES`. The pick body no longer takes `stage3_pokemon` (the key is ignored). `uq_draft_picks_legacy_name_live` (migration `20261102140100_legacy_pick_name_unique.sql`) enforces the same fold in the database for live picks without a `line_id`; the migration refuses to run while a pool already holds a duplicate.

### Legacy draft: rounds
A legacy pool plays `resolveTotalRounds` rounds: the stored exact team size when there is one, else 11 (`LEGACY_ROUNDS.default` in `src/lib/draft/points-limits.ts`, with the accepted range 1 to 50). `POST /api/drafts` stores a `rounds` of the body as `team_size_mode = 'exact'` and `team_size_exact` (no migration: the columns exist) and checks the fixed-price budget against those rounds in every pick order, free included (`draft_budget_below_rounds`; when the season already has a pool list the check is pool-wide, because every entry goes to one trainer only: fewer entries than `trainers × rounds` is `draft_pool_list_too_small`, and the cheapest `trainers × rounds` entries (each at its own price or the default) costing more than the trainers' budgets together is `draft_budget_below_listed_rounds`, and prices that cannot be dealt into `trainers` rosters of `rounds` Pokémon within the budget (`splitIntoRosters`, a bounded search) are `draft_budget_list_unassignable`, and a search that runs out of nodes before it finds a split is `draft_budget_list_unverifiable`: a pool is created only on a found split; the roster and later list edits are not seen at creation), against 11 when `rounds` is omitted. The admin create form (`DraftPoolManager`) has a Rounds field (default 11) and sends `rounds` only when it differs, so an untouched form creates the pool it always did. A point-buy league maps `rounds` to the queue pool's roster size. `name` and `pool_template_id` are refused, because a pool has neither.

### Legacy draft: concurrent picks and failures after the insert
A legacy pick is inserted as the pool's next `pick_number`, and `uq_draft_picks_pool_number_live` lets only one of two simultaneous requests win. The route tells the two unique indexes apart by name and logs the original error. On the Pokémon index the loser gets 400 `POKEMON_TAKEN`. On the pick-number index it re-reads the picks once and re-validates: a precise refusal (`NOT_YOUR_TURN`, `POKEMON_TAKEN`, `DRAFT_COMPLETE`, `draft_roster_full`) wins; if the pick is still legal it answers **409** `PICK_CONFLICT` and the client reloads and tries again. Once the insert has committed, a failing evolution tracker (an existing tracker counts as created) or a failing `complete` flip no longer turns the answer into a 500: the response is 201 with `warnings: ['TRACKER_NOT_CREATED' | 'POOL_COMPLETION_PENDING']` and a log line. A pool still `in_progress` with every pick made is completed by the next `GET /api/drafts/[id]/state` (conditional on the pool still running). `DraftBoard` shows each warning in a notice (`PickWarnings`) that says the pick stands and must not be repeated; the notice stays until the next pick. The board's status bar shows `Round r of N · Pick #p` while the draft runs (`N` is the state's `total_rounds`; an older server without it falls back to `Round r · Pick #p`). A `complete` pool has no next pick, so its counter would read `Round 7 · Pick #13` on a finished 6-round draft of two players; the bar shows `Draft complete · N rounds · M picks` instead (`M` = the picks made, so an ended-early draft reports what was picked).

A pool list names each Pokémon once by id: the unique index `uq_draft_pool_entries_season_folded_name` (`20261102150200_draft_pool_entries_folded_name_unique.sql`, `epb_fold_id` over `pokemon_name`; the migration aborts on existing duplicates) refuses a name that differs from a listed one only in case, spaces or punctuation, and the pool-entry writers (`POST /api/draft-pool-entries` single and bulk, the evolution tier auto-sync) answer its 23505 as **409** `pool_entry_duplicate_name`. The picks route folds names the same way, so such an entry would count toward the pool's size without ever being pickable. The auto-sync compares by id before it writes. Its batch insert is all-or-nothing, so after a duplicate refusal (a concurrent writer listed one of the names first) it writes each missing entry on its own and verifies the final list (`syncPoolEntries`, `src/lib/draft/pool-entry-sync.ts`); an entry that is still not listed makes the bulk `POST /api/evolutions` answer **500** `evolution_pool_sync_incomplete` (the tiers are saved; the error names the entries to add by hand) instead of 201.

## Dependencies
- **External Libraries**: None
- **Internal Modules**:
  - [PKMN Module](./pkmn.md)
  - [Tournament Module](./tournament.md)
  - [Discord Module](./discord.md)
  - [Social Module](./social.md)
  - [Supabase Module](./supabase.md)

## API Routes
- `/api/drafts`
- `/api/drafts/[id]`
- `/api/drafts/[id]/picks`
- `/api/drafts/[id]/state`
- `/api/drafts/[id]/undo`
- `/api/drafts/[id]/replay-events`
- `/api/draft-pool-entries`
- `/api/draft-pool-entries/[id]`
- `/api/draft-pool-templates`
- `/api/draft-pool-templates/[id]`
- `/api/draft-tier-limits`
- `/api/evolutions`
- `/api/evolutions/[id]`
- `/api/evolutions/trackers`

## Usage Examples

```typescript
import { computeDraftState, validatePick } from '@/lib/draft/engine';

const state = computeDraftState(pool, picks, participantIds, rounds);
const error = validatePick(state, input, true);
```

## Testing
- **Test Files**: `src/lib/draft/__tests__/` (70 test files; `fixtures/` holds the vector files). Engines and rules: `engine.test.ts`, `budget.test.ts`, `points-limits.test.ts`, `roster-split.test.ts`, `tokens.test.ts`, `redraft-engine.test.ts`, `redraft-order.test.ts`, `seat-draw.test.ts`, `completability.test.ts`, `draftability.test.ts`, `quiet-hours.test.ts`, `time.test.ts`. Evolution Point Buy: `epb-*.test.ts`, `evolution-engine.test.ts`, `point-buy-*.test.ts`, `progress-*.test.ts`, `line-*.test.ts`, `special-rules*.test.ts`, `reconciliation-report.server.test.ts`. Glue: `schemas.test.ts`, `errors.test.ts`, `http.test.ts`, `rpc-errors.test.ts`, `snapshot*.test.ts`, `notify*.test.ts`, `use-visible-poll.test.ts`. Migrations and SQL twins: nine `*-migration.test.ts` files read the migration text, `pool-phase-state-sql.test.ts` and `token-window-state.test.ts` hold the draft state machines equal to the latest definition of each RPC (`sql-function-body.ts` reads it), and eight `*.local.test.ts` / `*.live-db.test.ts` files run only against a local stack (`npm run test:db`, [`AGENTS.md`](../AGENTS.md) "Automation never spends the Supabase quota").
- **Testing Approach**: Pure unit tests of the engines, SQL-text tests of the migrations, local-stack tests of the RPCs, and the route tests of `src/app/api/drafts/` for the end-to-end flow.

## Related Modules
- [PKMN Module](./pkmn.md)
- [Tournament Module](./tournament.md)
- [Supabase Module](./supabase.md)

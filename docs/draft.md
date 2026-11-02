# Draft Module

## Overview
The Draft module handles draft pool lifecycle, pick validation/order, and evolution-league progression checks. Deleting a league freezes its running queue drafts and moves them to the league trash; a restore brings them back **paused** with every deadline shifted by the time spent in the trash ([Season, League recycle bin](./season.md#league-recycle-bin), [Draft Room](./draft-room.md)).

## File Structure
```
src/lib/draft/
├── engine.ts  # Draft order/state/validation helpers
└── evolution-engine.ts  # Evolution progression + evo-league helpers
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
`POST /api/drafts/[id]/picks` on a legacy pool stores the pool entry's spelling (for a wildcard pick the tier's `base_pokemon`), never the client's. Whether a species is taken, and whether it is in the pool, is decided on its id (`toID`, the TS twin of `epb_fold_id`): `Mr. Mime`, `mrmime` and `MR MIME` are one species, and a second pick of it answers 400 `POKEMON_TAKEN`. A league with no pool entries checks the name against the National Dex (`getNationalSpecies`, the season ruleset's generation, 9 without one) and stores the dex's name; an unknown name answers 400 `UNKNOWN_SPECIES`. The pick body no longer takes `stage3_pokemon` (the key is ignored). `uq_draft_picks_legacy_name_live` (migration `20261102140100_legacy_pick_name_unique.sql`) enforces the same fold in the database for live picks without a `line_id`; the migration refuses to run while a pool already holds a duplicate.

### Legacy draft: rounds
A legacy pool plays `resolveTotalRounds` rounds: the stored exact team size when there is one, else 11 (`LEGACY_ROUNDS.default` in `src/lib/draft/points-limits.ts`, with the accepted range 1 to 50). `POST /api/drafts` stores a `rounds` of the body as `team_size_mode = 'exact'` and `team_size_exact` (no migration: the columns exist) and checks the fixed-price budget against those rounds in every pick order, free included (`draft_budget_below_rounds`; when the season already has a pool list the check is pool-wide, because every entry goes to one trainer only: fewer entries than `trainers × rounds` is `draft_pool_list_too_small`, and the cheapest `trainers × rounds` entries (each at its own price or the default) costing more than the trainers' budgets together is `draft_budget_below_listed_rounds`, and prices that cannot be dealt into `trainers` rosters of `rounds` Pokémon within the budget (`splitIntoRosters`, a bounded search that refuses only on a proof) are `draft_budget_list_unassignable`; the roster and later list edits are not seen at creation), against 11 when `rounds` is omitted. The admin create form (`DraftPoolManager`) has a Rounds field (default 11) and sends `rounds` only when it differs, so an untouched form creates the pool it always did. A point-buy league maps `rounds` to the queue pool's roster size. `name` and `pool_template_id` are refused, because a pool has neither.

### Legacy draft: concurrent picks and failures after the insert
A legacy pick is inserted as the pool's next `pick_number`, and `uq_draft_picks_pool_number_live` lets only one of two simultaneous requests win. The route tells the two unique indexes apart by name and logs the original error. On the Pokémon index the loser gets 400 `POKEMON_TAKEN`. On the pick-number index it re-reads the picks once and re-validates: a precise refusal (`NOT_YOUR_TURN`, `POKEMON_TAKEN`, `DRAFT_COMPLETE`, `draft_roster_full`) wins; if the pick is still legal it answers **409** `PICK_CONFLICT` and the client reloads and tries again. Once the insert has committed, a failing evolution tracker (an existing tracker counts as created) or a failing `complete` flip no longer turns the answer into a 500: the response is 201 with `warnings: ['TRACKER_NOT_CREATED' | 'POOL_COMPLETION_PENDING']` and a log line. A pool still `in_progress` with every pick made is completed by the next `GET /api/drafts/[id]/state` (conditional on the pool still running). `DraftBoard` shows each warning in a notice (`PickWarnings`) that says the pick stands and must not be repeated; the notice stays until the next pick.

A pool list names each Pokémon once by id: the unique index `uq_draft_pool_entries_season_folded_name` (`20261102150200_draft_pool_entries_folded_name_unique.sql`, `epb_fold_id` over `pokemon_name`; the migration aborts on existing duplicates) refuses a name that differs from a listed one only in case, spaces or punctuation, and the pool-entry writers (`POST /api/draft-pool-entries` single and bulk, the evolution tier auto-sync) answer its 23505 as **409** `pool_entry_duplicate_name`. The picks route folds names the same way, so such an entry would count toward the pool's size without ever being pickable. The auto-sync compares by id before it writes.

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
- **Test Files**: No dedicated `src/lib/draft/__tests__` files currently
- **Testing Approach**: API route and end-to-end draft flow testing

## Related Modules
- [PKMN Module](./pkmn.md)
- [Tournament Module](./tournament.md)
- [Supabase Module](./supabase.md)

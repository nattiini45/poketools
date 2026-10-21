# Reconcile Module

> Rebuilds match-derived data (ratings, aggregates, streaks, EPB evolution) after resets, deletes, or drift — verify (dry-run) and repair (write) season derived state.

## Overview
The Reconcile module recomputes values that are *derived* from raw rows (matches → games → battle_stats) but are not cascade-deleted when those rows are reset or removed. It is the shared repair engine behind three kinds of operations:

1. **Match/round reset** — soft "undo" paths in the game pipeline call the same rebuilders (ratings, aggregates, streaks, EPB evolution) to leave the league as if the games never happened.
2. **Entity hard-delete** — deleting a tournament or season clears/re-orphans aggregate scopes and rebuilds ratings, streaks, and (when the season survives) EPB evolution state.
3. **Season audit/repair** — an admin-only dry-run-or-repair orchestrator that diffs stored vs. computed derived data and reports mismatches.

Everything is idempotent and re-runnable: each rebuilder recomputes from authoritative sources (matches, battle_stats, non-match grants) rather than applying deltas.

## File Structure
```
src/lib/reconcile/
├── entity-delete-rebuild.ts  # Derived-data rebuild after tournament/season hard-delete
├── evolution-rebuild.ts      # Chronological EPB evolution rebuild engine (spec §20)
├── reconcile-season.ts       # Season derived-data orchestrator: verify + repair (spec §22)
└── __tests__/
    ├── entity-delete-rebuild.test.ts
    ├── evolution-rebuild.test.ts
    ├── reconcile-season-serialize.test.ts
    └── reconcile-season.test.ts
```

## Core Functions/Classes

### Entity Delete Rebuild
- **File**: `entity-delete-rebuild.ts`
- **Purpose**: Rebuild/clear derived data after a tournament or season is hard-deleted
- **Key Functions**: `rebuildAfterTournamentDelete()`, `rebuildAfterSeasonDelete()`
- **Result type**: `EntityDeleteRebuildSummary`

### EPB Evolution Rebuild Engine
- **File**: `evolution-rebuild.ts`
- **Purpose**: Recompute evolution trackers by replaying EPB sources in chronological order; mirrors (never re-invents) the pure EPB primitives
- **Key Functions**: `computeEvolutionStateCore()`, `computeSeasonEvolutionState()`, `diffEvolutionState()`, `applyComputedEvolutionState()`, `repairSeasonEvolution()`
- **Key Types**: `ComputedTracker`, `ComputedEvolutionState`, `EvolutionMismatch`, `ImpossibleLineup`, `RepairResult`, `RebuildInput`

### Season Reconcile Orchestrator
- **File**: `reconcile-season.ts`
- **Purpose**: Loads a season's matches/roster/non-match sources, rebuilds via the four engines, diffs vs. stored, reports, and optionally repairs
- **Key Functions**: `reconcileSeasonDerivedData()`, `reconcileAllSeasons()`
- **Key Types**: `ReconcileOptions`, `RatingMismatch`, `ReconcileReport`

## Data Flows
- **Delete/reset triggers** → rebuild:
  - Match reset (`resetMatch`) / round reset (`resetRound`) → recalculate ratings, aggregates, streaks, EPB evolution (see [Match](./match.md)).
  - Tournament hard-delete → clear `tournament` scope; rebuild or clear `league` scope; rebuild `all_time`; rebuild ratings + streaks; repair EPB evolution if season survives.
  - Season hard-delete → clear `league` scope; rebuild `all_time`; rebuild ratings + streaks (evolution cascades with the season row).
- **Reconcile flow** (`reconcileSeasonDerivedData`):
  1. Resolve format_type + players; EPB seasons diff evolution first.
  2. Ratings: compute curve, diff stored vs. computed per player.
  3. Aggregates: rebuild `league` scope (repair-only; `all_time` is a separate global operation).
  4. Streaks: recompute per player.
  5. Aggregate the `ReconcileReport` (dry-run reports mismatches; repair rewrites).
- **Non-transactional**: each rebuilder manages its own writes sequentially; a mid-sequence failure leaves later rebuilders unrun and is completed on re-run.
- **Ratings are written atomically per player**: `rebuildRatingsForPlayers` writes each player's `player_ratings` row and whole `rating_history` in one SQL transaction (`rating_replace_player_history`), runs players strictly in order, and queues every rebuild in the process behind the previous one.
- **History gaps heal themselves**: a gap is a completed match where one player has a `rating_history` row and the opponent has none (the trace of a partial write). Before its first write the batch is planned: the player with the missing row is rebuilt first (their replay reads the other row and writes their own), and is added to the batch if it was not requested. Both players of a completed match with no history row at all (never rated) are rebuilt as well, against the initial rating, and logged. Results list every rebuilt player, added ones included (`addedToBatch`).
- **Only a gap cycle is refused**: when two players each miss the row the other one's replay needs, no order can fill the gaps. The batch then fails with `rating_history_incomplete` (409, naming the players) before anything is written. The season repair and a match reset run the same plan (`planRatingRebuild`) before their own first write, so the refusal leaves the season or match untouched. A cycle needs a developer: restore the missing `rating_history` rows (for example from a backup), run the dry-run reconcile, then repair. Never rerun a failed repair blindly. Each player is re-checked right before its write, so a gap that appears mid-batch (another process writing) stops the batch before that player; players already written keep their correct curves.

## Dependencies
- **External Libraries**: None
- **Internal Modules**:
  - `@/lib/rating/updateRatings` — rating curve rebuild (`rebuildRatingsForPlayers`, `planRatingRebuild`, `loadAndComputeRatingCurve`)
  - `@/lib/match/aggregate-rebuild` — aggregate scope rebuild (`rebuildAggregatesForScope`)
  - `@/lib/gamification/streaks` — streak recompute (`recomputeStreaks`)
  - `@/lib/draft/*` — EPB primitives mirrored by the evolution engine (`point-buy-engine`, `epb-thresholds`, `special-rules`, `evolution-points-engine`)
  - `@/lib/supabase/queries/*` — seasons, evolutions, evolution-events, match-snapshots, aggregates

## API Routes
### Admin Reconcile
- `POST /api/admin/reconcile` — dry-run or `repair` reconcile; `scope` = `season` (needs `season_id`) or `all`

### Reset / Repair Triggers
- `POST /api/admin/matches/[id]/reset` — reset a match to `scheduled`, recalculate derived data
- `POST /api/admin/rounds/[id]/reset` — reset all matches in a round
- `PATCH /api/tournaments/[id]/rounds/[rid]/matches/[mid]/repair` — re-pair a match (reset + new participants)

### Evolution Points
- `POST /api/seasons/[id]/evolution-points/recalculate` — rebuild evolution-point counters from persisted development events

## Related Modules
- [Match](./match.md)
- [Rating](./rating.md)
- [Season](./season.md)
- [Evolution Point Buy](./evolution-point-buy.md)
- [Admin](./admin.md)

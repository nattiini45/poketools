# Reconcile Module

> Rebuilds match-derived data (ratings, aggregates, streaks, EPB evolution) after resets, deletes, or drift — verify (dry-run) and repair (write) season derived state.

## Overview
The Reconcile module recomputes values that are *derived* from raw rows (matches → games → battle_stats) but are not cascade-deleted when those rows are reset or removed. It is the shared repair engine behind three kinds of operations:

1. **Match/round reset** — soft "undo" paths in the game pipeline call the same rebuilders (ratings, aggregates, streaks, EPB evolution) to leave the league as if the games never happened.
2. **Entity delete and restore** — deleting a tournament or season clears/re-orphans aggregate scopes and rebuilds ratings, streaks, and (when the season survives) EPB evolution state. A deleted league lands in the [league recycle bin](./season.md#league-recycle-bin); restoring it from there queues its games for the aggregate worker and rebuilds ratings, streaks and EPB state again.
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
- **Purpose**: Rebuild/clear derived data after a tournament or season is deleted, and after a league is restored from the trash
- **Key Functions**: `rebuildAfterTournamentDelete()`, `rebuildAfterSeasonDelete({ seasonId, playerIds, phaseIds })`, `rebuildAfterSeasonRestore({ seasonId, playerIds })`
- **Result types**: `EntityDeleteRebuildSummary`, `EntityRestoreRebuildSummary`
- **Delete of a league.** The database already removed the league's and its phases' aggregate scope rows in the delete transaction; `rebuildAfterSeasonDelete` clears them again (idempotent, so a re-run of a pending rebuild is self-contained), clears each phase's own tournament scope (hence `phaseIds`), rebuilds `all_time`, ratings and streaks. Evolution state went with the league and needs no repair.
- **Restore of a league.** `rebuildAfterSeasonRestore` runs four idempotent steps: (1) drain the aggregate queue (the restore queued one increment `aggregate_jobs` row per game with stats and cleared `aggregate_applied_at`; league, phase and `all_time` scopes are counted by the queue's own atomic apply and **never rebuilt globally here**), time-boxed to 90 s (`RESTORE_AGGREGATE_DRAIN_BUDGET_MS`), anything left stays for the `process-aggregates` cron; (2) ratings through `rebuildRatingsSettled` (`src/lib/rating/test-league-rebuild.ts`, extracted so the test-league flag change and the restore share it); (3) `recomputeStreaks` per player (streak pointers are not re-linked); (4) the EPB repair of the restored season.
- **Confirmation.** The routes confirm each finished rebuild to the database (`markLeagueTrashRebuildDone`, `markLeagueRestoreRebuildDone`); an unconfirmed rebuild comes back as a typed warning, the superadmin re-runs it from the league trash page (`POST /api/admin/league-trash/[id]/rebuild`), the expiry never purges an entry whose delete rebuild is unconfirmed, and the season audit reads `listPendingLeagueRebuilds`. A rebuild failure never fails the delete or the restore.

### EPB Evolution Rebuild Engine
- **File**: `evolution-rebuild.ts`
- **Purpose**: Recompute evolution trackers by replaying EPB sources in chronological order; mirrors (never re-invents) the pure EPB primitives
- **Key Functions**: `computeEvolutionStateCore()`, `computeSeasonEvolutionState()`, `diffEvolutionState()`, `applyComputedEvolutionState()`, `repairSeasonEvolution()`
- **Key Types**: `ComputedTracker`, `ComputedEvolutionState`, `EvolutionMismatch`, `ImpossibleLineup`, `RepairResult`, `RebuildInput`
- **Real-kill markers**: `real_kills` is recomputed from the season's completed matches only, so as its last write `applyComputedEvolutionState` aligns `games.evolution_applied_at` and the per-game credit ledger `games.evolution_credits` with them (`epb_sync_game_kill_credit`): games of the replayed matches are marked credited with the per-game credits the rebuild computed (`creditsByGame`), every other game of the season is unmarked, so a later match completion credits exactly the games the trackers do not hold and an admin edit debits exactly what they hold. The sync is fenced on the season's credit counter (`epb_kill_credit_epoch`), which `repairSeasonEvolution` reads before any season read: a credit, debit or other rebuild that committed in between, or a credited match that left `completed`, makes it refuse with nothing written (`StaleKillCreditError`) and the rebuild runs again from a fresh read, up to three attempts. After a deploy of `20261021100100_epb_game_kill_credit_ledger.sql`, one rebuild per EPB season writes the ledger for the games credited before it (until then an edit of such a game debits by its stats, see [Evolution Point Buy](./evolution-point-buy.md#match-lifecycle-wiring)).

### Season Reconcile Orchestrator
- **File**: `reconcile-season.ts`
- **Purpose**: Loads a season's matches/roster/non-match sources, rebuilds via the four engines, diffs vs. stored, reports, and optionally repairs
- **Key Functions**: `reconcileSeasonDerivedData()`, `reconcileAllSeasons()`
- **Key Types**: `ReconcileOptions`, `RatingMismatch`, `ReconcileReport`

## Data Flows
- **Delete/reset triggers** → rebuild:
  - Match reset (`resetMatch`) / round reset (`resetRound`) → recalculate ratings, aggregates, streaks, EPB evolution (see [Match](./match.md)).
  - Tournament hard-delete → clear `tournament` scope; rebuild or clear `league` scope; rebuild `all_time`; rebuild ratings + streaks; repair EPB evolution if season survives.
  - Season delete (to the trash) → clear the `league` and phase scopes; rebuild `all_time`; rebuild ratings + streaks (evolution goes with the season). Season restore → drain the queued aggregate jobs; rebuild ratings, streaks and EPB evolution.
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

### League trash
- `DELETE /api/seasons/[id]` — site admin; runs `rebuildAfterSeasonDelete` after the league moved to the trash
- `POST /api/admin/league-trash/[id]/restore` — superadmin; runs `rebuildAfterSeasonRestore`
- `POST /api/admin/league-trash/[id]/rebuild` — superadmin; runs the pending rebuild of a delete or a restore again

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

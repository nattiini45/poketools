# Gamification Module

## Overview
The Gamification module manages achievement unlocking, streak progression, and signature Pokémon updates.

## File Structure
```
src/lib/gamification/
├── achievements.ts  # Criteria evaluation + unlock persistence
├── signatures.ts  # Signature slot recomputation
└── streaks.ts  # Streak updates and recomputation
```

## Core Functions/Classes

### Achievement Engine
- **File**: `achievements.ts`
- **Purpose**: Evaluate criteria and unlock achievements
- **Key Methods**: `checkAchievements()`

### Streak Engine
- **File**: `streaks.ts`
- **Purpose**: Compute and store player streak records
- **Key Methods**: `recomputeStreaks()`, `computeStreaksFromHistory()` (pure), `advanceStreaks()` (pure, one match), `updateStreaks()` (incremental, backfill only)
- **The live finalize step and every repair rebuild the row** with `recomputeStreaks(playerId)`: it reads the player's whole completed history, replays it with `computeStreaksFromHistory` and replaces the stored row in ONE fenced write. It never reads the stored row, so a second run, the finalize heal and the season reconcile all land on the same numbers, and it grants no achievement and emits no event.
  - **Order**: `compareReplayOrder` (`src/lib/rating/replay-order.ts`, `date_played ?? created_at`, the rating curve's order).
  - **Complete history**: `getCompletedMatchesForRatingReplay` (keyset pages, no row cap) and then ONE paged read of the player's own `battle_stats` (`getPlayerStatTotalsByMatch`, not one read per match) for exactly the history's match ids, whatever their status now. The order matters: a stats read that ran first, or one filtered to completed matches, could miss a match that completes between the two reads while the history (and so the fence) still contains it, and the rebuild would treat that match as stats-less and overwrite the correct row.
  - **A draw** resets both the win and the loss streak.
  - **No battle stats are unknown, not zero.** A match the player has no `battle_stats` row for (a result entered without a replay, an admin settle through `POST /api/admin/matches/[id]/result`) moves the win and loss streaks but leaves the KO and flawless streaks as they are. It is decided per player: with stats for one side only, the other side's KO and flawless streaks stay put. Before this, such a match extended the flawless streak and reset the KO streak.
  - **Test leagues do not count** (`matchCountsForRatings`, one `loadRatingScope()` read per rebuild), the same rule as ratings. Achievements and signatures are NOT scoped this way: they still read all matches, so a test-league match can still count toward them.
  - **The test-league flag moves the rule**: setting `seasons.is_test_season` rebuilds the streak rows of the league's players (`rebuildRatingsAfterTestFlagChange`), so a stored row never keeps counting a match the new flag excludes.
  - **Milestone announcements** need a real rise: the winner's `streak_milestone` is emitted only when the rebuilt win streak is a multiple of five and above the stored one (a rebuild that lands on the value it already held announces nothing).
  - **Fenced write**: RPC `streaks_replace_player` (`20261102130000_streaks_replace_player.sql`, service role only) takes a per-player advisory lock and refuses with SQLSTATE `PT409` (nothing written) when the player's set of completed matches differs from the one the replay read; `recomputeStreaks` then reads again and writes once more (`StreaksStaleError` after the second refusal). There is no zeroing step, so a reader never sees a zeroed row, and two finalizations of one player both end up counted. The code is `PT409`, not 40001: PostgREST never answers a 40001 raised inside a function (the request hangs until the gateway returns 504).
  - **Heal**: `FINALIZE_HEAL_POLICY.streaks` stays `rerun`; the rebuild is replay-safe by construction.
- `updateStreaks()` (read, advance one match, upsert) is not replay-safe and not safe against a concurrent writer; only `POST /api/admin/backfill-gamification` uses it, so its achievement checks see the chronological state, and that route ends with `recomputeStreaks` for every touched player. To rebuild streaks on a live league, run the season reconcile ([Reconcile](./reconcile.md)), never the backfill route (its loop zeroes rows while it runs).

### Signature Engine
- **File**: `signatures.ts`
- **Purpose**: Recompute signature slots from aggregate stats
- **Key Methods**: `updateSignatures()`

## Data Flows
- **Input**: Completed match context + battle stats + rating/aggregate state
- **Processing**:
  1. Update rating/streak/signature baselines
  2. Build achievement criteria context
  3. Unlock eligible achievements
- **Output**: Updated gamification state and unlock payloads

## Dependencies
- **External Libraries**: None
- **Internal Modules**:
  - [Match Module](./match.md)
  - [Rating Module](./rating.md)
  - [Supabase Module](./supabase.md)

## API Routes
- `/api/achievements`
- `/api/achievements/[playerId]`
- `/api/streaks/[playerId]`
- `/api/streaks/leaderboard`
- `/api/signatures/[playerId]`
- `/api/admin/achievements`
- `/api/admin/achievements/[id]`
- `/api/admin/backfill-gamification`

## Usage Examples

```typescript
import { recomputeStreaks } from '@/lib/gamification/streaks';

const changes = await recomputeStreaks(playerId); // StreakChanges (before/after), for announcements
```

## Testing
- **Test Files**: `src/lib/gamification/__tests__/streaks.test.ts` (compute rules, rebuild, retry), `src/lib/supabase/queries/__tests__/streaks-replace.test.ts` (RPC wrapper, paged stats read), `streaks-replace.local.test.ts` (`npm run test:db`: fence refusal, two concurrent finalizes both counted, replay safety)
- **Testing Approach**: Pure compute tests, mocked-reader rebuild tests (history over 1,000 matches), a local-stack concurrency suite, plus route-level and match-completion integration testing

## Related Modules
- [Match Module](./match.md)
- [Rating Module](./rating.md)
- [Supabase Module](./supabase.md)

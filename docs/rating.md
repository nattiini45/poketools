# Rating Module

## Overview
The Rating module implements Glicko-2 updates and rating rollback logic for match-result workflows, plus a presentation-layer tier classifier that maps numeric ratings to the Pokéball badge tiers shown across the app (`RatingBadge`, `OverlayRatingBadge`).

## File Structure
```
src/lib/rating/
├── glicko2.ts          # Core Glicko-2 formulas
├── glicko2-preview.ts  # Read-only preview of next-game rating deltas
├── rating-scope.ts     # Which completed matches count toward ratings (test leagues do not)
├── replay-order.ts     # The one chronological replay order
├── test-league-rebuild.ts # Rating rebuild after the test-league flag is set
├── tiers.ts            # Pokéball tier classifier + tier metadata
├── updateRatings.ts    # Match-driven rating updates + rollback
└── __tests__/
    ├── glicko2.test.ts
    ├── glicko2-preview.test.ts
    ├── rating-scope.test.ts
    ├── replay-order.test.ts
    ├── test-league-rebuild.test.ts
    ├── tiers.test.ts
    ├── updateRatings.test.ts
    └── updateRatings-rebuild.test.ts
```

## Core Functions/Classes

### Glicko-2 Core
- **File**: `glicko2.ts`
- **Purpose**: Deterministic Glicko-2 math helpers
- **Key Methods**: `glicko2Update()`, `expectedScore()`, `inflateRD()`

### Rating Updater
- **File**: `updateRatings.ts`
- **Purpose**: Apply a completed match's rating change; rebuild a player's curve chronologically (removing a match is always a rebuild, never an inverse of one match)
- **Key Methods**: `updateRatings()`, `rebuildRatingsForPlayers()`, `planRatingRebuild()`, `loadAndComputeRatingCurve()`
- **Live path (`updateRatings`, called by match finalize and the gamification backfill)**: a test-league match is skipped first (`skipped_test_season`, nothing written; see [Test leagues](#test-leagues)). It skips a match whose two `rating_history` rows exist (returns the stored change). A one-sided history (one player's row only) is re-read after 250, 750 and 1500 ms before it throws: a rebuild in another process writes each player's curve in its own transaction, so between its two writes a match it replays has one row, and the live path waits for the second instead of failing the finalize ratings step. The same wait follows an RPC answer `history_incomplete` (the rebuild wrote one row after this read); the rebuild's rows are then reported as the result. Still one-sided after the last wait: the error propagates, the finalize step fails, and the cron's heal verifies the rows on a later run (healed once the rebuild finished, `needsAdmin` otherwise). Otherwise it computes the Glicko-2 step from both players' stored rows and writes the result through `rating_apply_match_result` (`supabase/migrations/20261018170100_rating_apply_atomic.sql`): both `player_ratings` rows and both `rating_history` rows in ONE transaction, so a failure leaves nothing and a retry after a lost response finds both rows (`already_applied`). The function takes the per-player advisory locks `rating_replace_player_history` takes (ascending player id), re-checks under them that the match is still completed between exactly these players and has no history yet, and fences on the stored values the computation read (`rating, rd, volatility, wins, losses, draws`, or "no row"; numeric columns round-trip exactly through PostgREST). A concurrent finalize sharing a player, or a rebuild that rewrote a player in between, makes it answer `stale` with nothing written; `updateRatings` then re-reads and recomputes (up to 3 attempts, then throws). Other outcomes throw: `match_missing`, `match_not_completed` (a reset won); `history_incomplete` waits as described above. In-process the live path also queues on the rebuild lock (`withRebuildLock`), so it never interleaves with a rebuild's reads in the same process.
- **Finalize heal**: the heal still only verifies ratings (both history rows) and lists a match without them as `needsAdmin`. With the atomic write, missing rows now mean "never applied"; the heal does not re-run the step because rows written by the earlier two-statement path ("ratings, no history") cannot be told apart.
- **Rebuild vs a live apply in another process**: the rebuild holds the per-player lock only for its write, so a live apply could commit between the rebuild's read and its write; the write then replaced the live rows with a replay that had played that match against the default opponent, or (a match completed after the read) dropped this player's row of it. `rating_replace_player_history` now takes the ids of the player's own history rows the replay read (`p_expected_history_match_ids`, 4-argument version in `20261018170100_rating_apply_atomic.sql`) and, under the player lock, refuses with SQLSTATE 40001 and nothing written when the player has a row for a completed match outside that set. `replacePlayerRatingCurve` maps the refusal to `RatingCurveStaleError`; the rebuild re-reads that player and replays again (up to 3 writes per player, then the error propagates). Rows of matches that are no longer completed are not part of the fence (the replace removes them). Local proof (local stack): in one session a write, a refusal with nothing written, a fenced write, a reset match ignored, the 3-argument call unfenced and EXECUTE for `service_role` only; in two sessions a replace that started while a live write held the player lock waited and was refused.
- **Rebuild**: replays each player's completed matches chronologically and writes the whole curve through `rating_replace_player_history` (`supabase/migrations/20261018130200_rating_history_atomic_replace.sql`): `player_ratings` upsert, history delete and history insert in ONE transaction under a per-player advisory lock, so readers see the old or the new complete set, never an empty one. Rebuilds in one process are serialized (`withRebuildLock`); history gaps are healed by rebuilding the player with the missing row first, and a gap cycle is refused (409 `rating_history_incomplete`) with nothing written.
- **Gap healing reaches beyond the requested players**: a player's curve depends on each opponent's frozen state (`rating_before`, `rd_before`) at every match, so the batch adds the opponent who misses a history row (rebuilt first, which writes that row) and both players of a never-rated match. Restricting the batch to the requested set would either write a curve against the default opponent where the real state exists, or leave a one-sided history that every later rebuild refuses. The added players are listed in the result (`addedToBatch`) and logged. A plan that would grow past 2000 players while healing is refused (409 `rating_rebuild_plan_too_large`, `RatingRebuildPlanTooLargeError`) with nothing written.
- **Where refusals surface**: match reset and the season repair run `planRatingRebuild` before their first write (409 with nothing written). The season, tournament and phase DELETE routes run the rebuild after the delete committed, so a refusal there is a 200 with `data.rebuild_warning`: a domain refusal keeps its code (`rating_history_incomplete` with its params, `rating_rebuild_plan_too_large`), any other failure gets the code of the rebuild step that failed (`delete_rebuild_aggregates_failed`, `delete_rebuild_ratings_failed`, `delete_rebuild_streaks_failed`, `delete_rebuild_evolution_failed`; `src/lib/reconcile/entity-delete-rebuild.ts` tags each step, `toDeleteRebuildWarning` in `src/lib/api/delete-rebuild-warning.ts` maps it), and only an untagged failure `derived_data_rebuild_failed`. The texts name a site admin for the repair, because a league admin may delete a phase; `DeleteResourceButton` and the phase list (`PhaseTimeline`, with a link to the admin data tools for site admins) show the warning; Record Reconciliation's dry run lists the gaps and never-rated matches (`ratings.integrity`) and whether the repair would refuse (`repairRefusal`: `rating_history_incomplete` or `rating_rebuild_plan_too_large`).
- **Replay read**: `getCompletedMatchesForRatingReplay` reads every completed match of the player with keyset paging (dated matches on `date_played, created_at, id`, then undated ones on `created_at, id`), so a match inserted or deleted during a long read cannot shift a page boundary and duplicate or skip a row.
- **Replay order**: `compareReplayOrder` (`src/lib/rating/replay-order.ts`) is the one chronological order of every replay: `date_played ?? created_at`, oldest first, compared at microsecond precision (the precision Postgres stores and the reader orders by; `Date` alone keeps milliseconds, so the sub-millisecond digits of the timestamp break a millisecond tie); on equal timestamps a dated match first, then `created_at` desc, then `id` desc (the order the replay reader has always produced). The rating rebuild, reconcile's rating diff and the gamification backfill (`POST /api/admin/backfill-gamification`, which feeds the order-dependent live `updateRatings` and the streak and achievement replay) all sort with it. `updated_at` is never a chronology: a match confirmed, edited or entered after it was played would sort late, and the backfilled curve would then differ from the one reconcile computes.
- **Local proof, live path** (local stack): `rating_apply_match_result` in BEGIN ... ROLLBACK (first apply writes 2 ratings + 2 history rows; a retry answers `already_applied` with counts unchanged; a fence that no longer matches answers `stale` and writes nothing; one history row → `history_incomplete`; a reset match → `match_not_completed`; unknown match → `match_missing`; a CHECK violation in the second history row rolls back the whole call; same player twice, a wrong opponent and non-participants are refused with 22023; EXECUTE for `service_role` only), then two sessions on committed rows: a second apply of the same match waited for the first and answered `already_applied`, and a live apply started while a `rating_replace_player_history` of one of its players held the lock waited and answered `stale`. The opt-in local suite `match-finalize-integrity.local.test.ts` repeats the refusal and the stale fence through the TS wrapper.
- **Local proof** (2026-10-18): `rating_replace_player_history` success, idempotency, the insert branch, every refusal (22004, 22023, 23505, 23514, 23502) with ratings and history byte-identical afterwards, EXECUTE for `service_role` only, RLS on; plus concurrency: a reader during an open replace sees the old complete set, a second replace of the same player waits for the first and wins whole, a replace of another player does not wait.

### Test leagues

Owner decision 2026-10-19: games in a test league (`seasons.is_test_season`) do not move player ratings. Standalone tournaments (no season) and normal leagues are unchanged; test ACCOUNTS (`players.is_test_account`) are a separate rule (the leaderboard leaves them out on read).

- **One predicate, mirrored in SQL.** `matchCountsForRatings(match, scope)` (`src/lib/rating/rating-scope.ts`) is false for a match whose tournament belongs to a test league; `loadRatingScope()` (`src/lib/supabase/queries/ratings.ts`) reads the test leagues' tournament ids (two narrow paged reads). The database mirrors it in `public.match_in_test_season(match_id)` (`supabase/migrations/20261019130000_ratings_skip_test_seasons.sql`, service-role only).
- **Live path.** `updateRatings` checks the match against the current scope before it reads history or computes anything and returns `{ status: 'skipped_test_season' }` with nothing written; otherwise `{ status: 'rated', ...change }`. `rating_apply_match_result` repeats the check under its locks, after the match read and before the idempotency check, and answers `skipped_test_season` (nothing written), so a caller that skips the TS check, or a flag set in between, still writes nothing. Finalize announces no rating milestone for a skipped match; the gamification backfill goes through `updateRatings` and skips the same matches.
- **Rebuilds.** `loadAndComputeRatingCurve` keeps only the matches the predicate admits (the replay reader returns `tournament_id` for it), so every rebuild, its gap healing and never-rated pairing, the reconcile diff and the match-reset / game-delete preflights replay exactly what the live path writes. A batch reads the scope once (`planRatingRebuild`) and reuses it for its writes. `rating_replace_player_history` ignores the player's rows of test-league matches in its history fence (the replace deletes them) and refuses a `p_history` row for a test-league match with SQLSTATE 40001 (the flag was set after the replay read it); the rebuild maps that to `RatingCurveStaleError`, re-reads the scope and the player, and replays again.
- **Finalize heal.** A test-league match expects no rating history: the heal's verify passes for it and `findMatchesNeedingAdmin` never lists it as `ratings_missing`.
- **Setting the flag.** The rule follows the CURRENT flag (unlike `games.exclude_all_time`, which is frozen per game for the all-time aggregates). Every `PATCH /api/seasons/[id]` that sends `is_test_season` calls `rebuildRatingsAfterTestFlagChange` (`src/lib/rating/test-league-rebuild.ts`) for the stored value, changed or not: a request cut off after the flag was saved (the route's `maxDuration` is 300 s) leaves a partial rebuild, and sending the same value again finishes it. Re-sending the same value is an API path: the admin checkbox only sends a changed value, so in the admin UI it means switching the flag off and on again (two rebuilds) or running the repair. The rebuild covers the players of the league's completed matches (`listSeasonCompletedMatchPlayerIds`; players who left the roster included), plus whoever the gap healing adds. Flag ON drops the league's matches from those curves (and their history rows); flag OFF meets them as never-rated matches. One pass does not settle these players: a rebuild writes its players one after another, and each replay reads the opponent's stored pre-match state, so a player written before an opponent replays against the opponent's old state (with the flag OFF, a never-rated league match even meets the default opponent; with either value, two league players who also met in a counted match meet each other's pre-change state). Two passes are not always enough either (two league players with three counted matches between them still move in a third pass). So the rebuild repeats the pass over every player rewritten so far while the last pass changed any player (`RebuildRatingsResult.changed`: no stored row, a stored rating / rd / volatility at the columns' scale or a win / loss / draw count that differs from the written state, a changed number of history rows, or a history row whose rating or rd before or after the match moved, which is what opponents read), up to 8 passes that still change something plus the pass that confirms it; a pass that changes nothing settles the league's players among themselves. The summary reports `passes` and `settled`. Opponents outside the league are not rebuilt: their curves keep the league players' old frozen states until a later rebuild reaches them (the one-pass limit every rebuild has). The rating reads of every involved player are expired (`expireRatingReads`) even when the rebuild fails part-way. A failure keeps the flag saved and answers `data.rebuild_warning` (`toTestFlagRebuildWarning`: `rating_history_incomplete` / `rating_rebuild_plan_too_large` keep their code, anything else is `test_flag_rating_rebuild_failed`), shown under the checkbox. A rebuild that reaches the cap while a pass still changed a player keeps the flag saved too and answers its summary with `data.rebuild_warning` `test_flag_rating_rebuild_unsettled` (`testFlagRebuildUnsettledWarning`), logged like a failure. Both texts tell a site admin to repair with Record Reconciliation and to repeat the repair until its dry run lists no rating mismatch: one repair run is a single rebuild pass. The audit record `season.set_test_flag` carries `changed` and the summary counts (with `settled`) or the error code. When the save gets no answer at all (network error, timeout), the control refreshes to the stored flag and says the save is unconfirmed.
- **Deploy order.** Apply migration `20261019130000` right before deploying the code, like the other migrations. In the gap between the two, the previous code's rating writes that involve a test-league match are refused with nothing written: its finalize rating step fails for a test-league match (the heal settles it after the deploy), and a rebuild of a player with test-league matches is refused. Keep the gap short.
- **One-time step for existing data.** Before this rule, test-league matches were rated like any other. A deployment whose test leagues already moved ratings rebuilds after deploying migration `20261019130000` and the code:
  1. Run the repair over every league: admin data tools, **Record Reconciliation**, or `POST /api/admin/reconcile` with `{ "scope": "all", "repair": true }`. Each league's repair rebuilds every player of the league (roster, EPB trackers and every player of its completed matches, so players who left a test league's roster are covered) under the new rule, which also deletes their rating history rows of test-league matches. It refuses (409, nothing written for that league) on a gap cycle, as described above. A scope-all repair runs the leagues in sequence and stops at the first refused league: the leagues before it are repaired, the later ones are not; resolve the refusal and repeat the scope-all repair.
  2. Dry-run over every league (`{ "scope": "all" }`). Its `ratings.mismatches` list players whose stored rating still differs from a replay under the new rule.
  3. While the dry run still lists rating mismatches, repeat the repair and the dry run. The repair runs league by league, so an opponent rebuilt before the test league's players replayed against their old states. Repeated runs settle those; the dry run is the check.
- **Local proof** (2026-10-19, local stack, BEGIN ... ROLLBACK, then the migration applied once and registered as `20261019130000 ratings_skip_test_seasons`): `match_in_test_season` is true for a test-league match and false for a normal-league, a standalone and an unknown match; `rating_apply_match_result` answers `skipped_test_season` for the test-league match with `player_ratings` and `rating_history` untouched (also once both players had ratings and a current fence), and `applied` for the normal-league match (two ratings, two history rows); `rating_replace_player_history` refuses a test-league history row with 40001 and nothing written, ignores a leftover test-league row in its fence (and the replace removes it), and still fences a normal completed match outside the expected set; EXECUTE on all three functions for `service_role` only.

### Rating Tier Classifier
- **File**: `tiers.ts`
- **Purpose**: Map a Glicko-2 (rating, rd) pair to one of four Pokéball tiers and look up the matching badge metadata (Tailwind classes, overlay hex, Showdown item id).
- **Key Exports**: `getRatingTier(rating, rd)`, `RATING_TIER_META`, `RatingTier`
- **Rules**: see Spec §11.5. Summary: Poké `< 1400` or `rd > 100` (provisional); Great `1400–1599`; Ultra `1600–1899` (or `rating ≥ 1900` with `rd > 50`); Master `rating ≥ 1900` AND `rd ≤ 50`. `rd === 0 | null | undefined` is the "RD unknown" sentinel — provisional and Master gates are both skipped (caps at Ultra).

## Data Flows
- **Input**: Winner/loser IDs + match ID (for `updateRatings`); `(rating, rd)` pair (for `getRatingTier`)
- **Processing**:
  1. Load current rating rows
  2. Apply RD inflation and Glicko-2 updates
  3. Persist rating + history records
  4. UI surfaces classify each rating into a Pokéball tier via `getRatingTier` and render via `RatingBadge` / `OverlayRatingBadge`
- **Output**: Updated ratings and deltas; tier badge UI

## Dependencies
- **External Libraries**: None
- **Internal Modules**:
  - [Supabase Module](./supabase.md)
  - [Match Module](./match.md)
  - [PKMN Module](./pkmn.md) — `src/lib/pkmn/ball-sprites.ts` is consumed by the `PokeballIcon` used in the tier badges

## API Routes
- `/api/ratings`
- `/api/ratings/[playerId]`
- `/api/ratings/[playerId]/history`

## Usage Examples

```typescript
import { updateRatings } from '@/lib/rating/updateRatings';
import { getRatingTier, RATING_TIER_META } from '@/lib/rating/tiers';

const result = await updateRatings(winnerId, loserId, false, matchId);

const tier = getRatingTier(player.rating, player.rd);
const meta = RATING_TIER_META[tier]; // { label, ballItemId, bg, text, border, overlayColor }
```

## Testing
- **Test Files**:
  - `src/lib/rating/__tests__/glicko2.test.ts` — pure Glicko-2 math (`glicko2Update`, `expectedScore`, `inflateRD`)
  - `src/lib/rating/__tests__/glicko2-preview.test.ts` — preview / next-game deltas
  - `src/lib/rating/__tests__/tiers.test.ts` — threshold bands, provisional rule, Master Ball gate, RD-unknown sentinel
  - `src/lib/rating/__tests__/updateRatings.test.ts` — live persistence (one statement per table, ratings before history, failure paths) and rollback paths
  - `src/lib/rating/__tests__/updateRatings-rebuild.test.ts` — chronological rebuild, gap healing, integrity refusals, test-league matches left out of every replay, the `changed` signal of each write
  - `src/lib/rating/__tests__/rating-scope.test.ts` — the shared predicate; `test-league-rebuild.test.ts` — the rebuild after the flag is set (passes over every rebuilt player until one changes nobody, the cap with `settled: false`, cache expiry on failure)
  - `src/app/api/seasons/[id]/__tests__/test-flag-ratings.test.ts` — the PATCH route: a rebuild for every request that sends the flag, the warnings (failed, unsettled), the audit record
  - `src/lib/api/__tests__/test-flag-rebuild-warning.test.ts` — the flag rebuild's warning codes (`toTestFlagRebuildWarning`, `testFlagRebuildUnsettledWarning`)
  - `src/lib/supabase/queries/__tests__/ratings-scope.test.ts` — `loadRatingScope`, the live update's match read and the league player listing behind the flag rebuild
  - `src/lib/supabase/queries/__tests__/ratings-live-writes.test.ts`, `ratings-rebuild.test.ts` — the query writers and the keyset replay read
  - `src/lib/supabase/queries/__tests__/match-finalize-integrity.local.test.ts` (LIVE-LOCAL, opt-in) — the replay cursor past 1000 rows and the live writers against a local stack
- **Testing Approach**: Pure unit tests for math + classifier; integration testing through match confirmation/reset paths for persistence.

## Related Modules
- [Match Module](./match.md)
- [Supabase Module](./supabase.md)
- [Gamification Module](./gamification.md) — `RatingBadge` lives under `src/components/gamification/`
- [PKMN Module](./pkmn.md)

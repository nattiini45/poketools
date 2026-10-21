import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { supabase } from '@/lib/supabase/client';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getBattleStatsByMatch } from '@/lib/supabase/queries/games';
import { upsertPlayerStreaks, type PlayerStreaksUpsertInput } from '@/lib/supabase/queries/streaks';
import { updateRatings } from '@/lib/rating/updateRatings';
import { compareReplayOrder } from '@/lib/rating/replay-order';
import { aggregateMatchKOs } from '@/lib/match/match-kos';
import { recomputeStreaks, updateStreaks } from '@/lib/gamification/streaks';
import { updateSignatures } from '@/lib/gamification/signatures';
import { checkAchievements } from '@/lib/gamification/achievements';
import { UserFacingError } from '@/lib/api/user-facing-error';
import type { ApiResult } from '@/types/api';

/** PostgREST caps every response at `max_rows` (1000) and truncates silently. */
const PAGE_SIZE = 1000;

interface BackfillMatch {
  id: string;
  player_1_id: string;
  player_2_id: string;
  winner_id: string | null;
  tournament_id: string;
  date_played: string | null;
  created_at: string;
}

/**
 * Every completed match with a winner, in the canonical replay order
 * (`compareReplayOrder`: `date_played ?? created_at`, oldest first), the same
 * order the rating rebuild and reconcile replay each player's curve in.
 * `updated_at` is NOT a chronology: a match confirmed, edited or entered after
 * it was played would sort late.
 *
 * Pages past the row cap on a total server order (`date_played` asc nulls
 * last, `created_at`, `id`), then sorts the whole list with the shared
 * comparator, so the replay order does not depend on how pages split.
 */
async function listCompletedMatches(): Promise<BackfillMatch[]> {
  const matches: BackfillMatch[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('matches')
      .select('id, player_1_id, player_2_id, winner_id, tournament_id, date_played, created_at')
      .eq('status', 'completed')
      .not('winner_id', 'is', null)
      .order('date_played', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    matches.push(...data);
    if (data.length < PAGE_SIZE) return matches.sort(compareReplayOrder);
  }
}

/** The streak row a player starts the chronological replay from. */
const EMPTY_STREAKS: Readonly<PlayerStreaksUpsertInput> = {
  current_win_streak: 0,
  best_win_streak: 0,
  current_loss_streak: 0,
  best_loss_streak: 0,
  current_ko_streak: 0,
  best_ko_streak: 0,
  current_flawless_streak: 0,
  best_flawless_streak: 0,
  last_match_id: null,
};

interface BackfillResult {
  processed: number;
  total: number;
  /**
   * One line per failure: the match or player, the step that failed and, for
   * a domain refusal (`UserFacingError`, safe by design), its message. Other
   * errors name the step only; their details are in the server log.
   */
  errors: string[];
}

/** The per-match step of the backfill, named in an error line. */
type BackfillStep = 'tournament read' | 'streak reset and signatures' | 'ratings' | 'streaks' | 'achievements';

/** The failure line of one match or player: step, plus the safe message of a domain refusal. */
function failureLine(subject: string, step: BackfillStep | 'streak recompute', err: unknown): string {
  const detail = err instanceof UserFacingError ? `: ${err.message}` : '';
  return `${subject}: ${step} failed${detail}`;
}

/**
 * POST /api/admin/backfill-gamification
 *
 * One-off admin endpoint. Processes all completed matches through the
 * gamification pipeline in the canonical replay order (`date_played ??
 * created_at`, oldest first, see `compareReplayOrder`; the order the rating
 * rebuild and reconcile use), in the live finalize order
 * (ratings, streaks, signatures, achievements), so ratings accumulate
 * correctly and each match's achievement check sees the streak state as of
 * that match.
 *
 * Re-run safety, step by step:
 * - ratings: `updateRatings` is idempotent per match (a match whose two
 *   rating_history rows exist is skipped) and writes each match in ONE
 *   transaction (`rating_apply_match_result`), under the same per-player
 *   locks as the chronological rebuild and the in-process rating queue, so a
 *   backfill cannot interleave with a rebuild. A test-league match is skipped
 *   by `updateRatings` itself (`skipped_test_season`, nothing written; test
 *   leagues stay out of ratings), its streaks and achievements still run.
 * - streaks: the incremental per-match update is not replay-safe, so each
 *   player's streak row is reset ONCE, the first time the player appears,
 *   and then advanced match by match. That gives `checkAchievements` the
 *   chronological streak state streak achievements need. After the loop,
 *   `recomputeStreaks` rebuilds every touched row from the full history (it
 *   also replays draws and matches this loop skipped), so the stored state is
 *   the same however the loop ended.
 * - signatures: recomputed from all-time aggregates, once per player before
 *   that player's first achievement check (the same state the live path sees).
 * - achievements: one-time achievements deduplicate through their unique
 *   constraint, but a REPEATABLE achievement's `times_earned` counts again on
 *   every run. Run this endpoint once per data set.
 */
export async function POST() {
  try {
    await requireAdmin();

    const matches = await listCompletedMatches();
    if (matches.length === 0) {
      return NextResponse.json<ApiResult<BackfillResult>>({
        success: true,
        data: { processed: 0, total: 0, errors: [] },
      });
    }

    const errors: string[] = [];
    let processed = 0;
    /** Players whose streak row was reset and signatures recomputed this run. */
    const players = new Set<string>();

    // Cache tournaments to avoid repeated lookups
    const tournamentCache = new Map<string, Awaited<ReturnType<typeof getTournamentById>>>();

    for (const match of matches) {
      let step: BackfillStep = 'tournament read';
      try {
        const winnerId = match.winner_id;
        if (!winnerId) continue; // filtered by the query; narrows the type
        const loserId = winnerId === match.player_1_id
          ? match.player_2_id
          : match.player_1_id;

        // Get tournament (cached)
        if (!tournamentCache.has(match.tournament_id)) {
          tournamentCache.set(match.tournament_id, await getTournamentById(match.tournament_id));
        }
        const tournament = tournamentCache.get(match.tournament_id);
        if (!tournament) {
          errors.push(`Match ${match.id}: tournament ${match.tournament_id} not found`);
          continue;
        }

        // First appearance: start the streak replay from zero and bring the
        // signatures up to date. Done once per player, so a re-run never
        // double-counts a streak.
        step = 'streak reset and signatures';
        for (const playerId of [winnerId, loserId]) {
          if (players.has(playerId)) continue;
          await upsertPlayerStreaks(playerId, EMPTY_STREAKS);
          players.add(playerId);
          await updateSignatures(playerId);
        }

        const matchContext = {
          match_id: match.id,
          tournament_id: match.tournament_id,
          season_id: tournament.season_id ?? null,
          winner_id: winnerId,
          loser_id: loserId,
          is_draw: false,
        };

        // 1. Ratings (order matters — sequential so Glicko-2 accumulates)
        step = 'ratings';
        await updateRatings(winnerId, loserId, false, match.id);

        // 2. Streaks, before achievements (the live finalize order): the
        //    achievement check reads the stored streak row.
        step = 'streaks';
        const flatStats = Object.values(await getBattleStatsByMatch(match.id)).flat();
        await Promise.all([
          updateStreaks(winnerId, { won: true, lost: false, drew: false }, aggregateMatchKOs(flatStats, winnerId), match.id),
          updateStreaks(loserId, { won: false, lost: true, drew: false }, aggregateMatchKOs(flatStats, loserId), match.id),
        ]);

        // 3. Achievements
        step = 'achievements';
        await Promise.all([
          checkAchievements(winnerId, matchContext),
          checkAchievements(loserId, matchContext),
        ]);

        processed++;
      } catch (err) {
        console.error(`[backfill] Match ${match.id} failed in step "${step}":`, err);
        errors.push(failureLine(`Match ${match.id}`, step, err));
      }
    }

    // 4. Authoritative streak rows from each touched player's full history.
    for (const playerId of players) {
      try {
        await recomputeStreaks(playerId);
      } catch (err) {
        console.error(`[backfill] Player ${playerId} streak recompute failed:`, err);
        errors.push(failureLine(`Player ${playerId}`, 'streak recompute', err));
      }
    }

    return NextResponse.json<ApiResult<BackfillResult>>({
      success: true,
      data: { processed, total: matches.length, errors },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to backfill gamification');
  }
}

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { supabase } from '@/lib/supabase/client';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getBattleStatsByMatch } from '@/lib/supabase/queries/games';
import { updateRatings } from '@/lib/rating/updateRatings';
import { updateStreaks } from '@/lib/gamification/streaks';
import { updateSignatures } from '@/lib/gamification/signatures';
import { checkAchievements } from '@/lib/gamification/achievements';
import type { ApiResult } from '@/types/api';
import type { BattleStat } from '@/types/game';

function aggregateMatchKOs(
  stats: BattleStat[],
  playerId: string
): { total_kos_dealt: number; total_kos_lost: number } {
  let totalKosDealt = 0;
  let totalKosLost = 0;
  for (const stat of stats) {
    if (stat.player_id !== playerId) continue;
    totalKosDealt += stat.kos_dealt;
    if (stat.was_koed) totalKosLost += 1;
  }
  return { total_kos_dealt: totalKosDealt, total_kos_lost: totalKosLost };
}

/**
 * POST /api/admin/backfill-gamification
 *
 * One-off admin endpoint. Processes all completed matches through the
 * gamification pipeline (ratings, streaks, signatures, achievements)
 * in chronological order so ratings accumulate correctly.
 *
 * Safe to run multiple times — ratings upsert, streaks overwrite,
 * signatures recompute, achievements deduplicate via unique constraint.
 */
export async function POST() {
  try {
    await requireAdmin();

    // Get all completed matches with a winner, ordered chronologically
    const { data: matches, error } = await supabase
      .from('matches')
      .select('id, player_1_id, player_2_id, winner_id, tournament_id, updated_at')
      .eq('status', 'completed')
      .not('winner_id', 'is', null)
      .order('updated_at', { ascending: true });

    if (error) throw error;
    if (!matches || matches.length === 0) {
      return NextResponse.json<ApiResult<{ processed: number; errors: string[] }>>({
        success: true,
        data: { processed: 0, errors: [] },
      });
    }

    const errors: string[] = [];
    let processed = 0;

    // Cache tournaments to avoid repeated lookups
    const tournamentCache = new Map<string, Awaited<ReturnType<typeof getTournamentById>>>();

    for (const match of matches) {
      try {
        const winnerId = match.winner_id!;
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

        const matchContext = {
          match_id: match.id,
          tournament_id: match.tournament_id,
          season_id: tournament.season_id ?? null,
          winner_id: winnerId,
          loser_id: loserId,
          is_draw: false,
        };

        // 1. Ratings (order matters — sequential so Glicko-2 accumulates)
        await updateRatings(winnerId, loserId, false, match.id);

        // 2. Streaks
        const statsByGame = await getBattleStatsByMatch(match.id);
        const flatStats = Object.values(statsByGame).flat();
        const winnerStats = aggregateMatchKOs(flatStats, winnerId);
        const loserStats = aggregateMatchKOs(flatStats, loserId);

        await Promise.all([
          updateStreaks(winnerId, { won: true, lost: false, drew: false }, winnerStats, match.id),
          updateStreaks(loserId, { won: false, lost: true, drew: false }, loserStats, match.id),
        ]);

        // 3. Signatures
        await Promise.all([
          updateSignatures(winnerId),
          updateSignatures(loserId),
        ]);

        // 4. Achievements
        await Promise.all([
          checkAchievements(winnerId, matchContext),
          checkAchievements(loserId, matchContext),
        ]);

        processed++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[backfill] Match ${match.id} failed:`, msg);
        errors.push(`Match ${match.id}: Match failed`);
      }
    }

    return NextResponse.json<ApiResult<{ processed: number; total: number; errors: string[] }>>({
      success: true,
      data: { processed, total: matches.length, errors },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to backfill gamification');
  }
}

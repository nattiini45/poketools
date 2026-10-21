import { getBattleStatsByMatch } from '@/lib/supabase/queries/games';
import { getMatchesByPlayer } from '@/lib/supabase/queries/matches';
import { getPlayerStreaks, upsertPlayerStreaks } from '@/lib/supabase/queries/streaks';
import type { MatchResult, MatchStats, StreakChanges, PlayerStreaks } from '@/types/streak';

function createDefaultStreaks(playerId: string): PlayerStreaks {
  return {
    id: '',
    player_id: playerId,
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
}

export async function updateStreaks(
  playerId: string,
  matchResult: MatchResult,
  matchStats: MatchStats,
  matchId: string
): Promise<StreakChanges> {
  const current = (await getPlayerStreaks(playerId)) ?? createDefaultStreaks(playerId);

  const nextWinStreak = matchResult.won
    ? current.current_win_streak + 1
    : (matchResult.lost || matchResult.drew ? 0 : current.current_win_streak);

  const nextLossStreak = matchResult.lost
    ? current.current_loss_streak + 1
    : (matchResult.won || matchResult.drew ? 0 : current.current_loss_streak);

  const nextKoStreak = matchStats.total_kos_dealt >= 3
    ? current.current_ko_streak + 1
    : 0;

  const nextFlawlessStreak = matchStats.total_kos_lost === 0
    ? current.current_flawless_streak + 1
    : 0;

  const nextBestWin = Math.max(current.best_win_streak, nextWinStreak);
  const nextBestLoss = Math.max(current.best_loss_streak, nextLossStreak);
  const nextBestKo = Math.max(current.best_ko_streak, nextKoStreak);
  const nextBestFlawless = Math.max(current.best_flawless_streak, nextFlawlessStreak);

  const newRecords: string[] = [];
  if (nextBestWin > current.best_win_streak) newRecords.push('win_streak');
  if (nextBestLoss > current.best_loss_streak) newRecords.push('loss_streak');
  if (nextBestKo > current.best_ko_streak) newRecords.push('ko_streak');
  if (nextBestFlawless > current.best_flawless_streak) newRecords.push('flawless_streak');

  await upsertPlayerStreaks(playerId, {
    current_win_streak: nextWinStreak,
    best_win_streak: nextBestWin,
    current_loss_streak: nextLossStreak,
    best_loss_streak: nextBestLoss,
    current_ko_streak: nextKoStreak,
    best_ko_streak: nextBestKo,
    current_flawless_streak: nextFlawlessStreak,
    best_flawless_streak: nextBestFlawless,
    last_match_id: matchId,
  });

  return {
    win_streak: { before: current.current_win_streak, after: nextWinStreak },
    loss_streak: { before: current.current_loss_streak, after: nextLossStreak },
    ko_streak: { before: current.current_ko_streak, after: nextKoStreak },
    flawless_streak: { before: current.current_flawless_streak, after: nextFlawlessStreak },
    new_records: newRecords,
  };
}

function aggregateMatchKOsForPlayer(
  groupedStats: Record<string, Array<{ player_id: string; kos_dealt: number; was_koed: boolean }>>,
  playerId: string
): MatchStats {
  const all = Object.values(groupedStats).flat().filter((s) => s.player_id === playerId);

  return {
    total_kos_dealt: all.reduce((sum, s) => sum + s.kos_dealt, 0),
    total_kos_lost: all.filter((s) => s.was_koed).length,
  };
}

/**
 * Resets and recomputes a player's streak rows by replaying completed matches in order.
 * Used for reset rollback when historical match outcomes change.
 */
export async function recomputeStreaks(playerId: string): Promise<void> {
  await upsertPlayerStreaks(playerId, {
    current_win_streak: 0,
    best_win_streak: 0,
    current_loss_streak: 0,
    best_loss_streak: 0,
    current_ko_streak: 0,
    best_ko_streak: 0,
    current_flawless_streak: 0,
    best_flawless_streak: 0,
    last_match_id: null,
  });

  const completedMatches = (await getMatchesByPlayer(playerId))
    .filter((m) => m.status === 'completed')
    .sort((a, b) => {
      const aTime = new Date(a.date_played ?? a.created_at).getTime();
      const bTime = new Date(b.date_played ?? b.created_at).getTime();
      return aTime - bTime;
    });

  for (const match of completedMatches) {
    const groupedStats = await getBattleStatsByMatch(match.id);
    const matchStats = aggregateMatchKOsForPlayer(groupedStats, playerId);

    const won = match.winner_id === playerId;
    const drew = match.winner_id === null;
    const lost = !won && !drew;

    await updateStreaks(
      playerId,
      { won, lost, drew },
      matchStats,
      match.id
    );
  }
}

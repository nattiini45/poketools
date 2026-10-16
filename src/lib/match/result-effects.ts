import { getMatchById } from '@/lib/supabase/queries/matches';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import { getBattleStatsByMatch } from '@/lib/supabase/queries/games';
import { buildGamePokemonStats, computePokemonScoreFromGameStats } from '@/lib/discord/helpers';
import { revalidateMatchPages } from '@/lib/revalidation';
import { emitDiscordEvent } from '@/lib/discord/notify';
import { emitSocialEvent } from '@/lib/social/notify';
import { triggerMatchAnalysis } from '@/lib/ai/trigger';
import { scheduleAggregateProcessing } from '@/lib/match/schedule-aggregate-processing';

interface MatchResultEffectsOptions {
  /** Whether the best-of threshold was reached (gates AI analysis). */
  boReached: boolean;
  /** Request cookie header, forwarded to the AI analysis trigger. */
  requestCookie: string | null;
  /** Replay URL to include in the Discord/social payload (omitted for manual entries). */
  replayUrl?: string;
}

/**
 * Shared post-record side effects for a recorded game result.
 *
 * Used by POST /api/parse-replay, POST /api/manual-result, and the admin
 * replay-import route. Runs ISR revalidation, fires the Discord/social
 * notification (fire-and-forget), triggers AI match analysis when the series
 * is complete, and schedules aggregate processing.
 *
 * Call this ONLY after the game pipeline has returned successfully. All
 * notification side effects are fire-and-forget — failures never break the
 * write path.
 */
export async function emitMatchResultEffects(
  matchId: string,
  { boReached, requestCookie, replayUrl }: MatchResultEffectsOptions
): Promise<void> {
  // Re-fetch the match so the notification payload reflects the post-record
  // winner_name set by the pipeline when the Bo threshold was reached.
  const match = await getMatchById(matchId);
  if (!match) return;

  // Bust ISR cache for affected pages
  await revalidateMatchPages(match.tournament_id, match.id);

  // Discord + social notification (fire-and-forget)
  const [tournament, round] = await Promise.all([
    getTournamentById(match.tournament_id),
    getRoundById(match.round_id),
  ]);
  if (tournament) {
    // Build per-game Pokémon KO stats for the Discord embed
    const statsByGame = await getBattleStatsByMatch(matchId);
    const gameStats = buildGamePokemonStats(match, statsByGame);

    // Pokémon score: sum of survivors across all games
    const pokScore = computePokemonScoreFromGameStats(
      gameStats,
      match.player_1_name,
      match.player_2_name
    );

    const resultPayload = {
      event_type: 'match_result_submitted' as const,
      tournament_id: match.tournament_id,
      season_id: tournament.season_id,
      data: {
        kind: 'match_result' as const,
        player_1_name: match.player_1_name,
        player_2_name: match.player_2_name,
        winner_name: match.winner_name ?? match.player_1_name,
        game_score: `${pokScore.p1}-${pokScore.p2}`,
        ...(replayUrl ? { replay_url: replayUrl } : {}),
        tournament_name: tournament.name,
        round_name: round?.name ?? `Round ${tournament.current_round}`,
        game_stats: gameStats,
      },
    };
    void emitDiscordEvent(resultPayload);
    void emitSocialEvent(resultPayload);
  }

  // AI match analysis (fire-and-forget, only when Bo threshold reached)
  if (boReached) {
    void triggerMatchAnalysis(matchId, requestCookie);
  }

  // Process aggregate jobs asynchronously (near-immediate via after())
  scheduleAggregateProcessing(5);
}

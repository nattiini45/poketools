import 'server-only';
import { after } from 'next/server';
import { anthropicApiKey } from '@/lib/ai/api-key';
import { generatePhaseAnalysis } from '@/lib/ai/phase-analysis';
import { buildGamePokemonStats, computePokemonScoreFromGameStats } from '@/lib/discord/helpers';
import { emitPhaseDiscordEvent } from '@/lib/discord/notify';
import { logger } from '@/lib/logger';
import { revalidatePhaseMatchPages } from '@/lib/revalidation';
import { emitPhaseSocialEvent } from '@/lib/social/notify';
import { getPhaseById } from '@/lib/supabase/queries/league-phases';
import { getPhaseBattleStatsByMatch } from '@/lib/supabase/queries/phase-games';
import { getPhaseMatchById } from '@/lib/supabase/queries/phase-matches';
import { getPhaseRoundById } from '@/lib/supabase/queries/phase-rounds';
import type { PhaseDiscordEventPayload } from '@/types/phase-events';
import { processPhaseAggregateJobs, type PhaseAggregateOwner } from './phase-aggregate-storage';

interface RecordedPhaseResult {
  game_id: string;
  game_winner_id: string;
  match_winner_id: string | null;
  bo_reached: boolean;
}

export async function emitPhaseResultEffects(
  owner: PhaseAggregateOwner,
  matchId: string,
  result: RecordedPhaseResult,
  { replayUrl }: { replayUrl?: string } = {},
): Promise<void> {
  const { phase_id: phaseId, season_id: seasonId } = owner;
  const context = { phaseId, seasonId, matchId, gameId: result.game_id };
  const warn = (message: string, error: unknown) => logger.warn('phase/result-effects', message, { ...context, error });

  try {
    await revalidatePhaseMatchPages(phaseId, matchId, seasonId);
  } catch (error) {
    warn('Could not revalidate the recorded result', error);
  }

  try {
    after(async () => {
      await Promise.all([
        processPhaseAggregateJobs(5, applied => revalidatePhaseMatchPages(applied.phase_id, undefined, applied.season_id))
          .catch(error => warn('Could not process phase aggregate jobs', error)),
        (async () => {
          if (!result.bo_reached || !anthropicApiKey()) return;
          const analysis = await generatePhaseAnalysis({ phaseId, matchId, kind: 'post_match' });
          if (analysis.kind === 'generated') await revalidatePhaseMatchPages(phaseId, matchId, seasonId);
        })().catch(error => warn('Could not generate native match analysis', error)),
      ]);
    });
  } catch (error) {
    warn('Could not schedule phase result effects', error);
  }

  try {
    const [phase, match] = await Promise.all([getPhaseById(phaseId), getPhaseMatchById(matchId)]);
    if (phase?.season_id !== seasonId || match?.phase_id !== phaseId) {
      throw new Error('Recorded result no longer belongs to this phase and league');
    }
    if (!match.games.some(game => game.id === result.game_id)) {
      throw new Error('Recorded game no longer belongs to this match');
    }
    const [round, stats] = await Promise.all([
      getPhaseRoundById(match.round_id, phaseId),
      getPhaseBattleStatsByMatch(matchId),
    ]);
    if (!round) throw new Error('Recorded result round not found in this phase');
    const winnerId = result.match_winner_id ?? result.game_winner_id;
    if (winnerId !== match.player_1_id && winnerId !== match.player_2_id) {
      throw new Error('Recorded result winner no longer belongs to this match');
    }
    const gameStats = buildGamePokemonStats(match, stats);
    const score = computePokemonScoreFromGameStats(gameStats, match.player_1_name, match.player_2_name);
    const payload: PhaseDiscordEventPayload = {
      version: 1,
      owner,
      event_type: 'match_result_submitted',
      data: {
        kind: 'match_result',
        player_1_name: match.player_1_name,
        player_2_name: match.player_2_name,
        winner_name: winnerId === match.player_1_id ? match.player_1_name : match.player_2_name,
        game_score: `${score.p1}-${score.p2}`,
        ...(replayUrl ? { replay_url: replayUrl } : {}),
        phase_name: phase.name,
        round_name: round.name,
        game_stats: gameStats,
      },
    };
    emitPhaseDiscordEvent(payload);
    emitPhaseSocialEvent(payload);
  } catch (error) {
    warn('Could not announce the recorded phase result', error);
  }
}

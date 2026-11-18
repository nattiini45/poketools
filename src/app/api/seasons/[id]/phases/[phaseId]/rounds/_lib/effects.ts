import { loadPhaseRoundScope } from '@/lib/ai/phase-context';
import { getPhaseAiParticipants } from '@/lib/supabase/queries/phase-ai-artifacts';
import { emitPhaseDiscordEvent } from '@/lib/discord/notify';
import { emitPhaseSocialEvent } from '@/lib/social/notify';
import { createNativePhaseServices } from '@/lib/league-phase/services';
import { loadPhaseReportStandings } from '@/lib/league-phase/report-standings';
import { logger } from '@/lib/logger';
import { expireSeasonReads, revalidatePhaseMatchPages } from '@/lib/revalidation';
import { getMatchesByPhase } from '@/lib/supabase/queries/phase-matches';
import { getPublicSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { BYE_PLAYER_ID } from '@/lib/tournament/types';
import type { Phase, PhaseRound } from '@/types/league-phase';
import type { PhaseDiscordEventPayload } from '@/types/phase-events';

export function nativeRoundServices(phase: Phase) {
  return createNativePhaseServices({
    invalidateMatch: (phaseId, match) => revalidatePhaseMatchPages(phaseId, match, phase.season_id),
    invalidateSeason: (season, phaseIds) => expireSeasonReads(season, { phaseIds }),
    invalidateWiki: id => revalidatePhaseMatchPages(id, undefined, phase.season_id),
  });
}

export async function onPhaseRoundCompleted(phase: Phase, round: PhaseRound) {
  const { matches: { kit }, triggerReport } = nativeRoundServices(phase);
  if (phase.season_format_type === 'custom') {
    try {
      await kit.roundCompleted({ phase, roundId: round.id });
    } catch (error) {
      logger.error('phase-rounds', 'Could not apply native round completion effects', { phaseId: phase.id, roundId: round.id, error });
    }
  }
  try {
    const [scope, matches, participants, leagueParticipants] = await Promise.all([
      loadPhaseRoundScope(phase.id, round.id),
      getMatchesByPhase(phase.id),
      getPhaseAiParticipants(phase.id),
      getPublicSeasonParticipants(phase.season_id),
    ]);
    const { current, previous } = await loadPhaseReportStandings({
      ...scope, matches, participants, leagueParticipants, reportType: 'round_recap',
    });
    const positions = new Map(previous?.map((row, index) => [row.player_id, index + 1]));
    const payload: PhaseDiscordEventPayload = {
      version: 1,
      owner: { kind: 'phase', phase_id: phase.id, season_id: phase.season_id },
      event_type: 'round_completed',
      data: {
        kind: 'round_completed',
        phase_name: phase.name,
        round_name: round.name,
        round_number: round.round_number,
        match_results: matches.filter(match => match.round_id === round.id && match.status === 'completed'
          && match.player_1_id !== BYE_PLAYER_ID && match.player_2_id !== BYE_PLAYER_ID).map(match => ({
          player_1_name: match.player_1_name,
          player_2_name: match.player_2_name,
          score: `${match.games.filter(game => game.winner_id === match.player_1_id).length}:${match.games.filter(game => game.winner_id === match.player_2_id).length}`,
          winner_name: match.winner_name,
        })),
        standings: current.map((row, index) => ({
          position: index + 1,
          player_name: row.player_name,
          wins: row.wins, losses: row.losses, draws: row.draws, points: row.points,
          position_change: previous === null ? null : (positions.get(row.player_id) ?? index + 1) - (index + 1),
        })),
      },
    };
    emitPhaseDiscordEvent(payload);
    emitPhaseSocialEvent(payload);
  } catch (error) {
    logger.error('phase-rounds', 'Could not assemble native round announcement', { phaseId: phase.id, roundId: round.id, error });
  }
  triggerReport(phase.id, round.id, 'round_recap');
}

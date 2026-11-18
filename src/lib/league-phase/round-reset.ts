import 'server-only';

import tournamentErrors from '@/i18n/messages/errors/tournaments/en';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { getPhaseParticipants } from '@/lib/supabase/queries/league-phases';
import { getMatchesByPhase, getPhaseMatchesByRound } from '@/lib/supabase/queries/phase-matches';
import { getRoundsByPhase } from '@/lib/supabase/queries/phase-rounds';
import { findDownstreamSlotKeys, findMatchForSlot, findSlotForMatch } from '@/lib/tournament/bracket-propagation';
import { buildBracketStructureForParticipants } from '@/lib/tournament/bracket-structure';
import type { Phase, PhaseRound } from '@/types/league-phase';

export async function planPhaseRoundReset(
  phase: Phase, round: PhaseRound, cascade: boolean,
) {
  const matches = await getPhaseMatchesByRound(round.id);
  const targets = matches.filter(match => match.status !== 'scheduled');
  const downstream = new Map<string, (typeof matches)[number]>();
  if ((phase.bracket_type === 'single_elim' || phase.bracket_type === 'double_elim')
      && targets.some(match => match.bracket_pos !== null)) {
    const [participants, rounds, phaseMatches] = await Promise.all([
      getPhaseParticipants(phase.id), getRoundsByPhase(phase.id), getMatchesByPhase(phase.id),
    ]);
    const structure = buildBracketStructureForParticipants(phase.bracket_type, participants, {
      bracketResetEnabled: true, thirdPlaceEnabled: true,
    });
    if (structure) {
      const roundIds = new Map(rounds.map(row => [row.round_number, row.id]));
      const keys = new Set<string>();
      for (const target of targets) {
        const source = findSlotForMatch(structure.slots, round.round_number, target.bracket_side, target.bracket_pos);
        if (source) for (const key of findDownstreamSlotKeys(structure, source.slotKey)) keys.add(key);
      }
      for (const slot of structure.slots) {
        if (!keys.has(slot.slotKey)) continue;
        const match = findMatchForSlot(phaseMatches, roundIds, slot);
        if (match) downstream.set(match.id, match);
      }
    }
  }
  if ([...matches, ...downstream.values()].some(match => match.status === 'scheduled' && match.games.length > 0)) {
    throw new UserFacingError(tournamentErrors.phase_round_reset_scheduled_games, {
      code: 'phase_round_reset_scheduled_games', status: 409,
    });
  }
  const playedDownstream = [...downstream.values()].filter(match => match.status !== 'scheduled');
  if (!cascade && playedDownstream.length > 0) {
    throw new UserFacingError(
      `${playedDownstream.length} downstream match(es) have results or are in progress. Pass cascade: true to reset the whole chain.`,
      { code: 'DOWNSTREAM_PLAYED', params: { count: playedDownstream.length }, status: 409 },
    );
  }
  return { targets, downstreamIds: [...downstream.keys()] };
}

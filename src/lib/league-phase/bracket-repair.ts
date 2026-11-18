import 'server-only';

import { buildSlotResolutionsFromMatches, findMatchForSlot, readyBracketSlots } from '@/lib/tournament/bracket-propagation';
import { bracketStructureOptionsOf, buildBracketStructureForParticipants } from '@/lib/tournament/bracket-structure';
import type { Phase, PhaseParticipant, PhaseRound } from '@/types/league-phase';
import type { PhaseMatchWithPlayers } from '@/types/league-phase-match';

export function planPhaseBracketRepair(
  phase: Pick<Phase, 'bracket_type' | 'bracket_reset_enabled' | 'third_place_enabled'>,
  participants: Pick<PhaseParticipant, 'id' | 'seed' | 'name' | 'starting_bracket'>[],
  rounds: Pick<PhaseRound, 'id' | 'round_number' | 'bracket_side'>[],
  matches: PhaseMatchWithPlayers[],
) {
  if (phase.bracket_type !== 'single_elim' && phase.bracket_type !== 'double_elim') return [];
  const structure = buildBracketStructureForParticipants(phase.bracket_type, participants, bracketStructureOptionsOf(phase));
  if (!structure) return [];
  const managed = rounds.filter(round => round.bracket_side !== null);
  const roundNumberById = new Map(managed.map(round => [round.id, round.round_number]));
  const roundIdByNumber = new Map(managed.map(round => [round.round_number, round.id]));
  const resolutions = buildSlotResolutionsFromMatches(structure.slots, matches, roundNumberById);
  return readyBracketSlots(participants, structure, roundIdByNumber, resolutions).flatMap(({ slot, roundId, player1Id, player2Id }) => {
    const existing = findMatchForSlot(matches, roundIdByNumber, slot);
    if (existing && (existing.status !== 'scheduled' || existing.games.length > 0
      || (existing.player_1_id === player1Id && existing.player_2_id === player2Id))) return [];
    return [{
      match_id: existing?.id ?? null,
      round_id: roundId,
      bracket_side: slot.bracket_side,
      bracket_pos: slot.bracket_pos,
      player_1_id: player1Id,
      player_2_id: player2Id,
    }];
  });
}

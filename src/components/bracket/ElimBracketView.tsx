import SingleElimBracket from '@/components/bracket/SingleElimBracket';
import DoubleElimBracket from '@/components/bracket/DoubleElimBracket';
import { isLegacyElimBracketData } from '@/components/bracket/legacy';
import { unneededResetSlotKeys } from '@/components/bracket/bracket-reset';
import { lossesEnteringMatches } from '@/components/bracket/entry-losses';
import type { BracketCopy } from '@/components/bracket/labels';
import { buildBracketStructureForParticipants, buildSlotIndexMap } from '@/lib/tournament/bracket-structure';
import { getBracketSlotLabels } from '@/lib/tournament/bracket-propagation';
import { computeBracketState, startingBracketsFromParticipants } from '@/lib/tournament/double-elim';
import type { MatchRecord } from '@/lib/tournament/types';
import type { PublicTournamentParticipant } from '@/lib/players/public-player';
import type { PublicMatch } from '@/lib/match/public-match';
import type { Round } from '@/types/round';

interface ElimBracketViewProps {
  bracketType: 'single_elim' | 'double_elim';
  tournamentId: string;
  rounds: Round[];
  matches: PublicMatch[];
  /** Phase enrollment: seeds place the slots, `starting_bracket` the losers-side starters. */
  participants: readonly Pick<PublicTournamentParticipant, 'id' | 'seed' | 'starting_bracket'>[];
  /** Completed results; only the winner matters (double elimination loss counts). */
  matchRecords: readonly MatchRecord[];
  /**
   * An explicit override of the bracket's words: renderer labels plus
   * translations of the engine's English round names and feeder labels.
   * Absent, the renderers show everything in the viewer's language
   * (`bracket` namespace, `translateEngineLabel`).
   */
  copy?: BracketCopy;
  /**
   * Double elimination: the tournament's "if necessary" Grand Finals reset
   * (`tournaments.bracket_reset_enabled`, default on). Off, an unplayed reset
   * slot is not drawn; a reset match that already exists always is.
   */
  bracketResetEnabled?: boolean;
}

/**
 * An elimination bracket with its slot structure: the slot skeleton from the
 * seeds and the "Winner of …" feeder labels. Double elimination drops the
 * bracket-reset slot once the winners-bracket entrant has won the Grand Final
 * (the reset is never played), and works out each player's loss count, which
 * sorts legacy rounds into their sections, and the losses each entrant
 * carried into every match, which the match cards print (the Grand Final's
 * 0 against 1 is what decides whether the reset is played). Legacy brackets (rounds without a
 * bracket side) fall back to the flat per-round lists.
 *
 * Server component: the feeder labels come from a server-only module, and the
 * Map props are built here and handed straight to the renderers. Shared by
 * the phase page and the league hub's playoff tab.
 */
export default function ElimBracketView({
  bracketType,
  tournamentId,
  rounds,
  matches,
  participants,
  matchRecords,
  copy,
  bracketResetEnabled = true,
}: ElimBracketViewProps) {
  const matchesByRound: Record<string, PublicMatch[]> = {};
  for (const match of matches) {
    (matchesByRound[match.round_id] ??= []).push(match);
  }

  const legacyMode = isLegacyElimBracketData(rounds, matches);
  // Always built WITH the reset slot, so a reset match played before the
  // reset was switched off still finds its slot; `unneededResetSlotKeys`
  // drops the slot when it should not be drawn.
  const structure = legacyMode
    ? null
    : buildBracketStructureForParticipants(bracketType, participants, { bracketResetEnabled: true });
  const slotIndexByKey = structure ? buildSlotIndexMap(structure.slots) : undefined;
  const engineLabels = structure ? getBracketSlotLabels(structure) : undefined;
  const slotLabels =
    engineLabels && copy
      ? new Map(
          [...engineLabels].map(([key, { label1, label2 }]) => [
            key,
            { label1: copy.slotLabel(label1), label2: copy.slotLabel(label2) },
          ]),
        )
      : engineLabels;
  const shownRounds = copy ? rounds.map((round) => ({ ...round, name: copy.roundName(round.name) })) : rounds;
  const labels = copy?.labels;

  if (bracketType === 'single_elim') {
    return (
      <SingleElimBracket
        rounds={shownRounds}
        matchesByRound={matchesByRound}
        tournamentId={tournamentId}
        structureSlots={structure?.slots}
        slotLabels={slotLabels}
        slotIndexByKey={slotIndexByKey}
        legacyMode={legacyMode}
        labels={labels}
      />
    );
  }

  const unneededResets = structure
    ? unneededResetSlotKeys(structure.slots, rounds, matches, bracketResetEnabled)
    : null;
  const structureSlots =
    structure && unneededResets && unneededResets.size > 0
      ? structure.slots.filter((slot) => !unneededResets.has(slot.slotKey))
      : structure?.slots;

  const participantIds = participants.map((participant) => participant.id);
  const bracketState = computeBracketState(
    participantIds,
    [...matchRecords],
    startingBracketsFromParticipants([...participants]),
  );
  const lossCount: Record<string, number> = {};
  for (const id of participantIds) {
    if (bracketState.winners_bracket.includes(id)) lossCount[id] = 0;
    else if (bracketState.losers_bracket.includes(id)) lossCount[id] = 1;
    else lossCount[id] = 2;
  }

  return (
    <DoubleElimBracket
      rounds={shownRounds}
      matchesByRound={matchesByRound}
      tournamentId={tournamentId}
      structureSlots={structureSlots}
      slotLabels={slotLabels}
      slotIndexByKey={slotIndexByKey}
      legacyMode={legacyMode}
      lossCount={lossCount}
      entryLosses={lossesEnteringMatches(rounds, matches, participants)}
      labels={labels}
    />
  );
}

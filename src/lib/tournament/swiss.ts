import type { Pairing, GeneratedRound, MatchRecord, ByeRecord } from './types';
import { BYE_PLAYER_ID } from './types';
import { computeStandings, buildPairingHistory, havePlayed } from './standings';

/**
 * Swiss/Monrad pairing algorithm.
 *
 * 1. Compute standings from completed matches (and stored byes, which score as wins)
 * 2. Sort players by points (desc), then buchholz
 * 3. Pair top-vs-next within score groups
 * 4. Enforce no-repeat constraint (slide down if already played)
 * 5. Handle bye for odd player count: the lowest-ranked player who has not had
 *    one (`byeHistory` lists the byes stored on earlier rounds)
 */
export function generateSwissRound(
  participantIds: string[],
  participantNames: Record<string, string>,
  matchHistory: MatchRecord[],
  roundNumber: number,
  byeHistory: ByeRecord[] = []
): GeneratedRound {
  const standings = computeStandings(
    participantIds,
    participantNames,
    matchHistory,
    {},
    { byes: byeHistory },
  );
  const history = buildPairingHistory(matchHistory, byeHistory);
  const pairings: Pairing[] = [];
  const byePlayerIds: string[] = [];

  // Work with a mutable copy of available players (sorted by standing)
  const available = standings.map((s) => s.player_id);

  // Handle bye for odd player count: lowest-ranked player gets the bye
  // Prefer a player who hasn't had a bye yet (a stored bye is a BYE pairing in the history)
  if (available.length % 2 !== 0) {
    let byeIdx = available.length - 1;
    // Try to give bye to lowest-ranked player who hasn't had one
    for (let i = available.length - 1; i >= 0; i--) {
      if (!havePlayed(history, available[i], BYE_PLAYER_ID)) {
        byeIdx = i;
        break;
      }
    }
    byePlayerIds.push(available[byeIdx]);
    available.splice(byeIdx, 1);
  }

  // Pair remaining players
  const paired = new Set<string>();

  for (let i = 0; i < available.length; i++) {
    if (paired.has(available[i])) continue;

    const p1 = available[i];
    // Find the highest-ranked unpaired opponent who hasn't played p1
    for (let j = i + 1; j < available.length; j++) {
      if (paired.has(available[j])) continue;

      const p2 = available[j];
      if (!havePlayed(history, p1, p2)) {
        pairings.push({ player_1_id: p1, player_2_id: p2 });
        paired.add(p1);
        paired.add(p2);
        break;
      }
    }

    // If no valid opponent found (all have been played), pair with closest anyway
    if (!paired.has(p1)) {
      for (let j = i + 1; j < available.length; j++) {
        if (!paired.has(available[j])) {
          pairings.push({ player_1_id: p1, player_2_id: available[j] });
          paired.add(p1);
          paired.add(available[j]);
          break;
        }
      }
    }
  }

  return {
    round_number: roundNumber,
    round_name: `Round ${roundNumber}`,
    pairings,
    bye_player_ids: byePlayerIds,
  };
}

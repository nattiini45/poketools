import type { ByeRecord, MatchRecord } from './types';
import { computeStandings } from './standings';

export interface ClinchStatus {
  playerId: string;
  playerName: string;
  currentRank: number;
  status: 'clinched' | 'eliminated' | 'alive';
  magicNumber: number | null; // wins needed to clinch
}

/**
 * Compute playoff clinch/elimination status for each player.
 * Brute-force: simulate all remaining match outcomes.
 * Feasible for leagues with <20 players and <30 remaining matches.
 */
export function computeClinchScenarios(
  participantIds: string[],
  participantNames: Record<string, string>,
  completedMatches: MatchRecord[],
  remainingMatches: Array<{ player_1_id: string; player_2_id: string }>,
  playoffSlots: number,
  byes: ByeRecord[] = []
): ClinchStatus[] {
  const current = computeStandings(participantIds, participantNames, completedMatches, {}, { byes });

  // If too many remaining matches, skip brute force
  if (remainingMatches.length > 20) {
    return current.map((s, i) => ({
      playerId: s.player_id,
      playerName: s.player_name,
      currentRank: i + 1,
      status: 'alive' as const,
      magicNumber: null,
    }));
  }

  // For each player, check:
  // - clinched: they make playoffs in ALL possible remaining outcomes
  // - eliminated: they miss playoffs in ALL possible remaining outcomes
  // - alive: neither

  const totalOutcomes = Math.pow(2, remainingMatches.length);
  const playerBestRank = new Map<string, number>();
  const playerWorstRank = new Map<string, number>();

  for (const id of participantIds) {
    playerBestRank.set(id, Infinity);
    playerWorstRank.set(id, 0);
  }

  // Enumerate all outcomes (binary: 0 = P1 wins, 1 = P2 wins)
  for (let outcome = 0; outcome < totalOutcomes; outcome++) {
    const simulated: MatchRecord[] = [...completedMatches];
    for (let j = 0; j < remainingMatches.length; j++) {
      const m = remainingMatches[j];
      const p1Wins = ((outcome >> j) & 1) === 0;
      simulated.push({
        player_1_id: m.player_1_id,
        player_2_id: m.player_2_id,
        winner_id: p1Wins ? m.player_1_id : m.player_2_id,
        round_number: 999,
      });
    }

    const standings = computeStandings(participantIds, participantNames, simulated, {}, { byes });
    for (let rank = 0; rank < standings.length; rank++) {
      const id = standings[rank].player_id;
      const r = rank + 1;
      const best = playerBestRank.get(id) ?? Infinity;
      const worst = playerWorstRank.get(id) ?? 0;
      if (r < best) playerBestRank.set(id, r);
      if (r > worst) playerWorstRank.set(id, r);
    }
  }

  return current.map((s, i) => {
    const best = playerBestRank.get(s.player_id) ?? Infinity;
    const worst = playerWorstRank.get(s.player_id) ?? Infinity;

    let status: ClinchStatus['status'];
    if (worst <= playoffSlots) status = 'clinched';
    else if (best > playoffSlots) status = 'eliminated';
    else status = 'alive';

    // Magic number: simplified — wins needed is (playoffSlots - currentRank + 1) when alive
    const magicNumber = status === 'alive'
      ? Math.max(0, playoffSlots - s.wins + 1)
      : null;

    return {
      playerId: s.player_id,
      playerName: s.player_name,
      currentRank: i + 1,
      status,
      magicNumber,
    };
  });
}

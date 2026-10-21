import type { MatchRecord } from '@/lib/tournament/types';
import { computeStandings } from '@/lib/tournament/standings';
import type { Locale } from '@/i18n/config';
import { createTranslator } from '@/i18n/core';
import { broadcastCasterMessages } from '@/i18n/messages/broadcast-caster';

export interface StandingsImpact {
  player1WinScenario: { rank: number; change: number; clinchNote: string | null };
  player2WinScenario: { rank: number; change: number; clinchNote: string | null };
  currentP1Rank: number;
  currentP2Rank: number;
}

/**
 * Simulate both outcomes (P1 wins / P2 wins) and compute rank deltas.
 * `locale` is the language of the `clinchNote` text (default English).
 */
export function computeStandingsImpact(
  p1Id: string,
  p2Id: string,
  matchRecords: MatchRecord[],
  participantIds: string[],
  participantNames: Record<string, string>,
  playoffSlots?: number,
  locale: Locale = 'en',
): StandingsImpact {
  const t = createTranslator(broadcastCasterMessages, locale);
  // Current standings
  const current = computeStandings(participantIds, participantNames, matchRecords);
  const currentP1Rank = current.findIndex((s) => s.player_id === p1Id) + 1;
  const currentP2Rank = current.findIndex((s) => s.player_id === p2Id) + 1;

  // Simulate P1 win
  const p1WinRecords: MatchRecord[] = [
    ...matchRecords,
    { player_1_id: p1Id, player_2_id: p2Id, winner_id: p1Id, round_number: 999 },
  ];
  const p1WinStandings = computeStandings(participantIds, participantNames, p1WinRecords);
  const p1WinRank = p1WinStandings.findIndex((s) => s.player_id === p1Id) + 1;

  // Simulate P2 win
  const p2WinRecords: MatchRecord[] = [
    ...matchRecords,
    { player_1_id: p1Id, player_2_id: p2Id, winner_id: p2Id, round_number: 999 },
  ];
  const p2WinStandings = computeStandings(participantIds, participantNames, p2WinRecords);
  const p2WinRank = p2WinStandings.findIndex((s) => s.player_id === p2Id) + 1;

  // Clinch/elimination detection
  const slots = playoffSlots ?? Math.ceil(participantIds.length / 2);

  function clinchNote(rank: number, prevRank: number): string | null {
    if (rank <= slots && prevRank > slots) return t('generated.clinchesPlayoffs');
    if (rank > slots && prevRank <= slots) return t('generated.dropsOutOfPlayoffs');
    if (rank === 1) return t('generated.takesFirst');
    return null;
  }

  return {
    player1WinScenario: {
      rank: p1WinRank,
      change: currentP1Rank - p1WinRank,
      clinchNote: clinchNote(p1WinRank, currentP1Rank),
    },
    player2WinScenario: {
      rank: p2WinRank,
      change: currentP2Rank - p2WinRank,
      clinchNote: clinchNote(p2WinRank, currentP2Rank),
    },
    currentP1Rank,
    currentP2Rank,
  };
}

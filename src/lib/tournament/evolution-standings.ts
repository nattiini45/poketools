/**
 * Evolution Point Buy standings with format-specific tiebreaker chain.
 *
 * The tiebreaker order is the season's stored `format_rules.tiebreaker_order` when it is a usable chain, else the
 * format pack's `epb.tiebreakerChain` (`effectiveTiebreakerChain`, `./standings-rules`): match points, evolution
 * points, kill difference and head-to-head in that order; `decision_match` (last when present) is a flag only —
 * not auto-scheduled.
 */

import type { Standing, MatchRecord } from './types';
import type { TournamentBattleStat } from '@/lib/supabase/queries/games';
import type { TiebreakerStep } from '@/types/format-rules';
import { epbPack } from '@/lib/format-pack';
import { resolveHeadToHead } from './head-to-head';
import { effectiveTiebreakerChain } from './standings-rules';

export interface EvolutionStanding extends Standing {
  evolution_points: number;
  /** Flag: true if this player is in an unresolved tie requiring a decision match */
  needs_decision_match: boolean;
}

export interface EvolutionStandingsOptions {
  /** Points awarded per win (default: the format pack's `epb.matchPoints.win`) */
  pointsPerWin?: number;
  /** Points awarded per draw (default: the format pack's `epb.matchPoints.draw`) */
  pointsPerDraw?: number;
  /** Battle stats for computing kill differential */
  battleStats?: TournamentBattleStat[];
  /**
   * The season's stored `format_rules.tiebreaker_order`, as read (not yet checked). A usable chain ranks the table;
   * anything else (absent, empty, unknown or repeated step) falls back to the pack's chain.
   */
  tiebreakerOrder?: unknown;
}

type RankingStep = Exclude<TiebreakerStep, 'decision_match'>;

/** One ranking step: negative = `a` ranks first, positive = `b` ranks first, 0 = tied on it. */
function compareOnStep(
  step: RankingStep,
  a: EvolutionStanding,
  b: EvolutionStanding,
  matches: MatchRecord[],
): number {
  switch (step) {
    case 'match_points':
      return b.points - a.points;
    case 'evolution_points':
      return b.evolution_points - a.evolution_points;
    case 'kill_difference':
      return b.kill_differential - a.kill_differential;
    case 'head_to_head':
      // h2h returns 1 if a wins, we want a first
      return -resolveHeadToHead(a.player_id, b.player_id, matches);
  }
}

/**
 * Compute standings for the Evolution Point Buy format.
 * Ranks by the stored tiebreaker order when it is usable, else by the format pack's chain (`epb.tiebreakerChain`).
 */
export function computeEvolutionPointBuyStandings(
  participantIds: string[],
  participantNames: Record<string, string>,
  matches: MatchRecord[],
  evolutionPoints: Record<string, number>,
  participantAvatars: Record<string, string | null> = {},
  options: EvolutionStandingsOptions = {},
): EvolutionStanding[] {
  const {
    pointsPerWin = epbPack.matchPoints.win,
    pointsPerDraw = epbPack.matchPoints.draw,
    battleStats,
    tiebreakerOrder,
  } = options;
  const chain = effectiveTiebreakerChain({ tiebreaker_order: tiebreakerOrder });
  const rankingSteps = chain.filter((s): s is RankingStep => s !== 'decision_match');
  const flagsDecisionMatch = chain.includes('decision_match');

  // Initialize standings
  const standingMap = new Map<string, EvolutionStanding>();
  for (const pid of participantIds) {
    standingMap.set(pid, {
      player_id: pid,
      player_name: participantNames[pid] ?? 'Unknown',
      player_avatar_url: participantAvatars[pid] ?? null,
      gym_type: null,
      wins: 0,
      losses: 0,
      draws: 0,
      points: 0,
      buchholz: 0,
      games_played: 0,
      kill_differential: 0,
      eliminated: false,
      evolution_points: evolutionPoints[pid] ?? 0,
      needs_decision_match: false,
    });
  }

  // Tally wins/losses from completed matches
  for (const match of matches) {
    const s1 = standingMap.get(match.player_1_id);
    const s2 = standingMap.get(match.player_2_id);
    if (!s1 || !s2) continue;

    if (match.winner_id === match.player_1_id) {
      s1.wins++;
      s1.points += pointsPerWin;
      s2.losses++;
    } else if (match.winner_id === match.player_2_id) {
      s2.wins++;
      s2.points += pointsPerWin;
      s1.losses++;
    } else {
      s1.draws++;
      s1.points += pointsPerDraw;
      s2.draws++;
      s2.points += pointsPerDraw;
    }
  }

  // Compute kill differential from battle stats
  if (battleStats) {
    for (const stat of battleStats) {
      const standing = standingMap.get(stat.player_id);
      if (!standing) continue;
      standing.kill_differential += stat.kos_dealt;
      if (stat.was_koed) standing.kill_differential -= 1;
    }
  }

  // Sort with the effective tiebreaker chain: the first non-zero step decides
  const standings = Array.from(standingMap.values());
  standings.sort((a, b) => {
    for (const step of rankingSteps) {
      const result = compareOnStep(step, a, b, matches);
      if (result !== 0) return result;
    }
    // Decision match needed (flag)
    return 0;
  });

  // Flag players in complete ties (every ranking step equal) as needing a decision match,
  // only when the chain ends in one
  if (flagsDecisionMatch) {
    for (let i = 0; i < standings.length - 1; i++) {
      const a = standings[i];
      const b = standings[i + 1];
      if (rankingSteps.every((step) => compareOnStep(step, a, b, matches) === 0)) {
        a.needs_decision_match = true;
        b.needs_decision_match = true;
      }
    }
  }

  return standings;
}

import type { AdvancementRule } from '@/types/season';
import type { MatchRecord } from './types';
import { computeStandings } from './standings';
import type { TournamentGroupWithMembers } from '@/types/season';

export interface AdvancementResult {
  /** Player IDs that advance to the next stage */
  advancing_player_ids: string[];
  /** Human-readable description of what happened */
  summary: string;
}

/**
 * Compute which players advance from a completed stage tournament
 * to the next stage, based on the advancement rule.
 *
 * @param rule The advancement rule (e.g., top 2 per group)
 * @param participantIds All participant IDs in the source tournament
 * @param participantNames Map of player ID → name
 * @param matchRecords Completed match records
 * @param groups Optional group structure (for per_group advancement)
 */
export function computeAdvancement(
  rule: AdvancementRule,
  participantIds: string[],
  participantNames: Record<string, string>,
  matchRecords: MatchRecord[],
  groups?: TournamentGroupWithMembers[]
): AdvancementResult {
  switch (rule.type) {
    case 'top_n':
      return computeTopN(rule, participantIds, participantNames, matchRecords, groups);
    default: {
      const _exhaustive: never = rule.type;
      throw new Error(`Unknown advancement type: ${_exhaustive}`);
    }
  }
}

function computeTopN(
  rule: AdvancementRule,
  participantIds: string[],
  participantNames: Record<string, string>,
  matchRecords: MatchRecord[],
  groups?: TournamentGroupWithMembers[]
): AdvancementResult {
  const advancing: string[] = [];

  if (rule.per_group && groups && groups.length > 0) {
    // Take top N from each group
    for (const group of groups) {
      const groupPlayerIds = group.members.map((m) => m.player_id);
      const groupMatches = matchRecords.filter(
        (m) =>
          groupPlayerIds.includes(m.player_1_id) &&
          groupPlayerIds.includes(m.player_2_id)
      );

      const standings = computeStandings(groupPlayerIds, participantNames, groupMatches);
      const topN = standings.slice(0, rule.count);
      advancing.push(...topN.map((s) => s.player_id));
    }

    return {
      advancing_player_ids: advancing,
      summary: `Top ${rule.count} from each of ${groups.length} groups (${advancing.length} players total)`,
    };
  } else {
    // Take top N overall
    const standings = computeStandings(participantIds, participantNames, matchRecords);
    const topN = standings.slice(0, rule.count);
    advancing.push(...topN.map((s) => s.player_id));

    return {
      advancing_player_ids: advancing,
      summary: `Top ${rule.count} overall (${advancing.length} players)`,
    };
  }
}

import 'server-only';
import { phasePublicReads, type PublicPhase } from '@/lib/cache/phase-public-reads';
import { publicReads } from '@/lib/cache/public-reads';
import { kitForPhase } from '@/lib/format-engine/context';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import type { MatchRecord } from '@/lib/tournament/types';

export async function loadNativePhasePageData(
  phase: Pick<PublicPhase, 'id' | 'season_id' | 'season_format_type' | 'ruleset_id'>,
  includeReports: boolean,
) {
  const { id, season_id: seasonId } = phase;
  const epb = isEvolutionPointBuy(phase.season_format_type ?? '');
  const [
    rounds, matches, participants, ruleset, battleStats, participantGymTypes, reports, aggregates,
    totalGamesInScope, season, evolutionPoints, formatRules, seasonKit, hiddenPlayerIds,
  ] = await Promise.all([
    phasePublicReads.rounds(id),
    phasePublicReads.matches(id),
    phasePublicReads.participants(id),
    phase.ruleset_id ? getRulesetById(phase.ruleset_id) : null,
    phasePublicReads.battleStats(id),
    publicReads.seasonGymTypes(seasonId),
    includeReports ? phasePublicReads.reports(id) : [],
    publicReads.aggregatesSummary('phase', id),
    publicReads.totalGames('phase', id),
    publicReads.seasonRow(seasonId),
    epb ? publicReads.seasonEvolutionPoints(seasonId) : undefined,
    epb ? publicReads.seasonFormatRules(seasonId) : null,
    phase.season_format_type === 'custom' ? phasePublicReads.seasonKitStandings(seasonId) : null,
    publicReads.hiddenPlayerIds(),
  ]);
  if (!season) return null;
  const matchRecords: MatchRecord[] = [];
  for (const match of matches) {
    if (match.status !== 'completed') continue;
    if (match.round_number === undefined) throw new Error('Completed phase match has no round number');
    matchRecords.push({
      match_id: match.id, player_1_id: match.player_1_id, player_2_id: match.player_2_id,
      winner_id: match.winner_id, round_number: match.round_number,
      bracket_side: match.bracket_side, bracket_pos: match.bracket_pos,
    });
  }
  return {
    rounds, matches, participants, matchRecords, ruleset, battleStats, participantGymTypes, reports,
    aggregates, totalGamesInScope, season, evolutionPoints, hiddenPlayerIds,
    tiebreakerOrder: formatRules?.tiebreaker_order,
    kit: kitForPhase(seasonKit, id),
  };
}

import 'server-only';
import { getByeRoundsByPhaseIds } from '@/lib/supabase/queries/phase-rounds';
import { getPhaseStandingsBattleStats } from '@/lib/supabase/queries/phase-games';
import { computeStandingsFromContext } from '@/lib/tournament/season-standings';
import { effectiveMatchPoints, roundRobinMatchPoints } from '@/lib/tournament/standings-rules';
import { formatScoresByes, scoringByeRecords } from '@/lib/tournament/byes';
import { byesThroughRound } from '@/lib/tournament/scoring-byes';
import { playoffStandingsOptions } from '@/lib/tournament/league-placings';
import { kitForPhase, ranksWithKit } from '@/lib/format-engine/context';
import type { MatchRecord } from '@/lib/tournament/types';
import type { PhaseReportStandings } from '@/lib/ai/kale/phase-fact-pack';
import { loadNativeSeasonStandingsContext } from './standings-context';

export const loadPhaseReportStandings: PhaseReportStandings = async input => {
  const { phase, round, season, matches, participants, leagueParticipants, reportType } = input;
  if (phase.season_id !== season.id || round.phase_id !== phase.id) throw new Error('Report standings scope mismatch');
  if (matches.some(match => match.phase_id !== phase.id || match.round_number === undefined)) {
    throw new Error('Report standings require native phase matches with round numbers');
  }
  const loaded = await loadNativeSeasonStandingsContext(season.id);
  const phaseKit = kitForPhase(loaded.kit, phase.id);
  if (loaded.kit && !phaseKit) throw new Error('Report phase has no attached kit stage');
  const context = { ...loaded, ...(phaseKit ? { kit: phaseKit } : {}) };
  const scoresByes = formatScoresByes(context.formatType) && phase.bracket_type === 'swiss';
  const [rounds, battleStats] = await Promise.all([
    scoresByes ? getByeRoundsByPhaseIds([phase.id]) : Promise.resolve(new Map<string, never[]>()),
    ranksWithKit(context.formatType, phaseKit) ? Promise.resolve([]) : getPhaseStandingsBattleStats(phase.id),
  ]);
  const ids = participants.map(player => player.id);
  const names = Object.fromEntries(participants.map(player => [player.id, player.name]));
  const avatars = Object.fromEntries(participants.map(player => [player.id, player.avatar_url]));
  const gymTypes = Object.fromEntries(leagueParticipants.map(player => [player.id, player.gym_type]));
  const records: MatchRecord[] = matches.filter(match => match.status === 'completed').map(match => ({
    match_id: match.id, player_1_id: match.player_1_id, player_2_id: match.player_2_id,
    winner_id: match.winner_id, round_number: match.round_number!,
    bracket_side: match.bracket_side, bracket_pos: match.bracket_pos,
  }));
  const byes = scoresByes ? scoringByeRecords(phase.bracket_type, rounds.get(phase.id) ?? []) : [];
  const cutoff = round.round_number - (reportType === 'round_forecast' ? 1 : 0);
  const currentByes = byesThroughRound(byes, cutoff);
  const previousByes = byesThroughRound(byes, cutoff - 1);
  const points = effectiveMatchPoints(context.formatType, phase.bracket_type === 'round_robin'
    ? roundRobinMatchPoints(context.formatType) : {});
  const table = (through: number, scoringByes: typeof byes) => computeStandingsFromContext(context, ids, names,
    records.filter(record => record.round_number <= through), avatars,
    { ...points, ...playoffStandingsOptions(phase, ids.length), byes: scoringByes,
      battleStats: battleStats.filter(stat => stat.round_number <= through) }, gymTypes);
  const scoring = ranksWithKit(context.formatType, phaseKit)
    ? JSON.stringify(phaseKit.stages[phase.id].scoring)
    : JSON.stringify({ win: points.pointsPerWin ?? 1, draw: points.pointsPerDraw ?? 0.5, loss: 0 });
  return {
    current: table(cutoff, currentByes),
    previous: cutoff > 0 ? table(cutoff - 1, previousByes) : null,
    currentByes, previousByes, scoring,
  };
};

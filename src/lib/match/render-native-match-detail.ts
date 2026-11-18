import 'server-only';
import { notFound } from 'next/navigation';
import MatchDetail from '@/components/match/MatchDetail';
import { getLiveAccess } from '@/lib/auth/helpers';
import { phasePublicReads, type PublicPhaseMatch } from '@/lib/cache/phase-public-reads';
import { kitForPhase } from '@/lib/format-engine/context';
import { loadNativeSeasonStandingsContext } from '@/lib/league-phase/standings-context';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { listPhaseMatchProposals } from '@/lib/supabase/queries/match-proposals';
import { getPhaseMatchAnalysis } from '@/lib/supabase/queries/phase-ai-artifacts';
import { hasViewedPhaseEpbReplay } from '@/lib/supabase/queries/phase-epb-animation-views';
import { getPhaseBattleStatsByMatch } from '@/lib/supabase/queries/phase-games';
import { getPhaseMatchSnapshots } from '@/lib/supabase/queries/phase-match-snapshots';
import { getPhaseMatchById } from '@/lib/supabase/queries/phase-matches';
import { getListEntries } from '@/lib/supabase/queries/point-buy-lists';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getPlayerStreaks } from '@/lib/supabase/queries/streaks';
import { formatScoresByes, scoringByeRecords } from '@/lib/tournament/byes';
import { computeStandingsFromContext } from '@/lib/tournament/season-standings';
import type { MatchRecord } from '@/lib/tournament/types';
import { resolveContentLocale } from '@/i18n/content-locale';

export async function renderNativeMatchDetail(seasonId: string, match: PublicPhaseMatch, href: string) {
  const phaseId = match.phase_id;
  const phase = await phasePublicReads.detail(seasonId, phaseId);
  if (!phase || phase.id !== phaseId || phase.season_id !== seasonId) notFound();

  const isEpb = isEvolutionPointBuy(phase.season_format_type ?? '');
  const [rounds, matches, participants, context, battleStatsByGame, analysis, player1Streaks, player2Streaks, access] =
    await Promise.all([
      phasePublicReads.rounds(phaseId),
      phasePublicReads.matches(phaseId),
      phasePublicReads.participants(phaseId),
      loadNativeSeasonStandingsContext(seasonId),
      getPhaseBattleStatsByMatch(match.id),
      getPhaseMatchAnalysis(phaseId, match.id),
      getPlayerStreaks(match.player_1_id),
      getPlayerStreaks(match.player_2_id),
      getLiveAccess(),
    ]);

  const round = rounds.find(row => row.id === match.round_id && row.phase_id === phaseId) ?? null;
  const matchRecords: MatchRecord[] = [];
  for (const row of matches) {
    if (row.status !== 'completed') continue;
    if (row.round_number === undefined) throw new Error('Completed phase match has no round number');
    matchRecords.push({
      match_id: row.id, player_1_id: row.player_1_id, player_2_id: row.player_2_id,
      winner_id: row.winner_id, round_number: row.round_number,
      bracket_side: row.bracket_side, bracket_pos: row.bracket_pos,
    });
  }
  const byes = formatScoresByes(phase.season_format_type) ? scoringByeRecords(phase.bracket_type, rounds) : [];
  const standings = computeStandingsFromContext(
    { ...context, kit: kitForPhase(context.kit, phaseId) },
    participants.map(player => player.id),
    Object.fromEntries(participants.map(player => [player.id, player.name])),
    matchRecords,
    {},
    { byes },
  );

  const viewer = access?.player;
  const viewerId = viewer && (access?.isSiteAdmin || (viewer.status !== 'banned' && viewer.status !== 'suspended'))
    ? viewer.playerId
    : undefined;
  const isParticipant = viewerId === match.player_1_id || viewerId === match.player_2_id;
  const [privateMatch, contentLocale, epb, proposals] = await Promise.all([
    access?.isSiteAdmin ? getPhaseMatchById(match.id) : null,
    analysis?.status === 'completed' ? resolveContentLocale({ seasonId }) : undefined,
    isEpb ? loadNativeEpbMatchDetail(match.id, seasonId, phaseId, viewerId) : undefined,
    viewerId && isParticipant ? listPhaseMatchProposals(match.id, viewerId) : [],
  ]);

  return MatchDetail({
    match,
    competition: phase,
    round,
    battleStatsByGame,
    analysis,
    standings,
    player1Streaks,
    player2Streaks,
    back: { kind: 'phase', href },
    viewerId,
    notes: privateMatch?.id === match.id && privateMatch.phase_id === phaseId ? privateMatch.notes : undefined,
    contentLocale,
    epb,
    proposals,
  });
}

async function loadNativeEpbMatchDetail(matchId: string, seasonId: string, phaseId: string, viewerId?: string) {
  const [snapshots, season, replayViewed] = await Promise.all([
    getPhaseMatchSnapshots(matchId),
    getSeasonById(seasonId),
    viewerId ? hasViewedPhaseEpbReplay(viewerId, matchId) : false,
  ]);
  const entries = season?.point_buy_list_id ? await getListEntries(season.point_buy_list_id) : [];
  return {
    snapshots, entries, replayViewed,
    viewedEndpoint: `/api/seasons/${seasonId}/phases/${phaseId}/matches/${matchId}/epb-replay-viewed`,
  };
}

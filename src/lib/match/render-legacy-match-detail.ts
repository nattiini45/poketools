import 'server-only';

import { notFound } from 'next/navigation';
import { getMatchById, getCompletedMatchRecords } from '@/lib/supabase/queries/matches';
import { listMatchProposals } from '@/lib/supabase/queries/match-proposals';
import { getBattleStatsByMatch, getGamesByMatch } from '@/lib/supabase/queries/games';
import { getMatchAnalysis } from '@/lib/supabase/queries/match-analyses';
import { getTournamentWithDetails, getParticipants } from '@/lib/supabase/queries/tournaments';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import { getPlayerStreaks } from '@/lib/supabase/queries/streaks';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import { computeStandingsForSeason } from '@/lib/tournament/season-standings';
import { loadScoringByes } from '@/lib/tournament/scoring-byes';
import { getMatchSnapshots } from '@/lib/supabase/queries/match-snapshots';
import { getListEntries } from '@/lib/supabase/queries/point-buy-lists';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { isEvolutionPointBuy } from '@/lib/season/format-utils';
import { resolveContentLocale } from '@/i18n/content-locale';
import type { Locale } from '@/i18n/config';
import { getLiveAccess, getSessionPlayer } from '@/lib/auth/helpers';
import { hasViewedEpbReplay } from '@/lib/supabase/queries/epb-animation-views';
import MatchDetail from '@/components/match/MatchDetail';
import type { MatchWithPlayers } from '@/types/match';

export async function renderLegacyMatchDetail(
  id: string,
  mid: string,
  canonical?: { seasonId: string; href: string; match: MatchWithPlayers },
) {
  const scopedTournament = canonical ? await getTournamentWithDetails(id) : null;
  if (canonical && (canonical.match.tournament_id !== id || scopedTournament?.season_id !== canonical.seasonId)) notFound();
  const player = await getSessionPlayer();
  // A signed-in viewer may be a game editor: read the games' versions BEFORE
  // the match and its battle stats. The inline editor sends its game's
  // version back as `expected_updated_at`, so any change after this read
  // (even one landing between the reads below) makes its save answer 409
  // instead of overwriting that change with the older data shown. Anonymous
  // viewers never edit, and the versions reach editors only.
  const gamesAtLoad = player ? await getGamesByMatch(mid) : [];
  const match = canonical && !player ? canonical.match : await getMatchById(mid);
  // The match must belong to the tournament in the URL, or the page would
  // render under (and link back to) another tournament.
  if (!match || match.tournament_id !== id) notFound();

  const [
    battleStatsByGame,
    analysis,
    tournament,
    round,
    participants,
    matchRecords,
    player1Streaks,
    player2Streaks,
  ] = await Promise.all([
    getBattleStatsByMatch(match.id),
    getMatchAnalysis(match.id),
    scopedTournament ?? getTournamentWithDetails(match.tournament_id),
    getRoundById(match.round_id),
    getParticipants(match.tournament_id),
    getCompletedMatchRecords(match.tournament_id),
    getPlayerStreaks(match.player_1_id),
    getPlayerStreaks(match.player_2_id),
  ]);

  // Compute tournament standings and extract each player's rank + W/L
  // (format-aware: EPB seasons use the evolution-points tiebreaker chain)
  const participantIds = participants.map((p) => p.id);
  const participantNames: Record<string, string> = {};
  for (const p of participants) participantNames[p.id] = p.name;
  // A Swiss stage scores its stored byes as wins, as the tournament page does.
  const byes = tournament ? await loadScoringByes(tournament) : [];
  const standings = await computeStandingsForSeason(
    tournament?.season_id ?? null, participantIds, participantNames, matchRecords, {}, { byes }
  );

  const isParticipant = player
    ? player.playerId === match.player_1_id || player.playerId === match.player_2_id
    : false;
  const initialProposals = isParticipant ? await listMatchProposals(match.id) : [];

  // Edit access mirrors PATCH /api/admin/games/[id]: site admins + per-tournament
  // resource admins. Resolved server-side so the Edit button only renders for
  // viewers the backend will actually authorize.
  const canEditGames = player
    ? player.isAdmin ||
      (await isResourceAdminFor(player.playerId, 'tournament', match.tournament_id))
    : false;
  const gameVersions: ReadonlyMap<string, string> = canEditGames
    ? new Map(gamesAtLoad.map((g) => [g.id, g.updated_at]))
    : new Map();
  const seasonId = tournament?.season_id;
  const epb = isEvolutionPointBuy(tournament?.season_format_type ?? '') && seasonId
    ? await loadLegacyEpbMatchDetail(match.id, seasonId, player?.playerId)
    : undefined;

  // The admin notes (dispute log) are admin-only data: gate them on the live
  // role read (`getLiveAccess`, AGENTS.md D37), never on the session copy,
  // which can be up to 5 minutes stale. Read only when the match has notes
  // and the viewer is signed in, so an anonymous view or a match without
  // notes costs no extra query. A failed read rethrows (fail closed).
  const showAdminNotes =
    match.notes && player ? (await getLiveAccess())?.isSiteAdmin === true : false;

  // The league's content language (seasons.language, i18n-core §6.3/§6.4):
  // the language the stored AI analysis was written in and the one the social
  // image is captured in. One narrow read, only when something uses it (a
  // stored analysis, or the admin's social-image button); standalone
  // tournaments use the default without a read.
  const hasStoredAnalysis = analysis?.status === 'completed';
  const contentLocale: Locale | undefined =
    hasStoredAnalysis || player?.isAdmin
      ? await resolveContentLocale({ seasonId: tournament?.season_id })
      : undefined;

  return MatchDetail({
    match,
    competition: tournament,
    round,
    battleStatsByGame,
    analysis,
    standings,
    player1Streaks,
    player2Streaks,
    back: canonical ? { kind: 'phase', href: canonical.href } : { kind: 'tournament', href: `/tournaments/${id}` },
    viewerId: player?.playerId,
    notes: showAdminNotes ? match.notes : undefined,
    contentLocale,
    epb,
    proposals: initialProposals,
    legacyActions: { isSiteAdmin: player?.isAdmin, canEditGames, gameVersions },
  });
}

async function loadLegacyEpbMatchDetail(matchId: string, seasonId: string, playerId?: string) {
  const [snapshots, season] = await Promise.all([
    getMatchSnapshots(matchId),
    getSeasonById(seasonId),
  ]);
  const entries = season?.point_buy_list_id ? await getListEntries(season.point_buy_list_id) : [];
  const replayViewed = playerId ? await hasViewedEpbReplay(playerId, matchId) : false;
  return { snapshots, entries, replayViewed };
}

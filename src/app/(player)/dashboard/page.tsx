import { getSession } from '@/lib/auth/helpers';
import { requireLiveIdentityOrSignIn } from '@/lib/auth/redirect-to-sign-in';
import { getPlayerById } from '@/lib/supabase/queries/players';
import { getMatchesByPlayer } from '@/lib/supabase/queries/matches';
import { getTournamentsByPlayer, listTournamentsByIds } from '@/lib/supabase/queries/tournaments';
import { getSeasonsByPlayer, listSeasonsByIds } from '@/lib/supabase/queries/seasons';
import { getPlayerRating } from '@/lib/supabase/queries/ratings';
import { getPlayerStreaks } from '@/lib/supabase/queries/streaks';
import { getPlayerScopeUsage } from '@/lib/supabase/queries/aggregates';
import { getPlayerFormatFacts, listActiveDraftTurns, listPlayerTeamSlots } from '@/lib/supabase/queries/dashboard-now';
import { publicReads } from '@/lib/cache/public-reads';
import { FULL_STANDINGS_LIMIT, playerStandingFromRows } from '@/lib/stats/standings-preview';
import DashboardContent from './DashboardContent';
import { buildTeamsUsed, teamsUsedScopeIds } from './teams-used';
import { buildDraftTurns, buildFormatActions, teamlessMatchIds } from './now-queue';
import Alert from '@/components/ui/Alert';
import PageContainer from '@/components/ui/PageContainer';
import { getT } from '@/i18n/server';
import { dashboardMessages } from '@/i18n/messages/dashboard';

export const dynamic = 'force-dynamic';

export const revalidate = 0; // Dashboard is user-specific, always fresh

export default async function DashboardPage() {
  // The layout is not re-rendered on a client navigation, so this page is the gate that sees a revoked session: only a
  // signed-in identity without a player gets the not-registered note. The player (id, name, avatar) is read live; the
  // token's provider image is display-only.
  const [{ player: livePlayer }, session] = await Promise.all([requireLiveIdentityOrSignIn(), getSession()]);

  if (!livePlayer) {
    const t = await getT(dashboardMessages);
    return (
      <PageContainer title={t('pageTitle')}>
        <Alert variant="warning">{t('notRegistered')}</Alert>
      </PageContainer>
    );
  }

  const playerId = livePlayer.playerId;

  const [player, matches, tournaments, leagues, rating, streaks, scopeUsage, draftTurnRows] = await Promise.all([
    getPlayerById(playerId),
    getMatchesByPlayer(playerId),
    getTournamentsByPlayer(playerId),
    getSeasonsByPlayer(playerId),
    getPlayerRating(playerId),
    getPlayerStreaks(playerId),
    getPlayerScopeUsage(playerId),
    listActiveDraftTurns(playerId),
  ]);

  // Stats outlive membership (a swapped-out player keeps their games), so the
  // teams resolve leagues and tournaments the player no longer belongs to.
  const { leagueIds, tournamentIds } = teamsUsedScopeIds(scopeUsage);
  const knownLeagueIds = new Set(leagues.map((l) => l.id));
  const knownTournamentIds = new Set(tournaments.map((t) => t.id));
  // The "Now" queue beyond matches: the team slots of the upcoming matches' tournaments, and the open business in the
  // running custom leagues (no request when the player has neither).
  const upcomingMatches = matches.filter((m) => m.status === 'scheduled' || m.status === 'in_progress');
  const runningCustomLeagues = leagues.filter((l) => l.format_type === 'custom' && l.status === 'active' && !l.archived);
  const [leagueStandings, extraLeagues, extraTournaments, teamSlots, formatFacts] = await Promise.all([
    // Completed leagues never change, so the shared cached table is read
    // instead of recomputing every league's standings per dashboard load.
    Promise.all(
      leagues.map(async (league) => {
        const rows = await publicReads.standingsPreview('league', league.id, FULL_STANDINGS_LIMIT);
        return {
          leagueId: league.id,
          leagueName: league.name,
          status: league.status,
          formatType: league.format_type,
          participantCount: league.participant_count,
          // Test leagues are listed too (getSeasonsByPlayer sorts them last), badged.
          isTestSeason: league.is_test_season,
          snapshot: playerStandingFromRows(rows, playerId),
        };
      }),
    ),
    listSeasonsByIds(leagueIds.filter((id) => !knownLeagueIds.has(id))),
    listTournamentsByIds(tournamentIds.filter((id) => !knownTournamentIds.has(id))),
    listPlayerTeamSlots(playerId, [...new Set(upcomingMatches.map((m) => m.tournament_id))]),
    getPlayerFormatFacts(playerId, runningCustomLeagues.map((l) => l.id), new Date()),
  ]);

  const teamsUsed = buildTeamsUsed(
    scopeUsage,
    [...leagues, ...extraLeagues],
    [...tournaments, ...extraTournaments].map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      season_id: t.season_id ?? null,
      created_at: t.created_at,
    })),
  );

  return (
    <PageContainer maxWidth="lg">
    <DashboardContent
      playerId={playerId}
      playerName={livePlayer.name}
      avatarUrl={session?.user?.image || undefined}
      customAvatarUrl={livePlayer.avatarUrl || undefined}
      initialPlayer={player}
      initialMatches={matches}
      initialTournaments={tournaments}
      playerRating={rating}
      playerStreaks={streaks}
      leagueStandings={leagueStandings}
      teamsUsed={teamsUsed}
      draftTurns={buildDraftTurns(draftTurnRows)}
      formatActions={buildFormatActions(runningCustomLeagues, formatFacts)}
      teamlessMatchIds={teamlessMatchIds(upcomingMatches, teamSlots)}
    />
    </PageContainer>
  );
}

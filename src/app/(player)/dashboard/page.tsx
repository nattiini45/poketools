import { getSession } from '@/lib/auth/helpers';
import { getPlayerById } from '@/lib/supabase/queries/players';
import { getMatchesByPlayer } from '@/lib/supabase/queries/matches';
import { getTournamentsByPlayer, listTournamentsByIds } from '@/lib/supabase/queries/tournaments';
import { getSeasonsByPlayer, listSeasonsByIds } from '@/lib/supabase/queries/seasons';
import { getPlayerRating } from '@/lib/supabase/queries/ratings';
import { getPlayerStreaks } from '@/lib/supabase/queries/streaks';
import { getPlayerScopeUsage } from '@/lib/supabase/queries/aggregates';
import { publicReads } from '@/lib/cache/public-reads';
import { FULL_STANDINGS_LIMIT, playerStandingFromRows } from '@/lib/stats/standings-preview';
import DashboardContent from './DashboardContent';
import { buildTeamsUsed, teamsUsedScopeIds } from './teams-used';
import PageContainer from '@/components/ui/PageContainer';
import { getT } from '@/i18n/server';
import { dashboardMessages } from '@/i18n/messages/dashboard';

export const dynamic = 'force-dynamic';

export const revalidate = 0; // Dashboard is user-specific, always fresh

export default async function DashboardPage() {
  const session = await getSession();

  if (!session?.player) {
    const t = await getT(dashboardMessages);
    return (
      <PageContainer title={t('pageTitle')}>
        <div className="bg-poke-yellow-light border border-poke-yellow/40 rounded-poke-lg p-5">
          <p className="text-sm text-yellow-700 dark:text-poke-yellow font-heading font-semibold">
            {t('notRegistered')}
          </p>
        </div>
      </PageContainer>
    );
  }

  const playerId = session.player.playerId;

  const [player, matches, tournaments, leagues, rating, streaks, scopeUsage] = await Promise.all([
    getPlayerById(playerId),
    getMatchesByPlayer(playerId),
    getTournamentsByPlayer(playerId),
    getSeasonsByPlayer(playerId),
    getPlayerRating(playerId),
    getPlayerStreaks(playerId),
    getPlayerScopeUsage(playerId),
  ]);

  // Stats outlive membership (a swapped-out player keeps their games), so the
  // teams resolve leagues and tournaments the player no longer belongs to.
  const { leagueIds, tournamentIds } = teamsUsedScopeIds(scopeUsage);
  const knownLeagueIds = new Set(leagues.map((l) => l.id));
  const knownTournamentIds = new Set(tournaments.map((t) => t.id));
  const [leagueStandings, extraLeagues, extraTournaments] = await Promise.all([
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
          snapshot: playerStandingFromRows(rows, playerId),
        };
      }),
    ),
    listSeasonsByIds(leagueIds.filter((id) => !knownLeagueIds.has(id))),
    listTournamentsByIds(tournamentIds.filter((id) => !knownTournamentIds.has(id))),
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
    <DashboardContent
      playerId={playerId}
      playerName={session.player.name}
      avatarUrl={session.user?.image || undefined}
      customAvatarUrl={session.player.avatarUrl || undefined}
      initialPlayer={player}
      initialMatches={matches}
      initialTournaments={tournaments}
      playerRating={rating}
      playerStreaks={streaks}
      leagueStandings={leagueStandings}
      teamsUsed={teamsUsed}
    />
  );
}

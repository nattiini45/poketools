import { getSession } from '@/lib/auth/helpers';
import { getPlayerById } from '@/lib/supabase/queries/players';
import { getMatchesByPlayer } from '@/lib/supabase/queries/matches';
import { listTeamsByPlayer } from '@/lib/supabase/queries/teams';
import { getTournamentsByPlayer } from '@/lib/supabase/queries/tournaments';
import { getSeasonsByPlayer } from '@/lib/supabase/queries/seasons';
import { getPlayerRating } from '@/lib/supabase/queries/ratings';
import { getPlayerStreaks } from '@/lib/supabase/queries/streaks';
import { getPlayerRankInLeague } from '@/lib/stats/standings-preview';
import DashboardContent from './DashboardContent';
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

  const [player, matches, teams, tournaments, leagues, rating, streaks] = await Promise.all([
    getPlayerById(playerId),
    getMatchesByPlayer(playerId),
    listTeamsByPlayer(playerId),
    getTournamentsByPlayer(playerId),
    getSeasonsByPlayer(playerId),
    getPlayerRating(playerId),
    getPlayerStreaks(playerId),
  ]);

  const activeLeagues = leagues.filter((l) => l.status === 'active');
  const leagueStandings = await Promise.all(
    activeLeagues.map(async (league) => {
      const snapshot = await getPlayerRankInLeague(league.id, playerId);
      return {
        leagueId: league.id,
        leagueName: league.name,
        snapshot,
      };
    }),
  );

  return (
    <DashboardContent
      playerId={playerId}
      playerName={session.player.name}
      avatarUrl={session.user?.image || undefined}
      customAvatarUrl={session.player.avatarUrl || undefined}
      initialPlayer={player}
      initialMatches={matches}
      initialTeams={teams}
      initialTournaments={tournaments}
      initialLeagues={leagues}
      playerRating={rating}
      playerStreaks={streaks}
      leagueStandings={leagueStandings}
    />
  );
}

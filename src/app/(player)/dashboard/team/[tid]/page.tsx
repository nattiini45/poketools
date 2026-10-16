import { notFound, redirect } from 'next/navigation';
import AuthGuard from '@/components/shared/AuthGuard';
import TeambuilderClient from '@/components/teambuilder/TeambuilderClient';
import { getTeamById } from '@/lib/supabase/queries/teams';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { getDraftPoolBySeason } from '@/lib/supabase/queries/drafts';
import { getSessionPlayer } from '@/lib/auth/helpers';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ tid: string }>;
}

export default async function DashboardTeamPage({ params }: PageProps) {
  const { tid } = await params;
  const player = await getSessionPlayer();
  if (!player) redirect('/');

  const team = await getTeamById(tid);
  if (!team) notFound();

  // Only the owner can view this page
  if (team.player_id !== player.playerId && !player.isAdmin) {
    redirect('/dashboard');
  }

  const tournament = team.tournament_id ? await getTournamentById(team.tournament_id) : null;
  const [ruleset, draftPool] = await Promise.all([
    tournament ? getRulesetById(tournament.ruleset_id) : Promise.resolve(null),
    tournament?.season_id ? getDraftPoolBySeason(tournament.season_id) : Promise.resolve(null),
  ]);

  return (
    <AuthGuard>
      <TeambuilderClient
        tournamentId={team.tournament_id}
        rulesetId={ruleset?.id}
        rulesetName={ruleset?.name}
        baseFormat={ruleset?.base_format}
        seasonId={tournament?.season_id ?? undefined}
        isDraftLeague={!!draftPool}
        initialPokemon={team.pokemon}
        teamId={team.id}
        teamName={team.name}
        locked={team.locked}
      />
    </AuthGuard>
  );
}

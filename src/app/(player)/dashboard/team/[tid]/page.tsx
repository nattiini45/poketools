import { notFound, redirect } from 'next/navigation';
import AuthGuard from '@/components/shared/AuthGuard';
import TeambuilderClient from '@/components/teambuilder/TeambuilderClient';
import { getTeamById, getTeamVisibilityFacts } from '@/lib/supabase/queries/teams';
import { isCompletedMatchLocked } from '@/lib/team/completed-match-lock';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { getInitialPoolForPlayer } from '@/lib/draft/player-pool';
import { getLiveAccess } from '@/lib/auth/helpers';
import { isValidUuid } from '@/lib/utils/uuid';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ tid: string }>;
}

export default async function DashboardTeamPage({ params }: PageProps) {
  const { tid } = await params;
  // The page renders the full roster, so the owner-or-admin gate reads the
  // live player and roles (AGENTS.md: view gates use getLiveAccess, never the
  // up-to-5-minutes-stale session copy): a revoked admin loses access at once.
  const access = await getLiveAccess();
  const player = access?.player;
  if (!access || !player) redirect('/');

  // A malformed id names no team (the uuid filter would fail as a 500).
  if (!isValidUuid(tid)) notFound();
  const team = await getTeamById(tid);
  if (!team) notFound();

  // Only the owner (or a site admin) can view this page
  if (team.player_id !== player.playerId && !access.isSiteAdmin) {
    redirect('/dashboard');
  }

  const tournament = team.tournament_id ? await getTournamentById(team.tournament_id) : null;
  const [ruleset, draftPool, completedMatch] = await Promise.all([
    tournament ? getRulesetById(tournament.ruleset_id) : Promise.resolve(null),
    // The team owner's pool: the season's, or the owner's group's in a league with groups.
    tournament?.season_id ? getInitialPoolForPlayer(tournament.season_id, team.player_id) : Promise.resolve(null),
    // A team of a completed match is final for its owner (lead ruling round 5: PATCH answers 409
    // team_match_completed); a site admin keeps the correction path, so the editor stays open for them.
    team.match_id && !access.isSiteAdmin
      ? getTeamVisibilityFacts([team.id]).then((facts) => isCompletedMatchLocked(facts.get(team.id)?.match_status))
      : Promise.resolve(false),
  ]);

  return (
    <AuthGuard>
      <TeambuilderClient
        tournamentId={team.tournament_id}
        rulesetId={ruleset?.id}
        rulesetName={ruleset?.name}
        baseFormat={ruleset?.base_format}
        gen={ruleset?.gen}
        seasonId={tournament?.season_id ?? undefined}
        isDraftLeague={!!draftPool}
        initialPokemon={team.pokemon}
        teamId={team.id}
        teamName={team.name}
        locked={team.locked || completedMatch}
        lockReason={completedMatch ? 'completed_match' : 'tournament'}
      />
    </AuthGuard>
  );
}

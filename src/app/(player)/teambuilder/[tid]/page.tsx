import { notFound } from 'next/navigation';
import AuthGuard from '@/components/shared/AuthGuard';
import TeambuilderClient from '@/components/teambuilder/TeambuilderClient';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { getInitialPoolForPlayer } from '@/lib/draft/player-pool';
import { requireLiveIdentityOrSignIn } from '@/lib/auth/redirect-to-sign-in';
import { getPlayerTeamForTournament } from '@/lib/supabase/queries/teams';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ tid: string }>;
}

export default async function TournamentTeambuilderPage({ params }: PageProps) {
  const { tid } = await params;
  // The layout is not re-rendered on a client navigation, so a revoked session is stopped here, before any read.
  const { player } = await requireLiveIdentityOrSignIn();
  const tournament = await getTournamentById(tid);
  if (!tournament) notFound();

  // The ruleset is the phase's own pin: an immutable version, so the rules the player builds against are the rules
  // the league validates against.
  const [ruleset, draftPool] = await Promise.all([
    getRulesetById(tournament.ruleset_id),
    // The viewer's pool: the season's, or their own group's in a league with groups.
    tournament.season_id
      ? getInitialPoolForPlayer(tournament.season_id, async () => player?.playerId ?? null)
      : Promise.resolve(null),
  ]);

  // Check if the player already has a team for this tournament
  let existingTeam = null;
  if (player) {
    existingTeam = await getPlayerTeamForTournament(player.playerId, tid);
  }

  return (
    <AuthGuard>
    <TeambuilderClient
      tournamentId={tid}
      rulesetId={ruleset?.id}
      rulesetName={ruleset?.name}
      baseFormat={ruleset?.base_format}
      gen={ruleset?.gen}
      seasonId={tournament.season_id ?? undefined}
      isDraftLeague={!!draftPool}
      initialPokemon={existingTeam?.pokemon}
      teamId={existingTeam?.id}
      teamName={existingTeam?.name}
      locked={existingTeam?.locked}
    />
    </AuthGuard>
  );
}

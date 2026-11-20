import { notFound } from 'next/navigation';
import AuthGuard from '@/components/shared/AuthGuard';
import TeambuilderClient from '@/components/teambuilder/TeambuilderClient';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getPhaseById } from '@/lib/supabase/queries/league-phases';
import { getPlayerPhaseTeamForPhase } from '@/lib/supabase/queries/phase-teams';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { getInitialPoolForPlayer } from '@/lib/draft/player-pool';
import { requireLiveIdentityOrSignIn } from '@/lib/auth/redirect-to-sign-in';
import { resolveIdOnlyCompetitionRoute } from '@/lib/league-phase/competition-route-owner';
import { getPlayerTeamForTournament } from '@/lib/supabase/queries/teams';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ tid: string }>;
}

export default async function TournamentTeambuilderPage({ params }: PageProps) {
  const { tid } = await params;
  // The layout is not re-rendered on a client navigation, so a revoked session is stopped here, before any read.
  const { player } = await requireLiveIdentityOrSignIn();

  // The id's owner decides the store: a tournament, or the league phase that replaced it under the same id (the
  // transfer keeps ids, so a booked URL keeps working).
  const owner = await resolveIdOnlyCompetitionRoute(tid);
  if (!owner) notFound();

  if (owner.kind === 'phase') {
    const phase = await getPhaseById(owner.phase_id);
    if (!phase) notFound();

    // The ruleset is the phase's own pin: an immutable version, so the rules the player builds against are the rules
    // the league validates against.
    const [ruleset, draftPool, existingTeam] = await Promise.all([
      getRulesetById(phase.ruleset_id),
      // The viewer's pool: the season's, or their own group's in a league with groups.
      getInitialPoolForPlayer(phase.season_id, async () => player?.playerId ?? null),
      // The player's team for the phase: their planned row, else the roster they registered for a match of it.
      player ? getPlayerPhaseTeamForPhase(player.playerId, phase.id) : Promise.resolve(null),
    ]);

    return (
      <AuthGuard>
        <TeambuilderClient
          tournamentId={null}
          phaseId={phase.id}
          matchId={existingTeam?.match_id ?? null}
          rulesetId={ruleset?.id}
          rulesetName={ruleset?.name}
          baseFormat={ruleset?.base_format}
          gen={ruleset?.gen}
          seasonId={phase.season_id}
          isDraftLeague={!!draftPool}
          initialPokemon={existingTeam?.pokemon}
          teamId={existingTeam?.id}
          teamName={existingTeam?.name}
          locked={existingTeam?.locked}
        />
      </AuthGuard>
    );
  }

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

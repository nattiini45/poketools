import { notFound } from 'next/navigation';
import AuthGuard from '@/components/shared/AuthGuard';
import TeambuilderClient from '@/components/teambuilder/TeambuilderClient';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import {
  resolveEffectiveRuleset,
} from '@/lib/supabase/queries/rulesets';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getDraftPoolBySeason } from '@/lib/supabase/queries/drafts';
import { getSessionPlayer } from '@/lib/auth/helpers';
import { getPlayerTeamForTournament } from '@/lib/supabase/queries/teams';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ tid: string }>;
}

export default async function TournamentTeambuilderPage({ params }: PageProps) {
  const { tid } = await params;
  const tournament = await getTournamentById(tid);
  if (!tournament) notFound();

  // Load the tournament's season (if any) so the resolver can use the
  // league name + season.ruleset_id for the custom-over-base precedence
  // (e.g. resolves the actual 'Type Triangle League' ruleset instead of
  // the base 'Gen 9 RU' ruleset when the tournament's ruleset_id is wrong).
  const season = tournament.season_id ? await getSeasonById(tournament.season_id) : null;

  const [resolved, player, draftPool] = await Promise.all([
    resolveEffectiveRuleset({
      tournamentRulesetId: tournament.ruleset_id,
      tournamentBracketType: tournament.bracket_type,
      season: season
        ? { id: season.id, name: season.name, rulesetId: season.ruleset_id }
        : null,
    }),
    getSessionPlayer(),
    tournament.season_id ? getDraftPoolBySeason(tournament.season_id) : Promise.resolve(null),
  ]);

  const ruleset = resolved?.ruleset ?? null;

  // Check if the player already has a team for this tournament
  let existingTeam = null;
  if (player) {
    existingTeam = await getPlayerTeamForTournament(player.playerId, tid);
  }

  return (
    <AuthGuard>
    <TeambuilderClient
      tournamentId={tid}
      rulesetId={resolved?.rulesetId}
      rulesetName={ruleset?.name}
      baseFormat={ruleset?.base_format}
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

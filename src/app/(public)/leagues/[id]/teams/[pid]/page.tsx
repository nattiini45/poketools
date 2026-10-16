import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getStagesBySeasonId } from '@/lib/supabase/queries/tournaments';
import { listTeamsByTournamentIds } from '@/lib/supabase/queries/teams';
import { getPlayerById } from '@/lib/supabase/queries/players';
import { getSessionPlayer } from '@/lib/auth/helpers';
import { filterTeamVisibility } from '@/lib/team/visibility';
import TeamDisplay from '@/components/teambuilder/TeamDisplay';
import { getT } from '@/i18n/server';
import { leaguesMessages } from '@/i18n/messages/leagues';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string; pid: string }>;
}

export default async function PlayerTeamPage({ params }: PageProps) {
  const { id: seasonId, pid: playerId } = await params;

  const season = await getSeasonById(seasonId);
  if (!season) notFound();

  const isEvoPointBuy = season.format_type === 'evolution_point_buy';

  // EPB seasons show per-player teams via the scrollworld team overlay.
  // Legacy subroute permanently redirects into the teams section with the
  // overlay param; other formats keep this page.
  if (isEvoPointBuy) {
    permanentRedirect(`/leagues/${seasonId}?team=${playerId}#teams`);
  }

  const [teamOwner, viewer, t] = await Promise.all([
    getPlayerById(playerId),
    getSessionPlayer(),
    getT(leaguesMessages),
  ]);

  if (!teamOwner) notFound();

  const stages = await getStagesBySeasonId(seasonId);
  const stageIds = stages.map((s) => s.id);
  const allTeams = await listTeamsByTournamentIds(stageIds);
  const foundTeam = allTeams.find((t) => t.player_id === playerId) ?? null;

  if (!foundTeam) notFound();

  let visible = true;
  let displayPokemon: NonNullable<typeof foundTeam>['pokemon'] = [];
  if (foundTeam) {
    const [team] = await filterTeamVisibility([foundTeam], {
      viewerId: viewer?.playerId ?? null,
      isAdmin: viewer?.isAdmin ?? false,
      tournamentId: foundTeam.tournament_id ?? undefined,
    });
    visible = team.pokemon[0]?.species !== 'hidden';
    displayPokemon = team.pokemon;
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{t('team.title', { name: teamOwner.name })}</h1>
        <p className="text-sm text-poke-text-secondary">{season.name}</p>
      </div>

      {foundTeam && !visible ? (
        <div className="p-4 bg-yellow-900/30 border border-yellow-700 rounded text-sm text-yellow-400 mb-4">
          {t('team.hidden')}
        </div>
      ) : null}

      {foundTeam && <TeamDisplay pokemon={displayPokemon} readOnly />}

      <Link
        href={`/leagues/${seasonId}/teams`}
        className="inline-block mt-6 text-sm text-blue-600 hover:underline"
      >
        <span aria-hidden="true">&larr; </span>
        {t('team.backToTeams')}
      </Link>
    </div>
  );
}

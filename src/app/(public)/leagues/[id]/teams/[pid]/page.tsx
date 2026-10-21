import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getStagesBySeasonId } from '@/lib/supabase/queries/tournaments';
import { listTeamsByTournamentIds } from '@/lib/supabase/queries/teams';
import { getPlayerById } from '@/lib/supabase/queries/players';
import { getLiveAccess } from '@/lib/auth/helpers';
import { pickDisplayTeams, resolveTeamVisibility, toVisibleTeam } from '@/lib/team/visibility';
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

  // Live roles (AGENTS.md) for the admin grant on hidden rosters.
  const [teamOwner, access, t] = await Promise.all([
    getPlayerById(playerId),
    getLiveAccess(),
    getT(leaguesMessages),
  ]);

  if (!teamOwner) notFound();

  const stages = await getStagesBySeasonId(seasonId);
  const stageIds = stages.map((s) => s.id);
  const allTeams = await listTeamsByTournamentIds(stageIds);
  const playerTeams = allTeams.filter((t) => t.player_id === playerId);
  if (playerTeams.length === 0) notFound();

  // Spec §7 per row (H3), same row choice as the league team list.
  const visibility = await resolveTeamVisibility(playerTeams, {
    viewerId: access?.player?.playerId ?? null,
    isAdmin: access?.isSiteAdmin ?? false,
  });
  const [{ team: foundTeam, visible }] = pickDisplayTeams(playerTeams, visibility);
  const displayPokemon = toVisibleTeam(foundTeam, visible).pokemon;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{t('team.title', { name: teamOwner.name })}</h1>
        <p className="text-sm text-poke-text-secondary">{season.name}</p>
      </div>

      {!visible ? (
        <div className="p-4 bg-yellow-900/30 border border-yellow-700 rounded text-sm text-yellow-400 mb-4">
          {t('team.hidden')}
        </div>
      ) : null}

      <TeamDisplay pokemon={displayPokemon} readOnly />

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

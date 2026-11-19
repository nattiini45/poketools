import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getPlayerById } from '@/lib/supabase/queries/players';
import { getLiveAccess } from '@/lib/auth/helpers';
import { getLeagueDisplayTeams } from '@/lib/team/phase-visibility';
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

  const [team] = await getLeagueDisplayTeams(seasonId, {
    viewerId: access?.player?.playerId ?? null,
    isAdmin: access?.isSiteAdmin ?? false,
  }, playerId);
  if (!team) notFound();

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{t('team.title', { name: teamOwner.name })}</h1>
        <p className="text-sm text-fg-muted">{season.name}</p>
      </div>

      {!team.visible ? (
        <div className="p-4 bg-accent-subtle border border-hairline-strong rounded text-sm text-accent-ink mb-4">
          {t('team.hidden')}
        </div>
      ) : null}

      <TeamDisplay pokemon={team.pokemon} readOnly />

      <Link
        href={`/leagues/${seasonId}/teams`}
        className="inline-block mt-6 text-sm text-accent-ink hover:underline"
      >
        <span aria-hidden="true">&larr; </span>
        {t('team.backToTeams')}
      </Link>
    </div>
  );
}

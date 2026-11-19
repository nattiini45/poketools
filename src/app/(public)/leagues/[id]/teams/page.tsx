import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getPlayersByIds } from '@/lib/supabase/queries/players';
import { getLiveAccess } from '@/lib/auth/helpers';
import { getLeagueDisplayTeams } from '@/lib/team/phase-visibility';
import PageContainer from '@/components/ui/PageContainer';
import Card from '@/components/ui/Card';
import PokemonSprite from '@/components/shared/PokemonSprite';
import { getT } from '@/i18n/server';
import { leaguesMessages } from '@/i18n/messages/leagues';

export const dynamic = 'force-dynamic';

export const revalidate = 60;

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function LeagueTeamsPage({ params }: PageProps) {
  const { id } = await params;
  const season = await getSeasonById(id);
  if (!season) notFound();

  // EPB seasons render teams inside the EvoLiga scrollworld. Legacy subroute
  // permanently redirects into the teams section; other formats keep this page.
  if (season.format_type === 'evolution_point_buy') {
    permanentRedirect(`/leagues/${id}#teams`);
  }

  // Live roles (AGENTS.md): the admin grant reveals hidden rosters, so a
  // demoted admin must lose it at once, not when the session token refreshes.
  const [access, t] = await Promise.all([getLiveAccess(), getT(leaguesMessages)]);
  const teams = await getLeagueDisplayTeams(id, {
    viewerId: access?.player?.playerId ?? null,
    isAdmin: access?.isSiteAdmin ?? false,
  });
  const playerMap = await getPlayersByIds(teams.map((team) => team.player_id));

  return (
    <PageContainer
      title={t('teams.title', { league: season.name })}
      subtitle={t('teams.registered', { count: teams.length })}
    >
      {teams.length === 0 ? (
        <p className="text-fg-muted">{t('teams.empty')}</p>
      ) : (
        <div className="grid gap-4">
          {teams.map((team) => (
            <Link key={team.id} href={`/leagues/${id}/teams/${team.player_id}`}>
              <Card hover padding="md">
                <h2 className="font-heading font-semibold text-sm text-fg mb-2">{playerMap.get(team.player_id)?.name ?? t('teams.unknownPlayer')}</h2>
                <div className="flex gap-2">
                  {team.visible ? (
                    team.pokemon.slice(0, 6).map((poke, i) => (
                      <PokemonSprite key={i} name={poke.species} size={40} />
                    ))
                  ) : (
                    Array.from({ length: 6 }).map((_, i) => (
                      <div
                        key={i}
                        title={t('teams.hiddenSlot')}
                        className="w-10 h-10 bg-sunken rounded-poke-md flex items-center justify-center text-fg-muted text-xs"
                      >
                        ?
                      </div>
                    ))
                  )}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <Link
        href={`/leagues/${id}`}
        className="inline-block text-sm text-accent-ink hover:underline"
      >
        <span aria-hidden="true">&larr; </span>
        {t('teams.backToLeague')}
      </Link>
    </PageContainer>
  );
}

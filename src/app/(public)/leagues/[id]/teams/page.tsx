import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getStagesBySeasonId } from '@/lib/supabase/queries/tournaments';
import { listTeamsByTournamentIds } from '@/lib/supabase/queries/teams';
import { getPlayersByIds } from '@/lib/supabase/queries/players';
import { getLiveAccess } from '@/lib/auth/helpers';
import { pickDisplayTeams, resolveTeamVisibility, toVisibleTeam } from '@/lib/team/visibility';
import type { PublicTeam } from '@/lib/team/public-team';
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

interface TeamWithVisibility extends PublicTeam {
  player_name: string;
  visible: boolean;
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
  const viewerId = access?.player?.playerId ?? null;
  const isAdmin = access?.isSiteAdmin ?? false;

  // Fetch stages + all teams in a single batch (not per-stage)
  const stages = await getStagesBySeasonId(id);
  const stageIds = stages.map((s) => s.id);
  const allTeams = await listTeamsByTournamentIds(stageIds);

  // Spec §7 per row (H3): owner/admin always see; everyone else sees a row
  // once it is linked to a completed match (or the stage is always_public).
  // One row per player: their newest visible row, else their first row.
  const visibility = await resolveTeamVisibility(allTeams, { viewerId, isAdmin });
  const uniqueTeams = pickDisplayTeams(allTeams, visibility);

  const playerMap = await getPlayersByIds(uniqueTeams.map(({ team }) => team.player_id));

  const teamsWithVisibility: TeamWithVisibility[] = uniqueTeams.map(({ team, visible }) => ({
    ...toVisibleTeam(team, visible),
    player_name: playerMap.get(team.player_id)?.name ?? t('teams.unknownPlayer'),
    visible,
  }));

  return (
    <PageContainer
      title={t('teams.title', { league: season.name })}
      subtitle={t('teams.registered', { count: teamsWithVisibility.length })}
    >
      {teamsWithVisibility.length === 0 ? (
        <p className="text-poke-text-muted">{t('teams.empty')}</p>
      ) : (
        <div className="grid gap-4">
          {teamsWithVisibility.map((team) => (
            <Link key={team.id} href={`/leagues/${id}/teams/${team.player_id}`}>
              <Card hover padding="md">
                <h2 className="font-heading font-semibold text-sm text-poke-text-primary mb-2">{team.player_name}</h2>
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
                        className="w-10 h-10 bg-poke-muted rounded-poke-md flex items-center justify-center text-poke-text-muted text-xs"
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
        className="inline-block text-sm text-poke-blue hover:underline"
      >
        <span aria-hidden="true">&larr; </span>
        {t('teams.backToLeague')}
      </Link>
    </PageContainer>
  );
}

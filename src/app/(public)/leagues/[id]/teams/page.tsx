import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getStagesBySeasonId } from '@/lib/supabase/queries/tournaments';
import { listTeamsByTournamentIds } from '@/lib/supabase/queries/teams';
import { getPlayersByIds } from '@/lib/supabase/queries/players';
import { getPlayerIdsWithCompletedMatches } from '@/lib/supabase/queries/matches';
import { getSessionPlayer } from '@/lib/auth/helpers';
import PageContainer from '@/components/ui/PageContainer';
import Card from '@/components/ui/Card';
import PokemonSprite from '@/components/shared/PokemonSprite';
import { getT } from '@/i18n/server';
import { leaguesMessages } from '@/i18n/messages/leagues';
import type { Team } from '@/types/team';

export const dynamic = 'force-dynamic';

export const revalidate = 60;

interface PageProps {
  params: Promise<{ id: string }>;
}

interface TeamWithVisibility extends Team {
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

  const [player, t] = await Promise.all([getSessionPlayer(), getT(leaguesMessages)]);
  const viewerId = player?.playerId ?? null;
  const isAdmin = player?.isAdmin ?? false;

  // Fetch stages + all teams in a single batch (not per-stage)
  const stages = await getStagesBySeasonId(id);
  const stageIds = stages.map((s) => s.id);
  const allTeams = await listTeamsByTournamentIds(stageIds);

  // Deduplicate (a player may have teams across multiple stages)
  const seen = new Set<string>();
  const uniqueTeams = allTeams.filter((t) => {
    const key = `${t.player_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Batch-fetch player names + visibility data in parallel (2 queries, not 2N)
  const playerIds = uniqueTeams.map((t) => t.player_id);
  const [playerMap, playersWithMatches] = await Promise.all([
    getPlayersByIds(playerIds),
    getPlayerIdsWithCompletedMatches(stageIds),
  ]);

  const teamsWithVisibility: TeamWithVisibility[] = uniqueTeams.map((team) => {
    const playerName = playerMap.get(team.player_id)?.name ?? t('teams.unknownPlayer');

    // Spec Section 7 visibility: owner/admin always see, others need completed match
    const visible =
      isAdmin ||
      (viewerId !== null && viewerId === team.player_id) ||
      playersWithMatches.has(team.player_id);

    return { ...team, player_name: playerName, visible };
  });

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

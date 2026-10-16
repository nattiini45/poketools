import AuthGuard from '@/components/shared/AuthGuard';
import PageContainer from '@/components/ui/PageContainer';
import { getSession } from '@/lib/auth/helpers';
import { getMatchById } from '@/lib/supabase/queries/matches';
import {
  createCastSession,
  listCastSessions,
  updateCastSession,
} from '@/lib/supabase/queries/cast-sessions';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { getPlayerTeamForTournament } from '@/lib/supabase/queries/teams';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { canViewTeamPokemon } from '@/lib/team/visibility';
import BattleTracker from '@/components/broadcast/tracker/BattleTracker';
import Link from 'next/link';
import type { CasterData } from '@/types/caster';
import { getT } from '@/i18n/server';
import { creatorMessages } from '@/i18n/messages/creator';

export const dynamic = 'force-dynamic';

export const revalidate = 0;

interface Props {
  params: Promise<{ mid: string }>;
}

export default async function TrackerPage({ params }: Props) {
  const { mid } = await params;
  const session = await getSession();
  const t = await getT(creatorMessages);

  if (!session?.player) {
    return (
      <AuthGuard>
        <PageContainer title={t('tracker.title')}>
          <p className="text-poke-text-secondary">{t('tracker.notRegistered')}</p>
        </PageContainer>
      </AuthGuard>
    );
  }

  const match = await getMatchById(mid);
  if (!match) {
    return (
      <AuthGuard>
        <PageContainer title={t('tracker.title')}>
          <p className="text-poke-text-secondary">{t('tracker.matchNotFound')}</p>
          <Link href="/dashboard/broadcast" className="text-poke-accent text-sm mt-2 inline-block">
            {t('tracker.backToHub')}
          </Link>
        </PageContainer>
      </AuthGuard>
    );
  }

  // Load tournament for best-of info
  const tournament = await getTournamentById(match.tournament_id);
  const bestOf = tournament?.best_of_default ?? undefined;

  // Auth hardening: only match participants, creators, and admins can access the tracker
  const isParticipant = session.player.playerId === match.player_1_id || session.player.playerId === match.player_2_id;
  const isCreatorOrAdmin = session.player.isCreator || session.player.isAdmin;
  if (!isParticipant && !isCreatorOrAdmin) {
    return (
      <AuthGuard>
        <PageContainer title={t('tracker.title')}>
          <p className="text-poke-text-secondary">{t('tracker.notAuthorized')}</p>
          <Link href="/dashboard/broadcast" className="text-poke-accent text-sm mt-2 inline-block">
            {t('tracker.backToHub')}
          </Link>
        </PageContainer>
      </AuthGuard>
    );
  }

  // Try to load teams for auto-populating tracker slots
  const [team1, team2] = await Promise.all([
    getPlayerTeamForTournament(match.player_1_id, match.tournament_id),
    getPlayerTeamForTournament(match.player_2_id, match.tournament_id),
  ]);

  // Apply team visibility — only show rosters if team owner has a completed match
  const visCtx = {
    viewerId: session.player.playerId,
    isAdmin: session.player.isAdmin,
    tournamentId: match.tournament_id,
  };
  const canSeeP1 = team1 ? await canViewTeamPokemon(team1, visCtx) : false;
  const canSeeP2 = team2 ? await canViewTeamPokemon(team2, visCtx) : false;
  const player1Pokemon = canSeeP1 ? team1?.pokemon.map((p) => p.species) : undefined;
  const player2Pokemon = canSeeP2 ? team2?.pokemon.map((p) => p.species) : undefined;

  // Fetch caster data for creators/admins (non-blocking, graceful fallback)
  let casterData: CasterData | null = null;
  let castSessionId: string | undefined;
  if (isCreatorOrAdmin) {
    try {
      const [{ fetchCasterData }, sessions] = await Promise.all([
        import('@/lib/broadcast/caster-data'),
        listCastSessions(session.player.playerId),
      ]);
      casterData = await fetchCasterData(mid);

      const existingSession = sessions.find(
        (castSession) => castSession.match_id === match.id && castSession.status !== 'archived'
      );

      if (existingSession) {
        castSessionId = existingSession.id;
      } else {
        const ruleset = tournament?.ruleset_id
          ? await getRulesetById(tournament.ruleset_id)
          : null;
        const generation = ruleset?.base_format
          ? Number.parseInt(ruleset.base_format.match(/^gen(\d+)/)?.[1] ?? '9', 10)
          : 9;

        const createdSession = await createCastSession(session.player.playerId, {
          name: `${match.player_1_name} vs ${match.player_2_name}`,
          mode: 'cast',
          match_id: match.id,
          tournament_id: match.tournament_id,
          season_id: tournament?.season_id ?? null,
          format: ruleset?.base_format ?? 'gen9ou',
          generation,
        });

        await updateCastSession(createdSession.id, {
          player1_id: match.player_1_id,
          player1_name: match.player_1_name,
          player1_avatar_url: match.player_1_avatar_url,
          player2_id: match.player_2_id,
          player2_name: match.player_2_name,
          player2_avatar_url: match.player_2_avatar_url,
          player1_team: canSeeP1 ? (team1?.pokemon ?? []) : [],
          player2_team: canSeeP2 ? (team2?.pokemon ?? []) : [],
        });

        castSessionId = createdSession.id;
      }
    } catch {
      // Caster data/session wiring is non-critical — tracker works without it
    }
  }

  return (
    <AuthGuard>
      <PageContainer
        title={t('tracker.matchTitle', { player1: match.player_1_name, player2: match.player_2_name })}
        subtitle={t('tracker.subtitle')}
      >
        <BattleTracker
          matchId={match.id}
          player1={{
            id: match.player_1_id,
            name: match.player_1_name,
            avatar_url: match.player_1_avatar_url,
            pokemon: player1Pokemon,
          }}
          player2={{
            id: match.player_2_id,
            name: match.player_2_name,
            avatar_url: match.player_2_avatar_url,
            pokemon: player2Pokemon,
          }}
          gamesSubmitted={match.games}
          bestOf={bestOf}
          casterData={casterData}
          sessionId={castSessionId}
        />
      </PageContainer>
    </AuthGuard>
  );
}

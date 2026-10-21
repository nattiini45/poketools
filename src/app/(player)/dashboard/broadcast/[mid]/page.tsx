import AuthGuard from '@/components/shared/AuthGuard';
import PageContainer from '@/components/ui/PageContainer';
import { getLiveAccess } from '@/lib/auth/helpers';
import { getMatchById } from '@/lib/supabase/queries/matches';
import {
  createCastSession,
  listCastSessions,
  updateCastSession,
} from '@/lib/supabase/queries/cast-sessions';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { getPlayerTeamForMatch } from '@/lib/supabase/queries/teams';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { decideMatchRosterVisibility, type TeamViewer } from '@/lib/team/visibility';
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
  // Live roles (AGENTS.md): the creator/admin flags gate who may open the
  // tracker and which planned rosters it shows.
  const access = await getLiveAccess();
  const t = await getT(creatorMessages);
  const player = access?.player;

  if (!access || !player) {
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
  const isParticipant = player.playerId === match.player_1_id || player.playerId === match.player_2_id;
  const isCreatorOrAdmin = access.isCreator;
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

  // Try to load each player's team for this match to auto-populate tracker slots
  const [team1, team2] = await Promise.all([
    getPlayerTeamForMatch(match.player_1_id, match),
    getPlayerTeamForMatch(match.player_2_id, match),
  ]);

  // Spec §7 per match: before this match is completed a participant sees only
  // their own roster, a creator none; an admin sees both.
  const viewer: TeamViewer = {
    viewerId: player.playerId,
    isAdmin: access.isSiteAdmin,
  };
  const tournamentVisibility = tournament?.team_visibility ?? null;
  const canSeeP1 = team1
    ? decideMatchRosterVisibility(team1, viewer, match, tournamentVisibility)
    : false;
  const canSeeP2 = team2
    ? decideMatchRosterVisibility(team2, viewer, match, tournamentVisibility)
    : false;
  const player1Pokemon = canSeeP1 ? team1?.pokemon.map((p) => p.species) : undefined;
  const player2Pokemon = canSeeP2 ? team2?.pokemon.map((p) => p.species) : undefined;

  // Fetch caster data for creators/admins (non-blocking, graceful fallback)
  let casterData: CasterData | null = null;
  let castSessionId: string | undefined;
  if (isCreatorOrAdmin) {
    try {
      const [{ fetchCasterData }, sessions] = await Promise.all([
        import('@/lib/broadcast/caster-data'),
        listCastSessions(player.playerId),
      ]);
      casterData = await fetchCasterData(mid, viewer);

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

        const createdSession = await createCastSession(player.playerId, {
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
    } catch (err) {
      // Caster data/session wiring is optional: the tracker works without it,
      // so the page still renders, but the original error is always logged.
      console.error('[dashboard/broadcast] caster data / cast session wiring failed:', err);
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

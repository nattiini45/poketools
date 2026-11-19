import AuthGuard from '@/components/shared/AuthGuard';
import PageContainer from '@/components/ui/PageContainer';
import { getLiveAccess } from '@/lib/auth/helpers';
import { loadTrackerMatch, readTrackerRosters } from '@/lib/broadcast/dashboard-tracker.server';
import {
  createCastSession,
  listCastSessions,
  updateCastSession,
} from '@/lib/supabase/queries/cast-sessions';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import type { TeamViewer } from '@/lib/team/visibility';
import { toPublicPhaseMatch } from '@/lib/match/public-match';
import BattleTracker from '@/components/broadcast/tracker/BattleTracker';
import Link from 'next/link';
import type { CasterData } from '@/types/caster';
import { getT } from '@/i18n/server';
import { generationOrDefault } from '@/lib/pkmn/format-id';
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
          <p className="text-body text-fg-muted">{t('tracker.notRegistered')}</p>
        </PageContainer>
      </AuthGuard>
    );
  }

  const read = await loadTrackerMatch(mid);
  if (!read) {
    return (
      <AuthGuard>
        <PageContainer title={t('tracker.title')}>
          <p className="text-body text-fg-muted">{t('tracker.matchNotFound')}</p>
          <Link href="/dashboard/broadcast" className="mt-2 inline-block text-body font-[550] text-accent-ink underline-offset-2 hover:underline">
            {t('tracker.backToHub')}
          </Link>
        </PageContainer>
      </AuthGuard>
    );
  }

  const { match, bestOf } = read;

  // Auth hardening: only match participants, creators, and admins can access the tracker
  const isParticipant = player.playerId === match.player_1_id || player.playerId === match.player_2_id;
  const isCreatorOrAdmin = access.isCreator;
  if (!isParticipant && !isCreatorOrAdmin) {
    return (
      <AuthGuard>
        <PageContainer title={t('tracker.title')}>
          <p className="text-body text-fg-muted">{t('tracker.notAuthorized')}</p>
          <Link href="/dashboard/broadcast" className="mt-2 inline-block text-body font-[550] text-accent-ink underline-offset-2 hover:underline">
            {t('tracker.backToHub')}
          </Link>
        </PageContainer>
      </AuthGuard>
    );
  }

  // Spec §7 per match: before this match is completed a participant sees only
  // their own roster, a creator none; an admin sees both.
  const viewer: TeamViewer = {
    viewerId: player.playerId,
    isAdmin: access.isSiteAdmin,
  };
  const { team1, team2 } = await readTrackerRosters(read, viewer);

  // Fetch caster data for creators/admins (non-blocking, graceful fallback)
  let casterData: CasterData | null = null;
  let castSessionId: string | undefined;
  if (isCreatorOrAdmin) {
    try {
      const [{ fetchCasterData }, sessions] = await Promise.all([
        import('@/lib/broadcast/caster-data'),
        read.kind === 'legacy' ? listCastSessions(player.playerId) : [],
      ]);
      casterData = await fetchCasterData(mid, viewer);

      if (read.kind === 'legacy') {
        const tournament = read.competition;
        const existingSession = sessions.find(
          (castSession) => castSession.match_id === match.id && castSession.status !== 'archived'
        );

        if (existingSession) {
          castSessionId = existingSession.id;
        } else {
          const ruleset = tournament?.ruleset_id
            ? await getRulesetById(tournament.ruleset_id)
            : null;
          const generation = generationOrDefault(ruleset?.base_format);

          const createdSession = await createCastSession(player.playerId, {
            name: `${match.player_1_name} vs ${match.player_2_name}`,
            mode: 'cast',
            match_id: match.id,
            tournament_id: read.match.tournament_id,
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
            player1_team: team1 ?? [],
            player2_team: team2 ?? [],
          });

          castSessionId = createdSession.id;
        }
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
            pokemon: team1?.map((p) => p.species),
          }}
          player2={{
            id: match.player_2_id,
            name: match.player_2_name,
            avatar_url: match.player_2_avatar_url,
            pokemon: team2?.map((p) => p.species),
          }}
          gamesSubmitted={read.kind === 'phase' ? toPublicPhaseMatch(read.match).games : match.games}
          bestOf={bestOf}
          casterData={casterData}
          sessionId={castSessionId}
          {...(isCreatorOrAdmin && read.kind === 'phase' ? { openPhaseSession: true } : {})}
        />
      </PageContainer>
    </AuthGuard>
  );
}

import { notFound } from 'next/navigation';
import AdminGuard from '@/components/shared/AdminGuard';
import PageContainer from '@/components/ui/PageContainer';
import { getGameById, getBattleStatsByGame } from '@/lib/supabase/queries/games';
import { getPhaseGameById, getPhaseBattleStatsByGame } from '@/lib/supabase/queries/phase-games';
import { requireOpenPhaseRouteMode } from '@/lib/league-phase/route-mode';
import EditGameForm from './EditGameForm';
import { canAdministerMatchTarget, MatchAccessDenied, viewerIsSiteAdmin } from '../../../match-access';
import { loadAdminMatchTarget } from '../../../match-target';
import { matchPageBackSuffix } from '@/lib/admin/match-list';
import { isValidUuid } from '@/lib/utils/uuid';
import { getT } from '@/i18n/server';
import { adminCoreMessages } from '@/i18n/messages/admin-core';
import AdminCrumbName from '@/components/admin/admin-crumb-names';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string; gid: string }>;
  /** `back` carries the Matches list query of the match page this edit was opened from. */
  searchParams?: Promise<{ back?: string | string[] }>;
}

export default async function EditGamePage({ params, searchParams }: PageProps) {
  const { id: requestedMatchId, gid: requestedGameId } = await params;
  if (!isValidUuid(requestedMatchId) || !isValidUuid(requestedGameId)) notFound();
  const mode = await requireOpenPhaseRouteMode();
  const matchId = mode === 'phase' ? requestedMatchId.toLowerCase() : requestedMatchId;
  const gameId = mode === 'phase' ? requestedGameId.toLowerCase() : requestedGameId;

  const [target, firstGame] = await Promise.all([
    loadAdminMatchTarget(matchId, mode),
    mode === 'phase' ? getPhaseGameById(gameId) : getGameById(gameId),
  ]);
  if (!target) notFound();
  const { match } = target;
  const native = target.kind === 'phase';
  // The write route prefers native games by id, so a native hit must never open a legacy editor.
  if (mode === 'phase' && !native && firstGame) notFound();
  const game = mode === 'phase' && !native ? await getGameById(gameId) : firstGame;
  if (!game || game.id !== gameId.toLowerCase() || game.match_id !== match.id) notFound();

  if (!(await canAdministerMatchTarget(target))) {
    return (
      <AdminGuard>
        <MatchAccessDenied />
      </AdminGuard>
    );
  }

  const [battleStats, t, isSiteAdmin, query] = await Promise.all([
    native ? getPhaseBattleStatsByGame(gameId) : getBattleStatsByGame(gameId),
    getT(adminCoreMessages),
    viewerIsSiteAdmin(),
    searchParams,
  ]);

  const versus = t('versus', { player1: match.player_1_name, player2: match.player_2_name });

  const content = (
    <>
      <AdminCrumbName href={`/admin/matches/${matchId}`} name={versus} />
      <PageContainer
        title={t('matches.editGame.title', { number: game.game_number })}
        icon="vs-seeker"
        subtitle={versus}
        maxWidth="md"
      >
        <EditGameForm
          gameId={game.id}
          matchId={matchId}
          gameUpdatedAt={game.updated_at}
          currentWinnerId={game.winner_id}
          player1={{ id: match.player_1_id, name: match.player_1_name }}
          player2={{ id: match.player_2_id, name: match.player_2_name }}
          battleStats={battleStats}
          isSiteAdmin={isSiteAdmin}
          native={native}
          returnHref={`/admin/matches/${matchId}${matchPageBackSuffix(query?.back)}`}
        />
      </PageContainer>
    </>
  );
  return native ? content : <AdminGuard>{content}</AdminGuard>;
}

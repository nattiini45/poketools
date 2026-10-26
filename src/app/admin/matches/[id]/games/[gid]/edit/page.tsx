import { notFound } from 'next/navigation';
import AdminGuard from '@/components/shared/AdminGuard';
import PageContainer from '@/components/ui/PageContainer';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { getGameById, getBattleStatsByGame } from '@/lib/supabase/queries/games';
import EditGameForm from './EditGameForm';
import { canAdministerMatch, MatchAccessDenied, viewerIsSiteAdmin } from '../../../match-access';
import { matchPageBackSuffix } from '@/lib/admin/match-list';
import { isValidUuid } from '@/lib/utils/uuid';
import { getT } from '@/i18n/server';
import { adminCoreMessages } from '@/i18n/messages/admin-core';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string; gid: string }>;
  /** `back` carries the Matches list query of the match page this edit was opened from. */
  searchParams?: Promise<{ back?: string | string[] }>;
}

export default async function EditGamePage({ params, searchParams }: PageProps) {
  const { id: matchId, gid: gameId } = await params;
  if (!isValidUuid(matchId) || !isValidUuid(gameId)) notFound();

  const [match, game] = await Promise.all([
    getMatchById(matchId),
    getGameById(gameId),
  ]);

  // The game must belong to the match in the URL. PATCH /api/admin/games/[id]
  // authorizes against the game's OWN match, so a mismatched pair would gate
  // on one match while rendering another match's game.
  if (!match || !game || game.match_id !== match.id) notFound();

  // Per-match gate: site admin, or resource admin of this match's tournament
  // or league (see match-access.tsx), the same rule PATCH /api/admin/games/[id]
  // applies when the form saves.
  if (!(await canAdministerMatch(match.tournament_id))) {
    return (
      <AdminGuard>
        <MatchAccessDenied />
      </AdminGuard>
    );
  }

  const [battleStats, t, isSiteAdmin, query] = await Promise.all([
    getBattleStatsByGame(gameId),
    getT(adminCoreMessages),
    viewerIsSiteAdmin(),
    searchParams,
  ]);

  return (
    <AdminGuard>
      <PageContainer
        title={t('matches.editGame.title', { number: game.game_number })}
        subtitle={t('versus', { player1: match.player_1_name, player2: match.player_2_name })}
        maxWidth="md"
      >
        <EditGameForm
          gameId={gameId}
          matchId={matchId}
          gameUpdatedAt={game.updated_at}
          currentWinnerId={game.winner_id}
          player1={{ id: match.player_1_id, name: match.player_1_name }}
          player2={{ id: match.player_2_id, name: match.player_2_name }}
          battleStats={battleStats}
          isSiteAdmin={isSiteAdmin}
          returnHref={`/admin/matches/${matchId}${matchPageBackSuffix(query?.back)}`}
        />
      </PageContainer>
    </AdminGuard>
  );
}

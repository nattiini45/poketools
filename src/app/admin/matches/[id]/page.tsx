import Link from 'next/link';
import { notFound } from 'next/navigation';
import AdminGuard from '@/components/shared/AdminGuard';
import { getMatchById } from '@/lib/supabase/queries/matches';
import MatchStatusBadge from '@/components/match/MatchStatusBadge';
import GameList from '@/components/match/GameList';
import AdminMatchActions from './AdminMatchActions';
import MatchContextHeader from './MatchContextHeader';
import MatchDisputePanel from './MatchDisputePanel';
import MatchHistoryPanel from './MatchHistoryPanel';
import MatchReopenSection from './MatchReopenSection';
import MatchSchedulePanel from './MatchSchedulePanel';
import { canAdministerMatch, MatchAccessDenied, viewerIsSiteAdmin } from './match-access';
import { isValidUuid } from '@/lib/utils/uuid';
import { loadAdminMatchContext } from '@/lib/admin/match-context';
import { historyPanelKey, MATCH_HISTORY_PAGE_SIZE, type MatchHistoryPage } from '@/lib/admin/match-detail';
import { readOptional } from '@/lib/admin/optional-read';
import { getLatestMatchDispute, listMatchAuditEvents } from '@/lib/audit/queries';
import { listMatchProposals } from '@/lib/supabase/queries/match-proposals';
import PageContainer from '@/components/ui/PageContainer';
import Card from '@/components/ui/Card';
import { getT } from '@/i18n/server';
import { adminCoreMessages } from '@/i18n/messages/admin-core';
import { enumMessages } from '@/i18n/messages/enums';
import { enumLabel } from '@/i18n/content/enum-label';

export const dynamic = 'force-dynamic';

/**
 * The time of this request (the page is `force-dynamic`). It only decides the
 * overdue flag and which time proposals are still open; times the viewer reads
 * are formatted by client leaves.
 */
function requestTimeMs(): number {
  return Date.now();
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminMatchPage({ params }: PageProps) {
  const { id } = await params;
  if (!isValidUuid(id)) notFound();
  const match = await getMatchById(id);
  if (!match) notFound();

  // AdminGuard admits an admin of ANY resource; this page shows one match's
  // admin notes and override controls, so the viewer must administer this
  // match (site admin, or resource admin of its tournament or league).
  if (!(await canAdministerMatch(match.tournament_id))) {
    return (
      <AdminGuard>
        <MatchAccessDenied />
      </AdminGuard>
    );
  }

  const emptyHistory: MatchHistoryPage = { entries: [], total: 0, offset: 0, limit: MATCH_HISTORY_PAGE_SIZE };
  // The match, its context and the viewer's role are needed for the controls;
  // history, dispute details and proposals only add to the page, so a failed
  // read degrades that section instead of failing the page.
  const [t, tEnums, isSiteAdmin, context, historyRead, disputeRead, proposalsRead] = await Promise.all([
    getT(adminCoreMessages),
    getT(enumMessages),
    viewerIsSiteAdmin(),
    loadAdminMatchContext(match),
    readOptional(
      'match history',
      listMatchAuditEvents(id, { limit: MATCH_HISTORY_PAGE_SIZE, offset: 0 }),
      emptyHistory,
    ),
    readOptional('dispute details', match.status === 'disputed' ? getLatestMatchDispute(id) : Promise.resolve(null), null),
    readOptional('time proposals', listMatchProposals(id), []),
  ]);
  const history = historyRead.value;
  const dispute = disputeRead.value;
  const proposals = proposalsRead.value;
  const now = requestTimeMs();
  const pendingProposals = proposals.filter(
    (proposal) => proposal.status === 'pending' && Date.parse(proposal.expires_at) > now,
  ).length;
  const winnerName = match.winner_id
    ? match.winner_id === match.player_1_id
      ? match.player_1_name
      : match.player_2_name
    : null;

  return (
    <AdminGuard>
      <PageContainer
        title={t('matches.detail.title')}
        subtitle={t('versus', { player1: match.player_1_name, player2: match.player_2_name })}
        action={<MatchStatusBadge status={match.status} />}
        maxWidth="sm"
      >
        <MatchContextHeader
          matchId={id}
          tournamentId={match.tournament_id}
          status={match.status}
          scheduledAt={match.scheduled_at}
          autoConfirmAt={match.auto_confirm_at}
          player1Name={match.player_1_name}
          player2Name={match.player_2_name}
          context={context}
          now={now}
        />

        {match.status === 'disputed' && (
          <MatchDisputePanel dispute={dispute} reportedWinnerName={winnerName} reporterName={context.submitter_name} />
        )}

        {/* Current State */}
        <Card variant="muted" padding="md">
          <div className="space-y-2">
            <div className="text-sm">
              <span className="text-poke-text-muted">{t('matches.detail.status')}</span>{' '}
              <span className="font-medium text-poke-text-primary">{enumLabel(tEnums, 'matchStatus', match.status)}</span>
            </div>
            {winnerName && (
              <div className="text-sm">
                <span className="text-poke-text-muted">{t('matches.detail.winner')}</span>{' '}
                <span className="font-semibold text-poke-green">{winnerName}</span>
              </div>
            )}
            {match.notes && (
              <div className="text-sm">
                <span className="text-poke-text-muted">{t('matches.detail.notes')}</span>{' '}
                <span className="text-poke-text-primary whitespace-pre-line">{match.notes}</span>
              </div>
            )}
          </div>
        </Card>

        <MatchSchedulePanel
          matchId={id}
          status={match.status}
          scheduledAt={match.scheduled_at}
          roundDeadline={context.round_deadline}
          pendingProposals={pendingProposals}
        />

        {/* Games */}
        {match.games.length > 0 && (
          <div>
            <GameList
              games={match.games}
              player1Name={match.player_1_name}
              player2Name={match.player_2_name}
              player1Id={match.player_1_id}
              player2Id={match.player_2_id}
            />
          </div>
        )}

        {/* Import a replay whose Showdown names don't match the registered players */}
        {(match.status === 'scheduled' || match.status === 'in_progress') && (
          <Link
            href={`/admin/matches/${id}/import-replay`}
            className="inline-flex items-center gap-1 text-sm text-poke-blue hover:underline font-heading"
          >
            {t('matches.detail.importReplay')}
          </Link>
        )}

        {/* Admin Actions */}
        <AdminMatchActions
          matchId={id}
          currentStatus={match.status}
          player1={{ id: match.player_1_id, name: match.player_1_name }}
          player2={{ id: match.player_2_id, name: match.player_2_name }}
          currentWinnerId={match.winner_id}
          games={match.games}
          tournamentId={match.tournament_id}
          bestOf={context.best_of}
          isSiteAdmin={isSiteAdmin}
        />

        <MatchReopenSection matchId={id} status={match.status} />

        <MatchHistoryPanel
          key={historyPanelKey(history, historyRead.failed)}
          matchId={id}
          initialPage={history}
          loadFailed={historyRead.failed}
          players={[
            { id: match.player_1_id, name: match.player_1_name },
            { id: match.player_2_id, name: match.player_2_name },
          ]}
        />

        <Link
          href="/admin"
          className="inline-flex items-center gap-1 text-sm text-poke-blue hover:underline font-heading"
        >
          <span aria-hidden="true">&larr;</span> {t('matches.detail.backToAdmin')}
        </Link>
      </PageContainer>
    </AdminGuard>
  );
}

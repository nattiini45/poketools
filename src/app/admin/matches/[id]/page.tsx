import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
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
import { matchListBackHref, matchPageBackSuffix } from '@/lib/admin/match-list';
import { getT } from '@/i18n/server';
import { adminCoreMessages } from '@/i18n/messages/admin-core';
import { adminMatchMessages } from '@/i18n/messages/admin-match';
import { computeSeriesTally } from '@/lib/match/series-tally';
import AdminCrumbName from '@/components/admin/admin-crumb-names';
import { FOCUS, PLATE, PLATE_TARGET, TOUCH } from '@/components/admin/match-styles';
import ItemIcon from '@/components/ui/ItemIcon';
import Section from '@/components/ui/Section';
import SkewChip from '@/components/ui/SkewChip';
import SkewPlate from '@/components/ui/SkewPlate';
import { cn } from '@/lib/utils/cn';

export const dynamic = 'force-dynamic';

/**
 * The time of this request (the page is `force-dynamic`). It only decides the
 * overdue flag and which time proposals are still open; times the viewer reads
 * are formatted by client leaves.
 */
function requestTimeMs(): number {
  return Date.now();
}

/** A game score in the header: the pixel face at the title's size on a skewed plate. */
const SCORE_PLATE = 'px-3 py-0 font-heading text-display font-normal';

interface PageProps {
  params: Promise<{ id: string }>;
  /** `back` carries the Matches list query the viewer came from (see `matchListBackHref`). */
  searchParams?: Promise<{ back?: string | string[] }>;
}

export default async function AdminMatchPage({ params, searchParams }: PageProps) {
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
  const [t, tMatch, isSiteAdmin, query, context, historyRead, disputeRead, proposalsRead] = await Promise.all([
    getT(adminCoreMessages),
    getT(adminMatchMessages),
    viewerIsSiteAdmin(),
    searchParams,
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
  // Never the raw value: the list query is re-parsed and re-serialised, so the
  // href is always a same-origin /admin/matches path with validated keys only.
  const backHref = matchListBackHref(query?.back);
  // The replay import and the game edit return here; they carry the same list query along.
  const backSuffix = matchPageBackSuffix(query?.back);

  const versus = t('versus', { player1: match.player_1_name, player2: match.player_2_name });
  const tally = computeSeriesTally(match.games, match.player_1_id, match.player_2_id, context.best_of);
  // The gold plate goes to the recorded winner, else to whoever leads on games.
  const aheadId = match.winner_id ?? tally.leaderId;
  const canImport = match.status === 'scheduled' || match.status === 'in_progress';
  const importHref = `/admin/matches/${id}/import-replay${backSuffix}`;

  return (
    <AdminGuard>
      <AdminCrumbName href={`/admin/matches/${id}`} name={versus} />
      <PageContainer maxWidth="xl">
        <header className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4" data-admin-match-header>
          <div className="min-w-0 flex-1 basis-72">
            <Link href={backHref} className={cn('inline-flex items-center gap-1.5 text-caption text-fg-muted hover:text-fg', TOUCH, FOCUS)}>
              <ArrowLeft aria-hidden="true" className="size-3.5" /> {t('matches.detail.backToMatches')}
            </Link>
            <div className="mt-2 flex items-start gap-3">
              <span aria-hidden="true" className="mt-0.5 h-8 w-2 shrink-0 rounded-[2px] bg-accent-fill [transform:skewX(var(--skew))]" />
              <h1 className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 font-heading text-display text-fg">
                <span className="sr-only">{versus}</span>
                <span aria-hidden="true" className="contents">
                  <span className="min-w-0 break-words">{match.player_1_name}</span>
                  {tally.recorded > 0 ? (
                    <span className="inline-flex items-center gap-1.5">
                      <SkewChip tone={aheadId === match.player_1_id ? 'tier-1' : 'neutral'} className={SCORE_PLATE}>
                        {tally.player1Wins}
                      </SkewChip>
                      <SkewChip tone={aheadId === match.player_2_id ? 'tier-1' : 'neutral'} className={SCORE_PLATE}>
                        {tally.player2Wins}
                      </SkewChip>
                    </span>
                  ) : (
                    <SkewChip className="px-2.5 font-heading text-title font-normal">{t('matches.detail.vs')}</SkewChip>
                  )}
                  <span className="min-w-0 break-words">{match.player_2_name}</span>
                </span>
              </h1>
            </div>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 pl-5 text-body text-fg-muted">
              <span>
                {context.league_name ?? tMatch('header.standalone')}
                <span aria-hidden="true" className="mx-1.5">
                  ·
                </span>
                {context.phase_name}
              </span>
              {winnerName && (
                <SkewChip tone="win">
                  {t('matches.detail.winner')} {winnerName}
                </SkewChip>
              )}
            </p>
          </div>
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-4 gap-y-3">
            <MatchStatusBadge status={match.status} />
            {/* Import a replay whose Showdown names don't match the registered players */}
            {canImport && (
              <Link href={importHref} className={PLATE_TARGET}>
                <SkewPlate variant="button" tone="secondary" className={PLATE} icon={<ItemIcon item="dubious-disc" />}>
                  {t('matches.detail.importReplay')}
                </SkewPlate>
              </Link>
            )}
          </div>
        </header>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_23rem] xl:items-start">
          <div className="flex min-w-0 flex-col gap-6">
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
              listHref={backSuffix ? backHref : undefined}
            />

            {match.notes && (
              <Section title={t('matches.detail.notesTitle')} icon="weakness-policy">
                <p className="whitespace-pre-line text-body text-fg">{match.notes}</p>
              </Section>
            )}

            {/* Games */}
            {match.games.length > 0 ? (
              <Card padding="md">
                <GameList
                  games={match.games}
                  player1Name={match.player_1_name}
                  player2Name={match.player_2_name}
                  player1Id={match.player_1_id}
                  player2Id={match.player_2_id}
                />
              </Card>
            ) : (
              <div className="flex flex-col items-center gap-2 rounded-poke-lg border border-dashed border-hairline-strong bg-surface px-4 py-8 text-center">
                <ItemIcon item="poke-doll" size={48} />
                <p className="text-subtitle text-fg">{t('actions.tally.none')}</p>
                {canImport && <p className="max-w-prose text-body text-fg-muted">{t('matches.detail.noGamesHint')}</p>}
              </div>
            )}
          </div>

          <aside aria-label={t('matches.detail.actionsRail')} className="flex min-w-0 flex-col gap-4" data-admin-match-rail>
            {match.status === 'disputed' && (
              <MatchDisputePanel dispute={dispute} reportedWinnerName={winnerName} reporterName={context.submitter_name} />
            )}

            <MatchSchedulePanel
              matchId={id}
              status={match.status}
              scheduledAt={match.scheduled_at}
              roundDeadline={context.round_deadline}
              pendingProposals={pendingProposals}
            />

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
              backSuffix={backSuffix}
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
          </aside>
        </div>
      </PageContainer>
    </AdminGuard>
  );
}

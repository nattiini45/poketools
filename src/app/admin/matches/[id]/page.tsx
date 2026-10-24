import Link from 'next/link';
import { notFound } from 'next/navigation';
import AdminGuard from '@/components/shared/AdminGuard';
import { getMatchById } from '@/lib/supabase/queries/matches';
import MatchStatusBadge from '@/components/match/MatchStatusBadge';
import GameList from '@/components/match/GameList';
import AdminMatchActions from './AdminMatchActions';
import { canAdministerMatch, MatchAccessDenied, viewerIsSiteAdmin } from './match-access';
import { isValidUuid } from '@/lib/utils/uuid';
import PageContainer from '@/components/ui/PageContainer';
import Card from '@/components/ui/Card';
import { matchListBackHref, matchPageBackSuffix } from '@/lib/admin/match-list';
import { getT } from '@/i18n/server';
import { adminCoreMessages } from '@/i18n/messages/admin-core';
import { enumMessages } from '@/i18n/messages/enums';
import { enumLabel } from '@/i18n/content/enum-label';

export const dynamic = 'force-dynamic';

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

  const [t, tEnums, isSiteAdmin, query] = await Promise.all([
    getT(adminCoreMessages),
    getT(enumMessages),
    viewerIsSiteAdmin(),
    searchParams,
  ]);
  // Never the raw value: the list query is re-parsed and re-serialised, so the
  // href is always a same-origin /admin/matches path with validated keys only.
  const backHref = matchListBackHref(query?.back);
  // The replay import and the game edit return here; they carry the same list query along.
  const backSuffix = matchPageBackSuffix(query?.back);

  return (
    <AdminGuard>
      <PageContainer
        title={t('matches.detail.title')}
        subtitle={t('versus', { player1: match.player_1_name, player2: match.player_2_name })}
        action={<MatchStatusBadge status={match.status} />}
        maxWidth="sm"
      >
        {/* Current State */}
        <Card variant="muted" padding="md">
          <div className="space-y-2">
            <div className="text-sm">
              <span className="text-poke-text-muted">{t('matches.detail.status')}</span>{' '}
              <span className="font-medium text-poke-text-primary">{enumLabel(tEnums, 'matchStatus', match.status)}</span>
            </div>
            {match.winner_id && (
              <div className="text-sm">
                <span className="text-poke-text-muted">{t('matches.detail.winner')}</span>{' '}
                <span className="font-semibold text-poke-green">
                  {match.winner_id === match.player_1_id
                    ? match.player_1_name
                    : match.player_2_name}
                </span>
              </div>
            )}
            {match.notes && (
              <div className="text-sm">
                <span className="text-poke-text-muted">{t('matches.detail.notes')}</span>{' '}
                <span className="text-poke-text-primary">{match.notes}</span>
              </div>
            )}
          </div>
        </Card>

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
            href={`/admin/matches/${id}/import-replay${backSuffix}`}
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
          isSiteAdmin={isSiteAdmin}
          backSuffix={backSuffix}
        />

        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-sm text-poke-blue hover:underline font-heading"
        >
          <span aria-hidden="true">&larr;</span> {t('matches.detail.backToMatches')}
        </Link>
      </PageContainer>
    </AdminGuard>
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';
import AdminGuard from '@/components/shared/AdminGuard';
import { getMatchById } from '@/lib/supabase/queries/matches';
import MatchStatusBadge from '@/components/match/MatchStatusBadge';
import ReplayImportForm from '@/components/match/ReplayImportForm';
import PageContainer from '@/components/ui/PageContainer';
import Alert from '@/components/ui/Alert';
import { matchPageBackSuffix } from '@/lib/admin/match-list';
import { canAdministerMatch, MatchAccessDenied } from '../match-access';
import { isValidUuid } from '@/lib/utils/uuid';
import { getT } from '@/i18n/server';
import { adminCoreMessages } from '@/i18n/messages/admin-core';
import { enumMessages } from '@/i18n/messages/enums';
import { enumLabel } from '@/i18n/content/enum-label';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
  /** `back` carries the Matches list query of the match page this import was opened from. */
  searchParams?: Promise<{ back?: string | string[] }>;
}

export default async function ImportReplayPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  if (!isValidUuid(id)) notFound();
  const match = await getMatchById(id);
  if (!match) notFound();

  // Per-match gate: site admin, or resource admin of this match's tournament
  // or league (see match-access.tsx).
  if (!(await canAdministerMatch(match.tournament_id))) {
    return (
      <AdminGuard>
        <MatchAccessDenied />
      </AdminGuard>
    );
  }

  const canImport = match.status === 'scheduled' || match.status === 'in_progress';

  const [t, tEnums, query] = await Promise.all([getT(adminCoreMessages), getT(enumMessages), searchParams]);
  const matchHref = `/admin/matches/${id}${matchPageBackSuffix(query?.back)}`;

  return (
    <AdminGuard>
      <PageContainer
        title={t('matches.importReplay.title')}
        subtitle={t('versus', { player1: match.player_1_name, player2: match.player_2_name })}
        action={<MatchStatusBadge status={match.status} />}
        maxWidth="md"
      >
        <Alert variant="info">{t('matches.importReplay.info')}</Alert>

        {!canImport ? (
          <Alert variant="warning">
            {t.rich('matches.importReplay.closed', {
              status: enumLabel(tEnums, 'matchStatus', match.status),
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </Alert>
        ) : (
          <ReplayImportForm
            key={id}
            matchId={id}
            players={[
              { id: match.player_1_id, name: match.player_1_name },
              { id: match.player_2_id, name: match.player_2_name },
            ]}
            redirectTo={matchHref}
          />
        )}

        <Link
          href={matchHref}
          className="inline-flex items-center gap-1 text-sm text-poke-blue hover:underline font-heading"
        >
          <span aria-hidden="true">&larr;</span> {t('matches.importReplay.backToMatch')}
        </Link>
      </PageContainer>
    </AdminGuard>
  );
}

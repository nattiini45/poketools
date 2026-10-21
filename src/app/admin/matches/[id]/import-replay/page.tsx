import Link from 'next/link';
import { notFound } from 'next/navigation';
import AdminGuard from '@/components/shared/AdminGuard';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { supabase } from '@/lib/supabase/client';
import MatchStatusBadge from '@/components/match/MatchStatusBadge';
import ReplayImportForm from '@/components/match/ReplayImportForm';
import PageContainer from '@/components/ui/PageContainer';
import Alert from '@/components/ui/Alert';
import { canAdministerMatch, MatchAccessDenied } from '../match-access';
import { isValidUuid } from '@/lib/utils/uuid';
import { getT } from '@/i18n/server';
import { adminCoreMessages } from '@/i18n/messages/admin-core';
import { enumMessages } from '@/i18n/messages/enums';
import { enumLabel } from '@/i18n/content/enum-label';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ImportReplayPage({ params }: PageProps) {
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

  // Resolve the format generation for Pokémon autocomplete filtering.
  let generation = 9;
  try {
    const { data: tournament } = await supabase
      .from('tournaments')
      .select('rulesets(base_format)')
      .eq('id', match.tournament_id)
      .single();
    const baseFormat = (tournament?.rulesets as { base_format: string } | null)?.base_format;
    if (baseFormat) {
      const genMatch = /^gen(\d+)/.exec(baseFormat);
      if (genMatch) {
        const parsed = parseInt(genMatch[1], 10);
        if (parsed >= 1 && parsed <= 9) generation = parsed;
      }
    }
  } catch {
    generation = 9;
  }

  const [t, tEnums] = await Promise.all([getT(adminCoreMessages), getT(enumMessages)]);

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
            generation={generation}
            redirectTo={`/admin/matches/${id}`}
          />
        )}

        <Link
          href={`/admin/matches/${id}`}
          className="inline-flex items-center gap-1 text-sm text-poke-blue hover:underline font-heading"
        >
          <span aria-hidden="true">&larr;</span> {t('matches.importReplay.backToMatch')}
        </Link>
      </PageContainer>
    </AdminGuard>
  );
}

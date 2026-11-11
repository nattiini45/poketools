import type { Metadata } from 'next';
import { publicReads } from '@/lib/cache/public-reads';
import PageContainer from '@/components/ui/PageContainer';
import Badge from '@/components/ui/Badge';
import PublicCompetitionList, { parseCompetitionStatusFilter } from '@/components/competition/PublicCompetitionList';
import { getT } from '@/i18n/server';
import { enumLabel } from '@/i18n/content/enum-label';
import { commonMessages } from '@/i18n/messages/common';
import { enumMessages } from '@/i18n/messages/enums';
import { tournamentsMessages } from '@/i18n/messages/tournaments';

// Stays dynamic although it reads no session: without `force-dynamic` the
// page would be prerendered by `next build`, which queries Supabase at build
// time (CI builds against a placeholder URL and would fail). The list itself
// comes from the tagged public read cache (60 s, expired by match writes), so
// a render costs no Supabase query while the entry is warm.
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(tournamentsMessages);
  return { title: t('list.title') };
}

export default async function TournamentsPage({ searchParams }: { searchParams?: Promise<{ status?: string | string[] }> } = {}) {
  // The status tabs filter the one cached list in memory: a tab costs no query.
  const [tournaments, t, tc, te, query] = await Promise.all([
    publicReads.tournamentList(),
    getT(tournamentsMessages),
    getT(commonMessages),
    getT(enumMessages),
    searchParams,
  ]);

  return (
    <PageContainer title={t('list.title')}>
      <PublicCompetitionList
        icon="kings-rock"
        basePath="/tournaments"
        filter={parseCompetitionStatusFilter(query?.status)}
        filterLabel={t('list.filterLabel')}
        filterLabels={{
          all: t('list.filters.all'),
          active: t('list.filters.active'),
          upcoming: t('list.filters.upcoming'),
          completed: t('list.filters.completed'),
        }}
        emptyText={t('list.empty')}
        emptyFilteredText={t('list.emptyFiltered')}
        items={tournaments.map((tournament) => ({
          id: tournament.id,
          href: `/tournaments/${tournament.id}`,
          name: tournament.name,
          status: tournament.status,
          statusLabel: enumLabel(te, 'tournamentStatus', tournament.status),
          meta: [
            enumLabel(te, 'bracketType', tournament.bracket_type),
            tournament.ruleset_name,
            ...(tournament.season_name ? [tournament.season_name] : []),
          ],
          stats: [tc('units.players', { count: tournament.participant_count }), tc('bestOf', { count: tournament.best_of_default })],
          badges: tournament.is_doubles ? <Badge variant="purple">{t('list.doubles')}</Badge> : undefined,
        }))}
      />
    </PageContainer>
  );
}

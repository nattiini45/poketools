import type { Metadata } from 'next';
import { publicReads } from '@/lib/cache/public-reads';
import PageContainer from '@/components/ui/PageContainer';
import TestLeagueBadge from '@/components/league/TestLeagueBadge';
import PublicCompetitionList, { parseCompetitionStatusFilter } from '@/components/competition/PublicCompetitionList';
import { getFormatter, getT } from '@/i18n/server';
import { enumLabel } from '@/i18n/content/enum-label';
import { commonMessages } from '@/i18n/messages/common';
import { enumMessages } from '@/i18n/messages/enums';
import { leaguesMessages } from '@/i18n/messages/leagues';

// Stays dynamic although it reads no session: without `force-dynamic` the
// page would be prerendered by `next build`, which queries Supabase at build
// time (CI builds against a placeholder URL and would fail). The list itself
// comes from the tagged public read cache (60 s, expired by match writes), so
// a render costs no Supabase query while the entry is warm.
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(leaguesMessages);
  return { title: t('list.title') };
}

export default async function LeaguesPage({ searchParams }: { searchParams?: Promise<{ status?: string | string[] }> } = {}) {
  // Test leagues are listed too (after the real ones, `listSeasons` sorts
  // them) with a badge, so the community can find and test in them.
  // The language is a cookie read, outside the cached list read (cached values hold no text).
  // The status tabs filter the one cached list in memory: a tab costs no query.
  const [leagues, t, common, enums, formatter, query] = await Promise.all([
    publicReads.seasonList(),
    getT(leaguesMessages),
    getT(commonMessages),
    getT(enumMessages),
    getFormatter(),
    searchParams,
  ]);

  return (
    <PageContainer title={t('list.title')}>
      <PublicCompetitionList
        icon="poke-ball"
        basePath="/leagues"
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
        showAllLabel={t('list.showAll')}
        items={leagues.map((league) => ({
          id: league.id,
          href: `/leagues/${league.id}`,
          name: league.name,
          status: league.status,
          statusLabel: enumLabel(enums, 'seasonStatus', league.status),
          meta: [enumLabel(enums, 'formatType', league.format_type), ...(league.ruleset_name ? [league.ruleset_name] : [])],
          stats: [
            common('units.players', { count: league.participant_count }),
            t('list.stages', { count: league.tournament_count }),
          ],
          badges: league.is_test_season ? <TestLeagueBadge label={t('list.testBadge')} /> : undefined,
          dates:
            league.start_date && league.end_date
              ? t('list.dateRange', {
                  start: formatter.calendarDate(league.start_date),
                  end: formatter.calendarDate(league.end_date),
                })
              : league.start_date
                ? t('list.dateFrom', { start: formatter.calendarDate(league.start_date) })
                : undefined,
        }))}
      />
    </PageContainer>
  );
}

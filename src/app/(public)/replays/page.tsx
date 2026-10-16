import Link from 'next/link';
import PageContainer from '@/components/ui/PageContainer';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { SortableTableHeader, TablePagination } from '@/components/ui/Table';
import { getButtonClasses } from '@/components/ui/buttonStyles';
import {
  paginateArray,
  parseSortParam,
  parseTableParams,
  nextSortParam,
  totalTablePages,
} from '@/lib/ui/table-params';
import {
  applyReplayLibraryParams,
  buildReplayLibraryHref,
  getReplayLibraryLeagueOptions,
  getReplayLibraryRoundOptions,
  getReplayLibraryTournamentOptions,
  isReplayLibraryBrowseView,
  parseReplayLibraryParams,
  type ReplayLibraryParams,
  type ReplayLibrarySortColumn,
} from './replay-library-utils';
import {
  listReplayLibraryFacetRows,
  listReplayLibraryPage,
  listReplayLibraryRows,
  type ReplayLibraryFacetRow,
  type ReplayLibraryRow,
  UNKNOWN_LEAGUE,
  UNKNOWN_PLAYER,
  UNKNOWN_ROUND,
} from '@/lib/supabase/queries/replay-library';
import { getLocale, getT } from '@/i18n/server';
import type { Translator } from '@/i18n/core';
import type { Locale } from '@/i18n/config';
import { LocalTime } from '@/i18n/LocalTime';
import { translateEngineLabel } from '@/i18n/content/engine-labels';
import { discoverMessages } from '@/i18n/messages/discover';
import type discoverEn from '@/i18n/messages/discover/en';

export const dynamic = 'force-dynamic';
export const revalidate = 60;

interface PageProps {
  searchParams: Promise<{
    q?: string;
    username?: string;
    league?: string;
    tournament?: string;
    round?: string;
    start?: string;
    end?: string;
    sort?: string;
    page?: string;
    perPage?: string;
  }>;
}

interface ReplayLibraryView {
  pageRows: ReplayLibraryRow[];
  totalItems: number;
  safePage: number;
  facetRows: ReplayLibraryFacetRow[];
}

/**
 * Unfiltered, date-sorted views read one `.range()` page plus the dropdown
 * names. Filtered views need every row, because the free-text search spans
 * joined fields; they read the whole library (in chunks, so nothing is
 * dropped at `max_rows`) and paginate in memory.
 */
async function loadReplayLibraryView(
  params: ReplayLibraryParams,
  page: number,
  perPage: number,
  sortDirection: 'asc' | 'desc',
): Promise<ReplayLibraryView> {
  if (isReplayLibraryBrowseView(params)) {
    const [pageResult, facetRows] = await Promise.all([
      listReplayLibraryPage({ page, perPage, ascending: sortDirection === 'asc' }),
      listReplayLibraryFacetRows(),
    ]);
    return {
      pageRows: pageResult.rows,
      totalItems: pageResult.total,
      safePage: pageResult.page,
      facetRows,
    };
  }

  const rows = await listReplayLibraryRows();
  const visibleRows = applyReplayLibraryParams(rows, params);
  const safePage = Math.min(page, totalTablePages(visibleRows.length, perPage));
  return {
    pageRows: paginateArray(visibleRows, safePage, perPage),
    totalItems: visibleRows.length,
    safePage,
    facetRows: rows,
  };
}

// UNKNOWN_* are the sentinels the replay-library query writes for missing joins.

/** The row's display label in the viewer's language (the stored `label` stays the English search text). */
function replayRowLabel(row: ReplayLibraryRow, t: Translator<typeof discoverEn>, locale: Locale): string {
  const player = (name: string) => (name === UNKNOWN_PLAYER ? t('replays.unknownPlayer') : name);
  return t('replays.rowLabel', {
    player1: player(row.player1Name),
    player2: player(row.player2Name),
    league: row.league === UNKNOWN_LEAGUE ? t('replays.unknownLeague') : row.league,
    round: roundLabel(row.round, t, locale),
    n: row.matchNumber,
  });
}

function roundLabel(round: string, t: Translator<typeof discoverEn>, locale: Locale): string {
  return round === UNKNOWN_ROUND ? t('replays.unknownRound') : translateEngineLabel('round', round, locale);
}

export default async function ReplaysPage({ searchParams }: PageProps) {
  const [rawParams, t, locale] = await Promise.all([searchParams, getT(discoverMessages), getLocale()]);
  const params = parseReplayLibraryParams(rawParams);
  const tableParams = parseTableParams(rawParams);
  const sortState = parseSortParam(params.sort, ['date', 'players', 'league', 'round'], {
    column: 'date',
    direction: 'desc',
  });
  const { pageRows, totalItems, safePage, facetRows } = await loadReplayLibraryView(
    params,
    tableParams.page,
    tableParams.perPage,
    sortState.direction,
  );
  const leagueOptions = getReplayLibraryLeagueOptions(facetRows);
  const tournamentOptions = getReplayLibraryTournamentOptions(facetRows);
  const roundOptions = getReplayLibraryRoundOptions(facetRows);
  const totalPages = totalTablePages(totalItems, tableParams.perPage);

  const baseQuery = {
    q: params.query || undefined,
    league: params.league || undefined,
    tournament: params.tournament || undefined,
    round: params.round || undefined,
    start: params.startDate || undefined,
    end: params.endDate || undefined,
    sort: params.sort || undefined,
    perPage: String(tableParams.perPage),
  };

  function sortHref(column: ReplayLibrarySortColumn): string {
    const current =
      sortState.key === column ? sortState : null;
    const nextSort = nextSortParam(current, column);
    return buildReplayLibraryHref(baseQuery, {
      sort: nextSort,
      page: undefined,
    });
  }

  function pageHref(page: number): string {
    return buildReplayLibraryHref(baseQuery, { page: page > 1 ? String(page) : undefined });
  }

  function perPageHref(perPage: number): string {
    return buildReplayLibraryHref(baseQuery, {
      perPage: perPage !== 20 ? String(perPage) : undefined,
      page: undefined,
    });
  }

  // Pre-compute hrefs as plain data so no functions cross the
  // Server → Client Component boundary (functions are not serializable).
  const pageHrefs: Record<number, string> = {};
  for (let p = 1; p <= totalPages; p += 1) {
    pageHrefs[p] = pageHref(p);
  }
  const perPageHrefs: Record<number, string> = {
    20: perPageHref(20),
    50: perPageHref(50),
    100: perPageHref(100),
  };

  return (
    <PageContainer
      title={t('replays.title')}
      subtitle={t('replays.subtitle')}
      maxWidth="xl"
    >
      <Card padding="lg">
        <form
          method="get"
          className="grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
        >
          <Input
            type="search"
            name="q"
            label={t('replays.search')}
            defaultValue={params.query}
            placeholder={t('replays.searchPlaceholder')}
            maxLength={64}
          />
          <Select name="league" label={t('replays.league')} defaultValue={params.league}>
            <option value="">{t('replays.allLeagues')}</option>
            {leagueOptions.map((league) => (
              <option key={league} value={league}>
                {league}
              </option>
            ))}
          </Select>
          <Select name="tournament" label={t('replays.tournament')} defaultValue={params.tournament}>
            <option value="">{t('replays.allTournaments')}</option>
            {tournamentOptions.map((tournament) => (
              <option key={tournament} value={tournament}>
                {tournament}
              </option>
            ))}
          </Select>
          <Select name="round" label={t('replays.round')} defaultValue={params.round}>
            <option value="">{t('replays.allRounds')}</option>
            {roundOptions.map((round) => (
              <option key={round} value={round}>
                {roundLabel(round, t, locale)}
              </option>
            ))}
          </Select>
          <Input type="date" name="start" label={t('replays.startDate')} defaultValue={params.startDate} />
          <Input type="date" name="end" label={t('replays.endDate')} defaultValue={params.endDate} />
          <div className="flex items-end gap-3">
            <button type="submit" className={getButtonClasses('primary', 'md')}>
              {t('replays.apply')}
            </button>
            <a href="/replays" className={getButtonClasses('ghost', 'md')}>
              {t('replays.reset')}
            </a>
          </div>
        </form>
      </Card>

      <Card padding="none" className="overflow-hidden">
        {totalItems === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-poke-text-muted">
            {t('replays.empty')}
          </p>
        ) : (
          <div className="space-y-4 p-4">
            <TablePagination
              page={safePage}
              totalPages={totalPages}
              perPage={tableParams.perPage}
              totalItems={totalItems}
              pageHrefs={pageHrefs}
              perPageHrefs={perPageHrefs}
            />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="border-b border-poke-border bg-poke-elevated">
                  <tr>
                    <SortableTableHeader
                      label={t('replays.date')}
                      column="date"
                      sortState={sortState}
                      href={sortHref('date')}
                    />
                    <SortableTableHeader
                      label={t('replays.players')}
                      column="players"
                      sortState={sortState}
                      href={sortHref('players')}
                    />
                    <SortableTableHeader
                      label={t('replays.league')}
                      column="league"
                      sortState={sortState}
                      href={sortHref('league')}
                    />
                    <SortableTableHeader
                      label={t('replays.round')}
                      column="round"
                      sortState={sortState}
                      href={sortHref('round')}
                    />
                    <th className="px-4 py-3 text-left font-heading text-xs font-semibold uppercase tracking-wide text-poke-text-secondary">
                      {t('replays.match')}
                    </th>
                    <th className="px-4 py-3 text-right font-heading text-xs font-semibold uppercase tracking-wide text-poke-text-secondary">
                      {t('replays.actions')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row) => (
                    <tr
                      key={row.replayUrl}
                      className="border-b border-poke-border last:border-b-0 hover:bg-poke-elevated/40"
                    >
                      <td className="px-4 py-3 text-poke-text-secondary">
                        <LocalTime value={row.date} preset="date" />
                      </td>
                      <td className="px-4 py-3 font-medium text-poke-text-primary">
                        {replayRowLabel(row, t, locale)}
                      </td>
                      <td className="px-4 py-3 text-poke-text-secondary">
                        {row.league === UNKNOWN_LEAGUE ? t('replays.unknownLeague') : row.league || '—'}
                      </td>
                      <td className="px-4 py-3 text-poke-text-secondary">
                        {row.round ? roundLabel(row.round, t, locale) : '—'}
                      </td>
                      <td className="px-4 py-3 text-poke-text-secondary">
                        {t('replays.gameNumber', { n: row.matchNumber })}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-3">
                          <Link href={row.matchUrl} className={getButtonClasses('secondary', 'sm')}>
                            {t('replays.matchPage')}
                          </Link>
                          <a
                            href={row.replayUrl}
                            target="_blank"
                            rel="noreferrer"
                            className={getButtonClasses('primary', 'sm')}
                          >
                            {t('replays.openReplay')}
                          </a>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TablePagination
              page={safePage}
              totalPages={totalPages}
              perPage={tableParams.perPage}
              totalItems={totalItems}
              pageHrefs={pageHrefs}
              perPageHrefs={perPageHrefs}
              className="justify-end"
            />
          </div>
        )}
      </Card>
    </PageContainer>
  );
}

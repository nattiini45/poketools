import type { Metadata } from 'next';
import Link from 'next/link';
import PageContainer from '@/components/ui/PageContainer';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { ExternalLink } from 'lucide-react';
import Button from '@/components/ui/Button';
import ItemIcon from '@/components/ui/ItemIcon';
import SkewChip from '@/components/ui/SkewChip';
import SkewPlate from '@/components/ui/SkewPlate';
import { SortableTableHeader, TablePagination } from '@/components/ui/Table';
import ButtonLink from '@/components/discover/ButtonLink';
import ReplayFilters from './ReplayFilters';
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
  getReplayLibraryCompetitionName,
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
    league: competitionLabel(row, t),
    round: roundLabel(row.round, t, locale),
    n: row.matchNumber,
  });
}

function competitionLabel(row: ReplayLibraryRow, t: Translator<typeof discoverEn>): string {
  const name = getReplayLibraryCompetitionName(row);
  return name === UNKNOWN_LEAGUE ? t('replays.unknownCompetition') : name;
}

function roundLabel(round: string, t: Translator<typeof discoverEn>, locale: Locale): string {
  return round === UNKNOWN_ROUND ? t('replays.unknownRound') : translateEngineLabel('round', round, locale);
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(discoverMessages);
  return { title: t('replays.title') };
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

  const activeFilterCount = [
    params.query,
    params.league,
    params.tournament,
    params.round,
    params.startDate,
    params.endDate,
  ].filter(Boolean).length;
  const fieldLabel = 'text-caption font-[550] text-fg-muted';
  const selectClass = 'h-9 border-border bg-transparent text-body shadow-none hover:bg-hover';
  const headClass = 'max-lg:flex max-lg:min-h-11 max-lg:items-center shrink-0 whitespace-nowrap text-caption normal-case [letter-spacing:normal] text-fg-muted';
  const cell = 'lg:table-cell lg:px-4 lg:py-3 lg:align-middle';

  return (
    <PageContainer
      title={t('replays.title')}
      subtitle={t('replays.subtitle')}
      maxWidth="xl"
      icon="dubious-disc"
    >
      <ReplayFilters label={t('replays.filters')} activeCount={activeFilterCount}>
        <form
          method="get"
          className="grid items-end gap-3 p-4 md:grid-cols-3 md:p-0 xl:grid-cols-[minmax(0,1.6fr)_repeat(5,minmax(0,1fr))_auto]"
        >
          <label className="flex flex-col gap-1.5">
            <span className={fieldLabel}>{t('replays.search')}</span>
            <Input
              type="search"
              name="q"
              defaultValue={params.query}
              placeholder={t('replays.searchPlaceholder')}
              maxLength={64}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={fieldLabel}>{t('replays.league')}</span>
            <Select name="league" defaultValue={params.league} className={selectClass}>
              <option value="">{t('replays.allLeagues')}</option>
              {leagueOptions.map((league) => (
                <option key={league} value={league}>
                  {league}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={fieldLabel}>{t('replays.tournament')}</span>
            <Select name="tournament" defaultValue={params.tournament} className={selectClass}>
              <option value="">{t('replays.allTournaments')}</option>
              {tournamentOptions.map((tournament) => (
                <option key={tournament} value={tournament}>
                  {tournament}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={fieldLabel}>{t('replays.round')}</span>
            <Select name="round" defaultValue={params.round} className={selectClass}>
              <option value="">{t('replays.allRounds')}</option>
              {roundOptions.map((round) => (
                <option key={round} value={round}>
                  {roundLabel(round, t, locale)}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={fieldLabel}>{t('replays.startDate')}</span>
            <Input type="date" name="start" defaultValue={params.startDate} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={fieldLabel}>{t('replays.endDate')}</span>
            <Input type="date" name="end" defaultValue={params.endDate} />
          </label>
          <div className="flex items-center gap-2 pb-1.5 max-md:pt-2">
            <Button type="submit" variant="primary" className="max-md:h-11 max-md:flex-1">
              {t('replays.apply')}
            </Button>
            <ButtonLink href="/replays" reload variant="ghost" className="max-md:h-11">
              {t('replays.reset')}
            </ButtonLink>
          </div>
        </form>
      </ReplayFilters>

      {totalItems === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-poke-lg border border-hairline bg-surface px-6 py-12 text-center">
          <ItemIcon item="poke-doll" size={72} />
          <h2 className="font-heading text-title text-fg">{t('replays.emptyTitle')}</h2>
          <p className="max-w-md text-body text-fg-muted">{t('replays.empty')}</p>
          <Link href={activeFilterCount > 0 ? '/replays' : '/leagues'} className="mt-2 inline-flex min-h-11 items-center">
            <SkewPlate variant="button">
              {activeFilterCount > 0 ? t('replays.resetFilters') : t('replays.browseLeagues')}
            </SkewPlate>
          </Link>
        </div>
      ) : (
        <Card padding="none" className="overflow-hidden">
          <TablePagination
            page={safePage}
            totalPages={totalPages}
            perPage={tableParams.perPage}
            totalItems={totalItems}
            pageHrefs={pageHrefs}
            perPageHrefs={perPageHrefs}
            className="px-4 py-3"
          />
          <table className="block w-full text-body lg:table lg:table-fixed">
            <thead className="block border-y border-hairline bg-elevated lg:table-header-group">
              <tr className="flex overflow-x-auto lg:table-row">
                <SortableTableHeader
                  label={t('replays.date')}
                  column="date"
                  sortState={sortState}
                  href={sortHref('date')}
                  className={`${headClass} lg:w-[7.5rem]`}
                />
                <SortableTableHeader
                  label={t('replays.players')}
                  column="players"
                  align="center"
                  sortState={sortState}
                  href={sortHref('players')}
                  className={`${headClass} lg:w-[26%]`}
                />
                <SortableTableHeader
                  label={t('replays.competition')}
                  column="league"
                  sortState={sortState}
                  href={sortHref('league')}
                  className={headClass}
                />
                <SortableTableHeader
                  label={t('replays.round')}
                  column="round"
                  sortState={sortState}
                  href={sortHref('round')}
                  className={`${headClass} lg:w-[10rem]`}
                />
                <th scope="col" className="hidden px-4 py-3 text-right text-caption font-[550] text-fg-muted lg:table-cell lg:w-[16.5rem]">
                  {t('replays.actions')}
                </th>
              </tr>
            </thead>
            <tbody className="block lg:table-row-group">
              {pageRows.map((row) => (
                <tr
                  key={row.replayUrl}
                  className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-hairline px-4 py-4 transition-colors duration-80 last:border-b-0 hover:bg-hover lg:table-row lg:p-0"
                >
                  <td className={`order-4 whitespace-nowrap text-caption tabular-nums text-fg-muted ${cell}`}>
                    <LocalTime value={row.date} preset="date" />
                  </td>
                  <td className={`order-1 basis-full ${cell}`}>
                    <span className="sr-only">{replayRowLabel(row, t, locale)}</span>
                    <span
                      aria-hidden="true"
                      className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 text-subtitle font-[550] text-fg"
                    >
                      <span className="truncate text-right">
                        {row.player1Name === UNKNOWN_PLAYER ? t('replays.unknownPlayer') : row.player1Name}
                      </span>
                      <SkewChip tone="accent" className="font-heading text-body font-normal">
                        {t('replays.versus')}
                      </SkewChip>
                      <span className="truncate">
                        {row.player2Name === UNKNOWN_PLAYER ? t('replays.unknownPlayer') : row.player2Name}
                      </span>
                    </span>
                  </td>
                  <td className={`order-2 min-w-0 basis-full ${cell}`}>
                    {row.competitionUrl ? (
                      <Link href={row.competitionUrl} className="inline-block rounded-poke-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring hover:underline">
                        <SkewChip>
                          <span className="block max-w-[16rem] truncate lg:max-w-[9rem] xl:max-w-[18rem]">
                            {competitionLabel(row, t)}
                          </span>
                        </SkewChip>
                      </Link>
                    ) : (
                      <SkewChip>{competitionLabel(row, t)}</SkewChip>
                    )}
                  </td>
                  <td className={`order-3 flex-1 whitespace-nowrap text-caption text-fg-muted ${cell}`}>
                    {row.round ? roundLabel(row.round, t, locale) : '—'}
                    <span aria-hidden="true"> · </span>
                    {t('replays.gameNumber', { n: row.matchNumber })}
                  </td>
                  <td className={`order-5 basis-full ${cell}`}>
                    <div className="flex items-center gap-2 lg:justify-end">
                      <ButtonLink href={row.matchUrl} variant="secondary" size="sm" className="max-lg:h-11 max-lg:flex-1">
                        {t('replays.matchPage')}
                      </ButtonLink>
                      <ButtonLink
                        href={row.replayUrl}
                        external
                        variant="primary"
                        size="sm"
                        className="max-lg:h-11 max-lg:flex-1"
                      >
                        {t('replays.openReplay')}
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      </ButtonLink>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <TablePagination
            page={safePage}
            totalPages={totalPages}
            perPage={tableParams.perPage}
            totalItems={totalItems}
            pageHrefs={pageHrefs}
            perPageHrefs={perPageHrefs}
            className="border-t border-hairline px-4 py-3"
          />
        </Card>
      )}
    </PageContainer>
  );
}

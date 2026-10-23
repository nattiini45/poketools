'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type {
  AdminMatchFilterOptions,
  AdminMatchLeagueOption,
  AdminMatchPhaseOption,
  AdminMatchStandaloneOption,
} from '@/lib/supabase/queries/matches';
import type { ApiResult } from '@/types/api';
import {
  ADMIN_MATCH_SEARCH_MAX_LENGTH,
  ADMIN_MATCH_SEARCH_PLAYER_CAP,
  ADMIN_MATCH_STATUSES,
  STANDALONE_LEAGUE,
  adminMatchLastPage,
  buildMatchListApiQuery,
  buildMatchListSearch,
  parseMatchListUrl,
  type AdminMatchListResponse,
  type MatchListUrlState,
} from '@/lib/admin/match-list';
import MatchStatusBadge from '@/components/match/MatchStatusBadge';
import Card from '@/components/ui/Card';
import Alert from '@/components/ui/Alert';
import Skeleton from '@/components/ui/Skeleton';
import { getButtonClasses } from '@/components/ui/Button';
import { AnimatedList, AnimatedListItem } from '@/components/shared/AnimatedList';
import { useFormatter, useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { shellMessages } from '@/i18n/messages/shell';
import { errorsAdmin } from '@/i18n/messages/errors';

/** How long typing pauses before the search is sent to the server. */
const SEARCH_DEBOUNCE_MS = 300;

/** Status tabs: '' = all, then each match status (its label is `admin.matches.status.<value>`). */
const STATUS_TABS: readonly (MatchListUrlState['status'])[] = ['', ...ADMIN_MATCH_STATUSES];

const SELECT_CLASSES =
  'border border-poke-border bg-poke-surface rounded-poke-md px-3 py-2 text-sm text-poke-text-primary focus:border-poke-border-focus focus:ring-1 focus:ring-poke-border-focus/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed w-full';

/** The API's error (or a load failure without one); translated at render. */
type LoadError = { kind: 'api'; error: ApiErrorLike } | { kind: 'loadFailed' };

/** GET a JSON `ApiResult`; a network or parse failure is `loadFailed`, an API error keeps its code. */
async function getJson<T>(url: string, signal: AbortSignal): Promise<{ ok: true; data: T } | { ok: false; error: LoadError }> {
  try {
    const res = await fetch(url, { signal });
    const result: ApiResult<T> = await res.json();
    if (result.success) return { ok: true, data: result.data };
    return { ok: false, error: { kind: 'api', error: toApiErrorLike(result) } };
  } catch {
    return { ok: false, error: { kind: 'loadFailed' } };
  }
}

/**
 * `update(patch)` for the list's filters: merges the patch into the URL state and hands the
 * new query string to `replace`. The state it merges into is a ref moved on every update, not
 * only when the router re-renders with the new URL, so two updates in one tick (a debounced
 * search firing right after a status click) compose instead of the second dropping the first.
 */
export function useMatchListUpdate(url: MatchListUrlState, replace: (search: string) => void) {
  const urlRef = useRef(url);
  useEffect(() => {
    urlRef.current = url;
  }, [url]);

  return useCallback(
    (patch: Partial<MatchListUrlState>) => {
      const next = { ...urlRef.current, ...patch };
      urlRef.current = next;
      replace(buildMatchListSearch(next));
    },
    [replace],
  );
}

/**
 * The list footer: the shown range, "page x of y" and the previous / next buttons. The last page
 * is capped at `ADMIN_MATCH_MAX_PAGE` (the API answers 400 above it), so a list longer than that
 * never offers a page it cannot load.
 */
export function MatchListPager({
  page,
  shownPage,
  total,
  pageSize,
  from,
  to,
  onPageChange,
}: {
  /** The page the URL asks for (the buttons step from it). */
  page: number;
  /** The page of the response on screen. */
  shownPage: number;
  total: number;
  pageSize: number;
  from: number;
  to: number;
  onPageChange: (page: number) => void;
}) {
  const t = useT(shellMessages);
  const f = useFormatter();
  const totalPages = adminMatchLastPage(total, pageSize);

  return (
    <div className="flex items-center justify-between pt-2">
      <div className="flex flex-wrap gap-x-3 text-xs text-poke-text-muted">
        <span>
          {t('admin.matches.range', {
            from: f.number(from),
            to: f.number(to),
            total: f.number(total),
          })}
        </span>
        {totalPages > 1 && (
          <span>{t('admin.matches.pageOf', { page: f.number(shownPage), pages: f.number(totalPages) })}</span>
        )}
      </div>
      {totalPages > 1 && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page <= 1}
            className={`${getButtonClasses('ghost', 'sm')} disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            {t('admin.matches.previous')}
          </button>
          <button
            type="button"
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className={`${getButtonClasses('ghost', 'sm')} disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            {t('admin.matches.next')}
          </button>
        </div>
      )}
    </div>
  );
}

export default function AdminMatchList() {
  const t = useT(shellMessages);
  const errorText = useApiErrorText(errorsAdmin);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // The URL is the source of truth for status, league, phase, q and page.
  const url = useMemo(() => parseMatchListUrl(searchParams), [searchParams]);
  const replaceSearch = useCallback(
    (search: string) => router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false }),
    [router, pathname],
  );
  const update = useMatchListUpdate(url, replaceSearch);

  // ── Search box: local text, sent to the URL (and so the server) after a pause ──
  const [searchInput, setSearchInput] = useState(url.q);
  // The q this box last put in the URL, and the URL q last seen: a URL q that this box did not
  // send (back / forward, a link) replaces the text; the echo of our own send does not.
  const [sentQ, setSentQ] = useState(url.q);
  const [seenQ, setSeenQ] = useState(url.q);
  if (url.q !== seenQ) {
    setSeenQ(url.q);
    if (url.q !== sentQ) {
      setSentQ(url.q);
      setSearchInput(url.q);
    }
  }
  useEffect(() => {
    const next = searchInput.trim();
    if (next === sentQ.trim()) return;
    const timer = setTimeout(() => {
      setSentQ(next);
      update({ q: next, page: 1 });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput, sentQ, update]);

  // ── Filter options (leagues with phases, standalone tournaments) ──
  const [options, setOptions] = useState<AdminMatchFilterOptions | null>(null);
  const [optionsError, setOptionsError] = useState<LoadError | null>(null);
  const [optionsKey, setOptionsKey] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void getJson<AdminMatchFilterOptions>('/api/admin/matches/filter-options', controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok) {
        setOptions(result.data);
        setOptionsError(null);
      } else {
        setOptionsError(result.error);
      }
    });
    return () => controller.abort();
  }, [optionsKey]);

  // ── The page of matches ──
  const [reloadKey, setReloadKey] = useState(0);
  const apiQuery = buildMatchListApiQuery(url);
  const requestKey = `${reloadKey}|${apiQuery}`;
  // The last settled response and the request it answered; anything else is "loading".
  const [settled, setSettled] = useState<{
    key: string;
    data: AdminMatchListResponse | null;
    error: LoadError | null;
  } | null>(null);
  const loading = settled?.key !== requestKey;
  const data = settled?.key === requestKey ? settled.data : null;
  const error = settled?.key === requestKey ? settled.error : null;
  useEffect(() => {
    // One request per filter state; a newer state aborts the older one, so a slow
    // earlier response can never replace the rows of the current filters.
    const controller = new AbortController();
    void getJson<AdminMatchListResponse>(`/api/admin/matches?${apiQuery}`, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setSettled(
        result.ok
          ? { key: requestKey, data: result.data, error: null }
          : { key: requestKey, data: null, error: result.error },
      );
    });
    return () => controller.abort();
  }, [apiQuery, requestKey]);

  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 50;

  // A page past the last one (a stale link, or rows removed meanwhile): step back to the last page.
  useEffect(() => {
    if (data && data.rows.length === 0 && data.total > 0 && url.page > 1) {
      update({ page: adminMatchLastPage(data.total, data.pageSize) });
    }
  }, [data, url.page, update]);

  // ── Cascading league -> phase selects ──
  const optionLabel = useCallback(
    (name: string, flags: { archived: boolean; test?: boolean }) => {
      let label = name;
      if (flags.test) label = t('admin.matches.testOption', { name: label });
      if (flags.archived) label = t('admin.matches.archivedOption', { name: label });
      return label;
    },
    [t],
  );

  const selectedLeague: AdminMatchLeagueOption | undefined = options?.leagues.find((l) => l.id === url.league);
  const phaseChoices: readonly (AdminMatchPhaseOption | AdminMatchStandaloneOption)[] =
    url.league === STANDALONE_LEAGUE ? (options?.tournaments ?? []) : (selectedLeague?.phases ?? []);
  const isStandalone = url.league === STANDALONE_LEAGUE;
  const phaseAll = isStandalone ? t('admin.matches.allTournaments') : t('admin.matches.allPhases');
  const phaseLabel = isStandalone ? t('admin.matches.tournament') : t('admin.matches.phase');

  const leagueKnown = url.league === '' || isStandalone || selectedLeague !== undefined;
  const phaseKnown = url.phase === '' || phaseChoices.some((p) => p.id === url.phase);

  // A deep-linked id the choices do not (yet) contain: a neutral label while they load, the id only once they
  // failed to load or really lack it.
  const optionsPending = options === null && optionsError === null;
  const unknownOptionLabel = (id: string) => (optionsPending ? t('admin.matches.loadingOption') : id);

  const firstShown = total === 0 || !data ? 0 : (data.page - 1) * data.pageSize + 1;
  const lastShown = data ? firstShown + data.rows.length - 1 : 0;

  return (
    <div className="space-y-4">
      {/* Search + League / Phase filters */}
      <div className="flex flex-col lg:flex-row gap-3">
        <div className="relative flex-1">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-poke-text-muted pointer-events-none"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            type="text"
            value={searchInput}
            maxLength={ADMIN_MATCH_SEARCH_MAX_LENGTH}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t('admin.matches.searchPlaceholder')}
            aria-label={t('admin.matches.searchLabel')}
            className="w-full pl-9 pr-3 py-2 border border-poke-border bg-poke-surface rounded-poke-md text-sm text-poke-text-primary placeholder:text-poke-text-muted focus:border-poke-border-focus focus:ring-1 focus:ring-poke-border-focus/20 transition-colors"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 lg:w-[34rem]">
          <select
            value={url.league}
            onChange={(e) => update({ league: e.target.value, phase: '', page: 1 })}
            aria-label={t('admin.matches.league')}
            className={SELECT_CLASSES}
          >
            <option value="">{t('admin.matches.allLeagues')}</option>
            <option value={STANDALONE_LEAGUE}>{t('admin.matches.noLeague')}</option>
            {!leagueKnown && <option value={url.league}>{unknownOptionLabel(url.league)}</option>}
            {options?.leagues.map((league) => (
              <option key={league.id} value={league.id}>
                {optionLabel(league.name, { archived: league.archived, test: league.is_test_season })}
              </option>
            ))}
          </select>
          <select
            value={url.phase}
            onChange={(e) => update({ phase: e.target.value, page: 1 })}
            disabled={url.league === ''}
            aria-label={phaseLabel}
            className={SELECT_CLASSES}
          >
            <option value="">{phaseAll}</option>
            {!phaseKnown && <option value={url.phase}>{unknownOptionLabel(url.phase)}</option>}
            {phaseChoices.map((phase) => (
              <option key={phase.id} value={phase.id}>
                {optionLabel(phase.name, { archived: phase.archived })}
              </option>
            ))}
          </select>
        </div>
      </div>

      {optionsError && (
        <Alert variant="error" className="flex items-center justify-between gap-3">
          <span>
            {t('admin.matches.filtersFailed')}
            {optionsError.kind === 'api' ? `: ${errorText(optionsError.error)}` : ''}
          </span>
          <button
            type="button"
            onClick={() => setOptionsKey((key) => key + 1)}
            className={getButtonClasses('secondary', 'sm')}
          >
            {t('admin.matches.retry')}
          </button>
        </Alert>
      )}

      {/* Status tabs */}
      <div className="flex gap-1 border-b border-poke-border overflow-x-auto">
        {STATUS_TABS.map((status) => (
          <button
            key={status || 'all'}
            type="button"
            onClick={() => update({ status, page: 1 })}
            aria-pressed={url.status === status}
            className={`px-3 py-2 text-xs font-heading font-medium border-b-2 transition-colors whitespace-nowrap ${
              url.status === status
                ? 'border-poke-accent text-poke-accent'
                : 'border-transparent text-poke-text-muted hover:text-poke-text-primary'
            }`}
          >
            {t(`admin.matches.status.${status || 'all'}`)}
          </button>
        ))}
      </div>

      {error && (
        <Alert variant="error" className="flex items-center justify-between gap-3">
          <span>{error.kind === 'loadFailed' ? t('admin.matches.loadFailed') : errorText(error.error)}</span>
          <button
            type="button"
            onClick={() => setReloadKey((key) => key + 1)}
            className={getButtonClasses('secondary', 'sm')}
          >
            {t('admin.matches.retry')}
          </button>
        </Alert>
      )}

      {data?.searchTruncated && !loading && (
        <Alert variant="warning">{t('admin.matches.searchTruncated', { count: ADMIN_MATCH_SEARCH_PLAYER_CAP })}</Alert>
      )}

      {loading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} height="72px" rounded="lg" />
          ))}
        </div>
      ) : !data || data.rows.length === 0 ? (
        !error && (
          <p className="text-sm text-poke-text-muted">
            {url.q ? t('admin.matches.noSearchResults') : t('admin.matches.none')}
          </p>
        )
      ) : (
        <>
          <AnimatedList className="space-y-2">
            {data.rows.map((m) => {
              const canSubmit = m.status === 'scheduled' || m.status === 'in_progress';
              const matchHref = `/tournaments/${m.tournament_id}/matches/${m.id}`;
              return (
                <AnimatedListItem key={m.id}>
                  <Link href={matchHref} className="block group">
                    <Card variant="outlined" padding="sm" className="transition-colors group-hover:border-poke-border-focus">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-heading font-medium text-sm text-poke-text-primary truncate group-hover:text-poke-accent transition-colors">
                            {t('admin.matches.versus', { player1: m.player_1_name, player2: m.player_2_name })}
                          </span>
                          {m.winner_name && (
                            <span className="text-xs text-poke-green shrink-0">
                              {t('admin.matches.winner', { name: m.winner_name })}
                            </span>
                          )}
                        </div>
                        <MatchStatusBadge status={m.status} />
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-poke-text-muted truncate">
                          {m.season_name
                            ? t('admin.matches.leaguePhase', { league: m.season_name, phase: m.tournament_name })
                            : m.tournament_name}
                        </span>
                        <div className="flex gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                          <Link href={`/admin/matches/${m.id}`} className={getButtonClasses('ghost', 'sm')}>
                            {t('admin.matches.override')}
                          </Link>
                          {canSubmit && (
                            <Link href={`/dashboard/submit/${m.id}`} className={getButtonClasses('secondary', 'sm')}>
                              {t('admin.matches.submitResult')}
                            </Link>
                          )}
                          {canSubmit && (
                            <Link href={`/dashboard/match-prep/${m.id}`} className={getButtonClasses('ghost', 'sm')}>
                              {t('admin.matches.viewPrep')}
                            </Link>
                          )}
                        </div>
                      </div>
                    </Card>
                  </Link>
                </AnimatedListItem>
              );
            })}
          </AnimatedList>

          <MatchListPager
            page={url.page}
            shownPage={data.page}
            total={total}
            pageSize={pageSize}
            from={firstShown}
            to={lastShown}
            onPageChange={(page) => update({ page })}
          />
        </>
      )}
    </div>
  );
}

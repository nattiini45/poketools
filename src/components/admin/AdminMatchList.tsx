'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { AdminMatchFilterOptions, AdminMatchRoundOption } from '@/lib/supabase/queries/matches';
import type { ApiResult } from '@/types/api';
import {
  ADMIN_MATCH_SEARCH_PLAYER_CAP,
  adminMatchLastPage,
  buildMatchListApiQuery,
  buildMatchListSearch,
  parseMatchListUrl,
  reconcileMatchListScope,
  type AdminMatchListResponse,
  type MatchListUrlState,
} from '@/lib/admin/match-list';
import AdminMatchFilters from '@/components/admin/AdminMatchFilters';
import { MatchListRow } from '@/components/admin/AdminMatchRowCard';
import { isRetryableLoadError, matchListEmptyKey } from '@/components/admin/match-list-view';
import Alert from '@/components/ui/Alert';
import Skeleton from '@/components/ui/Skeleton';
import { getButtonClasses } from '@/components/ui/Button';
import { AnimatedList, AnimatedListItem } from '@/components/shared/AnimatedList';
import { useFormatter, useT, useTimeZone } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { shellMessages } from '@/i18n/messages/shell';
import { errorsAdmin } from '@/i18n/messages/errors';

/** How long typing pauses before the search is sent to the server. */
const SEARCH_DEBOUNCE_MS = 300;

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
  const timeZone = useTimeZone();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // ── Filter options (leagues with phases, standalone tournaments, rulesets) ──
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

  // The URL is the source of truth for every filter, the sort and the page. A phase is checked against the filter
  // options (its league is derived from it, an unknown one dropped), so the bar, the rounds and the list request all
  // work from the same scope. A phase deep link therefore waits for the options before anything is requested.
  const parsedUrl = useMemo(() => parseMatchListUrl(searchParams), [searchParams]);
  const url = useMemo(() => reconcileMatchListScope(parsedUrl, options), [parsedUrl, options]);
  const scopePending = parsedUrl.phase !== '' && options === null && optionsError === null;
  const replaceSearch = useCallback(
    (search: string) => router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false }),
    [router, pathname],
  );
  const updateUrl = useMatchListUpdate(url, replaceSearch);

  // The "now" the relative date ranges (today, next 7 days) are resolved against. It moves only when the user
  // changes a date control and on Retry, never on a timer or during render, so the request key stays stable.
  // i18n-ignore: the seed only feeds the request URL, never the markup, so the server and client renders agree
  const [anchorMs, setAnchorMs] = useState(() => Date.now());
  const update = useCallback(
    (patch: Partial<MatchListUrlState>) => {
      if ('range' in patch || 'from' in patch || 'to' in patch || 'dateField' in patch) setAnchorMs(Date.now());
      updateUrl(patch);
    },
    [updateUrl],
  );

  // ── Search box: local text, sent to the URL (and so the server) after a pause ──
  const [searchInput, setSearchInput] = useState(url.q);
  // The q this box last put in the URL, and the URL q last seen: a URL q that this box did not
  // send (back / forward, a link, a removed chip) replaces the text; the echo of our own send does not.
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
      updateUrl({ q: next, page: 1 });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput, sentQ, updateUrl]);

  // ── Rounds of the selected phase (loaded lazily; the Round select is keyed by round id) ──
  const [roundsKey, setRoundsKey] = useState(0);
  const [roundsResult, setRoundsResult] = useState<{
    phase: string;
    rounds: AdminMatchRoundOption[] | null;
    error: LoadError | null;
  } | null>(null);
  useEffect(() => {
    if (!url.phase || scopePending) return;
    const phase = url.phase;
    const controller = new AbortController();
    void getJson<AdminMatchRoundOption[]>(
      `/api/admin/matches/filter-options/rounds?tournament_id=${encodeURIComponent(phase)}`,
      controller.signal,
    ).then((result) => {
      if (controller.signal.aborted) return;
      setRoundsResult(
        result.ok ? { phase, rounds: result.data, error: null } : { phase, rounds: null, error: result.error },
      );
    });
    return () => controller.abort();
  }, [url.phase, roundsKey, scopePending]);
  // Rounds belong to the phase they were loaded for; with another (or no) phase there are none.
  const roundsSettled = url.phase !== '' && roundsResult?.phase === url.phase;
  const rounds = roundsSettled ? roundsResult.rounds : null;
  const roundsError = roundsSettled ? roundsResult.error : null;
  const roundsPending = url.phase !== '' && !roundsSettled;

  // ── The page of matches ──
  const [reloadKey, setReloadKey] = useState(0);
  const apiQuery = buildMatchListApiQuery(url, { timeZone, nowMs: anchorMs });
  const requestKey = `${reloadKey}|${apiQuery}`;
  // The last settled response and the request it answered; anything else is "loading".
  const [settled, setSettled] = useState<{
    key: string;
    data: AdminMatchListResponse | null;
    error: LoadError | null;
  } | null>(null);
  // Names of the players the responses resolved, kept across reloads so the player chips do not flicker.
  const [playerNames, setPlayerNames] = useState<Record<string, string>>({});
  const loading = settled?.key !== requestKey;
  const data = settled?.key === requestKey ? settled.data : null;
  const error = settled?.key === requestKey ? settled.error : null;
  useEffect(() => {
    if (scopePending) return;
    // One request per filter state; a newer state aborts the older one, so a slow
    // earlier response can never replace the rows of the current filters.
    const controller = new AbortController();
    void getJson<AdminMatchListResponse>(`/api/admin/matches?${apiQuery}`, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok) {
        const players = result.data.players;
        if (players.length > 0) {
          setPlayerNames((prev) => ({ ...prev, ...Object.fromEntries(players.map((p) => [p.id, p.name])) }));
        }
      }
      setSettled(
        result.ok
          ? { key: requestKey, data: result.data, error: null }
          : { key: requestKey, data: null, error: result.error },
      );
    });
    return () => controller.abort();
  }, [apiQuery, requestKey, scopePending]);

  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 50;

  // A page past the last one (a stale link, or rows removed meanwhile): step back to the last page.
  useEffect(() => {
    if (data && data.rows.length === 0 && data.total > 0 && url.page > 1) {
      updateUrl({ page: adminMatchLastPage(data.total, data.pageSize) });
    }
  }, [data, url.page, updateUrl]);

  const firstShown = total === 0 || !data ? 0 : (data.page - 1) * data.pageSize + 1;
  const lastShown = data ? firstShown + data.rows.length - 1 : 0;

  const emptyText = t(`admin.matches.${matchListEmptyKey(url)}`);
  const backQuery = buildMatchListSearch(url);

  const alerts = (
    <>
      {optionsError && (
        <Alert variant="error" className="flex items-center justify-between gap-3">
          <span>
            {t('admin.matches.filtersFailed')}
            {optionsError.kind === 'api' ? `: ${errorText(optionsError.error)}` : ''}
          </span>
          {isRetryableLoadError(optionsError) && (
            <button
              type="button"
              onClick={() => setOptionsKey((key) => key + 1)}
              className={getButtonClasses('secondary', 'sm')}
            >
              {t('admin.matches.retry')}
            </button>
          )}
        </Alert>
      )}
      {roundsError && (
        <Alert variant="error" className="flex items-center justify-between gap-3">
          <span>
            {t('admin.matches.roundsFailed')}
            {roundsError.kind === 'api' ? `: ${errorText(roundsError.error)}` : ''}
          </span>
          {isRetryableLoadError(roundsError) && (
            <button
              type="button"
              onClick={() => setRoundsKey((key) => key + 1)}
              className={getButtonClasses('secondary', 'sm')}
            >
              {t('admin.matches.retry')}
            </button>
          )}
        </Alert>
      )}
    </>
  );

  return (
    <div className="space-y-4">
      <AdminMatchFilters
        url={url}
        update={update}
        searchInput={searchInput}
        onSearchChange={setSearchInput}
        options={options}
        optionsFailed={optionsError !== null}
        rounds={rounds}
        roundsPending={roundsPending}
        playerNames={playerNames}
        playersPending={loading}
        alerts={alerts}
      />

      {error && (
        <Alert variant="error" className="flex items-center justify-between gap-3">
          <span>{error.kind === 'loadFailed' ? t('admin.matches.loadFailed') : errorText(error.error)}</span>
          {isRetryableLoadError(error) && (
            <button
              type="button"
              onClick={() => {
                setAnchorMs(Date.now());
                setReloadKey((key) => key + 1);
              }}
              className={getButtonClasses('secondary', 'sm')}
            >
              {t('admin.matches.retry')}
            </button>
          )}
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
        !error && <p className="text-sm text-poke-text-muted">{emptyText}</p>
      ) : (
        <>
          <AnimatedList className="space-y-2">
            {data.rows.map((row) => (
              <AnimatedListItem key={row.id}>
                <MatchListRow row={row} backQuery={backQuery} />
              </AnimatedListItem>
            ))}
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

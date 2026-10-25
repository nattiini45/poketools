'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { AdminMatchFilterOptions, AdminMatchRoundOption, AdminMatchRow } from '@/lib/supabase/queries/matches';
import type { ApiResult } from '@/types/api';
import {
  ADMIN_MATCH_SEARCH_PLAYER_CAP,
  adminMatchLastPage,
  buildMatchListApiQuery,
  buildMatchListSearch,
  parseMatchListUrl,
  matchListScopeCorrection,
  reconcileMatchListScope,
  type AdminMatchListResponse,
  type MatchListUrlState,
} from '@/lib/admin/match-list';
import { ADMIN_MATCH_BULK_MAX, type AdminMatchBulkAction, type BulkItemResult } from '@/lib/admin/match-bulk';
import AdminMatchBulkBar from '@/components/admin/AdminMatchBulkBar';
import AdminMatchBulkDialog, { useBulkSummaryText } from '@/components/admin/AdminMatchBulkDialog';
import AdminMatchFilters from '@/components/admin/AdminMatchFilters';
import { MatchListRow } from '@/components/admin/AdminMatchRowCard';
import { downloadMatchExport, type MatchExportInfo } from '@/components/admin/match-bulk-client';
import { isRetryableLoadError, matchListEmptyKey } from '@/components/admin/match-list-view';
import { useMatchSelection } from '@/components/admin/useMatchSelection';
import type { AdminMatchViewer } from '@/lib/admin/match-row-actions';
import Alert from '@/components/ui/Alert';
import Skeleton from '@/components/ui/Skeleton';
import Button, { getButtonClasses } from '@/components/ui/Button';
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

/** The state of the CSV export button area. */
export type MatchExportState =
  | { kind: 'working' }
  | { kind: 'done'; info: Pick<MatchExportInfo, 'count' | 'total' | 'truncated' | 'searchTruncated'> }
  | { kind: 'failed'; error: ApiErrorLike };

/**
 * The strip above the rows: the page checkbox (indeterminate while only some rows are selected) next to the shown
 * range, the Export CSV button with its result line, and the hint on what a selection covers. Presentational, so
 * it renders without fetches.
 */
export function MatchListSelectionHeader({
  pageState,
  pageCount,
  from,
  to,
  total,
  onTogglePage,
  exportState,
  onExport,
}: {
  pageState: 'none' | 'some' | 'all';
  /** Rows on the page. */
  pageCount: number;
  from: number;
  to: number;
  total: number;
  onTogglePage: () => void;
  exportState: MatchExportState | null;
  onExport: () => void;
}) {
  const t = useT(shellMessages);
  const f = useFormatter();
  const errorText = useApiErrorText(errorsAdmin);
  const exporting = exportState?.kind === 'working';

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <label className="flex min-h-[32px] cursor-pointer items-center gap-2 text-xs text-poke-text-muted">
          <input
            type="checkbox"
            checked={pageState === 'all'}
            ref={(element) => {
              if (element) element.indeterminate = pageState === 'some';
            }}
            onChange={onTogglePage}
            data-state={pageState}
            aria-label={t('admin.matches.bulk.selectPage', { count: pageCount })}
            className="h-4 w-4 cursor-pointer accent-poke-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-poke-border-focus"
          />
          <span>{t('admin.matches.range', { from: f.number(from), to: f.number(to), total: f.number(total) })}</span>
        </label>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onExport}
          disabled={exporting || total === 0}
          className="min-h-[36px]"
        >
          {exporting ? t('admin.matches.export.working') : t('admin.matches.export.button', { count: total, number: f.number(total) })}
        </Button>
      </div>
      {/* Mounted before it has text, so the working and done lines are announced when they appear. */}
      <div role="status" className={exportState?.kind === 'done' ? 'space-y-0.5 text-xs text-poke-text-secondary' : 'sr-only'}>
        {exporting && <p>{t('admin.matches.export.working')}</p>}
        {exportState?.kind === 'done' && (
          <>
            <p>
              {exportState.info.truncated
                ? t('admin.matches.export.doneTruncated', {
                    exported: f.number(exportState.info.count),
                    total: f.number(exportState.info.total),
                  })
                : t('admin.matches.export.done', { count: exportState.info.count, number: f.number(exportState.info.count) })}
            </p>
            {exportState.info.searchTruncated && (
              <p className="text-poke-yellow-ink">
                {t('admin.matches.export.searchTruncated', { count: ADMIN_MATCH_SEARCH_PLAYER_CAP })}
              </p>
            )}
          </>
        )}
      </div>
      {exportState?.kind === 'failed' && (
        <p role="alert" className="text-xs text-poke-danger">
          {t('admin.matches.export.failed')}: {errorText(exportState.error)}
        </p>
      )}
      <p className="text-xs text-poke-text-muted">{t('admin.matches.bulk.hint', { max: ADMIN_MATCH_BULK_MAX })}</p>
    </div>
  );
}

export default function AdminMatchList({ viewer = null }: { viewer?: AdminMatchViewer | null }) {
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

  // A deep link whose scope was corrected (the phase won over a mismatched league, an unknown phase dropped) has its
  // address rewritten to the scope it lists, once the options are in. `replace` adds no history entry, and the
  // rewritten URL parses to the reconciled state itself, so the correction is empty the second time (no loop).
  const scopeCorrection = matchListScopeCorrection(parsedUrl, url);
  useEffect(() => {
    if (scopeCorrection !== null) replaceSearch(scopeCorrection);
  }, [scopeCorrection, replaceSearch]);

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

  // ── Row selection and the bulk actions ──
  const pageRows = data?.rows;
  const pageIds = useMemo(() => pageRows?.map((row) => row.id) ?? [], [pageRows]);
  // The request key carries every filter, the sort and the page, so any of them changing drops the selection.
  const selection = useMatchSelection({ selectionKey: apiQuery, pageIds });
  const selectedRows = useMemo(() => {
    const byId = new Map((pageRows ?? []).map((row) => [row.id, row]));
    return selection.selected.flatMap((id) => byId.get(id) ?? []);
  }, [pageRows, selection.selected]);
  // The selection as it was when the dialog opened: the list reloads behind the report.
  const [dialog, setDialog] = useState<{ kind: AdminMatchBulkAction; rows: AdminMatchRow[] } | null>(null);
  // What the screen-reader live region says after an action; the next change to the selection replaces it.
  const [announcement, setAnnouncement] = useState('');
  const summaryText = useBulkSummaryText();
  const { keepOnly } = selection;
  const handleBulkDone = useCallback(
    (results: BulkItemResult[]) => {
      // Whatever did not finish stays selected for a retry; the rest is deselected and the page reloads.
      keepOnly(results.filter((result) => !result.ok).map((result) => result.id));
      setReloadKey((key) => key + 1);
      setAnnouncement(summaryText(results));
    },
    [keepOnly, summaryText],
  );
  const toggleRow = (id: string) => {
    setAnnouncement('');
    selection.toggle(id);
  };
  const togglePage = () => {
    setAnnouncement('');
    selection.togglePage();
  };
  const clearSelection = () => {
    setAnnouncement('');
    selection.clear();
  };

  // ── CSV export of the whole filtered set (not only this page) ──
  const [exportResult, setExportResult] = useState<{ key: string; state: MatchExportState } | null>(null);
  const exportState = exportResult?.key === apiQuery ? exportResult.state : null;
  const exportController = useRef<AbortController | null>(null);
  useEffect(() => () => exportController.current?.abort(), []);
  const runExport = () => {
    if (exportState?.kind === 'working') return;
    exportController.current?.abort();
    const controller = new AbortController();
    exportController.current = controller;
    // Page 1 with the list's own clock: the file holds what the filters on screen select.
    const query = buildMatchListApiQuery({ ...url, page: 1 }, { timeZone, nowMs: anchorMs });
    const key = apiQuery;
    setExportResult({ key, state: { kind: 'working' } });
    void downloadMatchExport(query, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setExportResult({
        key,
        state: result.ok ? { kind: 'done', info: result.info } : { kind: 'failed', error: result.error },
      });
    });
  };

  const liveText =
    announcement || (selection.count > 0 ? t('admin.matches.bulk.liveSelected', { count: selection.count }) : '');

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
          <MatchListSelectionHeader
            pageState={selection.pageState}
            pageCount={data.rows.length}
            from={firstShown}
            to={lastShown}
            total={total}
            onTogglePage={togglePage}
            exportState={exportState}
            onExport={runExport}
          />

          <AnimatedList className="space-y-2">
            {data.rows.map((row) => (
              <AnimatedListItem key={row.id}>
                <MatchListRow
                  row={row}
                  backQuery={backQuery}
                  viewer={viewer}
                  selection={{ checked: selection.isSelected(row.id), onChange: () => toggleRow(row.id) }}
                />
              </AnimatedListItem>
            ))}
          </AnimatedList>

          <AdminMatchBulkBar
            count={selection.count}
            onClear={clearSelection}
            onAction={(kind) => {
              setAnnouncement('');
              setDialog({ kind, rows: selectedRows });
            }}
          />

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

      <div role="status" aria-live="polite" className="sr-only">
        {liveText}
      </div>

      {dialog && (
        <AdminMatchBulkDialog
          kind={dialog.kind}
          rows={dialog.rows}
          timeZone={timeZone}
          onClose={() => setDialog(null)}
          onDone={handleBulkDone}
        />
      )}
    </div>
  );
}

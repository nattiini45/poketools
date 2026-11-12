'use client';

/**
 * The league trash page's body (`/admin/leagues/trash`, superadmin only; the server page gates it and reads the data).
 *
 * - `LeagueTrashView` is the presentation: the notices (what a restore or a rebuild reported, kept until dismissed),
 *   the pending rebuilds with their "Run rebuild" action, and the table of trashed leagues (name, format, deleted by,
 *   deleted at, restorable until, counts, status chips, Restore). Pure props, so it renders in tests without a DOM.
 *   The page is `CompetitionList`'s trash view (redesign A4): the table shares its frame and cell recipe
 *   (`components/admin/competitions/table-styles.ts`) and the list's search narrows the rows and the pending rebuilds
 *   (`useCompetitionQuery`; outside a list the text is empty and nothing is narrowed).
 * - `LeagueTrashPanel` (default export) wires it: one action at a time (`/api/admin/league-trash/[id]/restore` or
 *   `.../rebuild`), the restore asks a `ConfirmDialog` first, the page state is `leagueTrashReducer`
 *   (`src/lib/league-trash/client.ts`), and the server data is refreshed after every successful action.
 *
 * A restored league leaves the table at once and its outcome stays in the notices: the warnings of the restore
 * (cleared references, released replay links, ignored columns), the drafts that came back paused and the rebuild
 * warning, rendered from the catalogue by code. A league whose delete rebuild is still pending cannot be restored
 * (the route would refuse): its row shows the badge and the pending list holds the action that clears it.
 */
import { useReducer, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import CompetitionEmpty from '@/components/admin/competitions/CompetitionEmpty';
import { useCompetitionQuery } from '@/components/admin/competitions/competition-query';
import {
  ACTION_CELL,
  CELL,
  NAME_CELL,
  ROW,
  TABLE,
  TABLE_FRAME,
  TBODY,
  TH,
  THEAD,
  TOUCH,
} from '@/components/admin/competitions/table-styles';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import SkewChip from '@/components/ui/SkewChip';
import { cn } from '@/lib/utils/cn';
import { matchesQuery } from '@/lib/admin/competition-list';
import { adminCompetitionsMessages } from '@/i18n/messages/admin-competitions';
import { LocalTime } from '@/i18n/LocalTime';
import type { Translator } from '@/i18n/core';
import type { Formatter } from '@/i18n/format';
import type en from '@/i18n/messages/league-admin/en';
import { useFormatter, useT } from '@/i18n/client';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText, type ApiErrorTextFn } from '@/i18n/use-api-error';
import { errorsAdmin, errorsSeasons, errorsTournaments } from '@/i18n/messages/errors';
import { leagueAdminMessages } from '@/i18n/messages/league-admin';
import {
  INITIAL_LEAGUE_TRASH_STATE,
  leagueTrashReducer,
  pendingKey,
  requestLeagueRebuild,
  requestLeagueRestore,
  type LeagueTrashHeadlineCounts,
  type LeagueTrashNotice,
  type LeagueTrashPageState,
  type LeagueTrashPendingView,
  type LeagueTrashRowView,
} from '@/lib/league-trash/client';
import type { LeagueTrashRestoreWarning } from '@/lib/league-trash/restore-warnings';
import { leagueTrashLifecycleState, leagueTrashMachine, type LeagueTrashBinState } from '@/lib/league-trash/lifecycle-state';

type T = Translator<typeof en>;

const COLUMNS = ['league', 'format', 'deletedBy', 'deletedAt', 'restorableUntil', 'contents', 'status', 'actions'] as const;

/** Whether the superadmin can restore an entry in `state`, and why not (`leagueTrashMachine`). */
function restoreAvailability(state: LeagueTrashBinState): { canRestore: boolean; blockedKey: 'trash.restore.blocked' | 'trash.restore.expired' | null } {
  const canRestore = leagueTrashMachine.transitionsFrom(state, 'superadmin').some((t) => t.event === 'restore');
  if (canRestore) return { canRestore, blockedKey: null };
  return { canRestore, blockedKey: state === 'rebuild_pending' ? 'trash.restore.blocked' : 'trash.restore.expired' };
}

const COUNT_KEYS = ['players', 'phases', 'matches', 'games', 'draftPools'] as const satisfies readonly (keyof LeagueTrashHeadlineCounts)[];

export interface LeagueTrashViewProps {
  rows: readonly LeagueTrashRowView[];
  pending: readonly LeagueTrashPendingView[];
  /** The time the page was read (ISO): an entry at or past its purge date can no longer be restored. */
  now: string;
  state: LeagueTrashPageState;
  /** The action that runs now (`restore:<trashId>` or `rebuild:<kind>:<trashId>`), or null. */
  busy: string | null;
  /** The league the restore confirm is open for. */
  confirming: LeagueTrashRowView | null;
  onAskRestore: (row: LeagueTrashRowView) => void;
  onConfirmRestore: () => void;
  onCancelRestore: () => void;
  onRunRebuild: (item: LeagueTrashPendingView) => void;
  onDismiss: (noticeId: number) => void;
  /** The list's search text: rows and pending rebuilds that do not contain every word are left out. */
  query?: string;
}

export const restoreBusyKey = (trashId: string) => `restore:${trashId}`;
export const rebuildBusyKey = (kind: 'delete' | 'restore', trashId: string) => `rebuild:${kind}:${trashId}`;

function warningText(t: T, f: Formatter, warning: LeagueTrashRestoreWarning): string {
  switch (warning.code) {
    case 'parent_missing_nulled':
      return t('trash.notice.warnings.parent_missing_nulled', { count: warning.count, rel: warning.rel, column: warning.column });
    case 'replay_hash_released':
      return t('trash.notice.warnings.replay_hash_released', { count: warning.count });
    case 'columns_ignored':
      return t('trash.notice.warnings.columns_ignored', { count: warning.columns.length, rel: warning.rel, columns: f.list(warning.columns) });
    case 'pointer_unknown':
      return t('trash.notice.warnings.pointer_unknown', { count: warning.count, rel: warning.rel, column: warning.column });
  }
}

function NoticeView({
  notice,
  t,
  f,
  errorText,
  onDismiss,
}: {
  notice: LeagueTrashNotice;
  t: T;
  f: Formatter;
  errorText: ApiErrorTextFn;
  onDismiss: (id: number) => void;
}) {
  const dismiss = (
    <Button variant="ghost" size="sm" className={TOUCH} onClick={() => onDismiss(notice.id)}>
      {t('trash.notice.dismiss')}
    </Button>
  );

  if (notice.kind === 'error') {
    const title = notice.action === 'restore' ? t('trash.restore.failedTitle', { name: notice.name }) : t('trash.pending.failedTitle', { name: notice.name });
    return (
      <Alert variant="error" data-trash-notice="error">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <p className="font-semibold">{title}</p>
            <p>{notice.error ? errorText(notice.error) : t('trash.failed')}</p>
          </div>
          {dismiss}
        </div>
      </Alert>
    );
  }

  if (notice.kind === 'rebuilt') {
    const warning = notice.rebuild.rebuildWarning;
    return (
      <Alert variant={warning ? 'warning' : 'success'} data-trash-notice="rebuilt">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <p className="font-semibold">{t('trash.notice.rebuilt', { name: notice.name })}</p>
            {warning && (
              <p>
                {t('trash.notice.rebuildIncomplete')} {errorText(warning)}
              </p>
            )}
          </div>
          {dismiss}
        </div>
      </Alert>
    );
  }

  const { restore } = notice;
  // pausedPools null: the restore answered after the request deadline, so its paused drafts and warnings are unknown.
  const detailsUnknown = restore.pausedPools === null;
  const needsReading =
    detailsUnknown || restore.warnings.length > 0 || (restore.pausedPools ?? 0) > 0 || restore.rebuildWarning !== null;
  return (
    <Alert variant={needsReading ? 'warning' : 'success'} data-trash-notice="restored">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-2">
          <p className="font-semibold">{t('trash.notice.restored', { name: restore.seasonName })}</p>
          {detailsUnknown && <p>{t('trash.notice.detailsUnknown')}</p>}
          {restore.pausedPools !== null && restore.pausedPools > 0 && (
            <p>{t('trash.notice.pausedPools', { count: restore.pausedPools })}</p>
          )}
          {restore.warnings.length > 0 && (
            <div className="space-y-1">
              <p className="font-semibold">{t('trash.notice.warningsTitle')}</p>
              <ul className="list-disc space-y-0.5 pl-5">
                {restore.warnings.map((warning, index) => (
                  <li key={`${warning.code}:${index}`}>{warningText(t, f, warning)}</li>
                ))}
              </ul>
            </div>
          )}
          {restore.rebuildWarning && (
            <p>
              {t('trash.notice.rebuildIncomplete')} {errorText(restore.rebuildWarning)}
            </p>
          )}
          <p>
            <Link href={`/admin/leagues/${restore.seasonId}`} className="font-semibold underline">
              {t('trash.notice.openLeague')}
            </Link>
          </p>
        </div>
        {dismiss}
      </div>
    </Alert>
  );
}

function CountsView({ counts, t }: { counts: LeagueTrashHeadlineCounts; t: T }) {
  const shown = COUNT_KEYS.filter((key) => counts[key] > 0);
  if (shown.length === 0) return <span className="text-fg-muted">–</span>;
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
      {shown.map((key) => (
        <li key={key} className="whitespace-nowrap">
          {t(`trash.counts.${key}`, { count: counts[key] })}
        </li>
      ))}
    </ul>
  );
}

export function LeagueTrashView({
  rows,
  pending,
  now,
  state,
  busy,
  confirming,
  onAskRestore,
  onConfirmRestore,
  onCancelRestore,
  onRunRebuild,
  onDismiss,
  query = '',
}: LeagueTrashViewProps) {
  const t = useT(leagueAdminMessages);
  const tc = useT(adminCompetitionsMessages);
  const f = useFormatter();
  const errorText = useApiErrorText(errorsSeasons, errorsTournaments, errorsAdmin);

  const openRows = rows.filter((row) => !state.restored.includes(row.id));
  const visibleRows = openRows
    .filter((row) => matchesQuery([row.name, row.formatLabel, row.deletedByName], query))
    .map((row) => {
      const rebuildPending = row.rebuildPending && !state.rebuilt.includes(pendingKey('delete', row.id));
      return { ...row, rebuildPending, ...restoreAvailability(leagueTrashLifecycleState({ rebuildPending, purgeAfter: row.purgeAfter }, now)) };
    });
  const visiblePending = pending
    .filter((item) => !state.rebuilt.includes(pendingKey(item.kind, item.trashId)))
    .filter((item) => matchesQuery([item.name], query));
  const anySchemaChanged = visibleRows.some((row) => row.schemaChanged);
  const busyNow = busy !== null;

  return (
    <div className="space-y-6">
      {state.notices.length > 0 && (
        <div className="space-y-3" data-trash-notices>
          {state.notices.map((notice) => (
            <NoticeView key={notice.id} notice={notice} t={t} f={f} errorText={errorText} onDismiss={onDismiss} />
          ))}
        </div>
      )}

      {visiblePending.length > 0 && (
        <section className="space-y-3 rounded-poke-lg border border-hairline bg-surface p-4" aria-labelledby="trash-pending-title">
          <div className="space-y-1">
            <h2 id="trash-pending-title" className="font-heading text-title text-fg">
              {t('trash.pending.title')}
            </h2>
            <p className="text-body text-fg-muted">{t('trash.pending.hint')}</p>
          </div>
          <ul className="divide-y divide-hairline" data-trash-pending>
            {visiblePending.map((item) => {
              const key = rebuildBusyKey(item.kind, item.trashId);
              return (
                <li key={key} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 space-y-1">
                    <p className="font-[550] text-fg">{item.name}</p>
                    <p className="flex flex-wrap items-center gap-2 text-caption text-fg-muted">
                      <SkewChip tone="accent">{t(`trash.pending.kind.${item.kind}`)}</SkewChip>
                      <LocalTime value={item.at} preset="dateTimeYear" />
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    className={TOUCH}
                    loading={busy === key}
                    disabled={busyNow}
                    aria-label={t('trash.pending.runLabel', { name: item.name })}
                    onClick={() => onRunRebuild(item)}
                  >
                    {t('trash.pending.run')}
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {openRows.length === 0 ? (
        <CompetitionEmpty title={t('trash.empty')} data-trash-empty />
      ) : visibleRows.length === 0 ? (
        visiblePending.length === 0 && (
          <CompetitionEmpty title={tc('empty.noMatches.title', { query: query.trim() })} hint={tc('empty.noMatches.hint')} data-competition-empty="search" />
        )
      ) : (
        <div className="space-y-2">
          <div className={TABLE_FRAME}>
            <table className={TABLE} data-trash-table>
              <caption className="sr-only">{t('trash.caption')}</caption>
              <thead className={THEAD}>
                <tr>
                  {COLUMNS.map((column) => (
                    <th key={column} scope="col" className={TH}>
                      {t(`trash.columns.${column}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className={TBODY}>
                {visibleRows.map((row) => (
                  <tr key={row.id} className={ROW} data-trash-row={row.id}>
                    <th scope="row" className={cn(NAME_CELL, 'font-[550] text-fg')}>
                      {row.name}
                    </th>
                    <td data-label={t('trash.columns.format')} className={cn(CELL, 'text-fg-muted')}>
                      {row.formatLabel}
                    </td>
                    <td data-label={t('trash.columns.deletedBy')} className={cn(CELL, 'text-fg-muted')}>
                      {row.deletedByName ?? t('trash.deletedByUnknown')}
                    </td>
                    <td data-label={t('trash.columns.deletedAt')} className={cn(CELL, 'text-fg-muted xl:whitespace-nowrap')}>
                      <LocalTime value={row.deletedAt} preset="dateTimeYear" />
                    </td>
                    <td data-label={t('trash.columns.restorableUntil')} className={cn(CELL, 'text-fg-muted xl:whitespace-nowrap')}>
                      <LocalTime value={row.purgeAfter} preset="dateTimeYear" />
                    </td>
                    <td data-label={t('trash.columns.contents')} className={cn(CELL, 'text-fg-muted')}>
                      <CountsView counts={row.counts} t={t} />
                    </td>
                    <td data-label={t('trash.columns.status')} className={cn(CELL, 'xl:whitespace-nowrap')}>
                      <div className="flex flex-wrap gap-1.5">
                        {row.rebuildPending && <SkewChip tone="accent">{t('trash.badges.rebuildPending')}</SkewChip>}
                        {row.schemaChanged && <SkewChip tone="loss">{t('trash.badges.schemaChanged')}</SkewChip>}
                        {row.canRestore && !row.schemaChanged && <SkewChip tone="live">{t('trash.badges.ready')}</SkewChip>}
                      </div>
                    </td>
                    <td className={ACTION_CELL}>
                      <Button
                        variant="secondary"
                        size="sm"
                        className={TOUCH}
                        loading={busy === restoreBusyKey(row.id)}
                        disabled={busyNow || !row.canRestore}
                        title={row.blockedKey ? t(row.blockedKey) : undefined}
                        aria-label={t('trash.restore.buttonLabel', { name: row.name })}
                        onClick={() => onAskRestore(row)}
                      >
                        {t('trash.restore.button')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {anySchemaChanged && <p className="text-caption text-fg-muted">{t('trash.schemaChangedHint')}</p>}
        </div>
      )}

      <ConfirmDialog
        open={confirming !== null}
        onClose={onCancelRestore}
        onConfirm={onConfirmRestore}
        title={t('trash.restore.confirmTitle')}
        message={confirming ? t('trash.restore.confirmMessage', { name: confirming.name }) : ''}
        confirmLabel={t('trash.restore.confirmAction')}
        confirmVariant="primary"
        loading={confirming !== null && busy === restoreBusyKey(confirming.id)}
      />
    </div>
  );
}

export interface LeagueTrashPanelProps {
  rows: readonly LeagueTrashRowView[];
  pending: readonly LeagueTrashPendingView[];
  /** The time the page was read (ISO). */
  now: string;
}

export default function LeagueTrashPanel({ rows, pending, now }: LeagueTrashPanelProps) {
  const router = useRouter();
  const query = useCompetitionQuery();
  const [state, dispatch] = useReducer(leagueTrashReducer, INITIAL_LEAGUE_TRASH_STATE);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<LeagueTrashRowView | null>(null);

  async function restore(row: LeagueTrashRowView) {
    setBusy(restoreBusyKey(row.id));
    try {
      const outcome = await requestLeagueRestore(row.id);
      if (outcome.kind === 'ok') {
        dispatch({ type: 'restored', trashId: row.id, restore: outcome.value });
        router.refresh();
      } else {
        dispatch({ type: 'failed', action: 'restore', name: row.name, error: outcome.error });
      }
    } catch (requestError) {
      console.error(`[LeagueTrashPanel] restoring ${row.id} failed`, requestError);
      dispatch({ type: 'failed', action: 'restore', name: row.name, error: apiErrorOf(requestError) });
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  async function rebuild(item: LeagueTrashPendingView) {
    setBusy(rebuildBusyKey(item.kind, item.trashId));
    try {
      const outcome = await requestLeagueRebuild(item.trashId);
      if (outcome.kind === 'ok') {
        dispatch({ type: 'rebuilt', trashId: item.trashId, name: item.name, rebuild: outcome.value });
        router.refresh();
      } else {
        dispatch({ type: 'failed', action: 'rebuild', name: item.name, error: outcome.error });
      }
    } catch (requestError) {
      console.error(`[LeagueTrashPanel] rebuilding ${item.trashId} failed`, requestError);
      dispatch({ type: 'failed', action: 'rebuild', name: item.name, error: apiErrorOf(requestError) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <LeagueTrashView
      rows={rows}
      pending={pending}
      now={now}
      state={state}
      busy={busy}
      confirming={confirming}
      onAskRestore={setConfirming}
      onConfirmRestore={() => {
        if (confirming) void restore(confirming);
      }}
      onCancelRestore={() => setConfirming(null)}
      onRunRebuild={(item) => void rebuild(item)}
      onDismiss={(id) => dispatch({ type: 'dismiss', id })}
      query={query}
    />
  );
}

/** A failed request: a fetch `TypeError` is the catalogue's `network_error`; anything else shows the generic text. */
function apiErrorOf(requestError: unknown): ApiErrorLike | null {
  const error = toApiErrorLike(requestError);
  return error.code ? { code: error.code } : null;
}

'use client';

/**
 * The league trash page's body (`/admin/leagues/trash`, superadmin only; the server page gates it and reads the data).
 *
 * - `LeagueTrashView` is the presentation: the notices (what a restore or a rebuild reported, kept until dismissed),
 *   the pending rebuilds with their "Run rebuild" action, and the table of trashed leagues (name, format, deleted by,
 *   deleted at, restorable until, counts, status badges, Restore). Pure props, so it renders in tests without a DOM.
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
import Alert from '@/components/ui/Alert';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Section from '@/components/ui/Section';
import { cn } from '@/lib/utils/cn';
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

type T = Translator<typeof en>;

/** A small button is a full 44px target on a phone and text-sized from `sm` up. */
const TOUCH = 'min-h-11 sm:min-h-0';

const COLUMNS = ['league', 'format', 'deletedBy', 'deletedAt', 'restorableUntil', 'contents', 'status', 'actions'] as const;

/**
 * A cell of the table. Below `xl` the table is a list of cards (every table display value is switched off) and a cell
 * prints its column name in front of its value, taken from `data-label`; from `xl` it is an ordinary table cell.
 */
const CELL = "flex items-baseline gap-3 py-0.5 before:w-24 before:shrink-0 before:text-xs before:text-poke-text-muted before:content-[attr(data-label)] xl:table-cell xl:px-3 xl:py-3 xl:before:content-none";

const COUNT_KEYS = ['players', 'phases', 'matches', 'games', 'draftPools'] as const satisfies readonly (keyof LeagueTrashHeadlineCounts)[];

export interface LeagueTrashViewProps {
  rows: readonly LeagueTrashRowView[];
  pending: readonly LeagueTrashPendingView[];
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
  const needsReading = restore.warnings.length > 0 || restore.pausedPools > 0 || restore.rebuildWarning !== null;
  return (
    <Alert variant={needsReading ? 'warning' : 'success'} data-trash-notice="restored">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-2">
          <p className="font-semibold">{t('trash.notice.restored', { name: restore.seasonName })}</p>
          {restore.pausedPools > 0 && <p>{t('trash.notice.pausedPools', { count: restore.pausedPools })}</p>}
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
  if (shown.length === 0) return <span className="text-poke-text-muted">–</span>;
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
  state,
  busy,
  confirming,
  onAskRestore,
  onConfirmRestore,
  onCancelRestore,
  onRunRebuild,
  onDismiss,
}: LeagueTrashViewProps) {
  const t = useT(leagueAdminMessages);
  const f = useFormatter();
  const errorText = useApiErrorText(errorsSeasons, errorsTournaments, errorsAdmin);

  const visibleRows = rows
    .filter((row) => !state.restored.includes(row.id))
    .map((row) => ({ ...row, rebuildPending: row.rebuildPending && !state.rebuilt.includes(pendingKey('delete', row.id)) }));
  const visiblePending = pending.filter((item) => !state.rebuilt.includes(pendingKey(item.kind, item.trashId)));
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
        <Section title={t('trash.pending.title')} subtitle={t('trash.pending.hint')}>
          <ul className="divide-y divide-poke-border" data-trash-pending>
            {visiblePending.map((item) => {
              const key = rebuildBusyKey(item.kind, item.trashId);
              return (
                <li key={key} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium text-poke-text-primary">{item.name}</p>
                    <p className="flex flex-wrap items-center gap-2 text-sm text-poke-text-muted">
                      <Badge variant="yellow">{t(`trash.pending.kind.${item.kind}`)}</Badge>
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
        </Section>
      )}

      {visibleRows.length === 0 ? (
        <p className="text-poke-text-muted" data-trash-empty>
          {t('trash.empty')}
        </p>
      ) : (
        <div className="space-y-2">
          <div className="rounded-poke-lg border border-poke-border bg-poke-surface shadow-poke-card xl:overflow-x-auto">
            <table className="block w-full border-collapse text-left text-sm xl:table xl:min-w-[64rem]" data-trash-table>
              <caption className="sr-only">{t('trash.caption')}</caption>
              <thead className="sr-only bg-poke-elevated/50 text-xs uppercase tracking-wide text-poke-text-muted xl:not-sr-only xl:table-header-group">
                <tr>
                  {COLUMNS.map((column) => (
                    <th key={column} scope="col" className="px-3 py-2 font-heading font-semibold">
                      {t(`trash.columns.${column}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="block divide-y divide-poke-border xl:table-row-group">
                {visibleRows.map((row) => (
                  <tr key={row.id} className="block px-3 py-3 align-top xl:table-row xl:p-0" data-trash-row={row.id}>
                    <th scope="row" className="block pb-2 text-base font-medium text-poke-text-primary xl:table-cell xl:px-3 xl:py-3 xl:text-sm">
                      {row.name}
                    </th>
                    <td data-label={t('trash.columns.format')} className={cn(CELL, 'text-poke-text-secondary')}>
                      {row.formatLabel}
                    </td>
                    <td data-label={t('trash.columns.deletedBy')} className={cn(CELL, 'text-poke-text-secondary')}>
                      {row.deletedByName ?? t('trash.deletedByUnknown')}
                    </td>
                    <td data-label={t('trash.columns.deletedAt')} className={cn(CELL, 'text-poke-text-secondary xl:whitespace-nowrap')}>
                      <LocalTime value={row.deletedAt} preset="dateTimeYear" />
                    </td>
                    <td data-label={t('trash.columns.restorableUntil')} className={cn(CELL, 'text-poke-text-secondary xl:whitespace-nowrap')}>
                      <LocalTime value={row.purgeAfter} preset="dateTimeYear" />
                    </td>
                    <td data-label={t('trash.columns.contents')} className={cn(CELL, 'text-poke-text-secondary')}>
                      <CountsView counts={row.counts} t={t} />
                    </td>
                    <td data-label={t('trash.columns.status')} className={cn(CELL, 'xl:whitespace-nowrap')}>
                      <div className="flex flex-wrap gap-1.5">
                        {row.rebuildPending && <Badge variant="blue">{t('trash.badges.rebuildPending')}</Badge>}
                        {row.schemaChanged && <Badge variant="yellow">{t('trash.badges.schemaChanged')}</Badge>}
                        {!row.rebuildPending && !row.schemaChanged && <Badge variant="green">{t('trash.badges.ready')}</Badge>}
                      </div>
                    </td>
                    <td className="block pt-2 xl:table-cell xl:px-3 xl:py-3">
                      <Button
                        variant="secondary"
                        size="sm"
                        className={TOUCH}
                        loading={busy === restoreBusyKey(row.id)}
                        disabled={busyNow || row.rebuildPending}
                        title={row.rebuildPending ? t('trash.restore.blocked') : undefined}
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
          {anySchemaChanged && <p className="text-xs text-poke-text-muted">{t('trash.schemaChangedHint')}</p>}
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
}

export default function LeagueTrashPanel({ rows, pending }: LeagueTrashPanelProps) {
  const router = useRouter();
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
    />
  );
}

/** A failed request: a fetch `TypeError` is the catalogue's `network_error`; anything else shows the generic text. */
function apiErrorOf(requestError: unknown): ApiErrorLike | null {
  const error = toApiErrorLike(requestError);
  return error.code ? { code: error.code } : null;
}

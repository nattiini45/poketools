'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import Skeleton from '@/components/ui/Skeleton';
import SkewChip, { type SkewChipTone } from '@/components/ui/SkewChip';
import AdminEmpty from '@/components/admin/AdminEmpty';
import AdminSectionHeading from '@/components/admin/AdminSectionHeading';
import { ACTION_CELL, CELL, NAME_CELL, ROW, ROW_LINK, TABLE, TABLE_FRAME, TBODY, TH, THEAD, TOUCH } from '@/components/admin/admin-table';
import { cn } from '@/lib/utils/cn';
import type { ApiResult } from '@/types/api';
import {
  ATTENTION_STATUSES,
  DASHBOARD_STAT_HREFS,
  attentionListHref,
  type AttentionMatch,
  type AttentionStatus,
  type DashboardData,
} from '@/lib/admin/dashboard';
import { useFormatter, useT } from '@/i18n/client';
import { RelativeTime, useMinuteClock } from '@/i18n/LocalTime';
import { useApiErrorText } from '@/i18n/use-api-error';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { errorsAdmin } from '@/i18n/messages/errors';
import { adminCoreMessages } from '@/i18n/messages/admin-core';
import { auditActionLabel, type ExtensionAuditActionLabels } from '@/i18n/content/audit-actions';

export type { DashboardData };

// Re-exported for existing importers; new code imports from `@/i18n/content/audit-actions`.
export { auditActionLabel };

/** A failed load: the API body (translated by code) or a local message key. */
type LoadError = { api: ApiErrorLike } | { local: 'loadFailed' | 'networkError' };

const FOCUS =
  'focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]';

/** One figure of the totals strip: the number in the pixel face, its name below; a link when the figure has a list. */
function StatCell({ label, value, href, className }: { label: string; value: number; href?: string; className?: string }) {
  const formatter = useFormatter();
  const figure = (
    <>
      <span className="block font-heading text-display tabular-nums text-fg">{formatter.number(value)}</span>
      <span className="mt-0.5 block text-caption text-fg-muted">{label}</span>
    </>
  );
  if (!href) return <li className={cn('px-4 py-3 shadow-[1px_0_0_0_var(--hairline),0_1px_0_0_var(--hairline)]', className)}>{figure}</li>;
  return (
    <li className={cn('shadow-[1px_0_0_0_var(--hairline),0_1px_0_0_var(--hairline)]', className)}>
      <Link
        href={href}
        className={cn(
          'block h-full px-4 py-3 transition-[background-color] duration-80 ease-out hover:bg-hover',
          FOCUS,
          'focus-visible:-outline-offset-2',
        )}
      >
        {figure}
      </Link>
    </li>
  );
}

/** The "See all" label of each attention status (one link per status: the list filters by one). */
const SEE_ALL_KEYS = {
  disputed: 'dashboard.attention.seeAllDisputed',
  pending_confirmation: 'dashboard.attention.seeAllPending',
} as const satisfies Record<AttentionStatus, string>;

/** The four matches that have waited longest carry the tier plates, like the top four of a table. */
const QUEUE_TONE: readonly SkewChipTone[] = ['tier-1', 'tier-2', 'tier-3', 'tier-4'];

function AttentionRow({ match: m, position }: { match: AttentionMatch; position: number }) {
  const t = useT(adminCoreMessages);
  const formatter = useFormatter();
  const now = useMinuteClock();
  const unknown = t('dashboard.attention.unknown');
  const tournamentName = m.tournament_name ?? unknown;

  return (
    <tr className={ROW}>
      <th scope="row" className={NAME_CELL}>
        <span className="flex items-start gap-2.5">
          <SkewChip tone={QUEUE_TONE[position] ?? 'neutral'} className="mt-px shrink-0 font-heading">
            {position + 1}
          </SkewChip>
          <span className="min-w-0">
            <Link href={`/admin/matches/${m.id}`} className={cn('break-words text-subtitle xl:text-body', ROW_LINK)}>
              {t('versus', { player1: m.player_1_name ?? unknown, player2: m.player_2_name ?? unknown })}
            </Link>
            {m.status === 'disputed' && m.note && (
              <span className="mt-1 block break-words text-caption font-normal text-fg-muted line-clamp-2">{m.note}</span>
            )}
          </span>
        </span>
      </th>
      <td data-label={t('dashboard.attention.columns.competition')} className={CELL}>
        <p className="min-w-0 break-words text-fg">
          {m.season_name
            ? t('dashboard.attention.leaguePhase', { league: m.season_name, phase: tournamentName })
            : tournamentName}
        </p>
      </td>
      <td data-label={t('dashboard.attention.columns.status')} className={CELL}>
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <SkewChip tone={m.status === 'disputed' ? 'loss' : 'accent'}>
            {m.status === 'pending_confirmation'
              ? t('dashboard.attention.needsConfirm')
              : t('dashboard.attention.disputed')}
          </SkewChip>
          <span className="text-caption text-fg-muted">
            {t('dashboard.attention.waiting', { when: formatter.relative(m.updated_at, now) })}
          </span>
        </span>
      </td>
      <td className={cn(ACTION_CELL, 'max-xl:col-span-2 max-xl:col-start-1 max-xl:row-start-auto max-xl:pt-2')}>
        <span className="flex flex-wrap gap-2 xl:flex-nowrap xl:justify-end">
          <Button asChild variant="secondary" size="sm" className={TOUCH}>
            <Link href={`/tournaments/${m.tournament_id}/matches/${m.id}`}>{t('dashboard.attention.publicPage')}</Link>
          </Button>
          <Button asChild variant="ghost" size="sm" className={TOUCH}>
            <Link href={`/tournaments/${m.tournament_id}`}>{t('dashboard.attention.tournament')}</Link>
          </Button>
        </span>
      </td>
    </tr>
  );
}

export default function AdminDashboardContent({
  extensionActionLabels = {},
}: {
  /** Localized labels of the active pack extension's audit actions (`extensionAuditActionLabels`). */
  extensionActionLabels?: ExtensionAuditActionLabels;
} = {}) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LoadError | null>(null);
  const t = useT(adminCoreMessages);
  const errorText = useApiErrorText(errorsAdmin);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/dashboard');
      const json: ApiResult<DashboardData> = await res.json();
      if (json.success && json.data) {
        setData(json.data);
      } else {
        const err = toApiErrorLike(json);
        setError(err.error || err.code ? { api: err } : { local: 'loadFailed' });
      }
    } catch {
      setError({ local: 'networkError' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  if (loading) {
    return (
      <div className="flex flex-col gap-8" aria-busy="true" data-admin-overview="loading">
        <p className="sr-only" role="status">
          {t('dashboard.loading')}
        </p>
        <div>
          <AdminSectionHeading id="admin-attention-title" icon="vs-seeker" title={t('dashboard.attention.title')} />
          <div className={cn(TABLE_FRAME, 'divide-y divide-hairline')}>
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-3">
                <Skeleton width="1.75rem" height="1.25rem" rounded="sm" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="w-2/5 max-w-64" height="0.875rem" rounded="sm" />
                  <Skeleton className="w-3/5 max-w-96" height="0.75rem" rounded="sm" />
                </div>
                <Skeleton className="hidden sm:block" width="6rem" height="1.25rem" rounded="sm" />
              </div>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 overflow-hidden rounded-poke-lg border border-hairline bg-surface lg:grid-cols-5">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="space-y-2 px-4 py-3 shadow-[1px_0_0_0_var(--hairline),0_1px_0_0_var(--hairline)] last:col-span-2 lg:last:col-span-1">
              <Skeleton width="3.5rem" height="2rem" rounded="sm" />
              <Skeleton width="5rem" height="0.75rem" rounded="sm" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="error" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2" data-admin-overview="error">
        <span>{'api' in error ? errorText(error.api) : t(`dashboard.${error.local}`)}</span>
        <Button variant="secondary" size="sm" className={TOUCH} onClick={load}>
          {t('dashboard.retry')}
        </Button>
      </Alert>
    );
  }

  if (!data) return null;

  return <DashboardView data={data} extensionActionLabels={extensionActionLabels} />;
}

/** The loaded dashboard. Exported for tests; `null` figures are hidden (not available for the role). */
export function DashboardView({
  data,
  extensionActionLabels = {},
}: {
  data: DashboardData;
  extensionActionLabels?: ExtensionAuditActionLabels;
}) {
  const t = useT(adminCoreMessages);
  const { counts, attention_required, attention_total, attention_by_status, recent_activity } = data;

  const allStatItems = [
    { key: 'players', value: counts.players, href: DASHBOARD_STAT_HREFS.players },
    { key: 'tournaments', value: counts.tournaments, href: DASHBOARD_STAT_HREFS.tournaments },
    { key: 'activeMatches', value: counts.active_matches, href: DASHBOARD_STAT_HREFS.activeMatches },
    { key: 'leagues', value: counts.leagues, href: DASHBOARD_STAT_HREFS.leagues },
    // The games total has no admin list to open.
    { key: 'games', value: counts.games, href: undefined },
  ] as const;
  // A null figure is not available for this role: hide the card rather than show a zero.
  const statItems = allStatItems.filter(
    (s): s is (typeof allStatItems)[number] & { value: number } => s.value !== null,
  );
  const attentionTruncated = attention_total > attention_required.length;

  return (
    <div className="flex flex-col gap-8" data-admin-overview="loaded">
      {/* Attention queue: the matches that have waited longest, oldest first */}
      <section aria-labelledby="admin-attention-title">
        <AdminSectionHeading
          id="admin-attention-title"
          icon="vs-seeker"
          title={t('dashboard.attention.title')}
          aside={
            attention_required.length > 0 && (
              <SkewChip tone="tier-1">
                {attentionTruncated
                  ? t('dashboard.attention.countOfTotal', { count: attention_required.length, total: attention_total })
                  : t('dashboard.attention.count', { count: attention_required.length })}
              </SkewChip>
            )
          }
        >
          {attention_total > 0 &&
            ATTENTION_STATUSES.filter((status) => attention_by_status[status] > 0).map((status) => (
              <Button key={status} asChild variant="secondary" size="sm" className={TOUCH}>
                <Link href={attentionListHref(status)}>{t(SEE_ALL_KEYS[status], { count: attention_by_status[status] })}</Link>
              </Button>
            ))}
        </AdminSectionHeading>
        {attention_required.length === 0 ? (
          <AdminEmpty title={t('dashboard.attention.emptyTitle')} hint={t('dashboard.attention.empty')} data-admin-attention-empty>
            <Button asChild variant="primary" size="sm" className={TOUCH}>
              <Link href="/admin/leagues/new">{t('dashboard.newCompetition')}</Link>
            </Button>
          </AdminEmpty>
        ) : (
          <div className={TABLE_FRAME}>
            <table className={TABLE} data-admin-attention>
              <caption className="sr-only">{t('dashboard.attention.caption')}</caption>
              <thead className={THEAD}>
                <tr>
                  <th scope="col" className={TH}>
                    {t('dashboard.attention.columns.match')}
                  </th>
                  <th scope="col" className={TH}>
                    {t('dashboard.attention.columns.competition')}
                  </th>
                  <th scope="col" className={TH}>
                    {t('dashboard.attention.columns.status')}
                  </th>
                  <th scope="col" className={cn(TH, 'xl:text-right')}>
                    {t('dashboard.attention.columns.open')}
                  </th>
                </tr>
              </thead>
              <tbody className={TBODY}>
                {attention_required.map((m, index) => (
                  <AttentionRow key={m.id} match={m} position={index} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Totals */}
      <section aria-label={t('dashboard.stats.label')}>
        <ul
          className={cn(
            'grid overflow-hidden rounded-poke-lg border border-hairline bg-surface',
            statItems.length === 5 ? 'grid-cols-2 lg:grid-cols-5' : 'grid-cols-3',
          )}
        >
          {statItems.map((s) => (
            <StatCell
              key={s.key}
              label={t(`dashboard.stats.${s.key}`)}
              value={s.value}
              href={s.href}
              className={statItems.length === 5 ? 'last:col-span-2 lg:last:col-span-1' : undefined}
            />
          ))}
        </ul>
      </section>

      {/* Recent Activity: site admins only (the audit trail is not scoped) */}
      {Array.isArray(recent_activity) && (
        <section aria-labelledby="admin-activity-title">
          <AdminSectionHeading
            id="admin-activity-title"
            icon="old-amber"
            title={t('dashboard.activity.title')}
            aside={<SkewChip>{t('dashboard.activity.count', { count: recent_activity.length })}</SkewChip>}
          >
            <Button asChild variant="secondary" size="sm" className={TOUCH}>
              <Link href="/admin/audit">{t('dashboard.activity.viewAll')}</Link>
            </Button>
          </AdminSectionHeading>
          {recent_activity.length === 0 ? (
            <AdminEmpty title={t('dashboard.activity.empty')} icon="old-amber" />
          ) : (
            <ul className={cn(TABLE_FRAME, 'divide-y divide-hairline')}>
              {recent_activity.map((entry) => (
                <li
                  key={entry.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-0.5 px-3 py-2.5 text-body sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto]"
                >
                  <span className="min-w-0 break-words font-[550] text-fg">{entry.actor_name}</span>
                  <span className="min-w-0 break-words text-fg-muted max-sm:col-span-2 max-sm:row-start-2">
                    {auditActionLabel(t, entry.action, extensionActionLabels)}
                    {entry.resource_name && <span className="text-fg"> — {entry.resource_name}</span>}
                  </span>
                  <RelativeTime value={entry.created_at} className="shrink-0 text-caption text-fg-muted max-sm:col-start-2 max-sm:row-start-1" />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

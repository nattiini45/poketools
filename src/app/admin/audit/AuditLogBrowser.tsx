'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import Input from '@/components/ui/Input';
import Section from '@/components/ui/Section';
import Skeleton from '@/components/ui/Skeleton';
import SkewChip from '@/components/ui/SkewChip';
import AdminEmpty from '@/components/admin/AdminEmpty';
import AdminSectionHeading from '@/components/admin/AdminSectionHeading';
import { CELL, NAME_CELL, TABLE, TABLE_FRAME, TH, THEAD, TOUCH } from '@/components/admin/admin-table';
import { cn } from '@/lib/utils/cn';
import type { ApiError, ApiResult } from '@/types/api';
import type { Json } from '@/types/database';
import { isValidUuid } from '@/lib/utils/uuid';
import { useT } from '@/i18n/client';
import { LocalTime } from '@/i18n/LocalTime';
import { useApiErrorText } from '@/i18n/use-api-error';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { errorsAdmin } from '@/i18n/messages/errors';
import { adminToolsMessages } from '@/i18n/messages/admin-tools';
import { adminCoreMessages } from '@/i18n/messages/admin-core';
import { commonMessages } from '@/i18n/messages/common';
import { auditActionLabel, type ExtensionAuditActionLabels } from '@/i18n/content/audit-actions';

interface AuditLogRecord {
  id: string;
  actor_id: string | null;
  actor_name: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  resource_name: string | null;
  changes: Json | null;
  metadata: Json | null;
  ip_address: string | null;
  created_at: string;
}

interface AuditLogListResult {
  entries: AuditLogRecord[];
  total: number;
  limit: number;
  offset: number;
}

interface AuditFilters {
  action: string;
  actor: string;
  resource_type: string;
  resource_id: string;
  from: string;
  to: string;
}

const INITIAL_FILTERS: AuditFilters = {
  action: '',
  actor: '',
  resource_type: '',
  resource_id: '',
  from: '',
  to: '',
};

const PAGE_SIZE = 50;

/** A failed load, translated at render: the API body, or a local message. */
type LoadError = { api: ApiErrorLike } | { local: 'networkError' | 'audit.events.loadFailed' };

function hasJsonValue(value: Json | null): boolean {
  if (value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function jsonPreview(value: Json | null): string | null {
  if (!hasJsonValue(value)) return null;
  return JSON.stringify(value, null, 2);
}

/** Whether the Resource ID filter draft can be sent: blank (no filter) or a UUID (the column is a uuid). */
export function isValidAuditResourceId(value: string): boolean {
  const trimmed = value.trim();
  return trimmed === '' || isValidUuid(trimmed);
}

export default function AuditLogBrowser({
  extensionActionLabels = {},
}: {
  /** Localized labels of the active pack extension's audit actions (`extensionAuditActionLabels`). */
  extensionActionLabels?: ExtensionAuditActionLabels;
} = {}) {
  const t = useT(adminToolsMessages);
  const tCore = useT(adminCoreMessages);
  const tc = useT(commonMessages);
  const apiErrorText = useApiErrorText(errorsAdmin);

  const [filters, setFilters] = useState<AuditFilters>(INITIAL_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<AuditFilters>(INITIAL_FILTERS);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<AuditLogListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LoadError | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String(offset));
    if (appliedFilters.action) params.set('action', appliedFilters.action);
    if (appliedFilters.actor) params.set('actor', appliedFilters.actor);
    if (appliedFilters.resource_type) params.set('resource_type', appliedFilters.resource_type);
    if (appliedFilters.resource_id.trim()) params.set('resource_id', appliedFilters.resource_id.trim());
    if (appliedFilters.from) params.set('from', `${appliedFilters.from}T00:00:00.000Z`);
    if (appliedFilters.to) params.set('to', `${appliedFilters.to}T23:59:59.999Z`);
    return params.toString();
  }, [appliedFilters, offset]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/audit-log?${queryString}`);
      const json: ApiResult<AuditLogListResult> = await res.json();
      if (json.success && json.data) {
        setData(json.data);
      } else {
        const err = json as ApiError;
        setError(err.error || err.code ? { api: err } : { local: 'audit.events.loadFailed' });
      }
    } catch {
      setError({ local: 'networkError' });
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => { load(); }, [load]);

  function updateFilter(key: keyof AuditFilters, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  const resourceIdInvalid = !isValidAuditResourceId(filters.resource_id);

  function applyFilters() {
    if (resourceIdInvalid) return;
    setOffset(0);
    setAppliedFilters(filters);
  }

  function clearFilters() {
    setFilters(INITIAL_FILTERS);
    setAppliedFilters(INITIAL_FILTERS);
    setOffset(0);
  }

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + PAGE_SIZE, total);
  const errorText = error === null ? null : 'local' in error ? t(error.local) : apiErrorText(error.api);

  const filtered = Object.values(appliedFilters).some((value) => value.trim() !== '');
  const firstLoad = loading && data === null;

  return (
    <div className="flex flex-col gap-8">
      <Section icon="scope-lens" title={t('audit.filters.title')}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Input
            label={t('audit.filters.action')}
            value={filters.action}
            onChange={(event) => updateFilter('action', event.target.value)}
            // i18n-ignore: example of a stored audit action code, not prose
            placeholder="match.override"
          />
          <Input
            label={t('audit.filters.actor')}
            value={filters.actor}
            onChange={(event) => updateFilter('actor', event.target.value)}
            placeholder={t('audit.filters.actorPlaceholder')}
          />
          <Input
            label={t('audit.filters.resourceType')}
            value={filters.resource_type}
            onChange={(event) => updateFilter('resource_type', event.target.value)}
            // i18n-ignore: example of a stored resource type code, not prose
            placeholder="match"
          />
          <Input
            label={t('audit.filters.resourceId')}
            value={filters.resource_id}
            onChange={(event) => updateFilter('resource_id', event.target.value)}
            placeholder={t('audit.filters.resourceIdPlaceholder')}
            error={resourceIdInvalid ? t('audit.filters.resourceIdInvalid') : undefined}
          />
          <Input label={t('audit.filters.from')} type="date" value={filters.from} onChange={(event) => updateFilter('from', event.target.value)} />
          <Input label={t('audit.filters.to')} type="date" value={filters.to} onChange={(event) => updateFilter('to', event.target.value)} />
        </div>
        <div className="mt-4 flex flex-wrap gap-3 border-t border-hairline pt-4">
          <Button onClick={applyFilters} loading={loading} disabled={resourceIdInvalid}>{t('audit.filters.apply')}</Button>
          <Button variant="secondary" onClick={clearFilters} disabled={loading}>{t('audit.filters.clear')}</Button>
        </div>
      </Section>

      <section aria-labelledby="audit-events-title" aria-busy={loading}>
        <AdminSectionHeading
          id="audit-events-title"
          icon="old-amber"
          title={t('audit.events.title')}
          aside={
            <SkewChip>
              {loading
                ? t('audit.events.loading')
                : t('audit.events.range', { start: pageStart, end: pageEnd, total })}
            </SkewChip>
          }
        />

        {errorText && (
          <Alert variant="error" className="mb-3">
            {errorText}
          </Alert>
        )}

        {firstLoad && (
          <div className={cn(TABLE_FRAME, 'divide-y divide-hairline')}>
            {[...Array(6)].map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-3 py-3">
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="w-2/5 max-w-56" height="0.875rem" rounded="sm" />
                  <Skeleton className="w-1/4 max-w-40" height="0.75rem" rounded="sm" />
                </div>
                <Skeleton className="hidden sm:block" width="9rem" height="0.875rem" rounded="sm" />
              </div>
            ))}
          </div>
        )}

        {!loading && entries.length === 0 && !error && (
          <AdminEmpty title={t('audit.events.empty')} icon="old-amber" hint={filtered ? t('audit.events.emptyFiltered') : undefined}>
            {filtered && (
              <Button variant="secondary" size="sm" className={TOUCH} onClick={clearFilters}>
                {t('audit.filters.clear')}
              </Button>
            )}
          </AdminEmpty>
        )}

        {entries.length > 0 && (
          <div className={TABLE_FRAME}>
            <table className={TABLE} data-audit-table>
              <caption className="sr-only">{t('audit.events.title')}</caption>
              <thead className={THEAD}>
                <tr>
                  <th scope="col" className={TH}>
                    {t('audit.filters.action')}
                  </th>
                  <th scope="col" className={TH}>
                    {t('audit.filters.actor')}
                  </th>
                  <th scope="col" className={TH}>
                    {t('audit.columns.resource')}
                  </th>
                  <th scope="col" className={TH}>
                    {t('audit.columns.when')}
                  </th>
                </tr>
              </thead>
              {entries.map((entry) => {
                const changes = jsonPreview(entry.changes);
                const metadata = jsonPreview(entry.metadata);
                return (
                  <tbody key={entry.id} className="block border-t border-hairline first-of-type:border-t-0 xl:table-row-group xl:hover:bg-hover">
                    <tr className="grid grid-cols-1 px-3 py-3 xl:table-row xl:p-0">
                      <th scope="row" className={NAME_CELL}>
                        <span className="block break-words text-subtitle text-fg xl:text-body xl:font-[550]">
                          {auditActionLabel(tCore, entry.action, extensionActionLabels)}
                        </span>
                        <code className="mt-0.5 block break-all font-mono text-caption font-normal text-fg-muted">{entry.action}</code>
                      </th>
                      <td data-label={t('audit.filters.actor')} className={CELL}>
                        <span className="min-w-0 break-words text-fg">{entry.actor_name}</span>
                      </td>
                      <td data-label={t('audit.columns.resource')} className={CELL}>
                        <span className="min-w-0">
                          <span className="block break-words text-fg">
                            {entry.resource_name
                              ? t('audit.events.resourceNamed', { resourceType: entry.resource_type, resourceName: entry.resource_name })
                              : entry.resource_type}
                          </span>
                          <span className="block break-all font-mono text-caption text-fg-muted">
                            {entry.resource_id ?? t('audit.events.noResourceId')}
                          </span>
                        </span>
                      </td>
                      <td data-label={t('audit.columns.when')} className={cn(CELL, 'xl:whitespace-nowrap')}>
                        <LocalTime value={entry.created_at} preset="dateTimeYear" className="text-fg-muted" />
                      </td>
                    </tr>
                    {(changes || metadata) && (
                      <tr className="block xl:table-row">
                        <td colSpan={4} className="block px-3 pb-3 xl:table-cell">
                          <details className="group">
                            <summary className="inline-flex min-h-11 cursor-pointer items-center rounded-poke-sm text-caption font-[550] text-accent-ink underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] sm:min-h-0">
                              {t('audit.events.details')}
                            </summary>
                            <div className="mt-2 grid grid-cols-1 gap-3 lg:grid-cols-2">
                              {changes && (
                                <div className="min-w-0">
                                  <p className="mb-1 text-caption font-[550] text-fg-muted">{t('audit.events.changes')}</p>
                                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-poke-md border border-hairline bg-sunken p-3 font-mono text-caption text-fg">
                                    {changes}
                                  </pre>
                                </div>
                              )}
                              {metadata && (
                                <div className="min-w-0">
                                  <p className="mb-1 text-caption font-[550] text-fg-muted">{t('audit.events.metadata')}</p>
                                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-poke-md border border-hairline bg-sunken p-3 font-mono text-caption text-fg">
                                    {metadata}
                                  </pre>
                                </div>
                              )}
                            </div>
                          </details>
                        </td>
                      </tr>
                    )}
                  </tbody>
                );
              })}
            </table>
          </div>
        )}

        {total > 0 && (
        <div className="mt-4 flex items-center justify-between gap-3">
          <Button
            variant="secondary"
            className={TOUCH}
            disabled={loading || offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            {tc('actions.previous')}
          </Button>
          <Button
            variant="secondary"
            className={TOUCH}
            disabled={loading || offset + PAGE_SIZE >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            {tc('actions.next')}
          </Button>
        </div>
        )}
      </section>
    </div>
  );
}

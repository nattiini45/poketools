'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Section from '@/components/ui/Section';
import Badge from '@/components/ui/Badge';
import type { ApiError, ApiResult } from '@/types/api';
import type { Json } from '@/types/database';
import { useT } from '@/i18n/client';
import { LocalTime } from '@/i18n/LocalTime';
import { useApiErrorText } from '@/i18n/use-api-error';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { errorsAdmin } from '@/i18n/messages/errors';
import { adminToolsMessages } from '@/i18n/messages/admin-tools';
import { adminCoreMessages } from '@/i18n/messages/admin-core';
import { commonMessages } from '@/i18n/messages/common';
import { auditActionLabel } from '@/i18n/content/audit-actions';

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

export default function AuditLogBrowser() {
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
    if (appliedFilters.resource_id) params.set('resource_id', appliedFilters.resource_id);
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

  function applyFilters() {
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

  return (
    <div className="space-y-6">
      <Section title={t('audit.filters.title')}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
          />
          <Input label={t('audit.filters.from')} type="date" value={filters.from} onChange={(event) => updateFilter('from', event.target.value)} />
          <Input label={t('audit.filters.to')} type="date" value={filters.to} onChange={(event) => updateFilter('to', event.target.value)} />
        </div>
        <div className="flex flex-wrap gap-3 mt-4">
          <Button onClick={applyFilters} loading={loading}>{t('audit.filters.apply')}</Button>
          <Button variant="secondary" onClick={clearFilters} disabled={loading}>{t('audit.filters.clear')}</Button>
        </div>
      </Section>

      <Section
        title={t('audit.events.title')}
        subtitle={
          loading
            ? t('audit.events.loading')
            : t('audit.events.range', { start: pageStart, end: pageEnd, total })
        }
      >
        {errorText && (
          <div className="mb-4 text-sm text-poke-danger">{errorText}</div>
        )}

        {!loading && entries.length === 0 && !error && (
          <p className="text-sm text-poke-text-muted">{t('audit.events.empty')}</p>
        )}

        <div className="space-y-3">
          {entries.map((entry) => {
            const changes = jsonPreview(entry.changes);
            const metadata = jsonPreview(entry.metadata);
            return (
              <Card key={entry.id} variant="outlined" padding="md">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="blue">{entry.action}</Badge>
                      <span className="text-sm font-heading font-semibold text-poke-text-primary">
                        {auditActionLabel(tCore, entry.action)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-poke-text-secondary">
                      {entry.resource_name
                        ? t('audit.events.actorOnNamed', {
                            actor: entry.actor_name,
                            resourceType: entry.resource_type,
                            resourceName: entry.resource_name,
                          })
                        : t('audit.events.actorOn', { actor: entry.actor_name, resourceType: entry.resource_type })}
                    </p>
                    <p className="mt-1 text-xs text-poke-text-muted break-all">
                      {entry.resource_id ?? t('audit.events.noResourceId')}
                    </p>
                  </div>
                  <LocalTime
                    value={entry.created_at}
                    preset="dateTimeYear"
                    className="text-xs text-poke-text-muted shrink-0"
                  />
                </div>

                {(changes || metadata) && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-4">
                    {changes && (
                      <pre className="max-h-48 overflow-auto rounded-poke-md bg-poke-surface-alt p-3 text-xs text-poke-text-secondary whitespace-pre-wrap">
                        {changes}
                      </pre>
                    )}
                    {metadata && (
                      <pre className="max-h-48 overflow-auto rounded-poke-md bg-poke-surface-alt p-3 text-xs text-poke-text-secondary whitespace-pre-wrap">
                        {metadata}
                      </pre>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-3 mt-4">
          <Button
            variant="secondary"
            disabled={loading || offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            {tc('actions.previous')}
          </Button>
          <Button
            variant="secondary"
            disabled={loading || offset + PAGE_SIZE >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            {tc('actions.next')}
          </Button>
        </div>
      </Section>
    </div>
  );
}

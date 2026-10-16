'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import Section from '@/components/ui/Section';
import Table, { type Column } from '@/components/ui/Table';
import type { ApiError, ApiResult } from '@/types/api';
import { useFormatter, useRequestTime, useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { errorsAdmin } from '@/i18n/messages/errors';
import { adminToolsMessages } from '@/i18n/messages/admin-tools';

interface CoverageEntry {
  format: string;
  rows: number;
  last_imported: string | null;
}

interface CoverageResponse {
  formats: CoverageEntry[];
  imported: number;
  available: number;
}

interface ImportUsageResponse {
  summary: {
    success: number;
    total_formats: number;
    total_pokemon: number;
    errors: number;
  };
  duration_ms: number;
}

/** Message keys a failed request can fall back to (no placeholders). */
type ErrorKey = 'metaData.loadFailed' | 'metaData.importFailed' | 'metaData.setsFailed';

/** A failed request, translated at render: the API body, or a local message. */
type ConsoleError = { api: ApiErrorLike; fallback: ErrorKey } | { local: ErrorKey };

/** A success notice, kept as data so a language switch re-renders it. */
type ConsoleNotice = { kind: 'imported'; result: ImportUsageResponse } | { kind: 'setsRefreshed' };

const STALE_AFTER_MS = 45 * 24 * 60 * 60 * 1000; // > 45 days

const CRON_PATH = '/api/cron/refresh-usage-stats';

/**
 * MetaDataConsole — shows per-format usage-stats coverage and lets admins
 * trigger imports manually (e.g. when a new VGC meta drops mid-month and the
 * monthly cron hasn't run yet).
 */
export default function MetaDataConsole() {
  const t = useT(adminToolsMessages);
  const formatter = useFormatter();
  const apiErrorText = useApiErrorText(errorsAdmin);
  // The request time is stable across server render and hydration (rule T4);
  // a 45-day staleness check does not need a ticking clock.
  const now = useRequestTime();

  const [coverage, setCoverage] = useState<CoverageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ConsoleError | null>(null);

  const [importing, setImporting] = useState<string | null>(null); // 'all' | format | 'sets'
  const [notice, setNotice] = useState<ConsoleNotice | null>(null);

  const loadCoverage = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/admin/import-usage-stats');
      const json = (await res.json()) as ApiResult<CoverageResponse>;
      if (json.success) setCoverage(json.data);
      else setError({ api: json as ApiError, fallback: 'metaData.loadFailed' });
    } catch {
      setError({ local: 'metaData.loadFailed' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCoverage();
  }, [loadCoverage]);

  // Stable identity so the columns useMemo below can depend on it without
  // recomputing every render; loadCoverage is already stable ([] deps).
  const runImport = useCallback(async (formats?: string[]) => {
    setImporting(formats ? formats[0] : 'all');
    setNotice(null);
    setError(null);
    try {
      const res = await fetch('/api/admin/import-usage-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formats ? { formats } : {}),
      });
      const json = (await res.json()) as ApiResult<ImportUsageResponse>;
      if (json.success) {
        setNotice({ kind: 'imported', result: json.data });
        setLoading(true);
        await loadCoverage();
      } else {
        setError({ api: json as ApiError, fallback: 'metaData.importFailed' });
      }
    } catch {
      setError({ local: 'metaData.importFailed' });
    } finally {
      setImporting(null);
    }
  }, [loadCoverage]);

  async function runSetsImport() {
    setImporting('sets');
    setNotice(null);
    setError(null);
    try {
      const res = await fetch('/api/admin/import-sample-sets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = (await res.json()) as ApiResult<unknown>;
      if (json.success) {
        setNotice({ kind: 'setsRefreshed' });
      } else {
        setError({ api: json as ApiError, fallback: 'metaData.setsFailed' });
      }
    } catch {
      setError({ local: 'metaData.setsFailed' });
    } finally {
      setImporting(null);
    }
  }

  const formatColumns = useMemo((): Column<CoverageEntry>[] => {
    const stale = (iso: string | null) => {
      if (!iso) return true;
      return now - new Date(iso).getTime() > STALE_AFTER_MS;
    };
    return [
      {
        key: 'format',
        header: t('metaData.columns.format'),
        sortable: true,
        sortValue: (f) => f.format,
        render: (f) => <span className="font-mono text-poke-text-primary">{f.format}</span>,
      },
      {
        key: 'rows',
        header: t('metaData.columns.pokemon'),
        align: 'right',
        sortable: true,
        sortValue: (f) => f.rows,
        render: (f) => (
          <span className="tabular-nums text-poke-text-secondary">
            {f.rows > 0 ? formatter.number(f.rows) : <span className="text-poke-text-muted">—</span>}
          </span>
        ),
      },
      {
        key: 'imported',
        header: t('metaData.columns.lastImported'),
        sortable: true,
        sortValue: (f) => f.last_imported ?? '',
        render: (f) =>
          f.last_imported ? (
            <span className={stale(f.last_imported) ? 'text-yellow-500' : 'text-poke-text-secondary'}>
              {formatter.instant(f.last_imported, 'date')}
            </span>
          ) : (
            <span className="text-poke-text-muted">{t('metaData.never')}</span>
          ),
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        render: (f) => (
          <button
            type="button"
            onClick={() => runImport([f.format])}
            disabled={importing !== null}
            className="text-xs text-poke-blue hover:text-poke-blue/80 disabled:opacity-50 transition-colors"
          >
            {importing === f.format
              ? t('metaData.importing')
              : f.rows > 0
                ? t('metaData.refresh')
                : t('metaData.import')}
          </button>
        ),
      },
    ];
  }, [importing, runImport, t, formatter, now]);

  const errorText =
    error === null
      ? null
      : 'local' in error
        ? t(error.local)
        : error.api.error || error.api.code
          ? apiErrorText(error.api)
          : t(error.fallback);

  const noticeText =
    notice === null
      ? null
      : notice.kind === 'setsRefreshed'
        ? t('metaData.setsRefreshed')
        : t('metaData.importResult', {
            success: notice.result.summary.success,
            total: notice.result.summary.total_formats,
            pokemon: notice.result.summary.total_pokemon,
            errors: notice.result.summary.errors,
            seconds: formatter.number(notice.result.duration_ms / 1000, {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1,
            }),
          });

  return (
    <div className="space-y-6">
      {errorText && <Alert variant="error">{errorText}</Alert>}
      {noticeText && <Alert variant="success">{noticeText}</Alert>}

      <Section
        title={t('metaData.usageTitle')}
        subtitle={
          coverage
            ? t('metaData.usageSubtitle', { imported: coverage.imported, available: coverage.available })
            : t('metaData.loadingCoverage')
        }
      >
        <div className="flex gap-2 mb-4">
          <Button
            onClick={() => runImport()}
            disabled={importing !== null}
            size="sm"
          >
            {importing === 'all' ? t('metaData.importing') : t('metaData.importAll')}
          </Button>
          <Button
            onClick={runSetsImport}
            disabled={importing !== null}
            variant="secondary"
            size="sm"
          >
            {importing === 'sets' ? t('metaData.importing') : t('metaData.refreshSets')}
          </Button>
        </div>

        {loading ? (
          <p className="text-sm text-poke-text-muted">{t('metaData.loadingCoverage')}</p>
        ) : coverage ? (
          <Table
            columns={formatColumns}
            data={coverage.formats}
            keyExtractor={(f) => f.format}
            emptyMessage={t('metaData.noFormats')}
          />
        ) : null}
      </Section>

      <p className="text-xs text-poke-text-muted">
        {t.rich('metaData.cronNote', { path: CRON_PATH, code: (chunks) => <code>{chunks}</code> })}
      </p>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Section from '@/components/ui/Section';
import Select from '@/components/ui/Select';
import type { ApiError, ApiResult } from '@/types/api';
import type { AggregateJobStats } from '@/lib/match/aggregate-queue';
import type { AggregateScope } from '@/types/game';
import type { ReconcileReport } from '@/lib/reconcile/reconcile-season';
import { useFormatter, useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { errorsAdmin } from '@/i18n/messages/errors';
import { adminToolsMessages } from '@/i18n/messages/admin-tools';
import { commonMessages } from '@/i18n/messages/common';

interface ImportResponse {
  total: number;
  imported: number;
  updated: number;
  skipped: number;
  results: Array<{
    name: string;
    discord_id: string;
    success: boolean;
    action: 'created' | 'updated' | 'skipped';
    error?: string;
  }>;
  errors: string[];
}

type ExportResource = 'players' | 'tournaments' | 'matches' | 'seasons' | 'games' | 'battle_stats';
type ExportFormat = 'csv' | 'json';
type RebuildScope = AggregateScope;
type ReconcileScope = 'season' | 'all';

interface DrainAggregateResponse {
  processed: number;
  failed: number;
  reclaimed: number;
  rounds: number;
  statsAfter: AggregateJobStats;
}

interface RebuildAggregateResponse {
  gamesProcessed: number;
  aggregatesDeleted: number;
  playerAggregatesDeleted: number;
}

const EXPORT_RESOURCES: readonly ExportResource[] = [
  'players',
  'tournaments',
  'matches',
  'seasons',
  'games',
  'battle_stats',
];

const REBUILD_SCOPES: readonly RebuildScope[] = ['all_time', 'league', 'tournament'];

const JOB_STATUSES = ['pending', 'processing', 'failed', 'completed', 'cancelled'] as const;

/** Message keys a failed request can fall back to (no placeholders). */
type ErrorKey =
  | 'networkError'
  | 'data.jobs.loadFailed'
  | 'data.jobs.drainFailed'
  | 'data.jobs.rebuildFailed'
  | 'data.reconcile.failed'
  | 'data.import.failed'
  | 'data.export.failed';

/**
 * A failed request, translated at render (never stored as text): the API
 * body, shown through the error catalogs, or a local message when the body
 * carries neither `error` nor `code`.
 */
type ToolError = { api: ApiErrorLike; fallback: ErrorKey } | { local: ErrorKey };

/** The rate-limit header of an export, or `null` when it is missing or garbled. */
function remainingExports(header: string | null): number | null {
  if (header === null || header.trim() === '') return null;
  const n = Number(header);
  return Number.isFinite(n) ? n : null;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function StatBox({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-poke-md border border-poke-border px-3 py-2">
      <div className="text-poke-text-muted">{label}</div>
      <div className="font-heading font-semibold text-poke-text-primary">{value}</div>
    </div>
  );
}

/**
 * Whether the report's rating history needs attention: gaps, never-rated
 * matches, or (dry run) a repair that would refuse the ratings step. Such a
 * report is never shown as "all consistent", even with zero mismatches.
 */
export function hasRatingIntegrityFindings(report: ReconcileReport): boolean {
  const integrity = report.ratings.integrity;
  return integrity.gaps.length > 0 || integrity.unratedMatchIds.length > 0 || integrity.repairRefusal !== null;
}

/**
 * The rating-history integrity of one report (`ratings.integrity`): what the
 * dry run found and whether the repair would heal it or refuse it
 * (`repairRefusal`, the catalogued `rating_history_incomplete` with its
 * params, rendered in the viewer's language).
 */
function RatingIntegrityNotice({ report }: { report: ReconcileReport }) {
  const t = useT(adminToolsMessages);
  const apiErrorText = useApiErrorText(errorsAdmin);
  const { integrity } = report.ratings;
  if (integrity.repairRefusal) {
    return (
      <Alert variant="warning">
        {t('data.reconcile.integrity.repairRefuses', { reason: apiErrorText(integrity.repairRefusal) })}
      </Alert>
    );
  }
  if (report.dryRun && (integrity.gaps.length > 0 || integrity.unratedMatchIds.length > 0)) {
    return <Alert variant="info">{t('data.reconcile.integrity.repairHeals')}</Alert>;
  }
  return null;
}

export function SingleSeasonReconcileView({ report }: { report: ReconcileReport }) {
  const t = useT(adminToolsMessages);
  const tc = useT(commonMessages);
  const formatter = useFormatter();
  const num = (n: number) => formatter.number(n);

  if (report.summary.totalMismatches === 0 && !report.summary.repaired && !hasRatingIntegrityFindings(report)) {
    return (
      <Alert variant="success" className="mt-4">
        {t('data.reconcile.allConsistent')}
      </Alert>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <StatBox label={t('data.reconcile.stats.totalMismatches')} value={num(report.summary.totalMismatches)} />
        <StatBox
          label={t('data.reconcile.stats.repaired')}
          value={report.summary.repaired ? tc('actions.yes') : tc('actions.no')}
        />
        <StatBox
          label={t('data.reconcile.stats.evolutionMismatches')}
          value={
            report.evolution.checked
              ? t('data.reconcile.stats.evolutionValue', {
                  mismatches: report.evolution.mismatches.length,
                  impossible: report.evolution.impossibleLineups.length,
                })
              : t('data.reconcile.stats.notEpb')
          }
        />
        <StatBox
          label={t('data.reconcile.stats.ratingMismatches')}
          value={
            report.ratings.checked
              ? num(report.ratings.mismatches.length)
              : t('data.reconcile.stats.notAvailable')
          }
        />
        <StatBox label={t('data.reconcile.stats.playersAffected')} value={num(report.playersAffected.length)} />
        {report.ratings.checked && (
          <>
            <StatBox label={t('data.reconcile.stats.historyGaps')} value={num(report.ratings.integrity.gaps.length)} />
            <StatBox
              label={t('data.reconcile.stats.unratedMatches')}
              value={num(report.ratings.integrity.unratedMatchIds.length)}
            />
          </>
        )}
      </div>

      <RatingIntegrityNotice report={report} />

      {report.summary.repaired && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm border-t border-poke-border pt-4">
          {report.evolution.repaired && (
            <StatBox
              label={t('data.reconcile.stats.evolutionRepaired')}
              value={`${num(report.evolution.repaired.trackersUpdated)} / ${num(report.evolution.repaired.eventsRewritten)} / ${num(report.evolution.repaired.evolutionPoints)}`}
            />
          )}
          {report.ratings.repaired && (
            <StatBox label={t('data.reconcile.stats.ratingsRewritten')} value={num(report.ratings.repaired.players)} />
          )}
          {report.aggregates.rebuilt && (
            <StatBox
              label={t('data.reconcile.stats.aggregatesProcessed')}
              value={t('data.reconcile.stats.aggregatesValue', {
                games: report.aggregates.rebuilt.gamesProcessed,
                rows: report.aggregates.rebuilt.aggregatesDeleted,
              })}
            />
          )}
          {report.streaks.rebuilt && (
            <StatBox label={t('data.reconcile.stats.streaksRecomputed')} value={num(report.streaks.rebuilt.players)} />
          )}
        </div>
      )}
    </div>
  );
}

export function AllSeasonsReconcileView({ reports }: { reports: ReconcileReport[] }) {
  const t = useT(adminToolsMessages);
  const totalMismatches = reports.reduce((sum, r) => sum + r.summary.totalMismatches, 0);
  const anyRepaired = reports.some((r) => r.summary.repaired);

  if (totalMismatches === 0 && !anyRepaired && !reports.some(hasRatingIntegrityFindings)) {
    return (
      <Alert variant="success" className="mt-4">
        {t('data.reconcile.allConsistentSeasons', { count: reports.length })}
      </Alert>
    );
  }

  return (
    <div className="mt-4 space-y-2">
      <div className="text-sm font-heading font-semibold text-poke-text-primary">
        {t('data.reconcile.seasonsSummary', {
          seasons: t('data.reconcile.seasonCount', { count: reports.length }),
          mismatches: t('data.reconcile.totalMismatchCount', { count: totalMismatches }),
        })}
      </div>
      <div className="border border-poke-border rounded-poke-md divide-y divide-poke-border text-sm">
        {reports.map((r) => (
          <div key={r.seasonId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <span className="font-mono text-poke-text-secondary">{r.seasonId}</span>
            <span className="font-heading font-semibold text-poke-text-primary">
              {t('data.reconcile.mismatchCount', { count: r.summary.totalMismatches })}
              {r.ratings.integrity.gaps.length > 0
                ? ` · ${t('data.reconcile.gapCount', { count: r.ratings.integrity.gaps.length })}`
                : ''}
              {r.ratings.integrity.repairRefusal ? ` · ${t('data.reconcile.repairWouldRefuse')}` : ''}
              {r.summary.repaired ? ` · ${t('data.reconcile.repaired')}` : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AdminDataTools() {
  const t = useT(adminToolsMessages);
  const formatter = useFormatter();
  const apiErrorText = useApiErrorText(errorsAdmin);

  const [csv, setCsv] = useState('');
  const [mode, setMode] = useState<'insert' | 'upsert'>('insert');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResponse | null>(null);
  const [importError, setImportError] = useState<ToolError | null>(null);

  const [resource, setResource] = useState<ExportResource>('players');
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [limit, setLimit] = useState(1000);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<ToolError | null>(null);
  /** `undefined` = no export yet; `null` = ready without a rate-limit header; a number = exports left today. */
  const [exportRemaining, setExportRemaining] = useState<number | null | undefined>(undefined);

  const [jobStats, setJobStats] = useState<AggregateJobStats | null>(null);
  const [jobStatsError, setJobStatsError] = useState<ToolError | null>(null);
  const [jobStatsLoading, setJobStatsLoading] = useState(true);
  const [draining, setDraining] = useState(false);
  const [drainResult, setDrainResult] = useState<DrainAggregateResponse | null>(null);
  const [drainError, setDrainError] = useState<ToolError | null>(null);
  const [rebuildScope, setRebuildScope] = useState<RebuildScope>('all_time');
  const [rebuildScopeId, setRebuildScopeId] = useState('');
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildResult, setRebuildResult] = useState<RebuildAggregateResponse | null>(null);
  const [rebuildError, setRebuildError] = useState<ToolError | null>(null);

  const [reconcileScope, setReconcileScope] = useState<ReconcileScope>('season');
  const [reconcileSeasonId, setReconcileSeasonId] = useState('');
  const [reconcileRepair, setReconcileRepair] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [reconcileResult, setReconcileResult] = useState<ReconcileReport | ReconcileReport[] | null>(null);
  const [reconcileError, setReconcileError] = useState<ToolError | null>(null);

  function errorText(e: ToolError): string {
    if ('local' in e) return t(e.local);
    return e.api.error || e.api.code ? apiErrorText(e.api) : t(e.fallback);
  }

  const loadJobStats = useCallback(async () => {
    setJobStatsLoading(true);
    setJobStatsError(null);
    try {
      const res = await fetch('/api/admin/aggregates');
      const json: ApiResult<{ jobs: AggregateJobStats }> = await res.json();
      if (json.success && json.data) {
        setJobStats(json.data.jobs);
      } else {
        setJobStatsError({ api: json as ApiError, fallback: 'data.jobs.loadFailed' });
      }
    } catch {
      setJobStatsError({ local: 'networkError' });
    } finally {
      setJobStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadJobStats();
  }, [loadJobStats]);

  async function handleDrainJobs() {
    setDraining(true);
    setDrainError(null);
    setDrainResult(null);
    try {
      const res = await fetch('/api/admin/aggregates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'drain' }),
      });
      const json: ApiResult<DrainAggregateResponse> = await res.json();
      if (json.success && json.data) {
        setDrainResult(json.data);
        setJobStats(json.data.statsAfter);
      } else {
        setDrainError({ api: json as ApiError, fallback: 'data.jobs.drainFailed' });
      }
    } catch {
      setDrainError({ local: 'networkError' });
    } finally {
      setDraining(false);
    }
  }

  async function handleRebuildScope() {
    setRebuilding(true);
    setRebuildError(null);
    setRebuildResult(null);
    try {
      const res = await fetch('/api/admin/aggregates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'rebuild',
          scope_type: rebuildScope,
          scope_id: rebuildScope === 'all_time' ? null : rebuildScopeId.trim() || null,
        }),
      });
      const json: ApiResult<RebuildAggregateResponse> = await res.json();
      if (json.success && json.data) {
        setRebuildResult(json.data);
        await loadJobStats();
      } else {
        setRebuildError({ api: json as ApiError, fallback: 'data.jobs.rebuildFailed' });
      }
    } catch {
      setRebuildError({ local: 'networkError' });
    } finally {
      setRebuilding(false);
    }
  }

  async function handleReconcile() {
    // Repair rewrites derived records (EPB progression, ratings, league
    // aggregates, streaks) — a data-mutating admin action. Require explicit
    // confirmation before firing so an accidental click doesn't rewrite data.
    if (reconcileRepair) {
      const ok = window.confirm(t('data.reconcile.confirmRepair'));
      if (!ok) return;
    }

    setReconciling(true);
    setReconcileError(null);
    setReconcileResult(null);
    try {
      const res = await fetch('/api/admin/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: reconcileScope,
          season_id: reconcileScope === 'season' ? reconcileSeasonId.trim() : undefined,
          repair: reconcileRepair,
        }),
      });
      const json: ApiResult<ReconcileReport | ReconcileReport[]> = await res.json();
      if (json.success && json.data) {
        setReconcileResult(json.data);
      } else {
        setReconcileError({ api: json as ApiError, fallback: 'data.reconcile.failed' });
      }
    } catch {
      setReconcileError({ local: 'networkError' });
    } finally {
      setReconciling(false);
    }
  }

  async function handleImport() {
    setImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const res = await fetch(`/api/admin/players/import?mode=${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv' },
        body: csv,
      });
      const json: ApiResult<ImportResponse> = await res.json();
      if (json.success && json.data) {
        setImportResult(json.data);
      } else {
        setImportError({ api: json as ApiError, fallback: 'data.import.failed' });
      }
    } catch {
      setImportError({ local: 'networkError' });
    } finally {
      setImporting(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    setExportRemaining(undefined);
    try {
      const res = await fetch('/api/admin/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resource, format, limit }),
      });

      if (!res.ok) {
        const json: ApiError = await res.json();
        setExportError({ api: json, fallback: 'data.export.failed' });
        return;
      }

      if (format === 'csv') {
        const blob = await res.blob();
        downloadBlob(blob, `${resource}_export.csv`);
      } else {
        const json: ApiResult<Record<string, unknown>[]> = await res.json();
        if (!json.success || !json.data) {
          setExportError({ local: 'data.export.failed' });
          return;
        }
        downloadBlob(
          new Blob([JSON.stringify(json.data, null, 2)], { type: 'application/json' }),
          `${resource}_export.json`
        );
      }

      setExportRemaining(remainingExports(res.headers.get('X-RateLimit-Remaining')));
    } catch {
      setExportError({ local: 'networkError' });
    } finally {
      setExporting(false);
    }
  }

  const num = (n: number) => formatter.number(n);

  return (
    <div className="space-y-6">
      <Section title={t('data.jobs.title')}>
        <p className="text-sm text-poke-text-muted mb-4">{t('data.jobs.intro')}</p>
        {jobStatsLoading && (
          <p className="text-sm text-poke-text-muted">{t('data.jobs.loadingStats')}</p>
        )}
        {jobStatsError && <Alert variant="error">{errorText(jobStatsError)}</Alert>}
        {jobStats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4 text-sm">
            {JOB_STATUSES.map((status) => (
              <StatBox key={status} label={t(`data.jobs.status.${status}`)} value={num(jobStats[status])} />
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-3 mb-4">
          <Button onClick={() => void loadJobStats()} variant="secondary" disabled={jobStatsLoading}>
            {t('data.jobs.refreshStats')}
          </Button>
          <Button onClick={handleDrainJobs} loading={draining}>
            {t('data.jobs.drain')}
          </Button>
        </div>
        {drainError && <Alert variant="error" className="mb-4">{errorText(drainError)}</Alert>}
        {drainResult && (
          <Alert variant="success" className="mb-4">
            {t('data.jobs.drainResult', {
              count: drainResult.rounds,
              processed: drainResult.processed,
              failed: drainResult.failed,
              reclaimed: drainResult.reclaimed,
              pending: drainResult.statsAfter.pending,
            })}
          </Alert>
        )}
        <div className="grid grid-cols-1 md:grid-cols-[180px_1fr_auto] gap-4 items-end border-t border-poke-border pt-4">
          <Select
            label={t('data.jobs.rebuildScope')}
            value={rebuildScope}
            onChange={(event) => setRebuildScope(event.target.value as RebuildScope)}
            options={REBUILD_SCOPES.map((scope) => ({ value: scope, label: t(`data.jobs.scopes.${scope}`) }))}
          />
          <Input
            label={t('data.jobs.scopeId')}
            value={rebuildScopeId}
            onChange={(event) => setRebuildScopeId(event.target.value)}
            placeholder={rebuildScope === 'all_time' ? t('data.jobs.scopeIdNotRequired') : t('data.jobs.uuid')}
            disabled={rebuildScope === 'all_time'}
          />
          <Button
            onClick={handleRebuildScope}
            loading={rebuilding}
            variant="secondary"
            disabled={rebuildScope !== 'all_time' && !rebuildScopeId.trim()}
          >
            {t('data.jobs.rebuild')}
          </Button>
        </div>
        {rebuildError && <Alert variant="error" className="mt-4">{errorText(rebuildError)}</Alert>}
        {rebuildResult && (
          <Alert variant="success" className="mt-4">
            {t('data.jobs.rebuiltGames', { count: rebuildResult.gamesProcessed })}{' '}
            {t('data.jobs.cleared', {
              aggregateRows: t('data.jobs.aggregateRows', { count: rebuildResult.aggregatesDeleted }),
              playerAggregateRows: t('data.jobs.playerAggregateRows', {
                count: rebuildResult.playerAggregatesDeleted,
              }),
            })}
          </Alert>
        )}
      </Section>

      <Section title={t('data.reconcile.title')}>
        <p className="text-sm text-poke-text-muted mb-4">{t('data.reconcile.intro')}</p>
        <div className="grid grid-cols-1 md:grid-cols-[160px_1fr_160px_auto] gap-4 items-end border-t border-poke-border pt-4">
          <Select
            label={t('data.reconcile.scope')}
            value={reconcileScope}
            onChange={(event) => setReconcileScope(event.target.value as ReconcileScope)}
            options={[
              { value: 'season', label: t('data.reconcile.scopes.season') },
              { value: 'all', label: t('data.reconcile.scopes.all') },
            ]}
          />
          <Input
            label={t('data.reconcile.seasonId')}
            value={reconcileSeasonId}
            onChange={(event) => setReconcileSeasonId(event.target.value)}
            placeholder={reconcileScope === 'all' ? t('data.reconcile.seasonIdNotRequired') : t('data.jobs.uuid')}
            disabled={reconcileScope === 'all'}
          />
          <Select
            label={t('data.reconcile.mode')}
            value={reconcileRepair ? 'repair' : 'verify'}
            onChange={(event) => setReconcileRepair(event.target.value === 'repair')}
            options={[
              { value: 'verify', label: t('data.reconcile.modes.verify') },
              { value: 'repair', label: t('data.reconcile.modes.repair') },
            ]}
          />
          <Button
            onClick={handleReconcile}
            loading={reconciling}
            variant="secondary"
            disabled={reconcileScope === 'season' && !reconcileSeasonId.trim()}
          >
            {reconcileRepair ? t('data.reconcile.repairButton') : t('data.reconcile.verifyButton')}
          </Button>
        </div>
        {reconcileError && <Alert variant="error" className="mt-4">{errorText(reconcileError)}</Alert>}
        {reconcileResult && !Array.isArray(reconcileResult) && (
          <SingleSeasonReconcileView report={reconcileResult} />
        )}
        {reconcileResult && Array.isArray(reconcileResult) && (
          <AllSeasonsReconcileView reports={reconcileResult} />
        )}
      </Section>

      <Section title={t('data.import.title')}>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_180px] gap-4">
          <div>
            <label htmlFor="player-import-csv" className="block text-sm font-heading font-semibold text-poke-text-primary mb-1.5">
              {t('data.import.csv')}
            </label>
            <textarea
              id="player-import-csv"
              value={csv}
              onChange={(event) => setCsv(event.target.value)}
              rows={10}
              className="w-full px-3 py-2 bg-poke-surface text-poke-text-primary border border-poke-border rounded-poke-md text-sm placeholder:text-poke-text-muted focus:outline-none focus:border-poke-border-focus focus:ring-2 focus:ring-poke-border-focus/20"
              // i18n-ignore: CSV column header names, read by the importer verbatim
              placeholder="name,discord_id,ps_username,champions_username"
            />
          </div>
          <div className="space-y-4">
            <Select
              label={t('data.import.mode')}
              value={mode}
              onChange={(event) => setMode(event.target.value as 'insert' | 'upsert')}
              options={[
                { value: 'insert', label: t('data.import.modes.insert') },
                { value: 'upsert', label: t('data.import.modes.upsert') },
              ]}
            />
            <Button onClick={handleImport} loading={importing} disabled={!csv.trim()} className="w-full">
              {t('data.import.button')}
            </Button>
          </div>
        </div>
        {importError && <Alert variant="error" className="mt-4">{errorText(importError)}</Alert>}
        {importResult && (
          <Alert variant="success" className="mt-4">
            {t('data.import.result', {
              imported: importResult.imported,
              updated: importResult.updated,
              skipped: importResult.skipped,
            })}
          </Alert>
        )}
      </Section>

      <Section title={t('data.export.title')}>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_160px_160px_auto] gap-4 items-end">
          <Select
            label={t('data.export.resource')}
            value={resource}
            onChange={(event) => setResource(event.target.value as ExportResource)}
            options={EXPORT_RESOURCES.map((value) => ({ value, label: t(`data.export.resources.${value}`) }))}
          />
          <Select
            label={t('data.export.format')}
            value={format}
            onChange={(event) => setFormat(event.target.value as ExportFormat)}
            options={[
              { value: 'csv', label: 'CSV' },
              { value: 'json', label: 'JSON' },
            ]}
          />
          <Input
            label={t('data.export.limit')}
            type="number"
            min={1}
            max={10000}
            value={limit}
            onChange={(event) => setLimit(Number(event.target.value))}
          />
          <Button onClick={handleExport} loading={exporting}>{t('data.export.button')}</Button>
        </div>
        {exportError && <Alert variant="error" className="mt-4">{errorText(exportError)}</Alert>}
        {exportRemaining !== undefined && (
          <Alert variant="success" className="mt-4">
            {exportRemaining === null
              ? t('data.export.ready')
              : t('data.export.remaining', { count: exportRemaining })}
          </Alert>
        )}
      </Section>
    </div>
  );
}

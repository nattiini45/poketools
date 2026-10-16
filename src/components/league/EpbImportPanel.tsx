'use client';

import { useState, type ReactNode } from 'react';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import { useDataLocale, useFormatter, useT } from '@/i18n/client';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsDraftLegacy, errorsSeasons } from '@/i18n/messages/errors';
import { draftLegacyLeagueAdminPoolMessages } from '@/i18n/messages/draft/legacy/league-admin/pool';
import { glossaryMessages } from '@/i18n/messages/glossary';
import { enumMessages } from '@/i18n/messages/enums';
import { enumLabel } from '@/i18n/content/enum-label';
import { epbPack } from '@/lib/format-pack';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import type { ReconciliationReport, SheetGroupKey } from '@/lib/draft/reconciliation-report';

interface EpbImportPanelProps {
  seasonId: string;
  seasonName: string;
}

export interface ImportReport {
  total_lines?: number;
  valid?: number;
  imported?: number;
  warnings?: string[];
  errors?: string[];
  /** Notes that need no action (point-buy import only). */
  info?: string[];
  version_id?: string | null;
  total_raw?: number;
  unique?: number;
  by_category?: Record<string, number>;
  /** The point-buy reconciliation report (draft-backend §2.5, Prompt 0 §8); point-buy import only. */
  reconciliation?: ReconciliationReport | null;
}

/** Workbook sheet names from the active format pack (`epb.workbook.pointBuy`), shown as they appear in the workbook. */
const POINT_BUY_SHEET = epbPack.workbook.pointBuy.sheet;
const OVERVIEW_SHEET = epbPack.workbook.pointBuy.overviewSheet ?? '—';
const MATCHUP_SHEETS = epbPack.workbook.teamRoles.sheets;

/** A failed import keeps the API body; a local failure keeps a message key. */
type ImportError = { api: ApiErrorLike } | { key: 'selectFile' | 'failed' };

function failure(json: unknown): ImportError {
  const api = toApiErrorLike(json);
  return api.error || api.code ? { api } : { key: 'failed' };
}

export default function EpbImportPanel({ seasonId, seasonName }: EpbImportPanelProps) {
  const t = useT(draftLegacyLeagueAdminPoolMessages);
  const apiErrorText = useApiErrorText(errorsDraftLegacy, errorsSeasons);
  const [pbFile, setPbFile] = useState<File | null>(null);
  const [pbName, setPbName] = useState<string>(epbPack.workbook.pointBuy.defaultListName);
  const [pbVersion, setPbVersion] = useState('1');
  const [pbBindSeason, setPbBindSeason] = useState(true);
  const [pbReport, setPbReport] = useState<ImportReport | null>(null);
  const [pbBusy, setPbBusy] = useState(false);
  const [pbError, setPbError] = useState<ImportError | null>(null);

  const [rolesFile, setRolesFile] = useState<File | null>(null);
  const [rolesReport, setRolesReport] = useState<ImportReport | null>(null);
  const [rolesImported, setRolesImported] = useState(0);
  const [rolesBusy, setRolesBusy] = useState(false);
  const [rolesError, setRolesError] = useState<ImportError | null>(null);

  const errorText = (error: ImportError) =>
    'api' in error ? apiErrorText(error.api) : t(`import.errors.${error.key}`);

  const runPointBuyImport = async (dryRun: boolean) => {
    if (!pbFile) {
      setPbError({ key: 'selectFile' });
      return;
    }
    setPbBusy(true);
    setPbError(null);
    setPbReport(null);

    const form = new FormData();
    form.append('file', pbFile);
    form.append('name', pbName);
    form.append('version', pbVersion);
    if (pbBindSeason) form.append('season_id', seasonId);
    if (dryRun) form.append('dry_run', 'true');

    try {
      const res = await fetch('/api/admin/import/point-buy', { method: 'POST', body: form });
      const json = await res.json();
      if (json.success) {
        setPbReport(json.data.report);
      } else {
        setPbError(failure(json));
      }
    } catch {
      setPbError({ key: 'failed' });
    } finally {
      setPbBusy(false);
    }
  };

  const runRolesImport = async (dryRun: boolean) => {
    if (!rolesFile) {
      setRolesError({ key: 'selectFile' });
      return;
    }
    setRolesBusy(true);
    setRolesError(null);
    setRolesReport(null);

    const form = new FormData();
    form.append('file', rolesFile);
    if (dryRun) form.append('dry_run', 'true');

    try {
      const res = await fetch('/api/admin/import/team-roles', { method: 'POST', body: form });
      const json = await res.json();
      if (json.success) {
        setRolesReport(json.data.report);
        setRolesImported(json.data.imported ?? 0);
      } else {
        setRolesError(failure(json));
      }
    } catch {
      setRolesError({ key: 'failed' });
    } finally {
      setRolesBusy(false);
    }
  };

  const bold = (chunks: ReactNode) => <strong>{chunks}</strong>;

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-poke-text-primary">{t('import.pointBuyTitle')}</h4>
        <p className="text-xs text-poke-text-secondary">
          {pbBindSeason
            ? t.rich('import.pointBuyIntroBind', {
                sheet: POINT_BUY_SHEET,
                overview: OVERVIEW_SHEET,
                season: seasonName,
                b: bold,
              })
            : t.rich('import.pointBuyIntro', { sheet: POINT_BUY_SHEET, overview: OVERVIEW_SHEET, b: bold })}
        </p>

        {pbError && <Alert variant="error">{errorText(pbError)}</Alert>}

        <input
          type="file"
          accept=".xlsx"
          onChange={(e) => setPbFile(e.target.files?.[0] ?? null)}
          className="block text-sm"
        />

        <div className="flex flex-wrap gap-3">
          <label className="text-sm">
            {t('import.name')}
            <input
              value={pbName}
              onChange={(e) => setPbName(e.target.value)}
              className="ml-2 rounded border border-poke-border bg-poke-elevated px-2 py-1 text-sm"
            />
          </label>
          <label className="text-sm">
            {t('import.version')}
            <input
              value={pbVersion}
              onChange={(e) => setPbVersion(e.target.value)}
              className="ml-2 w-16 rounded border border-poke-border bg-poke-elevated px-2 py-1 text-sm"
            />
          </label>
          <label className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={pbBindSeason}
              onChange={(e) => setPbBindSeason(e.target.checked)}
            />
            {t('import.bindLeague')}
          </label>
        </div>

        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => runPointBuyImport(true)} disabled={pbBusy}>
            {t('import.dryRun')}
          </Button>
          <Button onClick={() => runPointBuyImport(false)} disabled={pbBusy}>
            {pbBusy ? t('import.importing') : t('import.import')}
          </Button>
        </div>

        {pbReport && <ImportReportView report={pbReport} />}
      </div>

      <div className="space-y-3 border-t border-poke-border pt-6">
        <h4 className="text-sm font-semibold text-poke-text-primary">{t('import.rolesTitle')}</h4>
        <p className="text-xs text-poke-text-secondary">
          {t.rich('import.rolesIntro', { sheet1: MATCHUP_SHEETS[0], sheet2: MATCHUP_SHEETS[1], b: bold })}
        </p>

        {rolesError && <Alert variant="error">{errorText(rolesError)}</Alert>}

        <input
          type="file"
          accept=".xlsx"
          onChange={(e) => setRolesFile(e.target.files?.[0] ?? null)}
          className="block text-sm"
        />

        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => runRolesImport(true)} disabled={rolesBusy}>
            {t('import.dryRun')}
          </Button>
          <Button onClick={() => runRolesImport(false)} disabled={rolesBusy}>
            {rolesBusy ? t('import.importing') : t('import.import')}
          </Button>
        </div>

        {rolesReport && (
          <>
            <ImportReportView report={rolesReport} />
            {rolesImported > 0 && (
              <p className="text-sm text-green-400">{t('import.rolesImported', { count: rolesImported })}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** The import result; server warnings, errors and notes are English report data and render as sent. */
export function ImportReportView({ report }: { report: ImportReport }) {
  const t = useT(draftLegacyLeagueAdminPoolMessages);
  const warnings = report.warnings ?? [];
  const errors = report.errors ?? [];
  const info = report.info ?? [];
  return (
    <div className="rounded-lg border border-poke-border bg-poke-elevated p-3 text-xs">
      {report.total_lines != null && (
        <p>
          {t('import.report.lines', {
            valid: report.valid ?? 0,
            total: report.total_lines,
            imported: report.imported ?? 0,
          })}
        </p>
      )}
      {report.unique != null && (
        <p>{t('import.report.roles', { unique: report.unique, raw: report.total_raw ?? 0 })}</p>
      )}
      {report.version_id && <p>{t('import.report.versionId', { id: report.version_id })}</p>}
      {report.by_category && (
        <pre className="mt-1 overflow-x-auto text-poke-text-secondary">
          {JSON.stringify(report.by_category, null, 2)}
        </pre>
      )}
      {warnings.length > 0 && (
        <div className="mt-2 max-h-40 overflow-y-auto text-yellow-400">
          {warnings.slice(0, 30).map((w) => <p key={w}>! {w}</p>)}
          {warnings.length > 30 && <p>{t('import.report.more', { count: warnings.length - 30 })}</p>}
        </div>
      )}
      {errors.length > 0 && (
        <div className="mt-2 text-red-400">
          {errors.map((e) => <p key={e}>× {e}</p>)}
        </div>
      )}
      {info.length > 0 && (
        <details className="mt-2 text-poke-text-secondary">
          <summary className="cursor-pointer">
            {t('import.report.notes')} ({info.length})
          </summary>
          <div className="mt-1 max-h-40 overflow-y-auto">
            {info.map((n) => <p key={n}>{n}</p>)}
          </div>
        </details>
      )}
      {report.reconciliation && <ReconciliationView report={report.reconciliation} />}
    </div>
  );
}

/** The stored price groups in the pack's display order (`epb.priceGroupOrder`). */
const SHEET_GROUP_KEYS: readonly SheetGroupKey[] = epbPack.priceGroupOrder;

/**
 * The reconciliation report's sections (Prompt 0 §8 display). Labels come from the `pool`
 * namespace; line ids, codes, sheet values and the server's English details stay as sent.
 */
function ReconciliationView({ report }: { report: ReconciliationReport }) {
  const t = useT(draftLegacyLeagueAdminPoolMessages);
  const tGlossary = useT(glossaryMessages);
  const tEnum = useT(enumMessages);
  const format = useFormatter();
  const dl = useDataLocale();
  const yesNo = (v: boolean) => (v ? t('reconciliation.yes') : t('reconciliation.no'));
  const branchedLineCount = report.branched_bases.reduce((sum, b) => sum + b.lines.length, 0);
  const reasons = [...new Set(report.overrides_applied.map((o) => o.reason_en))];

  return (
    <div className="mt-3 space-y-3 border-t border-poke-border pt-3">
      <div>
        <h5 className="text-sm font-semibold text-poke-text-primary">{t('reconciliation.title')}</h5>
        <p>{t('reconciliation.generated', { date: format.instant(report.generated_at, 'dateTimeYear') })}</p>
        <p>{t('reconciliation.source', { source: report.list_source ?? '—' })}</p>
        <p>{t('reconciliation.lineCount', { count: report.line_count })}</p>
        <p>
          {t('reconciliation.issueCounts', { errors: report.errors.length, warnings: report.warnings.length })}
        </p>
      </div>

      <ReportSection title={t('reconciliation.priceTabs')}>
        <ReportTable
          headers={[t('reconciliation.tab'), t('reconciliation.lines')]}
          rows={[
            ...report.price_tabs.map((p) => [p.key, p.count]),
            [tGlossary('state.all'), report.line_count],
          ]}
          empty={t('reconciliation.none')}
        />
        {report.out_of_tab_prices.length > 0 && (
          <>
            <p className="mt-1">{t('reconciliation.outOfTab')}</p>
            <ReportTable
              headers={[t('reconciliation.line'), tGlossary('price.price')]}
              rows={report.out_of_tab_prices.map((o) => [o.line_id, o.price])}
              empty={t('reconciliation.none')}
            />
          </>
        )}
      </ReportSection>

      <ReportSection title={t('reconciliation.sheetGroups')}>
        <ReportTable
          headers={[t('reconciliation.group'), t('reconciliation.lines')]}
          rows={SHEET_GROUP_KEYS.map((k) => [enumLabel(tEnum, 'priceGroup', k), report.sheet_groups[k] ?? 0])}
          empty={t('reconciliation.none')}
        />
      </ReportSection>

      <ReportSection
        title={t('reconciliation.branchedBases', { bases: report.branched_bases.length, lines: branchedLineCount })}
      >
        <ReportTable
          headers={[
            tGlossary('roster.base'),
            t('reconciliation.lineId'),
            t('reconciliation.finalStage'),
            tGlossary('price.price'),
            t('reconciliation.kosToStage2'),
            t('reconciliation.kosToStage3'),
            t('reconciliation.thresholdsDiffer'),
            t('reconciliation.samePrice'),
          ]}
          rows={report.branched_bases.flatMap((b) =>
            b.lines.map((l) => [
              localizeSpecies(b.base, dl),
              l.line_id,
              localizeSpecies(l.final, dl),
              l.price,
              l.k2,
              l.k3,
              yesNo(b.thresholds_differ),
              yesNo(b.same_price),
            ]),
          )}
          empty={t('reconciliation.none')}
        />
      </ReportSection>

      <ReportSection title={t('reconciliation.thresholdConflicts')}>
        <ReportTable
          headers={[
            t('reconciliation.line'),
            t('reconciliation.field'),
            t('reconciliation.sheet'),
            t('reconciliation.applied'),
            t('reconciliation.sourceColumn'),
          ]}
          rows={report.threshold_conflicts.map((c) => [c.line_id, c.field, c.sheet_value, c.applied_value, c.source])}
          empty={t('reconciliation.none')}
        />
        {reasons.length > 0 && (
          <>
            <p className="mt-1">{t('reconciliation.reasons')}</p>
            <ul className="list-disc pl-4">
              {reasons.map((r) => <li key={r}>{r}</li>)}
            </ul>
          </>
        )}
      </ReportSection>

      <ReportSection title={t('reconciliation.unresolvedNames')}>
        <ReportTable
          headers={[
            t('reconciliation.line'),
            t('reconciliation.stage'),
            t('reconciliation.name'),
            t('reconciliation.reason'),
          ]}
          rows={report.unresolved_names.map((u) => [
            u.line_id,
            u.stage,
            u.name,
            t.dynamic(`reconciliation.unresolvedReason.${u.reason}`, undefined, u.reason),
          ])}
          empty={t('reconciliation.none')}
        />
      </ReportSection>

      <ReportSection title={t('reconciliation.ruleConflicts')}>
        <ReportTable
          headers={[t('reconciliation.code'), t('reconciliation.detail')]}
          rows={report.rule_conflicts.map((c) => [c.code, c.detail])}
          empty={t('reconciliation.none')}
        />
      </ReportSection>

      {report.utility && (
        <ReportSection title={t('reconciliation.utility')}>
          <ul className="list-disc pl-4">
            <li>
              {t('reconciliation.utilityUnmapped', {
                count: report.utility.unmapped_species_count,
                cap: report.utility.cap_species_count,
              })}
            </li>
            <li>
              {t('reconciliation.utilityLinesWithout', { count: report.utility.lines_without_any_utility.length })}
            </li>
            <li>
              {t('reconciliation.utilityUnresolvedLabels', { count: report.utility.unresolved_labels.length })}
            </li>
            <li>{t('reconciliation.utilityIllegalPairs', { count: report.utility.illegal_pairs.length })}</li>
            <li>
              {t('reconciliation.utilityMovesNotInModule', {
                count: report.utility.category_moves_not_in_module.length,
              })}
            </li>
          </ul>
        </ReportSection>
      )}

      {report.errors.length > 0 && (
        <ReportSection title={t('reconciliation.errors')}>
          <ul className="list-disc pl-4 text-red-400">
            {report.errors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        </ReportSection>
      )}
      {report.warnings.length > 0 && (
        <ReportSection title={t('reconciliation.warnings')}>
          <ul className="list-disc pl-4 text-yellow-400">
            {report.warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </ReportSection>
      )}
    </div>
  );
}

function ReportSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h6 className="mb-1 font-semibold text-poke-text-primary">{title}</h6>
      {children}
    </section>
  );
}

type Cell = string | number | null | undefined;

function ReportTable({ headers, rows, empty }: { headers: string[]; rows: Cell[][]; empty: string }) {
  if (rows.length === 0) return <p className="italic text-poke-text-secondary">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left">
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h} className="pr-3 font-medium text-poke-text-secondary">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-poke-border/50">
              {row.map((cell, j) => (
                <td key={j} className="pr-3 align-top">
                  {cell === null || cell === undefined ? '—' : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

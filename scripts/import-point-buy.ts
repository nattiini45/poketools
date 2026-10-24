/**
 * Import Evolution Point Buy list data from the authoritative xlsx workbook.
 *
 * Usage:
 *   npx tsx scripts/import-point-buy.ts \
 *     --xlsx=<path to the point-buy workbook> \
 *     [--name="<list name>"] [--version=1] \
 *     [--season-id=<uuid>] [--dry-run]
 *
 * The workbook is not in the repository: the league organiser supplies it privately.
 * `--name` defaults to the active format pack's `epb.workbook.pointBuy.defaultListName`.
 *
 * Parsing/validation lives in `@/lib/import/point-buy-xlsx` (same stack as admin API).
 * This script owns argv / env / DB write / report printing only. The reconciliation report
 * (line ids, price tabs, branched bases, the format pack's league overrides against the
 * sheet values, rule conflicts) is printed before anything is written, also on a dry run.
 */

import { existsSync, readFileSync } from 'fs';
import { basename, resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import { renderReconciliationMarkdown } from '@/lib/draft/reconciliation-report';
import { epbPack } from '@/lib/format-pack';
import {
  pointBuyEntriesToRows,
  validatePointBuyImport,
  type PointBuyImportReport,
} from '@/lib/import/point-buy-xlsx';
import type { Database } from '@/types/database';

function loadEnvFiles() {
  for (const name of ['.env.local', '.env']) {
    try {
      const content = readFileSync(resolve(process.cwd(), name), 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) process.env[key] = val;
      }
    } catch {
      // optional
    }
  }
}
loadEnvFiles();

function printReport(report: PointBuyImportReport) {
  console.log('\n=== Import Report ===');
  console.log(`Total lines: ${report.total_lines}`);
  console.log(`Valid: ${report.valid}`);
  console.log(`Imported: ${report.imported}`);
  if (report.version_id) console.log(`Version ID: ${report.version_id}`);
  console.log(`Warnings: ${report.warnings.length}`);
  for (const w of report.warnings) console.log(`  ! ${w}`);
  console.log(`Errors: ${report.errors.length}`);
  for (const e of report.errors) console.log(`  x ${e}`);
  if (report.info.length > 0) {
    console.log(`Notes: ${report.info.length}`);
    for (const i of report.info) console.log(`  - ${i}`);
  }
}

/** The reconciliation artifact, printed before anything is written. */
function printReconciliation(report: PointBuyImportReport) {
  if (!report.reconciliation) return;
  console.log('');
  console.log(renderReconciliationMarkdown(report.reconciliation));
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const getArg = (name: string): string | null =>
    args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? null;

  // Legacy --csv flag still accepted as an alias for --xlsx for older docs
  const xlsxPath = getArg('xlsx') ?? getArg('csv');
  if (!xlsxPath) {
    console.error('Pass the workbook path with --xlsx=<path>. The workbook is not in the repository.');
    process.exit(2);
  }
  const listName = getArg('name') ?? epbPack.workbook.pointBuy.defaultListName;
  const version = parseInt(getArg('version') ?? '1', 10);
  const seasonId = getArg('season-id');
  const path = xlsxPath;

  console.log('=== Evolution Point Buy Import ===');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`XLSX: ${path} | List: ${listName} v${version}`);
  if (seasonId) console.log(`Bind to season: ${seasonId}`);
  console.log('');

  if (!existsSync(resolve(process.cwd(), path))) {
    console.error(
      `Workbook not found: ${path}. The workbook is not in the repository; the league organiser supplies it privately. Pass its path with --xlsx=<path>.`
    );
    process.exit(2);
  }
  const buffer = readFileSync(resolve(process.cwd(), path));
  const { report, validEntries } = await validatePointBuyImport(buffer, { source: basename(path) });
  printReconciliation(report);

  if (report.errors.length > 0) {
    printReport(report);
    console.error('\nAborting: fix the errors above and re-run. Nothing was written.');
    process.exit(1);
  }

  if (dryRun) {
    printReport(report);
    console.log('\nDRY RUN complete. No data was written.');
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
    process.exit(1);
  }
  const supabase = createClient<Database>(url, key);

  const { data: existing, error: findErr } = await supabase
    .from('point_buy_list_versions')
    .select('id')
    .eq('name', listName)
    .eq('version', version)
    .maybeSingle();
  if (findErr) throw findErr;

  let versionId: string;
  if (existing) {
    versionId = existing.id;
    const { data: boundSeasons, error: boundErr } = await supabase
      .from('seasons')
      .select('id, name, status')
      .eq('point_buy_list_id', versionId)
      .neq('status', 'upcoming');
    if (boundErr) throw boundErr;
    if (boundSeasons && boundSeasons.length > 0) {
      console.error(`ERROR: "${listName}" v${version} is bound to non-upcoming season(s):`);
      for (const s of boundSeasons) console.error(`  - ${s.name} (${s.id}, ${s.status})`);
      console.error('Bound list versions are immutable snapshots. Bump --version to create a new list version.');
      process.exit(1);
    }
    console.log(`Reusing existing list version ${versionId}`);
  } else {
    const { data: created, error: createErr } = await supabase
      .from('point_buy_list_versions')
      .insert({ name: listName, version, source: path })
      .select('id')
      .single();
    if (createErr) throw createErr;
    versionId = created.id;
    console.log(`Created list version ${versionId}`);
  }
  report.version_id = versionId;

  const rows = pointBuyEntriesToRows(versionId, validEntries);

  const { error: upsertErr } = await supabase
    .from('point_buy_list_entries')
    .upsert(rows, { onConflict: 'list_version_id,line_number' });
  if (upsertErr) throw upsertErr;
  report.imported = rows.length;

  if (seasonId) {
    const { data: season, error: sErr } = await supabase
      .from('seasons')
      .select('status, point_buy_list_id')
      .eq('id', seasonId)
      .single();
    if (sErr) throw sErr;

    if (
      season.point_buy_list_id &&
      season.point_buy_list_id !== versionId &&
      season.status !== 'upcoming'
    ) {
      report.warnings.push(
        `Season ${seasonId} is ${season.status} and already bound to a different list — NOT rebinding.`
      );
    } else {
      const { error: bindErr } = await supabase
        .from('seasons')
        .update({ point_buy_list_id: versionId })
        .eq('id', seasonId);
      if (bindErr) throw bindErr;
      console.log(`Bound season ${seasonId} to list version ${versionId}`);
    }
  }

  printReport(report);
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});

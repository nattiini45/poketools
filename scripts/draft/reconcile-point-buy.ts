/**
 * Print the EPB list reconciliation report (draft-backend §2.5) for a workbook.
 * Parses the xlsx files only: no database access, no network.
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.json scripts/draft/reconcile-point-buy.ts \
 *     --xlsx <path to the point-buy workbook> \
 *     [--utility-xlsx <path to the utility workbook>] \
 *     [--json] [--generated-at 2026-10-10T00:00:00.000Z]
 *
 * The workbook is not in the repository: the league organiser supplies it privately.
 *
 * Exit code 1 when the workbook has import errors (duplicate line ids, invalid rows).
 */

import { existsSync, readFileSync } from 'fs';
import { basename, resolve } from 'path';
import { renderReconciliationMarkdown, buildReconciliationReport } from '@/lib/draft/reconciliation-report';
import { parsePointBuyXlsxBuffer, validatePointBuyImport } from '@/lib/import/point-buy-xlsx';
import { parseUtilityXlsxBuffer } from '@/lib/import/utility-sheet-xlsx';

function argValue(args: string[], name: string): string | null {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && idx + 1 < args.length && !args[idx + 1].startsWith('--')) return args[idx + 1];
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const xlsxPath = argValue(args, 'xlsx');
  if (!xlsxPath) {
    console.error('Missing --xlsx "<path to the point-buy workbook>"');
    process.exit(2);
  }
  const utilityPath = argValue(args, 'utility-xlsx');
  const generatedAt = argValue(args, 'generated-at') ?? undefined;
  const asJson = args.includes('--json');

  if (!existsSync(resolve(process.cwd(), xlsxPath))) {
    console.error(
      `Workbook not found: ${xlsxPath}. The EvoLiga workbook is not in the repository; the league organiser supplies it privately. Pass its path with --xlsx <path>.`
    );
    process.exit(2);
  }
  const buffer = readFileSync(resolve(process.cwd(), xlsxPath));
  // The importer's own validation (same code as the admin route), for its errors and warnings.
  const { report: importReport } = await validatePointBuyImport(buffer, { source: basename(xlsxPath) });
  const workbook = parsePointBuyXlsxBuffer(buffer);
  const report = await buildReconciliationReport({
    entries: workbook.entries,
    overview: workbook.overview,
    rulesSheetRows: workbook.rulesSheetRows,
    utilitySheet: utilityPath ? parseUtilityXlsxBuffer(readFileSync(resolve(process.cwd(), utilityPath))) : undefined,
    source: basename(xlsxPath),
    generatedAt,
  });
  report.errors.push(...importReport.errors.filter((e) => !report.errors.includes(e)));
  report.warnings.push(...importReport.warnings.filter((w) => !report.warnings.includes(w)));

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderReconciliationMarkdown(report));
    if (importReport.info.length > 0) {
      console.log('## Importer notes\n');
      for (const line of importReport.info) console.log(`- ${line}`);
    }
  }
  if (report.errors.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Reconciliation failed:', err);
  process.exit(1);
});

/**
 * Writes PRIVATE workbook data; the committed fixture
 * (`src/app/(public)/draft-preview/fixture-lines.example.json`) comes from
 * scripts/draft/make-example-list-fixtures.ts — do not commit this output.
 *
 * Builds `/draft-preview` lines in the shape of the committed fixture from a
 * league's point-buy workbook, through the importer's own parser. The workbook
 * layout and the league overrides are the ACTIVE format pack's
 * (`@/lib/format-pack`: `epb.workbook.pointBuy`, `epb.lineOverrides`), so the
 * workbook must match the pack in use (FORMAT_PACK / the tsconfig fallback).
 *
 * - Every list line as a `PointBuyListEntry` row with list-authoritative prices,
 *   thresholds, `line_id`s and species ids.
 * - League overrides applied (`applyLeagueOverrides`), exactly as the read layer
 *   returns them, so the preview catalog matches production.
 * - Narrow: rationale, historical data and sources are dropped (the pick screen
 *   never shows them, SPEC:378-379); special-rules flags and text are kept.
 * - Deterministic ids (`preview-entry-001` …, list version `preview-list-v1`), so
 *   the output only changes when the workbook does.
 *
 * No database or network access: it reads one local file and writes one:
 *
 *   npx tsx --tsconfig tsconfig.json scripts/draft-preview/make-fixture-lines.ts \
 *     --file <workbook.xlsx> --out <path outside the committed fixtures>
 *
 * (`--xlsx <path>` or a positional path work too.) League workbooks are not in the
 * repository: the league organiser supplies them privately.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { applyLeagueOverrides } from '@/lib/draft/league-overrides';
import { parsePointBuyXlsxBuffer, pointBuyEntriesToRows } from '@/lib/import/point-buy-xlsx';
import type { PointBuyListEntry } from '@/types/point-buy';
import { guardPrivateOutput } from '../lib/private-output-guard.mjs';

const PREVIEW_LIST_VERSION_ID = 'preview-list-v1';

function argValue(args: string[], name: string): string | null {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && idx + 1 < args.length && !args[idx + 1].startsWith('--')) return args[idx + 1];
  return null;
}

/** The first positional argument (the workbook path), skipping `--flag value` pairs. */
function positional(args: string[]): string | null {
  for (let i = 0; i < args.length; i += 1) {
    if (args[i].startsWith('--')) {
      if (!args[i].includes('=')) i += 1;
      continue;
    }
    return args[i];
  }
  return null;
}

function entryId(lineNumber: number): string {
  return `preview-entry-${String(lineNumber).padStart(3, '0')}`;
}

function main() {
  const args = process.argv.slice(2);
  const xlsxPath = argValue(args, 'file') ?? argValue(args, 'xlsx') ?? positional(args);
  if (!xlsxPath) {
    console.error('Pass --file <workbook.xlsx>: the point-buy workbook of the active format pack.');
    process.exit(1);
  }
  const outPath = argValue(args, 'out');
  if (!outPath) {
    console.error('Pass --out <path>. This writes PRIVATE workbook data; it must not overwrite the committed synthetic fixture.');
    process.exit(1);
  }
  // Outside the repository or git-ignored only: never a committed fixture or any other tracked file.
  const outFile = guardPrivateOutput(outPath);

  if (!existsSync(resolve(process.cwd(), xlsxPath))) {
    console.error(
      `Workbook not found: ${xlsxPath}. League workbooks are not in the repository; the league organiser supplies them privately. Pass its path with --file <path>.`
    );
    process.exit(2);
  }
  const workbook = parsePointBuyXlsxBuffer(readFileSync(resolve(process.cwd(), xlsxPath)));
  const entries: PointBuyListEntry[] = pointBuyEntriesToRows(PREVIEW_LIST_VERSION_ID, workbook.entries)
    .map((row) => ({
      ...row,
      id: entryId(row.line_number),
      rationale: null,
      historical_data: null,
      sources: null,
    }))
    .map((row) => applyLeagueOverrides(row))
    .sort((a, b) => a.line_number - b.line_number);

  writeFileSync(outFile,`${JSON.stringify(entries, null, 2)}\n`, 'utf-8');
  console.log(`Wrote ${entries.length} lines to ${outPath}`);
}

main();

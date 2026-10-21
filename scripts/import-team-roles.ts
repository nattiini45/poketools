/**
 * Import team role data from the league workbook's role sheets (format pack `workbook.teamRoles`).
 *
 * Usage:
 *   npx tsx scripts/import-team-roles.ts --xlsx=<path to the workbook> [--dry-run]
 *
 * The workbook is not in the repository: the league organiser supplies it privately.
 *
 * Parsing/validation lives in `@/lib/import/team-roles-xlsx` (same stack as admin API).
 * This script owns argv / env / DB write / report printing only.
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import {
  VALID_ROLE_CATEGORIES,
  validateTeamRoleImport,
} from '@/lib/import/team-roles-xlsx';
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

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const getArg = (name: string): string | null =>
    args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? null;
  const xlsxPath = getArg('xlsx') ?? getArg('csv');
  if (!xlsxPath) {
    console.error('Pass the workbook path with --xlsx=<path>. The workbook is not in the repository.');
    process.exit(2);
  }

  console.log('=== Team Roles Import ===');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'} | XLSX: ${xlsxPath}\n`);

  if (!existsSync(resolve(process.cwd(), xlsxPath))) {
    console.error(
      `Workbook not found: ${xlsxPath}. The workbook is not in the repository; the league organiser supplies it privately. Pass its path with --xlsx=<path>.`
    );
    process.exit(2);
  }
  const buffer = readFileSync(resolve(process.cwd(), xlsxPath));
  const { report, roles } = validateTeamRoleImport(buffer);

  console.log(
    `Parsed: ${report.unique} unique roles from ${report.total_raw} raw pairs | Warnings: ${report.warnings.length} | Errors: ${report.errors.length}`
  );
  for (const w of report.warnings.slice(0, 50)) console.log(`  ! ${w}`);
  if (report.warnings.length > 50) console.log(`  ! …and ${report.warnings.length - 50} more`);
  for (const e of report.errors) console.log(`  x ${e}`);

  if (report.errors.length > 0) {
    console.error('\nAborting: fix the errors above and re-run. Nothing was written.');
    process.exit(1);
  }

  if (dryRun) {
    const byCat = Object.fromEntries(
      VALID_ROLE_CATEGORIES.map((c) => [c, report.by_category[c]])
    );
    console.log('By category:', byCat);
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

  const { error } = await supabase.from('team_roles').upsert(
    roles.map((r) => ({
      species_form: r.species_form,
      stage: r.stage,
      category: r.category,
      move_name: r.move_name,
    })),
    { onConflict: 'species_form,category,move_name' }
  );
  if (error) throw error;

  console.log(`\nImported ${roles.length} team roles.`);
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});

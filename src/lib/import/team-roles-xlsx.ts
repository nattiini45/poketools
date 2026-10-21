/**
 * Team-roles xlsx parse + validate. Shared by admin API and CLI scripts.
 * Uses @pkmn/data — do not import from client components.
 *
 * The sheet names, the category headings and the block columns come from the active format pack
 * (`epb.workbook.teamRoles`, `@/lib/format-pack`); the stored categories stay the
 * public `TeamRoleCategory` vocabulary (DB CHECK).
 */
import { Generations } from '@pkmn/data';
import { Dex } from '@pkmn/dex';
import type { TeamRoleCategory } from '@/types/format-rules';
import { epbPack } from '@/lib/format-pack';
import { cellString, getSheet, readXlsxBuffer, type XlsxSheet } from '@/lib/import/xlsx';

const gens = new Generations(Dex);
const natDex = gens.get(9);

export const VALID_ROLE_CATEGORIES = [
  'hazard_setting',
  'hazard_removal',
  'healing_cleric',
  'momentum',
  'item_removal',
  'status',
  'priority',
  'disruption',
] as const satisfies readonly TeamRoleCategory[];

/** Lower-cased sheet heading -> stored category (`epb.workbook.teamRoles.categoryLabels`). */
const CATEGORY_LABEL_MAP: Readonly<Record<string, TeamRoleCategory>> = epbPack.workbook.teamRoles.categoryLabels;

/** One block per category: heading and species / move columns (`epb.workbook.teamRoles.blocks`). */
const CATEGORY_COLS: readonly { label: string; category: TeamRoleCategory; speciesCol: number; moveCol: number }[] =
  epbPack.workbook.teamRoles.blocks;

/** The heading of the first block locates the header row. */
const HEADER_ANCHOR = CATEGORY_COLS[0]?.label ?? '';

export interface ParsedTeamRoleRow {
  species_form: string;
  stage: number | null;
  category: TeamRoleCategory;
  move_name: string;
}

export interface TeamRoleImportReport {
  total_raw: number;
  unique: number;
  warnings: string[];
  errors: string[];
  by_category: Record<TeamRoleCategory, number>;
}

function normalizeSpeciesLabel(raw: string): string {
  return raw
    .replace(/\s*\(Bloodmoon\)/gi, '-Bloodmoon')
    .replace(/\s*\(H\)/gi, '-Hisui')
    .replace(/\s*\(Hisui\)/gi, '-Hisui')
    .replace(/\s*\(Alola\)/gi, '-Alola')
    .replace(/\s*\(Galar\)/gi, '-Galar')
    .replace(/\s*\(Paldea\)/gi, '-Paldea')
    .trim();
}

function resolveSpecies(name: string): { ok: boolean; resolved: string } {
  const normalized = normalizeSpeciesLabel(name);
  const species = natDex.species.get(normalized);
  if (species?.exists) {
    return { ok: true, resolved: species.name };
  }
  const id = normalized.toLowerCase().replace(/[^a-z0-9]/g, '');
  const byId = natDex.species.get(id);
  if (byId?.exists) {
    return { ok: true, resolved: byId.name };
  }
  return { ok: false, resolved: normalized };
}

function resolveMove(name: string): { ok: boolean; resolved: string } {
  const move = natDex.moves.get(name);
  if (move?.exists) {
    return { ok: true, resolved: move.name };
  }
  const id = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const byId = natDex.moves.get(id);
  if (byId?.exists) {
    return { ok: true, resolved: byId.name };
  }
  return { ok: false, resolved: name };
}

function findHeaderRow(sheet: XlsxSheet): number {
  for (let r = 0; r < sheet.rows.length; r++) {
    const cell = cellString(sheet.rows[r]?.[0]);
    if (cell.toLowerCase() === HEADER_ANCHOR.toLowerCase()) return r;
  }
  return -1;
}

function parseMatchupSheet(sheet: XlsxSheet, warnings: string[]): ParsedTeamRoleRow[] {
  const headerRow = findHeaderRow(sheet);
  if (headerRow < 0) {
    warnings.push(`Sheet "${sheet.name}": no "${HEADER_ANCHOR}" header row found`);
    return [];
  }

  for (const col of CATEGORY_COLS) {
    const header = cellString(sheet.rows[headerRow]?.[col.speciesCol]);
    const key = header.toLowerCase();
    const mapped = Object.hasOwn(CATEGORY_LABEL_MAP, key) ? CATEGORY_LABEL_MAP[key] : undefined;
    if (mapped !== col.category) {
      warnings.push(
        `Sheet "${sheet.name}" r${headerRow} c${col.speciesCol}: expected "${col.label}", got "${header}"`
      );
    }
  }

  const rows: ParsedTeamRoleRow[] = [];
  for (let r = headerRow + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r] ?? [];
    let anySpecies = false;
    for (const col of CATEGORY_COLS) {
      const speciesRaw = cellString(row[col.speciesCol]);
      const moveRaw = cellString(row[col.moveCol]);
      if (!speciesRaw && !moveRaw) continue;
      anySpecies = true;
      if (!speciesRaw || !moveRaw) {
        warnings.push(
          `Sheet "${sheet.name}" r${r + 1} ${col.category}: incomplete pair species="${speciesRaw}" move="${moveRaw}"`
        );
        continue;
      }
      if (/^\d+(\.\d+)?$/.test(speciesRaw) || speciesRaw.startsWith('#')) continue;
      if (['filtered', 'normal', 'fire', 'water'].includes(speciesRaw.toLowerCase()) && !moveRaw) {
        continue;
      }

      rows.push({
        species_form: speciesRaw,
        stage: null,
        category: col.category,
        move_name: moveRaw,
      });
    }
    if (!anySpecies && rows.length > 0) {
      const nextHas = CATEGORY_COLS.some((col) => cellString(sheet.rows[r + 1]?.[col.speciesCol]));
      if (!nextHas) break;
    }
  }
  return rows;
}

export function parseTeamRolesSheets(sheets: XlsxSheet[]): {
  rows: ParsedTeamRoleRow[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const rawRows: ParsedTeamRoleRow[] = [];
  for (const name of epbPack.workbook.teamRoles.sheets) {
    const sheet = getSheet(sheets, name);
    if (!sheet) {
      warnings.push(`Sheet "${name}" not found`);
      continue;
    }
    rawRows.push(...parseMatchupSheet(sheet, warnings));
  }
  return { rows: rawRows, warnings };
}

export function parseTeamRolesXlsxBuffer(buf: Buffer): {
  rows: ParsedTeamRoleRow[];
  warnings: string[];
} {
  return parseTeamRolesSheets(readXlsxBuffer(buf));
}

/** Parse, resolve against @pkmn/data, dedupe — does not write to the database. */
export function validateTeamRoleImport(buf: Buffer): {
  report: TeamRoleImportReport;
  roles: ParsedTeamRoleRow[];
} {
  const errors: string[] = [];

  let rawRows: ParsedTeamRoleRow[];
  let warnings: string[];
  try {
    ({ rows: rawRows, warnings } = parseTeamRolesXlsxBuffer(buf));
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    const emptyByCat = Object.fromEntries(
      VALID_ROLE_CATEGORIES.map((c) => [c, 0])
    ) as Record<TeamRoleCategory, number>;
    return {
      report: { total_raw: 0, unique: 0, warnings: [], errors, by_category: emptyByCat },
      roles: [],
    };
  }
  const seen = new Set<string>();
  const rows: ParsedTeamRoleRow[] = [];
  const unknownSpecies = new Set<string>();
  const unknownMoves = new Set<string>();

  for (const row of rawRows) {
    const species = resolveSpecies(row.species_form);
    const move = resolveMove(row.move_name);

    if (!species.ok) unknownSpecies.add(row.species_form);
    if (!move.ok) unknownMoves.add(row.move_name);

    const speciesForm = species.ok ? species.resolved : normalizeSpeciesLabel(row.species_form);
    const moveName = move.ok ? move.resolved : row.move_name;

    const key = `${speciesForm}::${row.category}::${moveName}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    rows.push({
      species_form: speciesForm,
      stage: row.stage,
      category: row.category,
      move_name: moveName,
    });
  }

  for (const s of [...unknownSpecies].sort()) {
    warnings.push(`Unknown species (kept as-is): ${s}`);
  }
  for (const m of [...unknownMoves].sort()) {
    warnings.push(`Unknown move (kept as-is): ${m}`);
  }

  const by_category = Object.fromEntries(
    VALID_ROLE_CATEGORIES.map((c) => [c, rows.filter((r) => r.category === c).length])
  ) as Record<TeamRoleCategory, number>;

  return {
    report: {
      total_raw: rawRows.length,
      unique: rows.length,
      warnings,
      errors,
      by_category,
    },
    roles: rows,
  };
}

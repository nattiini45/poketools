/**
 * Utility sheet parser and its label normalisation (draft-backend §2.3, §2.5). Used ONLY by the
 * reconciliation report: the draft's utility categories live in the format pack (`epb.utility`,
 * read through `src/lib/draft/utility-categories.ts`), and line availability always comes from
 * the Gen 9 learnsets, never from this sheet's species column.
 *
 * The sheet name, the source block headings and the label tables (branch markers, typos, whole-label
 * renames, move renames) come from the active format pack (`epb.workbook.utilitySheet`,
 * `@/lib/format-pack`). Layout: the category headers sit in one row; each block is
 * `[helper, helper, species, move, blank]`, the header above the species column. `#REF!` cells are
 * ignored.
 */

import { toLineId, type LineId } from '@/lib/draft/line-identity';
import { epbPack } from '@/lib/format-pack';
import { cellString, readXlsxBuffer, type XlsxSheet } from '@/lib/import/xlsx';

/** The utility-sheet part of the active pack's workbook map. */
const UTILITY_SHEET = epbPack.workbook.utilitySheet;

/** The source blocks of the sheet, as headed there (`epb.workbook.utilitySheet.categories`). */
export const UTILITY_SHEET_CATEGORIES: readonly string[] = UTILITY_SHEET.categories;

/** A source block heading of the active pack. */
export type UtilitySheetCategory = string;

export interface UtilitySheetPair {
  category: UtilitySheetCategory;
  /** 1-based sheet row. */
  row: number;
  /** Species label exactly as written in the sheet. */
  label: string;
  /** Move label exactly as written in the sheet. */
  move: string;
}

export interface UtilitySheetBlocks {
  sheet: string;
  pairs: UtilitySheetPair[];
}

function isCategory(value: string): value is UtilitySheetCategory {
  return UTILITY_SHEET_CATEGORIES.includes(value);
}

/** Read the (species, move) pairs of every category block. */
export function parseUtilitySheets(sheets: XlsxSheet[]): UtilitySheetBlocks {
  const sheet = sheets.find((s) => s.name === UTILITY_SHEET.sheet) ?? sheets[0];
  if (!sheet) throw new Error('Utility workbook has no sheets');

  // The first source block heading locates the header row.
  const anchor = UTILITY_SHEET_CATEGORIES[0] ?? '';
  const headerIndex = sheet.rows.findIndex((row) => (row ?? []).some((c) => cellString(c) === anchor));
  if (headerIndex === -1) throw new Error(`Sheet "${sheet.name}": no "${anchor}" header row found`);

  const headerRow = sheet.rows[headerIndex] ?? [];
  const blocks: { category: UtilitySheetCategory; col: number }[] = [];
  headerRow.forEach((cell, col) => {
    const label = cellString(cell);
    if (isCategory(label)) blocks.push({ category: label, col });
  });

  const pairs: UtilitySheetPair[] = [];
  for (const block of blocks) {
    for (let r = headerIndex + 1; r < sheet.rows.length; r++) {
      const row = sheet.rows[r] ?? [];
      const label = cellString(row[block.col]);
      const move = cellString(row[block.col + 1]);
      if (!label || !move || label === '#REF!' || move === '#REF!') continue;
      pairs.push({ category: block.category, row: r + 1, label, move });
    }
  }
  return { sheet: sheet.name, pairs };
}

export function parseUtilityXlsxBuffer(buf: Buffer): UtilitySheetBlocks {
  return parseUtilitySheets(readXlsxBuffer(buf));
}

// ── Label normalisation ───────────────────────────────────────────

export type UtilityLabelKind = 'species' | 'branch_marker' | 'typo';

export interface NormalizedUtilityLabel {
  label: string;
  /** Showdown species name to look up (for a typo: the label itself, unchanged). */
  normalized: string;
  kind: UtilityLabelKind;
  /** Branch markers select one line. */
  line_id: LineId | null;
  /** For a typo: what it most likely means (reported, never applied). */
  suggestion?: string;
}

/** Labels that are not forms but select one branch of a branched base (pack data). */
const BRANCH_MARKERS = UTILITY_SHEET.branchMarkers;

/** Labels with no exact Showdown match: reported as typos, not silently fixed (pack data). */
const TYPOS = UTILITY_SHEET.typos;

/** Whole-label renames, checked before the suffix rules (pack data). */
const EXACT = UTILITY_SHEET.exact;

/** Generic form suffixes of sheet labels (Showdown forme names). */
const SUFFIXES: readonly [RegExp, string][] = [
  [/\s*\(H\)$/, '-Hisui'],
  [/\s*\(A\)$/, '-Alola'],
  [/\s*\(G\)$/, '-Galar'],
  [/\s*\(Bloodmoon\)$/, '-Bloodmoon'],
  [/\s*\(Dusk\)$/, '-Dusk'],
  [/\s*\(Wash\)$/, '-Wash'],
  [/-T$/, '-Therian'],
  [/-C$/, '-Crowned'],
];

export function normalizeUtilityLabel(rawLabel: string): NormalizedUtilityLabel {
  const label = rawLabel.normalize('NFC').trim();
  const marker = Object.hasOwn(BRANCH_MARKERS, label) ? BRANCH_MARKERS[label] : undefined;
  if (marker) {
    return {
      label: rawLabel,
      normalized: marker.species,
      kind: 'branch_marker',
      line_id: toLineId(marker.line[0], marker.line[1]),
    };
  }
  const typo = Object.hasOwn(TYPOS, label) ? TYPOS[label] : undefined;
  if (typo) return { label: rawLabel, normalized: label, kind: 'typo', line_id: null, suggestion: typo };

  const exact = Object.hasOwn(EXACT, label) ? EXACT[label] : undefined;
  if (exact) return { label: rawLabel, normalized: exact, kind: 'species', line_id: null };

  for (const [pattern, replacement] of SUFFIXES) {
    if (pattern.test(label)) {
      return { label: rawLabel, normalized: label.replace(pattern, replacement), kind: 'species', line_id: null };
    }
  }
  return { label: rawLabel, normalized: label, kind: 'species', line_id: null };
}

/** Sheet move label -> Showdown move name (pack data). */
const MOVE_RENAMES = UTILITY_SHEET.moveRenames;

/** Sheet move label → Showdown move name (case slips only; resolution is by id anyway). */
export function normalizeUtilityMove(rawMove: string): string {
  const move = rawMove.normalize('NFC').trim();
  return (Object.hasOwn(MOVE_RENAMES, move) ? MOVE_RENAMES[move] : undefined) ?? move;
}

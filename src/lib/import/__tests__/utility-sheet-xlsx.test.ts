import { describe, expect, it } from 'vitest';
import { toLineId } from '@/lib/draft/line-identity';
import { epbPack } from '@/lib/format-pack';
import type { XlsxCellValue, XlsxSheet } from '@/lib/import/xlsx';
import {
  normalizeUtilityLabel,
  normalizeUtilityMove,
  parseUtilitySheets,
  UTILITY_SHEET_CATEGORIES,
} from '../utility-sheet-xlsx';

// The public suite runs on the example pack: sheet `Utility`, blocks Hazards / Hazard Control / Recovery /
// Pivoting / Priority, one branch marker and one move rename.
const SHEET = epbPack.workbook.utilitySheet;

function sparseRow(cells: Record<number, XlsxCellValue>): XlsxCellValue[] {
  const row: XlsxCellValue[] = [];
  for (const [col, value] of Object.entries(cells)) row[Number(col)] = value;
  return row;
}

describe('parseUtilitySheets', () => {
  it('reads the pack block headings', () => {
    expect(UTILITY_SHEET_CATEGORIES).toEqual(SHEET.categories);
    expect(UTILITY_SHEET_CATEGORIES[0]).toBe('Hazards');
  });

  it('reads (species, move) pairs under each category header and ignores the #REF! helper columns', () => {
    const sheet: XlsxSheet = {
      name: 'Utility',
      rows: [
        [],
        sparseRow({ 1: 'Pokemon', 2: 'HP' }),
        sparseRow({ 1: 'Sprigatito', 15: 1, 16: 2, 17: 'Hazards', 22: 'Hazard Control', 27: 'Recovery' }),
        sparseRow({ 1: 'Floragato', 15: '#REF!', 16: '#REF!', 17: 'Garchomp', 18: 'Stealth Rock', 22: 'Cinderace', 23: 'Court Change' }),
        sparseRow({ 1: 'Meowscarada', 17: 'Arghonaut', 18: 'Spikes', 27: 'Corviknight', 28: 'Roost' }),
        sparseRow({ 1: 'Fuecoco', 17: '#REF!', 18: 'Spikes' }),
      ],
    };
    // The pack's sheet name is preferred; another sheet name falls back to the first sheet.
    expect(parseUtilitySheets([{ name: 'Other', rows: [] }, sheet]).sheet).toBe('Utility');
    expect(parseUtilitySheets([sheet])).toEqual({
      sheet: 'Utility',
      pairs: [
        { category: 'Hazards', row: 4, label: 'Garchomp', move: 'Stealth Rock' },
        { category: 'Hazards', row: 5, label: 'Arghonaut', move: 'Spikes' },
        { category: 'Hazard Control', row: 4, label: 'Cinderace', move: 'Court Change' },
        { category: 'Recovery', row: 5, label: 'Corviknight', move: 'Roost' },
      ],
    });
  });

  it('fails clearly without a category header row (the first block heading anchors it)', () => {
    expect(() => parseUtilitySheets([{ name: 'Utility', rows: [['x']] }])).toThrow('no "Hazards" header row');
    expect(() => parseUtilitySheets([])).toThrow('Utility workbook has no sheets');
  });
});

describe('normalizeUtilityLabel', () => {
  it.each([
    ['Samurott (H)', 'Samurott-Hisui'],
    ['Raichu (A)', 'Raichu-Alola'],
    ['Slowking (G)', 'Slowking-Galar'],
    ['Ursaluna (Bloodmoon)', 'Ursaluna-Bloodmoon'],
    ['Lycanroc (Dusk)', 'Lycanroc-Dusk'],
    ['Rotom (Wash)', 'Rotom-Wash'],
    ['Landorus-T', 'Landorus-Therian'],
    ['Zacian-C', 'Zacian-Crowned'],
    ['Gengar', 'Gengar'],
  ])('%s -> %s (generic form suffixes)', (label, normalized) => {
    expect(normalizeUtilityLabel(label)).toEqual({ label, normalized, kind: 'species', line_id: null });
  });

  it('applies the pack branch markers: Pikachu (A) selects the Alolan Raichu line', () => {
    expect(normalizeUtilityLabel('Pikachu (A)')).toEqual({
      label: 'Pikachu (A)',
      normalized: 'Pikachu',
      kind: 'branch_marker',
      line_id: 'pichu--raichualola',
    });
    for (const [label, marker] of Object.entries(SHEET.branchMarkers)) {
      expect(normalizeUtilityLabel(label).line_id, label).toBe(toLineId(marker.line[0], marker.line[1]));
    }
  });

  it('applies the pack typo and whole-label tables (reported, never applied, for typos)', () => {
    for (const [label, suggestion] of Object.entries(SHEET.typos)) {
      expect(normalizeUtilityLabel(label)).toEqual({ label, normalized: label, kind: 'typo', line_id: null, suggestion });
    }
    for (const [label, normalized] of Object.entries(SHEET.exact)) {
      expect(normalizeUtilityLabel(label).normalized, label).toBe(normalized);
    }
    // Not in any table: a label is a plain species label, never a typo.
    expect(normalizeUtilityLabel('Ivysaur')).toEqual({ label: 'Ivysaur', normalized: 'Ivysaur', kind: 'species', line_id: null });
    // Object prototype names are not table entries.
    expect(normalizeUtilityLabel('constructor').kind).toBe('species');
  });

  it('fixes the pack move-label slips only', () => {
    expect(normalizeUtilityMove('U-Turn')).toBe('U-turn');
    expect(normalizeUtilityMove(' Knock Off ')).toBe('Knock Off');
    expect(normalizeUtilityMove('toString')).toBe('toString');
  });
});

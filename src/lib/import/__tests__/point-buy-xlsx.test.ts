import { describe, expect, it } from 'vitest';
import { overridesFor } from '@/lib/draft/league-overrides';
import { epbPack } from '@/lib/format-pack';
import type { XlsxCellValue, XlsxSheet } from '@/lib/import/xlsx';
import {
  OVERVIEW_GROUP_LABELS,
  parsePointBuySheets,
  pointBuyEntriesToRows,
  speciesIdFor,
  validatePointBuySheets,
} from '../point-buy-xlsx';

// The public suite runs on the example pack: sheets `Lines` / `Summary` / `Rules`, its own column order,
// English group spellings. The workbook below is laid out through the pack's column map.
const WB = epbPack.workbook.pointBuy;

type Line = [base: string, chain: string, price: number, group: string, k2: number, k3: number, rules?: string];

const LINES: Line[] = [
  ['Dratini', 'Dratini → Dragonair → Dragonite', 20, 'Top', 1, 3, 'Beispielregel: Teilnahme-Linie.'],
  ['Grubbin', 'Grubbin → Charjabug → Vikavolt', 18, 'Upper', 2, 1],
  ['Axew', 'Axew → Fraxure → Haxorus', 14, 'Middle', 2, 7],
  ['Flabébé', 'Flabébé → Floette → Florges', 12, 'Middle', 3, 11],
  ['Pichu', 'Pichu → Pikachu → Raichu', 11, 'Middle', 4, 6],
  ['Pichu', 'Pichu → Pikachu → Raichu-Alola', 7, '', 1, 7],
  ['Bulbasaur', 'Bulbasaur → Ivysaur → Venusaur', 9, 'Lower', 1, 8, 'Beispielregel: Ivysaur darf einen Evolith tragen.'],
];

function row(cells: Partial<Record<keyof typeof WB.columns, XlsxCellValue>>): XlsxCellValue[] {
  const out: XlsxCellValue[] = [];
  for (const [field, col] of Object.entries(WB.columns)) out[col] = cells[field as keyof typeof WB.columns] ?? null;
  return Array.from(out, (c) => c ?? null);
}

function listSheet(lines: Line[]): XlsxSheet {
  return {
    name: WB.sheet,
    rows: [
      row({ lineNumber: '#', startName: 'Start', evolutionLine: 'Line', price: 'Points', priceGroup: 'Group' }),
      // A section row the parser skips (`skipStartNames`).
      row({ startName: 'Group' }),
      ...lines.map(([base, chain, price, group, k2, k3, rules]) =>
        row({
          lineNumber: 0,
          startName: base,
          evolutionLine: chain,
          legacyTier: 'A',
          price,
          priceGroup: group,
          killsToStage2: k2,
          additionalKillsToStage3: k3,
          rationale: 'Rationale',
          historical: 'History',
          early: 5,
          mid: 5,
          late: 5,
          specialRulesText: rules ?? null,
          sources: 'Source',
        }),
      ),
    ],
  };
}

function overviewSheet(count: number, groups: Record<string, number>): XlsxSheet {
  return {
    name: WB.overviewSheet ?? 'Summary',
    rows: [['Summary'], [WB.overviewLabels.lineCount, count], ...Object.entries(groups).map(([label, n]) => [label, n])],
  };
}

const RULES: XlsxSheet = {
  name: WB.rulesSheet ?? 'Rules',
  rows: [['Example league point buy'], ['Last Respects', 'banned']],
};

const MATCHING_GROUPS = { Top: 1, Upper: 1, Middle: 3, Lower: 2, Bargain: 0 };

describe('parsePointBuySheets (example pack layout)', () => {
  it('reads the sheet through the pack column map and derives a line id per entry', () => {
    const { entries } = parsePointBuySheets([listSheet(LINES)]);
    expect(entries.map((e) => e.line_id)).toEqual([
      'dratini--dragonite',
      'grubbin--vikavolt',
      'axew--haxorus',
      'flabebe--florges',
      'pichu--raichu',
      'pichu--raichualola',
      'bulbasaur--venusaur',
    ]);
    expect(entries.map((e) => e.line_number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const dratini = entries[0];
    expect([dratini.price, dratini.kills_to_stage2, dratini.additional_kills_to_stage3]).toEqual([20, 1, 3]);
    expect([dratini.rationale, dratini.historical_data, dratini.sources, dratini.legacy_tier]).toEqual([
      'Rationale',
      'History',
      'Source',
      'A',
    ]);
  });

  it('maps the sheet group spellings, and derives a missing group from the pack price ranges', () => {
    const { entries } = parsePointBuySheets([listSheet(LINES)]);
    expect(entries.map((e) => e.price_group)).toEqual(['premium', 'hoch', 'mittel', 'mittel', 'mittel', 'guenstig', 'guenstig']);
  });

  it('stores the pack line-rule flags in the importer key order', () => {
    const { entries } = parsePointBuySheets([listSheet(LINES)]);
    expect(entries.map((e) => e.special_rules)).toEqual([
      { cosmog: true, no_redraft: true },
      { scatterbug: true },
      { no_cocoon_rule: true },
      null,
      null,
      null,
      null,
    ]);
  });

  it('keeps the rules sheet rows for the report', () => {
    expect(parsePointBuySheets([listSheet(LINES), RULES]).rulesSheetRows).toEqual(RULES.rows);
    expect(parsePointBuySheets([listSheet(LINES)]).rulesSheetRows).toEqual([]);
  });
});

describe('validatePointBuySheets', () => {
  it('derives the line count; a different overview count is a warning, not an error', async () => {
    const { report, validEntries } = await validatePointBuySheets([
      listSheet(LINES),
      overviewSheet(48, MATCHING_GROUPS),
      RULES,
    ]);
    expect(report.errors).toEqual([]);
    expect(report.total_lines).toBe(7);
    expect(validEntries).toHaveLength(7);
    expect(report.warnings).toContain('Summary says 48 lines, the list has 7: the derived count 7 is authoritative');
    expect(report.reconciliation?.line_count).toBe(7);
  });

  it('turns a group-count mismatch into a warning, and accepts any group counts that match', async () => {
    expect(OVERVIEW_GROUP_LABELS).toBe(WB.overviewGroupLabels);
    const mismatch = await validatePointBuySheets([
      listSheet(LINES),
      overviewSheet(7, { ...MATCHING_GROUPS, Top: 12, Lower: 5 }),
    ]);
    expect(mismatch.report.errors).toEqual([]);
    expect(mismatch.report.warnings.filter((w) => !w.startsWith('Grubbin'))).toEqual([
      'Summary group Top: sheet says 12, the list has 1 (derived count is authoritative)',
      'Summary group Lower: sheet says 5, the list has 2 (derived count is authoritative)',
    ]);

    const match = await validatePointBuySheets([listSheet(LINES), overviewSheet(7, MATCHING_GROUPS)]);
    expect(match.report.warnings.filter((w) => !w.startsWith('Grubbin'))).toEqual([]);
  });

  it('warns when the sheet disagrees with a line rule expected thresholds', async () => {
    const { report } = await validatePointBuySheets([listSheet(LINES)]);
    expect(report.warnings).toEqual([
      'Grubbin: expected 1 kill to Charjabug (got 2)',
      'Grubbin: expected 0 additional kills to Vikavolt (got 1)',
    ]);
    const agreeing = LINES.map((l): Line => (l[0] === 'Grubbin' ? [l[0], l[1], l[2], l[3], 1, 0] : l));
    expect((await validatePointBuySheets([listSheet(agreeing)])).report.warnings).toEqual([]);
  });

  it('a duplicate line id is an error', async () => {
    const { report } = await validatePointBuySheets([listSheet([...LINES, LINES[2]])]);
    expect(report.errors).toEqual(['Duplicate line id axew--haxorus: lines 3 and 8 (Axew → Haxorus)']);
    expect(report.reconciliation?.errors).toEqual(['Duplicate line id axew--haxorus']);
  });

  it('lists exactly the league overrides in the reconciliation report', async () => {
    const { report } = await validatePointBuySheets([listSheet(LINES), overviewSheet(7, MATCHING_GROUPS), RULES], {
      source: 'synthetic.xlsx',
    });
    const r = report.reconciliation;
    expect(r?.list_source).toBe('synthetic.xlsx');
    const { entries } = parsePointBuySheets([listSheet(LINES)]);
    const expected = entries.flatMap((e) => overridesFor(e).map((o) => [e.line_id, o.field, o.sheet_value, o.applied_value]));
    expect(r?.threshold_conflicts.map((c) => [c.line_id, c.field, c.sheet_value, c.applied_value])).toEqual(expected);
  });

  it('notes special-rule prose without a machine flag (info only)', async () => {
    const { report } = await validatePointBuySheets([listSheet(LINES)]);
    expect(report.info).toEqual([
      'Line 7 (bulbasaur--venusaur): special-rule text without a machine flag (shown as prose only)',
    ]);
  });

  it('reports a missing list sheet as an error without a reconciliation report', async () => {
    const { report, validEntries } = await validatePointBuySheets([RULES]);
    expect(report.errors).toEqual(['Sheet "Lines" not found']);
    expect(report.reconciliation).toBeNull();
    expect(validEntries).toEqual([]);
  });
});

describe('species ids', () => {
  it('resolve through the dex: Flabébé is flabebe, not flabb', () => {
    expect(speciesIdFor('Flabébé')).toBe('flabebe');
    expect(speciesIdFor('Flabébé'.normalize('NFD'))).toBe('flabebe');
    expect(speciesIdFor('Ursaluna-Bloodmoon')).toBe('ursalunabloodmoon');
    expect(speciesIdFor('Not A Pokemon')).toBe('notapokemon');
  });

  it('rows carry the line id and the dex species ids', () => {
    const { entries } = parsePointBuySheets([listSheet(LINES)]);
    const flabebe = pointBuyEntriesToRows('v1', entries).find((r) => r.base_pokemon === 'Flabébé');
    expect(flabebe?.line_id).toBe('flabebe--florges');
    expect(flabebe?.species_ids).toEqual({ base: 'flabebe', stage2: 'floette', stage3: 'florges' });
    expect(flabebe?.list_version_id).toBe('v1');
  });
});

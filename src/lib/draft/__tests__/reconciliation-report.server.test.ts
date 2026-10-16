import { describe, expect, it } from 'vitest';
import { epbPack } from '@/lib/format-pack';
import type { ParsedPointBuyEntry } from '@/lib/import/point-buy-xlsx';
import type { UtilitySheetBlocks } from '@/lib/import/utility-sheet-xlsx';
import type { PriceGroup } from '@/types/point-buy';
import { overridesFor } from '../league-overrides';
import fixture from './fixtures/example-list.json';
import { buildReconciliationReport, renderReconciliationMarkdown } from '../reconciliation-report';

// The public suite runs on the example pack and its synthetic 48-line list.
const entries: ParsedPointBuyEntry[] = fixture.entries.map((e) => ({
  ...e,
  price_group: e.price_group as PriceGroup,
  special_rules: e.special_rules as Record<string, boolean> | null,
}));

const GENERATED_AT = '2026-10-10T00:00:00.000Z';

function build(extra: { utilitySheet?: UtilitySheetBlocks } = {}) {
  return buildReconciliationReport({
    entries,
    overview: fixture.overview,
    rulesSheetRows: fixture.rules_sheet_rows,
    source: fixture.source,
    generatedAt: GENERATED_AT,
    ...extra,
  });
}

describe('reconciliation report (example list fixture)', () => {
  it('derives 48 lines and the example price tabs 12 / 12 / 12 / 12 with nothing out of tab', async () => {
    const r = await build();
    expect(r.line_count).toBe(48);
    expect(r.price_tabs).toEqual([
      { key: '25-20', count: 12 },
      { key: '19-15', count: 12 },
      { key: '14-10', count: 12 },
      { key: '9-1', count: 12 },
    ]);
    expect(r.out_of_tab_prices).toEqual([]);
    expect(r.sheet_groups).toEqual({ premium: 12, hoch: 12, mittel: 12, guenstig: 5, budget: 7 });
    expect(r.errors).toEqual([]);
  });

  it('resolves every stage name of the example list as a Gen 9 standard species', async () => {
    const r = await build();
    expect(r.unresolved_names).toEqual([]);
  });

  it('finds the 5 branched bases with their thresholds and prices', async () => {
    const r = await build();
    expect(r.branched_bases.map((b) => b.base)).toEqual(['Pichu', 'Ralts', 'Poliwag', 'Oddish', 'Eevee']);
    expect(r.branched_bases.flatMap((b) => b.lines)).toHaveLength(10);
    expect(r.branched_bases.every((b) => b.thresholds_differ && !b.same_price)).toBe(true);
    const eevee = r.branched_bases.find((b) => b.base === 'Eevee');
    expect(eevee?.lines.map((l) => [l.line_id, l.k2, l.k3])).toEqual([
      ['eevee--vaporeon', 3, null],
      ['eevee--jolteon', 4, null],
    ]);
  });

  it('lists exactly the league overrides the override layer applies, without a quoted rules row', async () => {
    const r = await build();
    const applied = entries.flatMap((e) => overridesFor(e).map((o) => [e.line_id, o.field, o.sheet_value, o.applied_value]));
    expect(r.threshold_conflicts.map((c) => [c.line_id, c.field, c.sheet_value, c.applied_value])).toEqual(applied);
    expect(r.overrides_applied).toHaveLength(applied.length);
    // The example pack names no rules-sheet row to quote next to the overrides.
    expect(epbPack.reconciliation.overrideRowPattern).toBeUndefined();
    for (const c of r.threshold_conflicts) expect(c.source).not.toContain('rules row');
  });

  it('has no rule conflicts: the example pack defines no ruleChecks hook', async () => {
    expect(epbPack.reconciliation.ruleChecks).toBeUndefined();
    expect((await build()).rule_conflicts).toEqual([]);
  });

  it('is repeatable: the same input gives the same report', async () => {
    expect(await build()).toEqual(await build());
    expect(renderReconciliationMarkdown(await build())).toBe(renderReconciliationMarkdown(await build()));
  });

  it('renders the markdown artifact with every section, group labels from the pack workbook', async () => {
    const md = renderReconciliationMarkdown(await build());
    expect(md).toContain('# EPB list reconciliation report');
    expect(md).toContain('Lines (derived): **48**');
    expect(md).toContain('| 9-1 | 12 |');
    expect(md).toContain('| Bargain | 7 |');
    expect(md).toContain('## Branched bases (5 bases / 10 lines)');
    expect(md).toContain('## Rule conflicts');
    expect(md).not.toContain('## Gen 9 utility sheet');
  });

  it('reports a duplicate line id and an out-of-tab price', async () => {
    const dup = { ...entries[0], line_number: 49, price: 0 };
    const r = await buildReconciliationReport({ entries: [...entries, dup], overview: {}, generatedAt: GENERATED_AT });
    expect(r.errors).toEqual([`Duplicate line id ${entries[0].line_id}`]);
    expect(r.out_of_tab_prices).toEqual([{ line_id: entries[0].line_id, price: 0 }]);
    expect(r.line_count).toBe(49);
  });
});

describe('reconciliation report: utility sheet section', () => {
  const sheet: UtilitySheetBlocks = {
    sheet: 'Utility',
    pairs: [
      { category: 'Hazards', row: 4, label: 'Geodude', move: 'Stealth Rock' },
      { category: 'Hazards', row: 5, label: 'Arghonaut', move: 'Spikes' },
      { category: 'Pivoting', row: 7, label: 'Pikachu (A)', move: 'Volt Switch' },
      { category: 'Pivoting', row: 8, label: 'Notamon', move: 'U-Turn' },
      { category: 'Recovery', row: 9, label: 'Charmander', move: 'Sleep Powder' },
    ],
  };

  it('normalises labels, maps branch markers to lines and reports unknown labels, illegal pairs and CAP species', async () => {
    const r = await build({ utilitySheet: sheet });
    const u = r.utility;
    expect(u).not.toBeNull();
    expect(u?.label_normalizations).toEqual([{ label: 'Pikachu (A)', normalized: 'Pikachu', line_id: 'pichu--raichualola' }]);
    expect(u?.unresolved_labels).toEqual([{ category: 'Pivoting', label: 'Notamon', reason: 'not_in_dex' }]);
    expect(u?.illegal_pairs).toEqual([{ category: 'Recovery', species: 'Charmander', move: 'Sleep Powder' }]);
    expect(u?.unmapped_species_count).toBe(1);
    expect(u?.cap_species_count).toBe(1);
    expect(u?.category_moves_not_in_module).toEqual([{ category: 'Recovery', move: 'Sleep Powder' }]);
    expect(u?.lines_without_any_utility).not.toContain('geodude--golem');
    expect(u?.lines_without_any_utility).not.toContain('pichu--raichualola');
    expect(u?.lines_without_any_utility).toContain('gastly--gengar');
    const md = renderReconciliationMarkdown(r);
    expect(md).toContain('- Utility categories: Hazards, Hazard control, Recovery, Pivoting, Priority');
    // The example pack lists no past-generation ids, so that line is left out.
    expect(md).not.toContain("isNonstandard 'Past'");
  });
});

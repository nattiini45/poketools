import { describe, expect, it } from 'vitest';
import fixture from '@/lib/draft/__tests__/fixtures/example-list.json';
import { applyLeagueOverrides } from '@/lib/draft/league-overrides';
import { lineOverrideFor } from '@/lib/format-pack';
import type { PointBuyListEntry } from '@/types/point-buy';
import { buildLineCatalog, hashCatalog } from '../line-catalog';

// The example list fixture as the read layer returns it (league overrides applied); the public suite runs
// on the example pack.
const ENTRIES: PointBuyListEntry[] = fixture.entries.map((e, i) =>
  applyLeagueOverrides({
    ...e,
    id: `entry-${i + 1}`,
    list_version_id: 'list-1',
    price_group: e.price_group as PointBuyListEntry['price_group'],
  }),
);

describe('buildLineCatalog (draft-frontend §4.8)', () => {
  const catalog = buildLineCatalog(ENTRIES, [], ['Baton Pass', 'shedtail'], 'en');
  const byId = new Map(catalog.lines.map((l) => [l.lineId, l]));

  it('keeps list order, prices and canonical stage names', () => {
    expect(catalog.lines).toHaveLength(48);
    expect(catalog.listVersionId).toBe('list-1');
    expect(catalog.lines.map((l) => l.lineNumber)).toEqual([...catalog.lines.map((l) => l.lineNumber)].sort((a, b) => a - b));
    expect(byId.get('gible--garchomp')?.stages.map((s) => s.name)).toEqual(['Gible', 'Gabite', 'Garchomp']);
    expect(catalog.bannedMoves).toEqual(['batonpass', 'shedtail']);
  });

  it('shows the read-layer thresholds (league overrides applied) and the stored flags', () => {
    expect(lineOverrideFor('dratini--dragonite')).not.toBeNull();
    const entry = ENTRIES.find((e) => e.line_id === 'dratini--dragonite');
    const k2 = entry?.kills_to_stage2 ?? Number.NaN;
    const k3 = entry?.additional_kills_to_stage3 ?? Number.NaN;
    const line = byId.get('dratini--dragonite');
    expect(line?.thresholds).toEqual({ toStage2: k2, additionalToStage3: k3, cumulative: [k2, k2 + k3] });
    expect(line?.flags).toEqual({ cosmog: true, noRedraft: true, scatterbugCocoon: false });
    expect(line?.branch).toEqual({ groupKey: 'dratini', count: 1 });
    expect(byId.get('grubbin--vikavolt')?.flags).toEqual({ cosmog: false, noRedraft: false, scatterbugCocoon: true });
  });

  it('prefers the season thresholds when given', () => {
    const withThresholds = buildLineCatalog(
      ENTRIES,
      [{ line_id: 'gastly--gengar', base_pokemon: 'Gastly', stage2_pokemon: 'Haunter', stage3_pokemon: 'Gengar', stage2_kos: 3, stage3_kos: 9 }],
      [],
      'en',
    );
    expect(withThresholds.lines.find((l) => l.lineId === 'gastly--gengar')?.thresholds.cumulative).toEqual([3, 9]);
  });

  it('marks branches and leaves single lines unmarked', () => {
    expect(byId.get('pichu--raichualola')?.branch).toEqual({ groupKey: 'pichu', count: 2 });
    expect(byId.get('gastly--gengar')?.branch.count).toBe(1);
  });

  it('localizes special rules on the server, German prose with lang "de"', () => {
    const en = byId.get('dratini--dragonite')?.specialRules;
    expect(en?.lang).toBe('en');
    const de = buildLineCatalog(ENTRIES, [], [], 'de').lines.find((l) => l.lineId === 'dratini--dragonite')?.specialRules;
    expect(de?.lang).toBe('de');
    // German prose without an authored English entry stays German in English.
    expect(byId.get('gastly--gengar')?.specialRules?.lang).toBe('de');
    expect(byId.get('mareep--ampharos')?.specialRules ?? null).toBeNull();
  });

  it('carries no rationale, history, sources or ratings', () => {
    const keys = Object.keys(catalog.lines[0]).sort();
    expect(keys).toEqual(['branch', 'entryId', 'flags', 'lineId', 'lineNumber', 'price', 'specialRules', 'stages', 'thresholds']);
  });
});

describe('hashCatalog', () => {
  const base = hashCatalog(ENTRIES);

  it('is 8 lowercase hex digits and independent of input order', () => {
    expect(base).toMatch(/^[0-9a-f]{8}$/);
    expect(hashCatalog([...ENTRIES].reverse())).toBe(base);
  });

  it('changes when a price or a species id changes', () => {
    const priced = ENTRIES.map((e, i) => (i === 3 ? { ...e, price: e.price + 1 } : e));
    expect(hashCatalog(priced)).not.toBe(base);
    const respecies = ENTRIES.map((e, i) =>
      i === 3 && e.species_ids ? { ...e, species_ids: { ...e.species_ids, stage2: 'other' } } : e,
    );
    expect(hashCatalog(respecies)).not.toBe(base);
  });

  it('ignores fields outside the formula', () => {
    expect(hashCatalog(ENTRIES.map((e) => ({ ...e, rationale: 'changed' })))).toBe(base);
  });
});

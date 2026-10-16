import { describe, expect, it } from 'vitest';
import type { PointBuyListEntry } from '@/types/point-buy';
import { lineIdOfEntry } from '@/lib/draft/line-identity';
import { PRICE_GROUPS } from '@/types/point-buy';
import { getTeraEligibility } from '@/lib/draft/point-buy-engine';
import { epbPack } from '@/lib/format-pack';
import {
  DEFAULT_POINT_BUY_FILTERS,
  PRICE_GROUP_RANGES,
  filterPointBuyEntries,
  lineMatchesSearch,
  stagesForEntry,
} from '../point-buy-display';

function entry(overrides: Partial<PointBuyListEntry> = {}): PointBuyListEntry {
  const e: Omit<PointBuyListEntry, 'line_id'> & { line_id?: string } = {
    id: 'e1',
    list_version_id: 'v1',
    line_number: 1,
    base_pokemon: 'Charmander',
    stage2_pokemon: 'Charmeleon',
    stage3_pokemon: 'Charizard',
    price: 20,
    kills_to_stage2: 3,
    additional_kills_to_stage3: 4,
    price_group: 'mittel',
    early_rating: null,
    mid_rating: null,
    late_rating: null,
    rationale: null,
    historical_data: null,
    special_rules: null,
    special_rules_text: null,
    sources: null,
    legacy_tier: null,
    species_ids: null,
    ...overrides,
  };
  return { ...e, line_id: e.line_id ?? lineIdOfEntry(e) };
}

describe('lineMatchesSearch (draft-frontend §8.5: all three stages, both languages)', () => {
  const line = entry();

  it('matches any stage by English name, prefix or substring', () => {
    expect(lineMatchesSearch(line, 'charm')).toBe(true);
    expect(lineMatchesSearch(line, 'meleon')).toBe(true);
    expect(lineMatchesSearch(line, 'Charizard')).toBe(true);
    expect(lineMatchesSearch(line, 'bulba')).toBe(false);
  });

  it('matches German names of every stage', () => {
    expect(lineMatchesSearch(line, 'Glumanda')).toBe(true);
    expect(lineMatchesSearch(line, 'glutexo')).toBe(true);
    expect(lineMatchesSearch(line, 'Glurak')).toBe(true);
  });

  it('matches every line on an empty query', () => {
    expect(lineMatchesSearch(line, '')).toBe(true);
  });

  it('drives the search filter of filterPointBuyEntries', () => {
    const lines = [line, entry({ id: 'e2', base_pokemon: 'Bulbasaur', stage2_pokemon: 'Ivysaur', stage3_pokemon: 'Venusaur' })];
    const found = filterPointBuyEntries(lines, { ...DEFAULT_POINT_BUY_FILTERS, search: 'bisaflor' }, {}, {});
    expect(found.map((e) => e.id)).toEqual(['e2']);
  });
});

describe('stagesForEntry returns keys, not display text', () => {
  it('carries stage numbers and tera-rule keys', () => {
    const stages = stagesForEntry(entry(), {}, {}, new Set());
    // The list card shows the active pack's Tera rule per stage, as getTeraEligibility reports it.
    const tera = epbPack.teraByStage;
    expect(stages.map((s) => [s.key, s.stageNumber, s.teraRule])).toEqual([
      ['base', 1, tera.stage1],
      ['stage2', 2, tera.stage2],
      ['stage3', 3, tera.stage3],
    ]);
    for (const stage of stages) expect(stage.teraRule).toBe(getTeraEligibility(stage.stageNumber));
    for (const stage of stages) expect(stage).not.toHaveProperty('label');
  });
});

describe('PRICE_GROUP_RANGES', () => {
  it('covers every price group with an ordered range', () => {
    for (const group of PRICE_GROUPS) {
      const [min, max] = PRICE_GROUP_RANGES[group];
      expect(min).toBeLessThan(max);
    }
  });
});

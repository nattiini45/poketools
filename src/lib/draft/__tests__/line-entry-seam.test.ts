/**
 * Seam test (B-LINE): the line-keyed helpers take a `PointBuyListEntry` (whose
 * `line_id` the read layer and the importer always set) and also a row that
 * lacks `line_id` (importer rows before the id is set), so FE §4.8's
 * `buildLineCatalog(entries: PointBuyListEntry[])` and DF1 compile and work
 * with both.
 */
import { describe, expect, it } from 'vitest';
import type { PointBuyListEntry } from '@/types/point-buy';
import type { getListEntries } from '@/lib/supabase/queries/point-buy-lists';
import { applyLeagueOverrides, overridesFor } from '../league-overrides';
import { effectiveThresholds } from '../line-catalog-data';
import { lineIdOfEntry, type LineId } from '../line-identity';
import { SPECIAL_RULES_EN, specialRulesTextFor } from '../special-rules-text';

// The public suite runs on the example pack: its participation line carries authored English.
const PARTICIPATION_DE = 'Beispielregel: Diese Linie sammelt Teilnahme-Tokens und bleibt im Redraft gesperrt.';

/** A list row without its `line_id` and `overrides` (e.g. an importer row before the id is set). */
function participationWithoutLineId(): Omit<PointBuyListEntry, 'line_id'> {
  return {
    id: 'entry-dratini',
    list_version_id: 'v1',
    line_number: 1,
    base_pokemon: 'Dratini',
    stage2_pokemon: 'Dragonair',
    stage3_pokemon: 'Dragonite',
    price: 20,
    kills_to_stage2: 3,
    additional_kills_to_stage3: 8,
    price_group: 'premium',
    early_rating: 6,
    mid_rating: 7,
    late_rating: 8,
    rationale: null,
    historical_data: null,
    special_rules: { cosmog: true, no_redraft: true },
    special_rules_text: PARTICIPATION_DE,
    sources: null,
    legacy_tier: 'S',
    species_ids: { base: 'dratini', stage2: 'dragonair', stage3: 'dragonite' },
  };
}

// Compile-time: an element of `getListEntries`' result is accepted as is.
type ReadEntry = Awaited<ReturnType<typeof getListEntries>>[number];
function catalogRow(entry: ReadEntry) {
  const applied = applyLeagueOverrides(entry);
  const lineId: LineId = applied.line_id;
  return { lineId, applied, text: specialRulesTextFor(applied, 'en'), thresholds: effectiveThresholds(entry) };
}

describe('line-keyed helpers accept a PointBuyListEntry', () => {
  it('applyLeagueOverrides computes the missing line_id and applies exactly the overrides of that id', () => {
    const raw = participationWithoutLineId();
    const applied = applyLeagueOverrides(raw);
    expect(applied.line_id).toBe('dratini--dragonite');
    expect(applied.overrides).toEqual(overridesFor(raw));
    for (const o of applied.overrides) expect(applied[o.field]).toBe(o.applied_value);
    expect(raw).not.toHaveProperty('line_id');
  });

  it('specialRulesTextFor finds the English entry by the computed line id', () => {
    const raw = participationWithoutLineId();
    expect(specialRulesTextFor(raw, 'en')).toEqual({ text: SPECIAL_RULES_EN['dratini--dragonite'].en, lang: 'en' });
    expect(specialRulesTextFor(raw, 'de')).toEqual({ text: PARTICIPATION_DE, lang: 'de' });
  });

  it('works on the read-layer shape (catalog builder)', () => {
    const row = catalogRow({ ...participationWithoutLineId(), line_id: 'dratini--dragonite' });
    expect(row.lineId).toBe('dratini--dragonite');
    expect(row.text.lang).toBe('en');
    expect(row.text.text).toContain(SPECIAL_RULES_EN['dratini--dragonite'].en);
    for (const o of row.applied.overrides) expect(row.text.text).toContain(o.reason.en);
    const k2 = row.applied.kills_to_stage2;
    expect(row.thresholds).toEqual({
      line_id: 'dratini--dragonite',
      stage2_kos: k2,
      stage3_kos: k2 + (row.applied.additional_kills_to_stage3 ?? 0),
    });
  });

  it('a stored line_id wins over the stage names', () => {
    expect(lineIdOfEntry({ ...participationWithoutLineId(), line_id: 'stored--line' })).toBe('stored--line');
    expect(lineIdOfEntry({ line_id: 'gastly--gengar' })).toBe('gastly--gengar');
  });

  it('refuses an entry with neither a line id nor stage names', () => {
    expect(() => lineIdOfEntry({ line_id: '' })).toThrow(/neither a line id nor stage names/);
  });
});

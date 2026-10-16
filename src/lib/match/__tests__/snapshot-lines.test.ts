import { describe, expect, it } from 'vitest';
import { resolveSnapshotEntries, type LineSnapshot } from '../snapshot-lines';
import type { PointBuyListEntry } from '@/types/point-buy';
import { lineIdOfEntry } from '@/lib/draft/line-identity';

function entry(base: string, stage2: string, stage3: string | null, over: Partial<PointBuyListEntry> = {}): PointBuyListEntry {
  const e: Omit<PointBuyListEntry, 'line_id'> & { line_id?: string } = {
    id: `${base}-${stage3 ?? stage2}`,
    list_version_id: 'v1',
    line_number: 1,
    base_pokemon: base,
    stage2_pokemon: stage2,
    stage3_pokemon: stage3,
    price: 10,
    kills_to_stage2: 3,
    additional_kills_to_stage3: stage3 ? 4 : null,
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
    ...over,
  };
  return { ...e, line_id: e.line_id ?? lineIdOfEntry(e) };
}

function snap(id: string, base: string, species: string, lineId?: string | null): LineSnapshot {
  return { id, base_pokemon: base, species_at_match: species, line_id: lineId };
}

const SAMUROTT = entry('Oshawott', 'Dewott', 'Samurott', { price: 12 });
const SAMUROTT_HISUI = entry('Oshawott', 'Dewott', 'Samurott-Hisui', { price: 18 });
const CHARIZARD = entry('Charmander', 'Charmeleon', 'Charizard');

describe('resolveSnapshotEntries', () => {
  it('keys the list by line id, so two lines with one base both resolve', () => {
    const map = resolveSnapshotEntries(
      [snap('a', 'Oshawott', 'Oshawott', 'oshawott--samurott'), snap('b', 'Oshawott', 'Oshawott', 'oshawott--samurotthisui')],
      [SAMUROTT, SAMUROTT_HISUI],
    );
    expect(map.get('a')?.price).toBe(12);
    expect(map.get('b')?.price).toBe(18);
  });

  it('uses a stored line_id when the entry has one', () => {
    const stored = entry('Eevee', 'Vaporeon', null, { line_id: 'eevee--vaporeon', price: 7 });
    const map = resolveSnapshotEntries([snap('a', 'Eevee', 'Eevee', 'eevee--vaporeon')], [stored]);
    expect(map.get('a')?.price).toBe(7);
  });

  it('falls back to the base for a snapshot without a line id', () => {
    const map = resolveSnapshotEntries([snap('a', 'Charmander', 'Charmeleon')], [CHARIZARD, SAMUROTT]);
    expect(map.get('a')).toBe(CHARIZARD);
  });

  it('disambiguates a shared base by the form used in the match', () => {
    const map = resolveSnapshotEntries([snap('a', 'Oshawott', 'Samurott-Hisui', null)], [SAMUROTT, SAMUROTT_HISUI]);
    expect(map.get('a')).toBe(SAMUROTT_HISUI);
  });

  it('takes the first line of a shared base when the form does not decide', () => {
    const map = resolveSnapshotEntries([snap('a', 'Oshawott', 'Dewott')], [SAMUROTT, SAMUROTT_HISUI]);
    expect(map.get('a')).toBe(SAMUROTT);
  });

  it('falls back to the base when the line id is unknown to the list', () => {
    const map = resolveSnapshotEntries([snap('a', 'Charmander', 'Charmander', 'charmander--charizardmegax')], [CHARIZARD]);
    expect(map.get('a')).toBe(CHARIZARD);
  });

  it('leaves out snapshots whose line is not on the list', () => {
    const map = resolveSnapshotEntries([snap('a', 'Pikachu', 'Pikachu')], [CHARIZARD]);
    expect(map.has('a')).toBe(false);
  });
});

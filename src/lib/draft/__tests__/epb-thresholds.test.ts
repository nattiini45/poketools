import { describe, expect, it, vi } from 'vitest';

// The module also hosts the DB loader; the pure helper under test never touches it.
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/supabase/queries/evolutions', () => ({ getAllTiers: vi.fn() }));
vi.mock('@/lib/supabase/queries/point-buy-lists', () => ({ getListEntries: vi.fn() }));

import { lineThresholdsFromEntries } from '../epb-thresholds';
import type { PointBuyListEntry } from '@/types/point-buy';
import { lineIdOfEntry } from '@/lib/draft/line-identity';

function entry(overrides: Partial<PointBuyListEntry>): PointBuyListEntry {
  const e: Omit<PointBuyListEntry, 'line_id'> & { line_id?: string } = {
    id: 'e-1',
    list_version_id: 'v-1',
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

describe('lineThresholdsFromEntries', () => {
  it('turns per-stage kills into cumulative thresholds and keeps the line id', () => {
    expect(lineThresholdsFromEntries([entry({ line_id: 'charmander--charizard' })])).toEqual([
      {
        line_id: 'charmander--charizard',
        base_pokemon: 'Charmander',
        stage2_pokemon: 'Charmeleon',
        stage3_pokemon: 'Charizard',
        stage2_kos: 3,
        stage3_kos: 7,
      },
    ]);
  });

  it('derives the line id when the entry has none and handles two-stage lines', () => {
    const [line] = lineThresholdsFromEntries([
      entry({ base_pokemon: 'Pawniard', stage2_pokemon: 'Bisharp', stage3_pokemon: null, additional_kills_to_stage3: null }),
    ]);
    expect(line).toMatchObject({ stage3_pokemon: null, stage2_kos: 3, stage3_kos: null });
    expect(typeof line?.line_id).toBe('string');
    expect(line?.line_id).not.toBe('');
  });

  it('applies league overrides (example pack: Dratini 5 / 10 cumulative)', () => {
    const [line] = lineThresholdsFromEntries([
      entry({
        line_id: 'dratini--dragonite',
        base_pokemon: 'Dratini',
        stage2_pokemon: 'Dragonair',
        stage3_pokemon: 'Dragonite',
        kills_to_stage2: 1,
        additional_kills_to_stage3: 1,
      }),
    ]);
    expect(line).toMatchObject({ line_id: 'dratini--dragonite', stage2_kos: 5, stage3_kos: 10 });
  });

  it('keeps branched bases as separate lines, in input order', () => {
    const lines = lineThresholdsFromEntries([
      entry({ line_id: 'oshawott--samurott', base_pokemon: 'Oshawott', stage2_pokemon: 'Dewott', stage3_pokemon: 'Samurott' }),
      entry({ line_id: 'oshawott--samurotthisui', base_pokemon: 'Oshawott', stage2_pokemon: 'Dewott', stage3_pokemon: 'Samurott-Hisui' }),
    ]);
    expect(lines.map((l) => l.line_id)).toEqual(['oshawott--samurott', 'oshawott--samurotthisui']);
  });

  it('returns an empty list for no entries', () => {
    expect(lineThresholdsFromEntries([])).toEqual([]);
  });
});

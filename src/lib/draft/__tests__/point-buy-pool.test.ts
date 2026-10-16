import { describe, it, expect } from 'vitest';
import { pointBuyListToDraftPool, isEntryDrafted } from '../point-buy-pool';
import { lineIdOfEntry } from '../line-identity';
import type { PointBuyListEntry } from '@/types/point-buy';
import type { EvolutionTracker } from '@/types/evolution';

function makeEntry(overrides: Partial<PointBuyListEntry> = {}): PointBuyListEntry {
  const entry: Omit<PointBuyListEntry, 'line_id'> = {
    id: 'entry-1',
    list_version_id: 'list-1',
    line_number: 1,
    base_pokemon: 'Gastly',
    stage2_pokemon: 'Haunter',
    stage3_pokemon: 'Gengar',
    price: 12,
    kills_to_stage2: 5,
    additional_kills_to_stage3: 10,
    price_group: 'hoch',
    early_rating: 7,
    mid_rating: 8,
    late_rating: 9,
    rationale: null,
    historical_data: null,
    special_rules: null,
    special_rules_text: null,
    sources: null,
    legacy_tier: null,
    species_ids: null,
    ...overrides,
  };
  return { ...entry, line_id: overrides.line_id ?? lineIdOfEntry(entry) };
}

function makeTracker(overrides: Partial<EvolutionTracker> = {}): EvolutionTracker {
  return {
    id: 'tracker-1',
    season_id: 'season-1',
    player_id: 'player-1',
    base_pokemon: 'Gastly',
    current_form: 'Haunter',
    total_kos: 6,
    current_stage: 2,
    evolved_at: '2026-01-15T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-15T00:00:00Z',
    real_kills: 5,
    draft_tokens: 1,
    kill_tokens: 0,
    cosmo_points: 0,
    suspended_until_matchday: null,
    evolution_points_awarded: 1,
    locked_stage3_pokemon: null,
    line_id: null,
    transferred_evo_progress: 0,
    redraft_slot_id: null,
    ...overrides,
  };
}

describe('pointBuyListToDraftPool', () => {
  it('converts point-buy entries to draft pool entries', () => {
    const entries = [
      makeEntry({ id: 'e1', line_number: 1, base_pokemon: 'Gastly', price: 12 }),
      makeEntry({ id: 'e2', line_number: 2, base_pokemon: 'Abra', price: 8 }),
    ];

    const pool = pointBuyListToDraftPool(entries, 'season-1');

    expect(pool).toHaveLength(2);
    expect(pool[0].pokemon_name).toBe('Gastly');
    expect(pool[0].stage3_pokemon).toBe('Gengar');
    expect(pool[0].point_cost).toBe(12);
    expect(pool[0].power_tier).toBeNull();
    expect(pool[1].pokemon_name).toBe('Abra');
    expect(pool[1].point_cost).toBe(8);
  });

  it('excludes already-drafted lines by base + stage3 identity', () => {
    const entries = [
      makeEntry({ id: 'e1', line_number: 1, base_pokemon: 'Gastly', stage3_pokemon: 'Gengar' }),
      makeEntry({ id: 'e2', line_number: 2, base_pokemon: 'Abra', stage3_pokemon: 'Alakazam' }),
    ];
    const trackers = [makeTracker({ base_pokemon: 'Gastly', locked_stage3_pokemon: 'Gengar' })];

    const pool = pointBuyListToDraftPool(entries, 'season-1', trackers);

    expect(pool).toHaveLength(1);
    expect(pool[0].pokemon_name).toBe('Abra');
  });

  it('keeps alternate branched lines when only one branch is drafted', () => {
    const entries = [
      makeEntry({ id: 'e1', line_number: 1, base_pokemon: 'Eevee', stage3_pokemon: 'Vaporeon', price: 20 }),
      makeEntry({ id: 'e2', line_number: 2, base_pokemon: 'Eevee', stage3_pokemon: 'Jolteon', price: 18 }),
    ];
    const trackers = [makeTracker({ base_pokemon: 'Eevee', locked_stage3_pokemon: 'Vaporeon' })];

    const pool = pointBuyListToDraftPool(entries, 'season-1', trackers);

    expect(pool).toHaveLength(1);
    expect(pool[0].stage3_pokemon).toBe('Jolteon');
  });

  it('returns empty array when all lines are drafted', () => {
    const entries = [makeEntry({ base_pokemon: 'Gastly' })];
    const trackers = [makeTracker({ base_pokemon: 'Gastly', locked_stage3_pokemon: 'Gengar' })];

    const pool = pointBuyListToDraftPool(entries, 'season-1', trackers);

    expect(pool).toHaveLength(0);
  });
});

describe('isEntryDrafted (trackers without a line id: base + stage-3 branch)', () => {
  it('returns true when a tracker exists for the base + stage3 branch', () => {
    const trackers = [makeTracker({ base_pokemon: 'Gastly', locked_stage3_pokemon: 'Gengar' })];
    expect(isEntryDrafted(makeEntry({ base_pokemon: 'Gastly', stage3_pokemon: 'Gengar' }), trackers)).toBe(true);
  });

  it('returns false when a different branch of the same base is drafted', () => {
    const trackers = [makeTracker({ base_pokemon: 'Eevee', locked_stage3_pokemon: 'Vaporeon' })];
    expect(
      isEntryDrafted(makeEntry({ base_pokemon: 'Eevee', stage2_pokemon: 'Eevee', stage3_pokemon: 'Jolteon' }), trackers),
    ).toBe(false);
  });

  it('returns false when no tracker exists', () => {
    const trackers = [makeTracker({ base_pokemon: 'Gastly', locked_stage3_pokemon: 'Gengar' })];
    expect(
      isEntryDrafted(makeEntry({ base_pokemon: 'Abra', stage2_pokemon: 'Kadabra', stage3_pokemon: 'Alakazam' }), trackers),
    ).toBe(false);
  });
});

describe('isEntryDrafted (line ids)', () => {
  const samurott = makeEntry({ id: 'o1', base_pokemon: 'Oshawott', stage2_pokemon: 'Dewott', stage3_pokemon: 'Samurott' });
  const hisui = makeEntry({ id: 'o2', base_pokemon: 'Oshawott', stage2_pokemon: 'Dewott', stage3_pokemon: 'Samurott-Hisui' });

  it('keys by the tracker line id: the other branch of the base stays draftable', () => {
    const trackers = [makeTracker({ base_pokemon: 'Oshawott', line_id: 'oshawott--samurotthisui' })];
    expect(isEntryDrafted(hisui, trackers)).toBe(true);
    expect(isEntryDrafted(samurott, trackers)).toBe(false);
    expect(pointBuyListToDraftPool([samurott, hisui], 'season-1', trackers).map((e) => e.id)).toEqual(['o1']);
  });

  it('identifies a two-stage line by its line id (no stage 3)', () => {
    const twoStage = makeEntry({ id: 'p1', base_pokemon: 'Pawmi', stage2_pokemon: 'Pawmo', stage3_pokemon: null });
    expect(twoStage.line_id).toBe('pawmi--pawmo');
    expect(isEntryDrafted(twoStage, [makeTracker({ base_pokemon: 'Pawmi', line_id: 'pawmi--pawmo' })])).toBe(true);
  });
});

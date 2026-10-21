import { describe, it, expect } from 'vitest';
import { computeKillTokens } from '@/lib/draft/point-buy-engine';
import { formatLineLabel, lineIdOfEntry, toLineId } from '@/lib/draft/line-identity';
import { pointBuyListToDraftPool, isEntryDrafted } from '@/lib/draft/point-buy-pool';
import { resolveEpbStageTransitions } from '@/lib/match/epb-stage-resolution';
import { toCumulativeThresholds } from '@/lib/draft/special-rules';
import { comebackTokensFromTable } from '@/lib/format-pack';
import type { PointBuyListEntry } from '@/types/point-buy';
import type { EvolutionTracker } from '@/types/evolution';

function makeEntry(overrides: Partial<PointBuyListEntry> = {}): PointBuyListEntry {
  const entry: Omit<PointBuyListEntry, 'line_id'> = {
    id: 'e1',
    list_version_id: 'v1',
    line_number: 1,
    base_pokemon: 'Gastly',
    stage2_pokemon: 'Haunter',
    stage3_pokemon: 'Gengar',
    price: 20,
    kills_to_stage2: 5,
    additional_kills_to_stage3: 10,
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
  return { ...entry, line_id: overrides.line_id ?? lineIdOfEntry(entry) };
}

function makeTracker(overrides: Partial<EvolutionTracker> = {}): EvolutionTracker {
  return {
    id: 't1',
    season_id: 's1',
    player_id: 'p1',
    base_pokemon: 'Gastly',
    current_form: 'Gastly',
    total_kos: 0,
    current_stage: 1,
    evolved_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    real_kills: 0,
    draft_tokens: 0,
    kill_tokens: 0,
    cosmo_points: 0,
    suspended_until_matchday: null,
    evolution_points_awarded: 0,
    locked_stage3_pokemon: null,
    line_id: null,
    transferred_evo_progress: 0,
    redraft_slot_id: null,
    ...overrides,
  };
}

describe('EPB regression — branched lines', () => {
  it('keeps Gardevoir and Gallade as separate draft options', () => {
    const entries = [
      makeEntry({
        id: 'gar',
        base_pokemon: 'Ralts',
        stage2_pokemon: 'Kirlia',
        stage3_pokemon: 'Gardevoir',
        price: 24,
      }),
      makeEntry({
        id: 'gal',
        line_number: 2,
        base_pokemon: 'Ralts',
        stage2_pokemon: 'Kirlia',
        stage3_pokemon: 'Gallade',
        price: 18,
      }),
    ];
    const pool = pointBuyListToDraftPool(entries, 's1', []);
    expect(pool).toHaveLength(2);
    expect(pool.map((p) => p.stage3_pokemon).sort()).toEqual(['Gallade', 'Gardevoir']);
  });

  it('drafting Gardevoir does not block Gallade', () => {
    const trackers = [
      makeTracker({
        base_pokemon: 'Ralts',
        locked_stage3_pokemon: 'Gardevoir',
        current_form: 'Ralts',
      }),
    ];
    const ralts = { base_pokemon: 'Ralts', stage2_pokemon: 'Kirlia' };
    expect(isEntryDrafted(makeEntry({ ...ralts, stage3_pokemon: 'Gardevoir' }), trackers)).toBe(true);
    expect(isEntryDrafted(makeEntry({ ...ralts, stage3_pokemon: 'Gallade' }), trackers)).toBe(false);
    expect(toLineId('Ralts', 'Gardevoir')).not.toBe(toLineId('Ralts', 'Gallade'));
    expect(formatLineLabel('Ralts', 'Gardevoir')).toBe('Ralts → Gardevoir');
  });
});

describe('EPB regression — sheet 3/8', () => {
  it('uses cumulative 11 thresholds', () => {
    expect(toCumulativeThresholds(3, 8)).toEqual({ stage2_kos: 3, stage3_kos: 11 });
  });
});

describe('EPB regression — kill tokens (surviving Pokémon)', () => {
  it('maps shutout survivor scorelines through the pack comeback table', () => {
    for (let winner = 0; winner <= 6; winner++) {
      expect(computeKillTokens(0, winner)).toBe(comebackTokensFromTable(0, winner));
    }
    // example pack: 0:4 and better earn 1
    expect(computeKillTokens(0, 3)).toBe(0);
    expect(computeKillTokens(0, 4)).toBe(1);
    expect(computeKillTokens(0, 6)).toBe(1);
  });

  it('ignores non-shutouts', () => {
    expect(computeKillTokens(1, 5)).toBe(0);
  });
});

describe('EPB regression — instant-final-stage double evolution', () => {
  it('emits Charjabug then Vikavolt (example pack instant-final-stage line)', () => {
    const line = {
      base_pokemon: 'Grubbin',
      stage2_pokemon: 'Charjabug',
      stage3_pokemon: 'Vikavolt',
      stage2_kos: 1,
      stage3_kos: 1,
    };
    const transitions = resolveEpbStageTransitions(line, 1, 'Grubbin', 1);
    expect(transitions).toEqual([
      { form: 'Charjabug', stage: 2 },
      { form: 'Vikavolt', stage: 3 },
    ]);
  });
});

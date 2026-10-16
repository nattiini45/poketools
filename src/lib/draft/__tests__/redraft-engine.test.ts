import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ─────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/queries/evolutions', () => ({
  getSeasonTrackers: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/point-buy-lists', () => ({
  getListEntries: vi.fn(),
}));

// ─── Import after mocks ────────────────────────────────────────────

import { prepareRedraftSwap, getFreeLines } from '../redraft-engine';
import { entryForTracker } from '../point-buy-pool';
import { lineIdOfEntry } from '../line-identity';
import { getSeasonTrackers } from '@/lib/supabase/queries/evolutions';
import { getListEntries } from '@/lib/supabase/queries/point-buy-lists';
import type { EvolutionTracker } from '@/types/evolution';
import type { PointBuyListEntry } from '@/types/point-buy';

const mockGetTrackers = vi.mocked(getSeasonTrackers);
const mockGetEntries = vi.mocked(getListEntries);

// ─── Fixtures ──────────────────────────────────────────────────────

function makeTracker(overrides: Partial<EvolutionTracker> = {}): EvolutionTracker {
  return {
    id: 'tracker-1',
    season_id: 's1',
    player_id: 'p1',
    base_pokemon: 'Gastly',
    current_form: 'Haunter',
    total_kos: 14,
    current_stage: 2,
    evolved_at: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    real_kills: 14,
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

function makeEntry(overrides: Partial<PointBuyListEntry> = {}): PointBuyListEntry {
  const entry: Omit<PointBuyListEntry, 'line_id'> & { line_id?: string } = {
    id: 'entry-1',
    list_version_id: 'list-1',
    line_number: 1,
    base_pokemon: 'Axew',
    stage2_pokemon: 'Fraxure',
    stage3_pokemon: 'Haxorus',
    price: 20,
    kills_to_stage2: 4,
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
  return { ...entry, line_id: overrides.line_id ?? lineIdOfEntry({ ...entry, line_id: null }) };
}

/** Gastly line entry: 5 to stage 2, 10 more to stage 3 (cumulative 15). */
const gastlyEntry = makeEntry({
  id: 'entry-gastly',
  base_pokemon: 'Gastly',
  stage2_pokemon: 'Haunter',
  stage3_pokemon: 'Gengar',
  price: 20,
  kills_to_stage2: 5,
  additional_kills_to_stage3: 10,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGetEntries.mockResolvedValue([gastlyEntry, makeEntry()]);
});

// ─── prepareRedraftSwap (trades) ───────────────────────────────────
// The free-swap execution path (executeRedraft) is retired; trades build their
// payloads with prepareRedraftSwap and run them through the consent route.

function prepareTrade(overrides: Partial<Parameters<typeof prepareRedraftSwap>[0]> = {}) {
  return prepareRedraftSwap({
    season_id: 's1',
    player_id: 'p1',
    from_tracker_id: 'tracker-1',
    to_line: makeEntry(),
    transfer_type: 'trade',
    trade_partner_id: 'p2',
    remaining_points: 0,
    ...overrides,
  });
}

describe('prepareRedraftSwap — trade side', () => {
  it('blocks acquiring the participation line via a trade', async () => {
    const result = await prepareTrade({
      to_line: makeEntry({ base_pokemon: 'Dratini', special_rules: { cosmog: true, no_redraft: true } }),
      remaining_points: 10,
    });

    expect(result.swap).toBeUndefined();
    expect(result.error).toContain('cannot be obtained via redraft');
    expect(result.refusal).toEqual({ code: 'redraft_line_excluded', params: { pokemon: 'Dratini' } });
  });

  it('rejects upgrade without enough remaining points', async () => {
    mockGetTrackers.mockResolvedValue([makeTracker()]);

    const result = await prepareTrade({
      to_line: makeEntry({ price: 30 }), // Gastly costs 20 → upgrade costs 10
      remaining_points: 5,
    });

    expect(result.swap).toBeUndefined();
    expect(result.error).toContain('Not enough points');
    expect(result.refusal).toEqual({
      code: 'redraft_insufficient_points',
      params: { cost: 10, remaining: 5 },
    });
  });

  it('builds the payload with the target line id and the trade history', async () => {
    mockGetTrackers.mockResolvedValue([makeTracker()]);

    const result = await prepareTrade();

    expect(result.swap?.points_spent).toBe(0);
    expect(result.swap?.payload).toMatchObject({
      player_id: 'p1',
      from_tracker_id: 'tracker-1',
      new_tracker: { base_pokemon: 'Axew', line_id: 'axew--haxorus' },
      history: { to_base_pokemon: 'Axew', transfer_type: 'trade', trade_partner_id: 'p2' },
    });
  });

  it('stores transferred progress in transferred_evo_progress, never in real_kills', async () => {
    // Haunter (stage 2) at 14/15 cumulative → 1 missing kill to Gengar.
    // New line Axew/Fraxure/Haxorus: 10 additional to stage 3 → starts at 9/10.
    // Cumulative total: stage2 (4) + 9 = 13.
    mockGetTrackers.mockResolvedValue([makeTracker({ evolution_points_awarded: 2 })]);

    const result = await prepareTrade();

    expect(result.swap?.payload.new_tracker).toEqual({
      base_pokemon: 'Axew',
      current_form: 'Fraxure',
      current_stage: 2,
      total_kos: 13,
      real_kills: 0, // self-earned kills of the new line: none yet (public kill ranking)
      transferred_evo_progress: 13, // invariant: total = sum of the five sources
      line_id: 'axew--haxorus',
      evolution_points_awarded: 2, // player-level counter survives the trade
      locked_stage3_pokemon: 'Haxorus', // branch locked from the target entry
    });
  });

  it('fully evolved line stays fully evolved', async () => {
    mockGetTrackers.mockResolvedValue([
      makeTracker({ current_form: 'Gengar', current_stage: 3, total_kos: 15 }),
    ]);

    const result = await prepareTrade();

    expect(result.swap?.payload.new_tracker).toMatchObject({
      current_form: 'Haxorus',
      current_stage: 3,
      total_kos: 14,
      transferred_evo_progress: 14,
    });
  });

  it('clamps a fully evolved source to stage 2 on a 2-stage target line', async () => {
    mockGetTrackers.mockResolvedValue([
      makeTracker({ current_form: 'Gengar', current_stage: 3, total_kos: 15 }),
    ]);

    // 2-stage line: no stage 3 form
    const result = await prepareTrade({
      to_line: makeEntry({ stage3_pokemon: null, additional_kills_to_stage3: null }),
    });

    expect(result.swap?.payload.new_tracker).toMatchObject({
      current_form: 'Fraxure',
      current_stage: 2, // clamped — a 2-stage line cannot be stage 3
      total_kos: 4,
      line_id: 'axew--fraxure',
    });
  });

  it('rejects trading a line the player does not own', async () => {
    mockGetTrackers.mockResolvedValue([makeTracker({ player_id: 'p2' })]);

    const result = await prepareTrade();

    expect(result.swap).toBeUndefined();
    expect(result.error).toContain('do not own');
    expect(result.refusal).toEqual({ code: 'redraft_line_not_owned' });
  });

  it('prices the source by its line id when a base has two branches', async () => {
    // The player holds Oshawott → Samurott-Hisui (price 24); the other branch costs 12.
    mockGetEntries.mockResolvedValue([
      makeEntry({ id: 'osha-1', base_pokemon: 'Oshawott', stage2_pokemon: 'Dewott', stage3_pokemon: 'Samurott', price: 12 }),
      makeEntry({ id: 'osha-2', base_pokemon: 'Oshawott', stage2_pokemon: 'Dewott', stage3_pokemon: 'Samurott-Hisui', price: 24 }),
      makeEntry(),
    ]);
    mockGetTrackers.mockResolvedValue([
      makeTracker({
        base_pokemon: 'Oshawott',
        current_form: 'Oshawott',
        current_stage: 1,
        total_kos: 0,
        real_kills: 0,
        line_id: 'oshawott--samurotthisui',
        locked_stage3_pokemon: null,
      }),
    ]);

    // Axew costs 20: a downgrade from 24 (free), but an upgrade from 12 would cost 8.
    const result = await prepareTrade({ remaining_points: 0 });

    expect(result.swap?.points_spent).toBe(0);
  });
});

// ─── prepareRedraftSwap (instant stage 3) ──────────────────────────

describe('prepareRedraftSwap', () => {
  it('resolves instant stage 3 when the target needs 0 additional kills (instant-final-stage line)', async () => {
    // Source is stage 2 with missing kills; target has additional_kills_to_stage3 = 0
    mockGetTrackers.mockResolvedValue([makeTracker()]);

    const prepared = await prepareRedraftSwap({
      season_id: 's1',
      player_id: 'p1',
      from_tracker_id: 'tracker-1',
      to_line: makeEntry({
        base_pokemon: 'Grubbin',
        stage2_pokemon: 'Charjabug',
        stage3_pokemon: 'Vikavolt',
        kills_to_stage2: 1,
        additional_kills_to_stage3: 0,
        special_rules: { scatterbug: true },
        price: 8,
      }),
      transfer_type: 'trade',
      remaining_points: 0,
    });

    expect(prepared.swap).toBeDefined();
    expect(prepared.swap?.payload.new_tracker).toMatchObject({
      base_pokemon: 'Grubbin',
      current_form: 'Vikavolt',
      current_stage: 3,
      total_kos: 1, // cumulative stage-3 threshold (1 + 0)
    });
  });
});

// ─── getFreeLines ──────────────────────────────────────────────────

describe('getFreeLines', () => {
  it('excludes lines already drafted by any player', async () => {
    mockGetTrackers.mockResolvedValue([makeTracker({ base_pokemon: 'Gastly', locked_stage3_pokemon: 'Gengar' })]);

    const free = await getFreeLines('s1', 'list-1');

    expect(free.map((e) => e.base_pokemon)).toEqual(['Axew']);
  });

  it('keeps alternate branches when only one branched line is drafted', async () => {
    mockGetEntries.mockResolvedValue([
      makeEntry({ id: 'e1', base_pokemon: 'Eevee', stage3_pokemon: 'Vaporeon' }),
      makeEntry({ id: 'e2', base_pokemon: 'Eevee', stage3_pokemon: 'Jolteon' }),
    ]);
    mockGetTrackers.mockResolvedValue([
      makeTracker({ base_pokemon: 'Eevee', locked_stage3_pokemon: 'Vaporeon' }),
    ]);

    const free = await getFreeLines('s1', 'list-1');

    expect(free).toHaveLength(1);
    expect(free[0].stage3_pokemon).toBe('Jolteon');
  });

  it('keys drafted lines by line_id (a tracker without a locked stage 3 still blocks only its own branch)', async () => {
    mockGetEntries.mockResolvedValue([
      makeEntry({ id: 'o1', base_pokemon: 'Oshawott', stage2_pokemon: 'Dewott', stage3_pokemon: 'Samurott' }),
      makeEntry({ id: 'o2', base_pokemon: 'Oshawott', stage2_pokemon: 'Dewott', stage3_pokemon: 'Samurott-Hisui' }),
    ]);
    mockGetTrackers.mockResolvedValue([
      makeTracker({ base_pokemon: 'Oshawott', line_id: 'oshawott--samurotthisui', locked_stage3_pokemon: null }),
    ]);

    const free = await getFreeLines('s1', 'list-1');

    expect(free.map((e) => e.line_id)).toEqual(['oshawott--samurott']);
  });
});

// ─── entryForTracker ───────────────────────────────────────────────

describe('entryForTracker', () => {
  const branches = [
    makeEntry({ id: 'o1', base_pokemon: 'Oshawott', stage2_pokemon: 'Dewott', stage3_pokemon: 'Samurott' }),
    makeEntry({ id: 'o2', base_pokemon: 'Oshawott', stage2_pokemon: 'Dewott', stage3_pokemon: 'Samurott-Hisui' }),
  ];

  it('resolves by line id', () => {
    const tracker = makeTracker({ base_pokemon: 'Oshawott', line_id: 'oshawott--samurotthisui' });
    expect(entryForTracker(tracker, branches)?.id).toBe('o2');
  });

  it('falls back to base + locked stage 3 for a legacy tracker', () => {
    const tracker = makeTracker({ base_pokemon: 'Oshawott', line_id: null, locked_stage3_pokemon: 'Samurott-Hisui' });
    expect(entryForTracker(tracker, branches)?.id).toBe('o2');
  });
});

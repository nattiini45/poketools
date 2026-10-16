import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ─────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/queries/evolutions', () => ({
  getSeasonTrackers: vi.fn(),
  getAllTiers: vi.fn(),
  getSeasonKosForLine: vi.fn(),
  updateTracker: vi.fn(),
}));

// isEvoLeague's fast-path queries seasons.format_type via the supabase client;
// mock it so unit tests never issue real network I/O.
const mockMaybeSingle = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: (...args: unknown[]) => mockMaybeSingle(...args),
        }),
      }),
    }),
  },
}));

// ─── Import after mocks ────────────────────────────────────────────

import { checkEvolutions, checkPlayerEvolutions, validateEvoLeaguePick, isEvoLeague } from '../evolution-engine';
import {
  getSeasonTrackers,
  getAllTiers,
  getSeasonKosForLine,
  updateTracker,
} from '@/lib/supabase/queries/evolutions';
import type { EvolutionTier, EvolutionTracker } from '@/types/evolution';

const mockGetTrackers = vi.mocked(getSeasonTrackers);
const mockGetAllTiers = vi.mocked(getAllTiers);
const mockGetKosForLine = vi.mocked(getSeasonKosForLine);
const mockUpdateTracker = vi.mocked(updateTracker);

// ─── Fixtures ──────────────────────────────────────────────────────

function makeTier(overrides: Partial<EvolutionTier> = {}): EvolutionTier {
  return {
    id: 'tier-1',
    season_id: 's1',
    player_id: null,
    base_pokemon: 'Charmander',
    stage2_pokemon: 'Charmeleon',
    stage2_kos: 3,
    stage3_pokemon: 'Charizard',
    stage3_kos: 8,
    power_tier: 'A',
    created_at: '2024-01-01',
    ...overrides,
  };
}

function makeTracker(overrides: Partial<EvolutionTracker> = {}): EvolutionTracker {
  return {
    id: 'tracker-1',
    season_id: 's1',
    player_id: 'p1',
    base_pokemon: 'Charmander',
    current_form: 'Charmander',
    total_kos: 0,
    current_stage: 1,
    evolved_at: null,
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
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

// ─── Tests ─────────────────────────────────────────────────────────

describe('checkEvolutions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty when no tiers configured', async () => {
    mockGetTrackers.mockResolvedValue([makeTracker()] as never);
    mockGetAllTiers.mockResolvedValue([] as never);
    const events = await checkEvolutions('s1');
    expect(events).toEqual([]);
  });

  it('returns empty when no trackers exist', async () => {
    mockGetTrackers.mockResolvedValue([] as never);
    mockGetAllTiers.mockResolvedValue([makeTier()] as never);
    const events = await checkEvolutions('s1');
    expect(events).toEqual([]);
  });

  it('evolves to stage 2 when KO threshold met', async () => {
    mockGetTrackers.mockResolvedValue([makeTracker()] as never);
    mockGetAllTiers.mockResolvedValue([makeTier()] as never);
    mockGetKosForLine.mockResolvedValue(5 as never);

    const events = await checkEvolutions('s1');

    expect(events).toHaveLength(1);
    expect(events[0].new_form).toBe('Charmeleon');
    expect(events[0].new_stage).toBe(2);
    expect(events[0].is_devolution).toBe(false);
    expect(mockUpdateTracker).toHaveBeenCalledWith('tracker-1', expect.objectContaining({
      current_form: 'Charmeleon',
      current_stage: 2,
    }));
  });

  it('evolves to stage 3 when KO threshold met', async () => {
    mockGetTrackers.mockResolvedValue([makeTracker({ current_form: 'Charmeleon', current_stage: 2, total_kos: 5 })] as never);
    mockGetAllTiers.mockResolvedValue([makeTier()] as never);
    mockGetKosForLine.mockResolvedValue(10 as never);

    const events = await checkEvolutions('s1');

    expect(events).toHaveLength(1);
    expect(events[0].new_form).toBe('Charizard');
    expect(events[0].new_stage).toBe(3);
  });

  it('handles devolution when KOs decrease (match undo)', async () => {
    mockGetTrackers.mockResolvedValue([
      makeTracker({ current_form: 'Charmeleon', current_stage: 2, total_kos: 5 }),
    ] as never);
    mockGetAllTiers.mockResolvedValue([makeTier()] as never);
    mockGetKosForLine.mockResolvedValue(1 as never); // Below stage2 threshold

    const events = await checkEvolutions('s1');

    expect(events).toHaveLength(1);
    expect(events[0].new_form).toBe('Charmander');
    expect(events[0].new_stage).toBe(1);
    expect(events[0].is_devolution).toBe(true);
  });

  it('updates tracker even when only KO count changes (no form change)', async () => {
    mockGetTrackers.mockResolvedValue([makeTracker({ total_kos: 1 })] as never);
    mockGetAllTiers.mockResolvedValue([makeTier()] as never);
    mockGetKosForLine.mockResolvedValue(2 as never); // Still stage 1 but KO count changed

    const events = await checkEvolutions('s1');

    // No form change event
    expect(events).toHaveLength(0);
    // But tracker still updated with new KO count
    expect(mockUpdateTracker).toHaveBeenCalledWith('tracker-1', expect.objectContaining({
      total_kos: 2,
    }));
  });

  it('skips tracker with no matching tier', async () => {
    mockGetTrackers.mockResolvedValue([makeTracker({ base_pokemon: 'Magikarp' })] as never);
    mockGetAllTiers.mockResolvedValue([makeTier()] as never); // Only Charmander tier

    const events = await checkEvolutions('s1');

    expect(events).toEqual([]);
    expect(mockUpdateTracker).not.toHaveBeenCalled();
  });

  it('prefers player-specific tier over general tier', async () => {
    const generalTier = makeTier({ stage2_kos: 3 });
    const playerTier = makeTier({ id: 'tier-2', player_id: 'p1', stage2_kos: 1 });

    mockGetTrackers.mockResolvedValue([makeTracker()] as never);
    mockGetAllTiers.mockResolvedValue([generalTier, playerTier] as never);
    mockGetKosForLine.mockResolvedValue(2 as never);

    const events = await checkEvolutions('s1');

    expect(events).toHaveLength(1);
    expect(events[0].new_form).toBe('Charmeleon');
  });

  it('handles two-stage evolution lines (no stage3)', async () => {
    const tier = makeTier({ stage3_pokemon: null, stage3_kos: null });
    mockGetTrackers.mockResolvedValue([makeTracker()] as never);
    mockGetAllTiers.mockResolvedValue([tier] as never);
    mockGetKosForLine.mockResolvedValue(5 as never);

    const events = await checkEvolutions('s1');

    expect(events).toHaveLength(1);
    expect(events[0].new_form).toBe('Charmeleon');
    expect(events[0].new_stage).toBe(2);
  });
});

describe('checkPlayerEvolutions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('only checks trackers for the specified player', async () => {
    const p1Tracker = makeTracker({ player_id: 'p1' });
    const p2Tracker = makeTracker({ id: 'tracker-2', player_id: 'p2', base_pokemon: 'Squirtle' });

    mockGetTrackers.mockResolvedValue([p1Tracker, p2Tracker] as never);
    mockGetAllTiers.mockResolvedValue([makeTier()] as never);
    mockGetKosForLine.mockResolvedValue(5 as never);

    const events = await checkPlayerEvolutions('s1', 'p1');

    expect(events).toHaveLength(1);
    expect(events[0].player_id).toBe('p1');
    // getSeasonKosForLine called once (only for p1's tracker)
    expect(mockGetKosForLine).toHaveBeenCalledTimes(1);
  });

  it('returns empty when player has no trackers', async () => {
    mockGetTrackers.mockResolvedValue([makeTracker({ player_id: 'p2' })] as never);
    mockGetAllTiers.mockResolvedValue([makeTier()] as never);

    const events = await checkPlayerEvolutions('s1', 'p1');
    expect(events).toEqual([]);
  });
});

describe('validateEvoLeaguePick', () => {
  const tiers: EvolutionTier[] = [
    makeTier({ base_pokemon: 'Charmander', player_id: null }),
    makeTier({ id: 'tier-2', base_pokemon: 'Pikachu', player_id: 'p1' }),
  ];

  it('returns null for valid tier list pick', () => {
    expect(validateEvoLeaguePick('Charmander', tiers, 'p1')).toBeNull();
  });

  it('returns null for valid wildcard pick assigned to player', () => {
    expect(validateEvoLeaguePick('Pikachu', tiers, 'p1')).toBeNull();
  });

  it('returns error for wildcard assigned to different player', () => {
    const result = validateEvoLeaguePick('Pikachu', tiers, 'p2');
    expect(result).toContain('not a valid base-form');
  });

  it('returns error for unknown pokemon', () => {
    const result = validateEvoLeaguePick('Magikarp', tiers, 'p1');
    expect(result).toContain('not a valid base-form');
  });
});

describe('isEvoLeague', () => {
  it('returns true when tiers exist', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { format_type: 'draft' }, error: null });
    mockGetAllTiers.mockResolvedValue([makeTier()] as never);
    expect(await isEvoLeague('s1')).toBe(true);
  });

  it('returns false when no tiers exist', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { format_type: 'draft' }, error: null });
    mockGetAllTiers.mockResolvedValue([] as never);
    expect(await isEvoLeague('s1')).toBe(false);
  });

  it('fast-path: returns true for evolution_point_buy without checking tiers', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { format_type: 'evolution_point_buy' }, error: null });
    mockGetAllTiers.mockClear();
    expect(await isEvoLeague('s1')).toBe(true);
    expect(mockGetAllTiers).not.toHaveBeenCalled();
  });
});

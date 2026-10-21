import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ─────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/queries/evolutions', () => ({
  getSeasonTrackers: vi.fn(),
}));

// ─── Import after mocks ────────────────────────────────────────────

import { getRedraftEligibleLines } from '../redraft-engine';
import { entryForTracker } from '../point-buy-pool';
import { lineIdOfEntry } from '../line-identity';
import { getSeasonTrackers } from '@/lib/supabase/queries/evolutions';
import type { EvolutionTracker } from '@/types/evolution';
import type { PointBuyListEntry } from '@/types/point-buy';

const mockGetTrackers = vi.mocked(getSeasonTrackers);

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
});

// ─── getRedraftEligibleLines ───────────────────────────────────────

describe('getRedraftEligibleLines', () => {
  it("returns only the player's own lines", async () => {
    mockGetTrackers.mockResolvedValue([
      makeTracker({ id: 'mine', player_id: 'p1', line_id: gastlyEntry.line_id }),
      makeTracker({ id: 'theirs', player_id: 'p2', line_id: gastlyEntry.line_id }),
    ]);
    const lines = await getRedraftEligibleLines('s1', 'p1', [gastlyEntry]);
    expect(lines.map((t) => t.id)).toEqual(['mine']);
    expect(mockGetTrackers).toHaveBeenCalledWith('s1');
  });

  it('drops a redraft-locked line (no_redraft special rule)', async () => {
    const locked = makeEntry({ id: 'entry-locked', special_rules: { no_redraft: true } });
    mockGetTrackers.mockResolvedValue([
      makeTracker({ id: 'free', base_pokemon: 'Gastly', line_id: gastlyEntry.line_id }),
      makeTracker({ id: 'locked', base_pokemon: 'Axew', line_id: locked.line_id }),
    ]);
    const lines = await getRedraftEligibleLines('s1', 'p1', [gastlyEntry, locked]);
    expect(lines.map((t) => t.id)).toEqual(['free']);
  });

  it('propagates a tracker read failure', async () => {
    mockGetTrackers.mockRejectedValue(new Error('read failed'));
    await expect(getRedraftEligibleLines('s1', 'p1', [gastlyEntry])).rejects.toThrow('read failed');
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

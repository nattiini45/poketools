import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks (before imports) ─────────────────────────────────────────

vi.mock('@/lib/supabase/queries/aggregates', () => ({
  getAllTimePlayerAggregates: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/signatures', () => ({
  getPlayerSignatures: vi.fn(),
  upsertPlayerSignatures: vi.fn(),
}));

import { updateSignatures } from '../signatures';
import { getAllTimePlayerAggregates } from '@/lib/supabase/queries/aggregates';
import { getPlayerSignatures, upsertPlayerSignatures } from '@/lib/supabase/queries/signatures';
import { SIGNATURE_THRESHOLDS } from '@/types/signature';

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Helpers ────────────────────────────────────────────────────────

function makeAggregate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agg-1',
    player_id: 'player-1',
    scope_type: 'tournament' as const,
    scope_id: 't1',
    pokemon_name: 'Pikachu',
    total_appearances: 15,
    total_brought: 15,
    total_led: 0,
    total_kos_dealt: 30,
    total_koed: 5,
    total_wins: 10,
    total_games: 15,
    move_counts: {},
    last_updated: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

// ─── updateSignatures ───────────────────────────────────────────────

describe('updateSignatures', () => {
  it('returns empty signatures when no pokemon meet the minimum threshold', async () => {
    vi.mocked(getAllTimePlayerAggregates).mockResolvedValue([
      makeAggregate({ pokemon_name: 'Pikachu', total_brought: 5 }), // Below 10
    ]);

    vi.mocked(getPlayerSignatures).mockResolvedValue(null);
    vi.mocked(upsertPlayerSignatures).mockResolvedValue({ signatures: [] } as never as never as never);

    const result = await updateSignatures('player-1');
    expect(result).toEqual([]);
    expect(upsertPlayerSignatures).toHaveBeenCalledWith('player-1', []);
  });

  it('assigns slot 1 when pokemon meets first threshold (10 games)', async () => {
    vi.mocked(getAllTimePlayerAggregates).mockResolvedValue([
      makeAggregate({ pokemon_name: 'Pikachu', total_brought: 12, total_wins: 8, total_games: 12, total_kos_dealt: 20, player_id: 'p1', id: 'agg-1', scope_type: 'tournament' as const, scope_id: 't1', total_appearances: 12, total_led: 0, total_koed: 0, move_counts: {}, last_updated: '2024-01-01T00:00:00Z' }),
    ]);

    vi.mocked(getPlayerSignatures).mockResolvedValue(null);
    vi.mocked(upsertPlayerSignatures).mockImplementation(
      async (_pid, sigs) => ({ signatures: sigs } as ReturnType<typeof upsertPlayerSignatures> extends Promise<infer T> ? T : never)
    );

    const result = await updateSignatures('player-1');

    expect(result).toHaveLength(1);
    expect(result[0].pokemon_name).toBe('Pikachu');
    expect(result[0].slot_number).toBe(1);
    expect(result[0].games_played).toBe(12);
    expect(result[0].total_kos).toBe(20);
    // win_rate = 8/12 = 0.6667
    expect(result[0].win_rate).toBeCloseTo(0.6667, 3);
  });

  it('assigns multiple slots based on thresholds', async () => {
    // Thresholds: slot 1 = 10, slot 2 = 15, slot 3 = 20
    // Each candidate at index N must meet SIGNATURE_THRESHOLDS[N]
    vi.mocked(getAllTimePlayerAggregates).mockResolvedValue([
      makeAggregate({ pokemon_name: 'Pikachu', total_brought: 30, total_wins: 20, total_games: 30, total_kos_dealt: 60, player_id: 'p1', id: 'agg-1', scope_type: 'tournament' as const, scope_id: 't1', total_appearances: 30, total_led: 0, total_koed: 0, move_counts: {}, last_updated: '2024-01-01T00:00:00Z' }),
      makeAggregate({ pokemon_name: 'Charizard', total_brought: 25, total_wins: 15, total_games: 25, total_kos_dealt: 40, player_id: 'p1', id: 'agg-1', scope_type: 'tournament' as const, scope_id: 't1', total_appearances: 25, total_led: 0, total_koed: 0, move_counts: {}, last_updated: '2024-01-01T00:00:00Z' }),
      makeAggregate({ pokemon_name: 'Blastoise', total_brought: 22, total_wins: 12, total_games: 22, total_kos_dealt: 30, player_id: 'p1', id: 'agg-1', scope_type: 'tournament' as const, scope_id: 't1', total_appearances: 22, total_led: 0, total_koed: 0, move_counts: {}, last_updated: '2024-01-01T00:00:00Z' }),
    ]);

    vi.mocked(getPlayerSignatures).mockResolvedValue(null);
    vi.mocked(upsertPlayerSignatures).mockImplementation(
      async (_pid, sigs) => ({ signatures: sigs } as ReturnType<typeof upsertPlayerSignatures> extends Promise<infer T> ? T : never)
    );

    const result = await updateSignatures('player-1');

    // Pikachu(30) >= slot1(10), Charizard(25) >= slot2(15), Blastoise(22) >= slot3(20)
    expect(result).toHaveLength(3);
    expect(result[0].pokemon_name).toBe('Pikachu');
    expect(result[0].slot_number).toBe(1);
    expect(result[1].pokemon_name).toBe('Charizard');
    expect(result[1].slot_number).toBe(2);
    expect(result[2].pokemon_name).toBe('Blastoise');
    expect(result[2].slot_number).toBe(3);
  });

  it('skips slots where candidate does not meet the threshold', async () => {
    // Only 1 pokemon, meets threshold 1 (10) but not threshold 2 (15)
    vi.mocked(getAllTimePlayerAggregates).mockResolvedValue([
      makeAggregate({ pokemon_name: 'Pikachu', total_brought: 12 }),
    ]);

    vi.mocked(getPlayerSignatures).mockResolvedValue(null);
    vi.mocked(upsertPlayerSignatures).mockImplementation(
      async (_pid, sigs) => ({ signatures: sigs } as ReturnType<typeof upsertPlayerSignatures> extends Promise<infer T> ? T : never)
    );

    const result = await updateSignatures('player-1');

    expect(result).toHaveLength(1);
    expect(result[0].slot_number).toBe(1);
  });

  it('preserves unlocked_at for unchanged pokemon in existing slots', async () => {
    const existingDate = '2024-06-01T00:00:00.000Z';

    vi.mocked(getAllTimePlayerAggregates).mockResolvedValue([
      makeAggregate({ pokemon_name: 'Pikachu', total_brought: 12 }),
    ]);

    vi.mocked(getPlayerSignatures).mockResolvedValue({
      id: 'sig-1',
      player_id: 'player-1',
      signatures: [
        {
          pokemon_name: 'Pikachu',
          games_played: 10,
          win_rate: 0.6,
          total_kos: 15,
          slot_number: 1,
          unlocked_at: existingDate,
        },
      ],
      updated_at: '2024-06-01',
    });

    vi.mocked(upsertPlayerSignatures).mockImplementation(
      async (_pid, sigs) => ({ signatures: sigs } as ReturnType<typeof upsertPlayerSignatures> extends Promise<infer T> ? T : never)
    );

    const result = await updateSignatures('player-1');

    expect(result[0].unlocked_at).toBe(existingDate);
  });

  it('updates unlocked_at when pokemon changes in a slot', async () => {
    vi.mocked(getAllTimePlayerAggregates).mockResolvedValue([
      makeAggregate({ pokemon_name: 'Charizard', total_brought: 20 }),
    ]);

    vi.mocked(getPlayerSignatures).mockResolvedValue({
      id: 'sig-1',
      player_id: 'player-1',
      signatures: [
        {
          pokemon_name: 'Pikachu',
          games_played: 10,
          win_rate: 0.6,
          total_kos: 15,
          slot_number: 1,
          unlocked_at: '2024-01-01T00:00:00.000Z',
        },
      ],
      updated_at: '2024-01-01',
    });

    vi.mocked(upsertPlayerSignatures).mockImplementation(
      async (_pid, sigs) => ({ signatures: sigs } as ReturnType<typeof upsertPlayerSignatures> extends Promise<infer T> ? T : never)
    );

    const result = await updateSignatures('player-1');

    expect(result[0].pokemon_name).toBe('Charizard');
    // unlocked_at should be a new date (not the old one)
    expect(result[0].unlocked_at).not.toBe('2024-01-01T00:00:00.000Z');
  });

  it('sorts candidates by total_brought then win_rate', async () => {
    vi.mocked(getAllTimePlayerAggregates).mockResolvedValue([
      makeAggregate({ pokemon_name: 'Blastoise', total_brought: 15, total_wins: 12, total_games: 15 }),
      makeAggregate({ pokemon_name: 'Pikachu', total_brought: 15, total_wins: 5, total_games: 15 }),
      makeAggregate({ pokemon_name: 'Charizard', total_brought: 20, total_wins: 10, total_games: 20 }),
    ]);

    vi.mocked(getPlayerSignatures).mockResolvedValue(null);
    vi.mocked(upsertPlayerSignatures).mockImplementation(
      async (_pid, sigs) => ({ signatures: sigs } as ReturnType<typeof upsertPlayerSignatures> extends Promise<infer T> ? T : never)
    );

    const result = await updateSignatures('player-1');

    // Charizard(20) first, then Blastoise(15, higher win rate) before Pikachu(15, lower win rate)
    expect(result[0].pokemon_name).toBe('Charizard');
    expect(result[1].pokemon_name).toBe('Blastoise');
  });

  it('computes win_rate as 0 when total_games is 0', async () => {
    vi.mocked(getAllTimePlayerAggregates).mockResolvedValue([
      makeAggregate({ pokemon_name: 'Pikachu', total_brought: 10, total_wins: 0, total_games: 0 }),
    ]);

    vi.mocked(getPlayerSignatures).mockResolvedValue(null);
    vi.mocked(upsertPlayerSignatures).mockImplementation(
      async (_pid, sigs) => ({ signatures: sigs } as ReturnType<typeof upsertPlayerSignatures> extends Promise<infer T> ? T : never)
    );

    const result = await updateSignatures('player-1');

    expect(result[0].win_rate).toBe(0);
  });

  it('verifies SIGNATURE_THRESHOLDS has 6 entries', () => {
    expect(SIGNATURE_THRESHOLDS).toHaveLength(6);
    expect(SIGNATURE_THRESHOLDS[0]).toBe(10);
    expect(SIGNATURE_THRESHOLDS[5]).toBe(50);
  });
});

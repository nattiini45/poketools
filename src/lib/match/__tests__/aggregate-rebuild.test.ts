import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/queries/aggregates', () => ({
  clearAggregatesForScope: vi.fn(),
  updateAggregatesForScope: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/games', () => ({
  getBattleStatsByGame: vi.fn(),
  listGamesForAggregateRebuild: vi.fn(),
}));

vi.mock('@/lib/revalidation', () => ({
  revalidateMatchPages: vi.fn(async () => {}),
  revalidatePublicPath: vi.fn(),
}));

import { rebuildAggregatesForScope } from '../aggregate-rebuild';
import {
  clearAggregatesForScope,
  updateAggregatesForScope,
} from '@/lib/supabase/queries/aggregates';
import {
  getBattleStatsByGame,
  listGamesForAggregateRebuild,
} from '@/lib/supabase/queries/games';
import type { ScopeGameRow } from '@/lib/supabase/queries/games';
import type { BattleStat } from '@/types/game';

const stat = (playerId: string): BattleStat => ({
  id: `bs-${playerId}`,
  game_id: 'g1',
  player_id: playerId,
  pokemon_name: 'Garchomp',
  was_brought: true,
  was_lead: false,
  kos_dealt: 2,
  was_koed: false,
  match_won: true,
  moves_used: ['Earthquake'],
  turns_active: 5,
  created_at: '2024-01-01T00:00:00Z',
});

const gameRow = (
  game_id: string,
  tournament_id: string,
  season_id: string | null,
  exclude_all_time: boolean,
): ScopeGameRow => ({ game_id, tournament_id, season_id, exclude_all_time });

describe('rebuildAggregatesForScope — test-data isolation', () => {
  beforeEach(() => {
    // resetAllMocks clears call data AND any mockResolvedValueOnce queues.
    vi.resetAllMocks();
    // Re-establish persistent implementations cleared by resetAllMocks.
    vi.mocked(clearAggregatesForScope).mockResolvedValue({
      aggregatesDeleted: 0,
      playerAggregatesDeleted: 0,
    });
    vi.mocked(updateAggregatesForScope).mockResolvedValue(undefined);
    vi.mocked(getBattleStatsByGame).mockResolvedValue([stat('p1')]);
  });

  it('skips test games during an all_time rebuild (reads frozen exclude_all_time)', async () => {
    const normalGame = gameRow('g1', 't1', 's-real', false);
    const testGame = gameRow('g2', 't2', 's-test', true);
    vi.mocked(listGamesForAggregateRebuild)
      .mockResolvedValueOnce([normalGame, testGame])
      .mockResolvedValueOnce([]);

    const result = await rebuildAggregatesForScope('all_time', null);

    expect(result.gamesProcessed).toBe(1); // only the normal game
    expect(updateAggregatesForScope).toHaveBeenCalledTimes(1);
  });

  it('keeps local test data during a league rebuild (ignores exclude_all_time)', async () => {
    const game = gameRow('g1', 't1', 's-test', true);
    vi.mocked(listGamesForAggregateRebuild)
      .mockResolvedValueOnce([game])
      .mockResolvedValueOnce([]);

    const result = await rebuildAggregatesForScope('league', 's-test');

    expect(result.gamesProcessed).toBe(1);
    expect(updateAggregatesForScope).toHaveBeenCalledTimes(1);
  });

  it('keeps local test data during a tournament rebuild (ignores exclude_all_time)', async () => {
    const game = gameRow('g1', 't1', 's-test', true);
    vi.mocked(listGamesForAggregateRebuild)
      .mockResolvedValueOnce([game])
      .mockResolvedValueOnce([]);

    const result = await rebuildAggregatesForScope('tournament', 't1');

    expect(result.gamesProcessed).toBe(1);
    expect(updateAggregatesForScope).toHaveBeenCalledTimes(1);
  });
});
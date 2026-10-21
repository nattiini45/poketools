import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BattleStat } from '@/types/game';

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock('@/lib/supabase/client', () => ({ supabase: { rpc: rpcMock } }));

import {
  applyAggregateJob,
  buildGameAggregateDeltas,
  rollbackGameAggregates,
  updateAggregatesForScope,
} from '../aggregates';

function stat(overrides: Partial<BattleStat>): BattleStat {
  return {
    id: 'bs',
    game_id: 'g1',
    player_id: 'p1',
    pokemon_name: 'Pikachu',
    was_brought: true,
    was_lead: false,
    kos_dealt: 0,
    was_koed: false,
    match_won: false,
    moves_used: [],
    turns_active: 1,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// Deliberately unsorted input: Map iteration order follows the stats order.
const STATS: BattleStat[] = [
  stat({ id: 'a', player_id: 'p2', pokemon_name: 'Zapdos', kos_dealt: 2, moves_used: ['Thunderbolt'] }),
  stat({ id: 'b', player_id: 'p1', pokemon_name: 'Amoonguss', was_lead: true, was_koed: true }),
  stat({ id: 'c', player_id: 'p1', pokemon_name: 'Zapdos', match_won: true, moves_used: ['Roost', 'Roost'] }),
];

describe('buildGameAggregateDeltas', () => {
  it('orders deltas by scope, scope id, Pokémon and player so concurrent applies lock rows in one order', () => {
    const { aggregateDeltas, playerDeltas } = buildGameAggregateDeltas(STATS, 't1', 's1');

    expect(aggregateDeltas.map((d) => `${d.scope_type}/${d.scope_id}/${d.pokemon_name}`)).toEqual([
      'all_time/null/Amoonguss',
      'all_time/null/Zapdos',
      'league/s1/Amoonguss',
      'league/s1/Zapdos',
      'tournament/t1/Amoonguss',
      'tournament/t1/Zapdos',
    ]);
    expect(playerDeltas.map((d) => `${d.scope_type}/${d.pokemon_name}/${d.player_id}`)).toEqual([
      'all_time/Amoonguss/p1',
      'all_time/Zapdos/p1',
      'all_time/Zapdos/p2',
      'league/Amoonguss/p1',
      'league/Zapdos/p1',
      'league/Zapdos/p2',
      'tournament/Amoonguss/p1',
      'tournament/Zapdos/p1',
      'tournament/Zapdos/p2',
    ]);
  });

  it('is independent of the input order', () => {
    const forward = buildGameAggregateDeltas(STATS, 't1', null);
    const reversed = buildGameAggregateDeltas([...STATS].reverse(), 't1', null);

    expect(reversed.aggregateDeltas.map((d) => [d.scope_type, d.pokemon_name])).toEqual(
      forward.aggregateDeltas.map((d) => [d.scope_type, d.pokemon_name]),
    );
    expect(reversed.playerDeltas.map((d) => [d.scope_type, d.pokemon_name, d.player_id])).toEqual(
      forward.playerDeltas.map((d) => [d.scope_type, d.pokemon_name, d.player_id]),
    );
  });

  it('omits the all_time scope for an excluded game and the league scope without a season', () => {
    const { aggregateDeltas, playerDeltas } = buildGameAggregateDeltas(STATS, 't1', null, { excludeAllTime: true });

    expect(new Set(aggregateDeltas.map((d) => d.scope_type))).toEqual(new Set(['tournament']));
    expect(new Set(playerDeltas.map((d) => d.scope_type))).toEqual(new Set(['tournament']));
  });

  it('sums each Pokémon across players for aggregates and keeps players apart for player aggregates', () => {
    const { aggregateDeltas, playerDeltas } = buildGameAggregateDeltas(STATS, 't1', null, { excludeAllTime: true });

    const zapdos = aggregateDeltas.find((d) => d.pokemon_name === 'Zapdos');
    expect(zapdos).toMatchObject({
      appearances: 2,
      brought: 2,
      kos_dealt: 2,
      wins: 1,
      games: 2,
      move_counts: { Thunderbolt: 1, Roost: 2 },
    });
    const zapdosP1 = playerDeltas.find((d) => d.pokemon_name === 'Zapdos' && d.player_id === 'p1');
    expect(zapdosP1).toMatchObject({ appearances: 1, wins: 1, move_counts: { Roost: 2 } });
  });

  it('matches the per-scope deltas of the scope rebuild, so a rebuilt scope equals the sum of its applied games', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    const byKey = (d: { scope_type: string; scope_id: string | null; pokemon_name: string; player_id?: string }) =>
      `${d.scope_type}/${d.scope_id}/${d.pokemon_name}/${d.player_id ?? ''}`;
    const sortDeltas = <T extends { scope_type: string; scope_id: string | null; pokemon_name: string; player_id?: string }>(
      deltas: T[],
    ) => [...deltas].sort((a, b) => byKey(a).localeCompare(byKey(b)));

    await updateAggregatesForScope(STATS, 'tournament', 't1');
    const payload = (name: string) =>
      (rpcMock.mock.calls.find((call) => call[0] === name)?.[1] as { p_deltas: never[] }).p_deltas;

    const built = buildGameAggregateDeltas(STATS, 't1', null, { excludeAllTime: true });
    expect(sortDeltas(built.aggregateDeltas)).toEqual(sortDeltas(payload('batch_upsert_aggregates')));
    expect(sortDeltas(built.playerDeltas)).toEqual(sortDeltas(payload('batch_upsert_player_aggregates')));
  });

  it('sends the scope rebuild deltas in the same lock order as the per-game apply and rollback', async () => {
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ data: null, error: null });

    await updateAggregatesForScope(STATS, 'tournament', 't1');
    const payload = (name: string) =>
      (rpcMock.mock.calls.find((call) => call[0] === name)?.[1] as { p_deltas: never[] }).p_deltas;

    // Exactly the order buildGameAggregateDeltas produces (not merely the same set).
    const built = buildGameAggregateDeltas(STATS, 't1', null, { excludeAllTime: true });
    expect(payload('batch_upsert_aggregates')).toEqual(built.aggregateDeltas);
    expect(payload('batch_upsert_player_aggregates')).toEqual(built.playerDeltas);
  });
});

describe('applyAggregateJob', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('sends one apply_aggregate_job RPC with the job, the game and both delta arrays', async () => {
    rpcMock.mockResolvedValueOnce({ data: 'applied', error: null });
    const deltas = buildGameAggregateDeltas(STATS, 't1', null);

    await expect(applyAggregateJob('job-1', 'g1', deltas)).resolves.toBe('applied');

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith('apply_aggregate_job', {
      p_job_id: 'job-1',
      p_game_id: 'g1',
      p_aggregate_deltas: deltas.aggregateDeltas,
      p_player_deltas: deltas.playerDeltas,
    });
  });

  it.each(['applied', 'already_applied', 'game_missing', 'job_not_processing'] as const)(
    'passes the %s outcome through',
    async (outcome) => {
      rpcMock.mockResolvedValueOnce({ data: outcome, error: null });

      await expect(applyAggregateJob('job-1', 'g1', { aggregateDeltas: [], playerDeltas: [] })).resolves.toBe(outcome);
    },
  );

  it('throws on an outcome this build does not know instead of treating it as success', async () => {
    rpcMock.mockResolvedValueOnce({ data: 'partially_applied', error: null });

    await expect(applyAggregateJob('job-1', 'g1', { aggregateDeltas: [], playerDeltas: [] })).rejects.toThrow(
      'apply_aggregate_job returned an unknown outcome: "partially_applied"',
    );
  });

  it('throws the RPC error unchanged (the transaction rolled back, nothing was written)', async () => {
    const rpcError = { message: 'deadlock detected', code: '40P01' };
    rpcMock.mockResolvedValueOnce({ data: null, error: rpcError });

    await expect(applyAggregateJob('job-1', 'g1', { aggregateDeltas: [], playerDeltas: [] })).rejects.toBe(rpcError);
  });
});

describe('rollbackGameAggregates', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  const MARKER = '2026-10-18T10:00:00.123456+00:00';

  it('sends ONE rollback_game_aggregates RPC with the game, the marker it read and the same deltas the apply sends', async () => {
    rpcMock.mockResolvedValueOnce({ data: 'rolled_back', error: null });
    const deltas = buildGameAggregateDeltas(STATS, 't1', 's1');

    await expect(rollbackGameAggregates('g1', MARKER, deltas)).resolves.toBe('rolled_back');

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith('rollback_game_aggregates', {
      p_game_id: 'g1',
      p_expected_applied_at: MARKER,
      p_aggregate_deltas: deltas.aggregateDeltas,
      p_player_deltas: deltas.playerDeltas,
    });
    // No separate decrement or marker request any more.
    expect(rpcMock.mock.calls.map((call) => call[0])).not.toContain('batch_decrement_aggregates');
  });

  it.each(['rolled_back', 'not_applied', 'marker_changed', 'game_missing'] as const)(
    'passes the %s outcome through',
    async (outcome) => {
      rpcMock.mockResolvedValueOnce({ data: outcome, error: null });
      await expect(rollbackGameAggregates('g1', MARKER, { aggregateDeltas: [], playerDeltas: [] })).resolves.toBe(outcome);
    },
  );

  it('throws on an outcome this build does not know instead of treating it as success', async () => {
    rpcMock.mockResolvedValueOnce({ data: 'partially_rolled_back', error: null });
    await expect(rollbackGameAggregates('g1', MARKER, { aggregateDeltas: [], playerDeltas: [] })).rejects.toThrow(
      'rollback_game_aggregates returned an unknown outcome: "partially_rolled_back"',
    );
  });

  it('throws the RPC error unchanged (the transaction rolled back: counts and marker unchanged)', async () => {
    const rpcError = { message: 'deadlock detected', code: '40P01' };
    rpcMock.mockResolvedValueOnce({ data: null, error: rpcError });
    await expect(rollbackGameAggregates('g1', MARKER, { aggregateDeltas: [], playerDeltas: [] })).rejects.toBe(rpcError);
  });
});

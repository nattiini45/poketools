/**
 * `getParticipantsBatch` against the in-memory PostgREST with the server's
 * 1,000-row `max_rows` ceiling. The profile composition reads the participants
 * of every stage a player entered in one batch, and that batch used to stop at
 * the first 1,000 rows. It now pages with `.range()` on the primary key, and a
 * batch under 1,000 rows must stay ONE query.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabase, type FakeRow, type FakeSupabase } from '@/lib/worlds/__tests__/fake-postgrest';

const fake = vi.hoisted(() => ({ current: null as FakeSupabase | null }));

vi.mock('@/lib/supabase/client', () => ({
  get supabase() {
    return fake.current!.client;
  },
}));

import { getParticipantsBatch } from '../tournaments';

function player(id: string): FakeRow {
  return {
    id,
    name: `Player ${id}`,
    discord_id: null,
    auth_user_id: null,
    ps_username: null,
    champions_username: null,
    is_admin: false,
    is_creator: false,
    is_guest: false,
    is_test_account: false,
    joined_date: '2026-01-01',
    avatar_url: null,
    avatar_config: null,
    status: 'active',
    suspended_until: null,
    ban_reason: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

/** `count` participant rows spread round-robin over `tournaments` stages, stored in reverse key order. */
function participantRows(count: number, tournaments: number): FakeRow[] {
  const rows = Array.from({ length: count }, (_, i) => {
    const playerId = `p-${String(i).padStart(5, '0')}`;
    return {
      tournament_id: `t-${i % tournaments}`,
      player_id: playerId,
      seed: i,
      starting_bracket: null,
      players: player(playerId),
    };
  });
  return rows.reverse();
}

/** The ids the batch must return for one stage: that stage's players in player_id order. */
function expectedPlayerIds(count: number, tournaments: number, tournament: number): string[] {
  return Array.from({ length: count }, (_, i) => i)
    .filter((i) => i % tournaments === tournament)
    .map((i) => `p-${String(i).padStart(5, '0')}`);
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  return () => warn.mockRestore();
});

describe('getParticipantsBatch', () => {
  it('pages past the max_rows ceiling and groups every participant per tournament', async () => {
    fake.current = createFakeSupabase(
      { tournament_participants: participantRows(2345, 5), players: [] },
      {},
      { maxRows: 1000 },
    );
    const ids = ['t-0', 't-1', 't-2', 't-3', 't-4'];

    const result = await getParticipantsBatch(ids);

    // Before: one unordered read, cut to 1,000 rows by the server.
    expect(fake.current.queries.map((q) => q.range)).toEqual([
      { from: 0, to: 999 },
      { from: 1000, to: 1999 },
      { from: 2000, to: 2999 },
    ]);
    for (const q of fake.current.queries) {
      expect(q.table).toBe('tournament_participants');
      expect(q.filters).toEqual([{ op: 'in', column: 'tournament_id', value: ids }]);
      expect(q.orders).toEqual([
        { column: 'tournament_id', ascending: true },
        { column: 'player_id', ascending: true },
      ]);
      expect(q.limit).toBeNull();
    }
    let total = 0;
    ids.forEach((id, index) => {
      const list = result.get(id) ?? [];
      total += list.length;
      expect(list.map((p) => p.id)).toEqual(expectedPlayerIds(2345, 5, index));
    });
    expect(total).toBe(2345);
    expect(warn).not.toHaveBeenCalled();
  });

  it('reads a batch under 1,000 rows in ONE query and groups it exactly as before', async () => {
    fake.current = createFakeSupabase(
      { tournament_participants: participantRows(7, 2), players: [] },
      {},
      { maxRows: 1000 },
    );

    const result = await getParticipantsBatch(['t-0', 't-1', 't-unused']);

    expect(fake.current.queries).toHaveLength(1);
    expect(fake.current.queries[0].range).toEqual({ from: 0, to: 999 });
    expect([...result.keys()]).toEqual(['t-0', 't-1']);
    expect(result.get('t-0')!.map((p) => p.id)).toEqual(expectedPlayerIds(7, 2, 0));
    expect(result.get('t-1')!.map((p) => p.id)).toEqual(expectedPlayerIds(7, 2, 1));
    expect(result.get('t-0')![0]).toMatchObject({ name: 'Player p-00000', seed: 0, status: 'active' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('issues no query for an empty tournament list', async () => {
    fake.current = createFakeSupabase({ tournament_participants: participantRows(3, 1) }, {}, { maxRows: 1000 });

    const result = await getParticipantsBatch([]);

    expect(result.size).toBe(0);
    expect(fake.current.queries).toHaveLength(0);
  });

  it('rethrows a client error', async () => {
    const boom = new Error('batch failed');
    fake.current = {
      queries: [],
      reset: () => {},
      client: {
        from: () => {
          const builder: Record<string, unknown> = {};
          for (const m of ['select', 'in', 'order', 'range']) builder[m] = () => builder;
          builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: null, error: boom });
          return builder;
        },
        rpc: async () => ({ data: null, error: null }),
      },
    };

    await expect(getParticipantsBatch(['t-0'])).rejects.toBe(boom);
  });

  it('logs a warning when the 20,000-row bound is reached', async () => {
    fake.current = createFakeSupabase(
      { tournament_participants: participantRows(20_001, 1) },
      {},
      { maxRows: 1000 },
    );

    const result = await getParticipantsBatch(['t-0']);

    expect(fake.current.queries).toHaveLength(20);
    expect(result.get('t-0')).toHaveLength(20_000);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('getParticipantsBatch');
  });
});

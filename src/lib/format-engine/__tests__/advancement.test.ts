import { describe, expect, it } from 'vitest';
import type { Edge } from '@/lib/format-kit/types';
import { resolveAdvancement } from '../advancement';
import type { KitStanding } from '../standings';

/** A ranked table: `p1` first, with points falling by 3 a place. */
function standings(n: number): KitStanding[] {
  return Array.from({ length: n }, (_, i) => ({
    player_id: `p${i + 1}`,
    player_name: `P${i + 1}`,
    player_avatar_url: null,
    gym_type: null,
    wins: n - 1 - i,
    losses: i,
    draws: 0,
    points: 3 * (n - 1 - i),
    buchholz: 0,
    games_played: 0,
    kill_differential: 0,
    eliminated: false,
    rank: i + 1,
    faints_dealt: 0,
    faints_taken: 0,
    forfeit_wins: 0,
    forfeit_losses: 0,
    needs_decision_match: false,
    tie_group: null,
  }));
}

const edge = (select: Edge['select'], seeding: Edge['seeding'] = 'rank'): Pick<Edge, 'key' | 'select' | 'seeding'> => ({
  key: 'to_playoffs',
  select,
  seeding,
});
const picked = (result: ReturnType<typeof resolveAdvancement>) => result.players.map((p) => p.player_id);

// Two groups of four, the whole table interleaving them: p1 (A), p2 (B), p3 (A), p4 (B), ...
const groupOf = Object.fromEntries(standings(8).map((row, i) => [row.player_id, (i % 2) + 1]));

describe('resolveAdvancement', () => {
  it('takes the best n of the table, seeded by rank', () => {
    const result = resolveAdvancement({ edge: edge([{ kind: 'top_n', n: 3 }]), table: standings(8) });
    expect(result.players).toEqual([
      { player_id: 'p1', seed: 1, select: 0 },
      { player_id: 'p2', seed: 2, select: 0 },
      { player_id: 'p3', seed: 3, select: 0 },
    ]);
    expect(result.awaitingManualList).toBe(false);
  });

  it('takes the best of every group, then wildcards from the rest, never a player twice', () => {
    const result = resolveAdvancement({
      edge: edge([{ kind: 'per_group', n: 1 }, { kind: 'wildcard', n: 2 }, { kind: 'top_n', n: 2 }]),
      table: standings(8),
      groupOf,
    });
    expect(picked(result)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(result.players.map((p) => p.select)).toEqual([0, 0, 1, 1]);
  });

  it('deals group places for cross_group seeding', () => {
    const result = resolveAdvancement({ edge: edge([{ kind: 'per_group', n: 2 }], 'cross_group'), table: standings(8), groupOf });
    // Group winners first (A then B), then the runners-up.
    expect(picked(result)).toEqual(['p1', 'p2', 'p3', 'p4']);
    const reversed = Object.fromEntries(Object.entries(groupOf).map(([id, g]) => [id, 3 - g]));
    expect(picked(resolveAdvancement({ edge: edge([{ kind: 'per_group', n: 2 }], 'cross_group'), table: standings(8), groupOf: reversed }))).toEqual(
      ['p2', 'p1', 'p4', 'p3'],
    );
  });

  it('selects by a threshold expression over the row', () => {
    const result = resolveAdvancement({
      edge: edge([
        {
          kind: 'threshold',
          when: { k: 'cmp', op: '>=', a: { k: 'ref', name: 'points', t: 'number' }, b: { k: 'num', v: 12 } },
        },
      ]),
      table: standings(8),
    });
    expect(picked(result)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(result.issues).toEqual([]);
  });

  it('takes the last n in table order', () => {
    expect(picked(resolveAdvancement({ edge: edge([{ kind: 'bottom_n', n: 2 }]), table: standings(8) }))).toEqual(['p7', 'p8']);
  });

  it('waits for a manual list, then follows it in the admin order (manual seeding)', () => {
    const select: Edge['select'] = [{ kind: 'manual_list', count: 2 }];
    expect(resolveAdvancement({ edge: edge(select, 'manual'), table: standings(8) })).toEqual({
      players: [],
      awaitingManualList: true,
      issues: [],
    });
    const result = resolveAdvancement({ edge: edge(select, 'manual'), table: standings(8), manualList: ['p5', 'nobody', 'p2', 'p1'] });
    expect(picked(result)).toEqual(['p5']);
    const full = resolveAdvancement({ edge: edge(select, 'manual'), table: standings(8), manualList: ['p5', 'p2', 'p1'] });
    expect(picked(full)).toEqual(['p5', 'p2']);
  });

  it('shuffles with the season seed for random seeding: the same seed gives the same order', () => {
    const run = (seed: string) =>
      picked(resolveAdvancement({ edge: edge([{ kind: 'top_n', n: 6 }], 'random'), table: standings(8), seed }));
    expect(run('s')).toEqual(run('s'));
    expect([...run('s')].sort()).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
  });
});

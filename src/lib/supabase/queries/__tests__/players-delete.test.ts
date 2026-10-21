/**
 * getPlayerCompetitiveRefs: the delete route's pre-check. Every players FK left
 * ON DELETE NO ACTION must be counted, so a delete that would hit SQLSTATE
 * 23503 is refused with a coded 409 before the DELETE runs. Served by a tiny
 * in-memory head-count stub (no network).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  calls: [] as Array<{ table: string; column: string }>,
  failTable: null as string | null,
}));

/** Value at a dotted path (`draft_pools.phase` reads the embedded pool). */
function at(row: Row, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (value, key) => (value && typeof value === 'object' ? (value as Row)[key] : undefined),
    row,
  );
}

type Filter = (row: Row) => boolean;

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (table: string) => ({
      select: (_columns: string, opts: { count: string; head: boolean }) => {
        expect(opts).toEqual({ count: 'exact', head: true });
        const filters: Filter[] = [];
        const builder = {
          eq(column: string, value: unknown) {
            state.calls.push({ table, column });
            filters.push((row) => at(row, column) === value);
            return builder;
          },
          not(column: string, op: string, list: string) {
            expect(op).toBe('in');
            const excluded = list.replace(/^\(|\)$/g, '').split(',');
            filters.push((row) => !excluded.includes(String(at(row, column))));
            return builder;
          },
          then<T>(resolve: (r: { data: null; count: number | null; error: { message: string } | null }) => T) {
            if (state.failTable === table) return resolve({ data: null, count: null, error: { message: 'boom' } });
            const count = (state.tables[table] ?? []).filter((row) => filters.every((f) => f(row))).length;
            return resolve({ data: null, count, error: null });
          },
        };
        return builder;
      },
    }),
  },
}));

import { getPlayerCompetitiveRefs } from '../players';

beforeEach(() => {
  state.tables = {};
  state.calls = [];
  state.failTable = null;
});

describe('getPlayerCompetitiveRefs', () => {
  it('returns zeros for a player nothing references', async () => {
    await expect(getPlayerCompetitiveRefs('p1')).resolves.toEqual({
      matches: 0,
      proposals: 0,
      leagueHistory: 0,
      activeDrafts: 0,
    });
  });

  it('sums matches and proposals over both slots', async () => {
    state.tables = {
      matches: [{ player_1_id: 'p1' }, { player_2_id: 'p1' }, { player_1_id: 'p2' }],
      match_proposals: [{ proposer_id: 'p1' }, { responder_id: 'p1' }, { responder_id: 'p1' }],
    };
    await expect(getPlayerCompetitiveRefs('p1')).resolves.toEqual({
      matches: 2,
      proposals: 3,
      leagueHistory: 0,
      activeDrafts: 0,
    });
  });

  it.each([
    ['rating_history', 'opponent_id'],
    ['match_evolution_snapshots', 'player_id'],
    ['redraft_history', 'player_id'],
    ['redraft_history', 'trade_partner_id'],
    ['evolution_events', 'player_id'],
    ['epb_token_grants', 'player_id'],
    ['epb_token_grants', 'created_by'],
    ['evo_progress_log', 'created_by'],
    ['redraft_trade_requests', 'initiated_by'],
    ['redraft_trade_requests', 'player_a_id'],
    ['redraft_trade_requests', 'player_b_id'],
    ['redraft_trade_requests', 'cancelled_by'],
  ])('counts the NO ACTION reference %s.%s as league history', async (table, column) => {
    state.tables = { [table]: [{ [column]: 'p1' }] };
    const refs = await getPlayerCompetitiveRefs('p1');
    expect(refs).toEqual({ matches: 0, proposals: 0, leagueHistory: 1, activeDrafts: 0 });
    expect(state.calls).toContainEqual({ table, column });
  });

  it('counts seats in unfinished queue drafts only', async () => {
    const seat = (engine: string, phase: string, player_id = 'p1') => ({
      player_id,
      draft_pools: { engine, phase },
    });
    state.tables = {
      draft_participants: [
        seat('queue', 'setup'),
        seat('queue', 'submissions'),
        seat('queue', 'drafting'),
        seat('queue', 'complete'),
        seat('queue', 'cancelled'),
        seat('legacy', 'setup'),
        seat('queue', 'drafting', 'p2'),
      ],
    };
    const refs = await getPlayerCompetitiveRefs('p1');
    expect(refs).toEqual({ matches: 0, proposals: 0, leagueHistory: 0, activeDrafts: 3 });
    expect(state.calls).toContainEqual({ table: 'draft_participants', column: 'player_id' });
    expect(state.calls).toContainEqual({ table: 'draft_participants', column: 'draft_pools.engine' });
  });

  it('rethrows a draft-seat count error', async () => {
    state.failTable = 'draft_participants';
    await expect(getPlayerCompetitiveRefs('p1')).rejects.toEqual({ message: 'boom' });
  });

  it('rethrows a count error', async () => {
    state.failTable = 'evolution_events';
    await expect(getPlayerCompetitiveRefs('p1')).rejects.toEqual({ message: 'boom' });
  });
});

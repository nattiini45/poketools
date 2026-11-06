/**
 * The reads behind the format engine's cron pass: the kit leagues (with or without a calendar) and the finalized
 * matches of a league's phases.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Step = [string, ...unknown[]];

const state = vi.hoisted(() => ({
  calls: [] as { table: string; steps: [string, ...unknown[]][] }[],
  reply: { data: [] as unknown[], error: null as unknown },
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      const call = { table, steps: [] as [string, ...unknown[]][] };
      state.calls.push(call);
      const chain: Record<string, unknown> = {};
      for (const name of ['select', 'eq', 'neq', 'in', 'not', 'order', 'range']) {
        chain[name] = (...args: unknown[]) => {
          call.steps.push([name, ...args]);
          return chain;
        };
      }
      chain.then = (resolve: (value: unknown) => unknown) => resolve(state.reply);
      return chain;
    },
  },
}));

import { listFinalizedMatches, listKitSeasonIds, listUncompletedMatches, UNCOMPLETED_MATCH_CHUNK } from '../format-cron';

const stepsOf = (call: { steps: Step[] }, name: string) => call.steps.filter(([step]) => step === name);

beforeEach(() => {
  state.calls.length = 0;
  state.reply = { data: [], error: null };
});

describe('listKitSeasonIds', () => {
  it('reads upcoming and active, not archived leagues on the kit engine, whatever their calendars', async () => {
    state.reply = { data: [{ id: 's-1' }, { id: 's-2' }], error: null };
    await expect(listKitSeasonIds()).resolves.toEqual(['s-1', 's-2']);
    const [call] = state.calls;
    expect(call.table).toBe('seasons');
    expect(stepsOf(call, 'in')).toEqual([['in', 'status', ['upcoming', 'active']]]);
    expect(stepsOf(call, 'eq')).toEqual(
      expect.arrayContaining([
        ['eq', 'archived', false],
        ['eq', 'season_formats.engine', 'kit'],
      ]),
    );
    expect(stepsOf(call, 'order')).toEqual([['order', 'id', { ascending: true }]]);
  });

  it('propagates a database error', async () => {
    state.reply = { data: [], error: new Error('db') };
    await expect(listKitSeasonIds()).rejects.toThrow('db');
  });
});

describe('listFinalizedMatches', () => {
  it('reads nothing for no phases', async () => {
    await expect(listFinalizedMatches([])).resolves.toEqual([]);
    expect(state.calls).toHaveLength(0);
  });

  it('reads the completed, finalized matches with a winner of the given phases', async () => {
    const row = { id: 'm-1', tournament_id: 't-1', round_id: 'r-1', player_1_id: 'a', player_2_id: 'b', winner_id: 'a' };
    state.reply = { data: [row], error: null };
    await expect(listFinalizedMatches(['t-1', 't-2'])).resolves.toEqual([row]);
    const [call] = state.calls;
    expect(call.table).toBe('matches');
    expect(stepsOf(call, 'in')).toEqual([['in', 'tournament_id', ['t-1', 't-2']]]);
    expect(stepsOf(call, 'eq')).toEqual([['eq', 'status', 'completed']]);
    expect(stepsOf(call, 'not')).toEqual([
      ['not', 'finalized_at', 'is', null],
      ['not', 'winner_id', 'is', null],
    ]);
  });

  it('lists the matches in the order they finished, the id breaking a tie', async () => {
    state.reply = { data: [], error: null };
    await listFinalizedMatches(['t-1']);
    const [call] = state.calls;
    expect(stepsOf(call, 'order')).toEqual([
      ['order', 'finalized_at', { ascending: true }],
      ['order', 'id', { ascending: true }],
    ]);
  });
});

describe('listUncompletedMatches', () => {
  it('reads nothing without phases or matches', async () => {
    await expect(listUncompletedMatches([], ['m-1'])).resolves.toEqual([]);
    await expect(listUncompletedMatches(['t-1'], [])).resolves.toEqual([]);
    expect(state.calls).toHaveLength(0);
  });

  it('reads the matches of the given phases and ids whose status is not completed', async () => {
    const row = { id: 'm-1', tournament_id: 't-1', status: 'in_progress' };
    state.reply = { data: [row], error: null };
    await expect(listUncompletedMatches(['t-1'], ['m-1', 'm-2'])).resolves.toEqual([row]);
    const [call] = state.calls;
    expect(call.table).toBe('matches');
    expect(stepsOf(call, 'in')).toEqual([
      ['in', 'tournament_id', ['t-1']],
      ['in', 'id', ['m-1', 'm-2']],
    ]);
    expect(stepsOf(call, 'neq')).toEqual([['neq', 'status', 'completed']]);
  });

  it('reads the ids in chunks, so no request carries an unbounded list', async () => {
    const ids = Array.from({ length: UNCOMPLETED_MATCH_CHUNK * 2 + 1 }, (_, index) => `m-${index}`);
    await listUncompletedMatches(['t-1'], ids);
    expect(state.calls).toHaveLength(3);
    expect(stepsOf(state.calls[2], 'in')[1]).toEqual(['in', 'id', ['m-200']]);
  });

  it('propagates a database error', async () => {
    state.reply = { data: [], error: new Error('db') };
    await expect(listUncompletedMatches(['t-1'], ['m-1'])).rejects.toThrow('db');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

// A chainable query builder whose `.range()` resolves with the next queued page.
const h = vi.hoisted(() => {
  const calls: { method: string; args: unknown[] }[] = [];
  const pages: { data: unknown[] | null; error: unknown }[] = [];
  const builder: Record<string, (...args: unknown[]) => unknown> = {};
  for (const method of ['from', 'select', 'eq', 'in', 'order']) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.range = (...args: unknown[]) => {
    calls.push({ method: 'range', args });
    return Promise.resolve(pages.shift() ?? { data: [], error: null });
  };
  return { calls, pages, builder };
});

vi.mock('../../client', () => ({ supabase: h.builder }));

import { getByeRoundsByTournamentIds, getSwissByeRoundsBySeason } from '../rounds';

function roundRow(id: string, tournament_id: string, round_number: number, bye_player_ids: string[] | null) {
  return { id, tournament_id, round_number, bye_player_ids };
}

describe('getByeRoundsByTournamentIds', () => {
  beforeEach(() => {
    h.calls.length = 0;
    h.pages.length = 0;
  });

  it('reads the rounds of every tournament in ONE query, selecting only the bye columns', async () => {
    h.pages.push({
      data: [roundRow('r1', 't1', 1, ['p1']), roundRow('r2', 't1', 2, null), roundRow('r3', 't2', 1, [])],
      error: null,
    });

    const byTournament = await getByeRoundsByTournamentIds(['t1', 't2', 't1', 't3']);

    expect(h.calls.filter((c) => c.method === 'from')).toHaveLength(1);
    expect(h.calls.find((c) => c.method === 'select')!.args).toEqual(['id, tournament_id, round_number, bye_player_ids']);
    expect(h.calls.find((c) => c.method === 'in')!.args).toEqual(['tournament_id', ['t1', 't2', 't3']]);
    expect(byTournament.get('t1')).toEqual([
      { id: 'r1', tournament_id: 't1', round_number: 1, bye_player_ids: ['p1'] },
      // A legacy row holds no bye list.
      { id: 'r2', tournament_id: 't1', round_number: 2, bye_player_ids: [] },
    ]);
    expect(byTournament.get('t2')).toHaveLength(1);
    // A tournament without rounds still has an entry.
    expect(byTournament.get('t3')).toEqual([]);
  });

  it('reads nothing for an empty list', async () => {
    expect((await getByeRoundsByTournamentIds([])).size).toBe(0);
    expect(h.calls).toEqual([]);
  });

  it('pages past the PostgREST row ceiling instead of cutting the batch off', async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => roundRow(`a${i}`, 't1', i + 1, []));
    h.pages.push({ data: fullPage, error: null }, { data: [roundRow('b0', 't1', 1001, ['p1'])], error: null });

    const byTournament = await getByeRoundsByTournamentIds(['t1']);

    expect(byTournament.get('t1')).toHaveLength(1001);
    expect(h.calls.filter((c) => c.method === 'range').map((c) => c.args)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it('orders by a unique final key so the pages never skip or repeat a row', async () => {
    await getByeRoundsByTournamentIds(['t1']);

    expect(h.calls.filter((c) => c.method === 'order').map((c) => c.args)).toEqual([
      ['tournament_id'],
      ['round_number'],
      ['id'],
    ]);
  });

  it('throws on a read error rather than returning rounds without byes', async () => {
    const failure = { message: 'timeout', code: '' };
    h.pages.push({ data: null, error: failure });

    await expect(getByeRoundsByTournamentIds(['t1'])).rejects.toBe(failure);
  });
});

describe('getSwissByeRoundsBySeason', () => {
  beforeEach(() => {
    h.calls.length = 0;
    h.pages.length = 0;
  });

  it('filters the season and the Swiss stages in the database, in one query', async () => {
    h.pages.push({ data: [roundRow('r1', 't1', 1, ['p1']), roundRow('r2', 't2', 1, [])], error: null });

    const rounds = await getSwissByeRoundsBySeason('season-1');

    expect(h.calls.filter((c) => c.method === 'from')).toHaveLength(1);
    expect(h.calls.filter((c) => c.method === 'eq').map((c) => c.args)).toEqual([
      ['tournaments.season_id', 'season-1'],
      ['tournaments.bracket_type', 'swiss'],
    ]);
    expect(rounds).toEqual([
      { id: 'r1', tournament_id: 't1', round_number: 1, bye_player_ids: ['p1'] },
      { id: 'r2', tournament_id: 't2', round_number: 1, bye_player_ids: [] },
    ]);
  });

  it('orders by a unique final key so the pages never skip or repeat a row', async () => {
    await getSwissByeRoundsBySeason('season-1');

    expect(h.calls.filter((c) => c.method === 'order').map((c) => c.args)).toEqual([
      ['tournament_id'],
      ['round_number'],
      ['id'],
    ]);
  });

  it('throws on a read error', async () => {
    const failure = { message: 'timeout', code: '' };
    h.pages.push({ data: null, error: failure });

    await expect(getSwissByeRoundsBySeason('season-1')).rejects.toBe(failure);
  });
});

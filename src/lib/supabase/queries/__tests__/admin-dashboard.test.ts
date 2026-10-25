/**
 * `listActiveCompetitions`: the leagues and tournaments the admin dashboard
 * counts, for a site admin (paged full reads) and a resource admin (id chunks).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Call {
  table: string;
  select: string;
  ins: Array<{ column: string; values: string[] }>;
  eqs: Array<{ column: string; value: unknown }>;
  range: [number, number] | null;
}

const calls: Call[] = [];
let tournaments: Array<{ id: string; season_id: string | null; archived: boolean }> = [];
let seasons: Array<{ id: string; archived: boolean; is_test_season: boolean }> = [];
let failTable: string | null = null;

/** A tiny PostgREST stand-in: applies in / eq / order(id) / range to the fixture tables. */
function execute(call: Call) {
  if (call.table === failTable) return { data: null, error: { message: 'boom' } };
  let rows = (call.table === 'tournaments' ? tournaments : seasons) as unknown as Array<Record<string, unknown>>;
  for (const f of call.ins) rows = rows.filter((r) => f.values.includes(r[f.column] as string));
  for (const e of call.eqs) rows = rows.filter((r) => r[e.column] === e.value);
  rows = [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  if (call.range) rows = rows.slice(call.range[0], call.range[1] + 1);
  return { data: rows, error: null };
}

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from(table: string) {
      const call: Call = { table, select: '', ins: [], eqs: [], range: null };
      calls.push(call);
      const builder = {
        select(columns: string) {
          call.select = columns;
          return builder;
        },
        in(column: string, values: string[]) {
          call.ins.push({ column, values });
          return builder;
        },
        eq(column: string, value: unknown) {
          call.eqs.push({ column, value });
          return builder;
        },
        order() {
          return builder;
        },
        range(from: number, to: number) {
          call.range = [from, to];
          return builder;
        },
        then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
          return Promise.resolve(execute(call)).then(onFulfilled, onRejected);
        },
      };
      return builder;
    },
  },
}));

import { listActiveCompetitions } from '../admin-dashboard';

const idsOf = (n: number, prefix: string) =>
  Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(4, '0')}`);

beforeEach(() => {
  calls.length = 0;
  failTable = null;
  seasons = [
    { id: 's-live', archived: false, is_test_season: false },
    { id: 's-live-2', archived: false, is_test_season: false },
    { id: 's-test', archived: false, is_test_season: true },
    { id: 's-archived', archived: true, is_test_season: false },
  ];
  tournaments = [
    { id: 't-solo', season_id: null, archived: false },
    { id: 't-solo-old', season_id: null, archived: true },
    { id: 't-live-a', season_id: 's-live', archived: false },
    { id: 't-live-b', season_id: 's-live-2', archived: false },
    { id: 't-test', season_id: 's-test', archived: false },
    { id: 't-in-archived', season_id: 's-archived', archived: false },
    { id: 't-archived', season_id: 's-live', archived: true },
  ];
});

describe('listActiveCompetitions: site admin', () => {
  it('returns active leagues, standalone tournaments and every eligible tournament', async () => {
    const result = await listActiveCompetitions({ seasonIds: null, tournamentIds: null });
    expect(result.seasonIds).toEqual(['s-live', 's-live-2']);
    expect(result.standaloneTournamentIds).toEqual(['t-solo']);
    expect(result.tournamentIds).toEqual(['t-live-a', 't-live-b', 't-solo']);
  });

  it('leaves out archived tournaments, test-league phases and archived-league phases', async () => {
    const { tournamentIds } = await listActiveCompetitions({ seasonIds: null, tournamentIds: null });
    for (const id of ['t-solo-old', 't-archived', 't-test', 't-in-archived']) {
      expect(tournamentIds).not.toContain(id);
    }
  });

  it('asks for non-archived tournaments only, ordered and paged', async () => {
    await listActiveCompetitions({ seasonIds: null, tournamentIds: null });
    const tournamentRead = calls.find((c) => c.table === 'tournaments');
    expect(tournamentRead?.select).toBe('id, season_id');
    expect(tournamentRead?.eqs).toEqual([{ column: 'archived', value: false }]);
    expect(tournamentRead?.range).toEqual([0, 999]);
    expect(calls.find((c) => c.table === 'seasons')?.select).toBe('id, archived, is_test_season');
  });

  it('pages past the 1000-row cap for both tables', async () => {
    seasons = idsOf(1200, 's').map((id) => ({ id, archived: false, is_test_season: false }));
    tournaments = idsOf(2300, 't').map((id, i) => ({
      id,
      season_id: i % 2 === 0 ? null : seasons[i % 1200].id,
      archived: false,
    }));
    const result = await listActiveCompetitions({ seasonIds: null, tournamentIds: null });
    expect(result.seasonIds).toHaveLength(1200);
    expect(result.tournamentIds).toHaveLength(2300);
    expect(result.standaloneTournamentIds).toHaveLength(1150);
    expect(calls.filter((c) => c.table === 'tournaments').map((c) => c.range)).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
    expect(calls.filter((c) => c.table === 'seasons').map((c) => c.range)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it('fails closed when a phase points at a league the read did not return', async () => {
    tournaments = [
      { id: 't-orphan', season_id: 's-missing', archived: false },
      { id: 't-solo', season_id: null, archived: false },
    ];
    const result = await listActiveCompetitions({ seasonIds: null, tournamentIds: null });
    expect(result.tournamentIds).toEqual(['t-solo']);
  });
});

describe('listActiveCompetitions: resource admin', () => {
  it('reads only the assigned tournaments and the leagues they belong to or are assigned', async () => {
    const result = await listActiveCompetitions({
      seasonIds: ['s-live'],
      tournamentIds: ['t-live-a', 't-live-b', 't-solo', 't-test', 't-archived'],
    });
    // t-live-b sits in a league the admin is not assigned to: its phase counts, the league does not
    expect([...result.tournamentIds].sort()).toEqual(['t-live-a', 't-live-b', 't-solo']);
    expect(result.standaloneTournamentIds).toEqual(['t-solo']);
    expect(result.seasonIds).toEqual(['s-live']);

    const seasonRead = calls.find((c) => c.table === 'seasons');
    expect([...(seasonRead?.ins[0].values ?? [])].sort()).toEqual(['s-live', 's-live-2', 's-test']);
    expect(calls.find((c) => c.table === 'tournaments')?.eqs).toEqual([{ column: 'archived', value: false }]);
  });

  it('falls back to the season of a phase when no league is assigned directly', async () => {
    const result = await listActiveCompetitions({ seasonIds: [], tournamentIds: ['t-live-a'] });
    expect(result.tournamentIds).toEqual(['t-live-a']);
    expect(result.seasonIds).toEqual([]);
  });

  it('counts an assigned test league or archived league as neither a league nor a phase source', async () => {
    const result = await listActiveCompetitions({
      seasonIds: ['s-test', 's-archived'],
      tournamentIds: ['t-test', 't-in-archived'],
    });
    expect(result).toEqual({ seasonIds: [], standaloneTournamentIds: [], tournamentIds: [] });
  });

  it('chunks long id lists at 100 ids', async () => {
    const ids = idsOf(250, 't');
    tournaments = ids.map((id) => ({ id, season_id: null, archived: false }));
    const result = await listActiveCompetitions({ seasonIds: [], tournamentIds: ids });
    const tournamentReads = calls.filter((c) => c.table === 'tournaments');
    expect(tournamentReads.map((c) => c.ins[0].values.length)).toEqual([100, 100, 50]);
    expect(result.tournamentIds).toHaveLength(250);
  });

  it('reads nothing for an empty scope', async () => {
    const result = await listActiveCompetitions({ seasonIds: [], tournamentIds: [] });
    expect(result).toEqual({ seasonIds: [], standaloneTournamentIds: [], tournamentIds: [] });
    expect(calls).toHaveLength(0);
  });

  it('fails closed when an assigned phase points at a league the read did not return', async () => {
    tournaments = [{ id: 't-orphan', season_id: 's-missing', archived: false }];
    const result = await listActiveCompetitions({ seasonIds: [], tournamentIds: ['t-orphan'] });
    expect(result.tournamentIds).toEqual([]);
  });
});

describe('listActiveCompetitions: read errors', () => {
  it.each(['tournaments', 'seasons'])('throws when the %s read fails', async (table) => {
    failTable = table;
    await expect(listActiveCompetitions({ seasonIds: null, tournamentIds: null })).rejects.toEqual({
      message: 'boom',
    });
  });
});

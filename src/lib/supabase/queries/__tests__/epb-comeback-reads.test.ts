/**
 * Comeback/participation reads of the EPB token rules:
 * - `fetchComebackTokenData` with an earn scope loads only the Hinrunde of the primary stage (comeback tokens are earned in the first half only);
 * - `getRegisteredSpeciesByMatches` reads registered teams (brought = registered team), pages, and fails loudly on a
 *   malformed team instead of treating it as "no team".
 * No DB: a table-keyed chain mock records each query's filters. A `.range(from, to)` read gets
 * that slice of the table's rows, like PostgREST, so paged reads end on a real empty page.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Call = { table: string; ops: [string, unknown[]][] };

const db = vi.hoisted(() => {
  const state = {
    calls: [] as Call[],
    /** table → queued results; the last one repeats. A ranged read answers its slice of the result's rows. */
    results: new Map<string, { data: unknown; error: unknown }[]>(),
  };
  function from(table: string) {
    const call: Call = { table, ops: [] };
    state.calls.push(call);
    const builder: Record<string, unknown> = {};
    for (const op of ['select', 'eq', 'in', 'not', 'lte', 'order', 'range']) {
      builder[op] = (...args: unknown[]) => {
        call.ops.push([op, args]);
        return builder;
      };
    }
    builder.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
      const queue = state.results.get(table) ?? [];
      const next = queue.length > 1 ? queue.shift() : queue[0];
      const range = call.ops.find(([op]) => op === 'range')?.[1] as [number, number] | undefined;
      const answer =
        next && range && Array.isArray(next.data)
          ? { data: next.data.slice(range[0], range[1] + 1), error: next.error }
          : next;
      return Promise.resolve(answer ?? { data: [], error: null }).then(resolve, reject);
    };
    return builder;
  }
  return { state, from };
});

vi.mock('@/lib/supabase/client', () => ({ supabase: { from: db.from } }));

import { fetchComebackTokenData } from '../epb-kill-tokens';
import { getRegisteredSpeciesByMatch, getRegisteredSpeciesByMatches } from '../match-prep-teams';

function setResults(table: string, ...results: { data: unknown; error?: unknown }[]) {
  db.state.results.set(table, results.map((r) => ({ data: r.data, error: r.error ?? null })));
}

function opsOf(table: string, op: string): unknown[][] {
  return db.state.calls.filter((c) => c.table === table).flatMap((c) => c.ops.filter(([o]) => o === op).map(([, a]) => a));
}

beforeEach(() => {
  db.state.calls = [];
  db.state.results = new Map();
});

describe('fetchComebackTokenData — earn scope (first half only)', () => {
  const matchRow = (id: string, round: number) => ({
    id,
    player_1_id: 'p1',
    player_2_id: 'p2',
    winner_id: 'p2',
    status: 'completed',
    rounds: { round_number: round },
  });

  beforeEach(() => {
    setResults('tournaments', { data: [{ id: 'stage-1' }, { id: 'playoffs' }] });
    setResults('matches', { data: [matchRow('m-r4', 4), matchRow('m-r5', 5)] });
    setResults('games', { data: [{ id: 'g-r4', match_id: 'm-r4' }] });
    setResults('battle_stats', { data: [{ id: 1, game_id: 'g-r4', player_id: 'p1', pokemon_name: 'A', was_koed: true }] });
  });

  it('without a scope loads every stage of the season', async () => {
    const data = await fetchComebackTokenData('s1');

    expect(opsOf('matches', 'in')).toContainEqual(['tournament_id', ['stage-1', 'playoffs']]);
    expect(data.matches.map((m) => m.id)).toEqual(['m-r4', 'm-r5']);
  });

  it('with a scope bounds the query to the primary stage and the Hinrunde rounds', async () => {
    setResults('matches', { data: [matchRow('m-r4', 4)] }); // what the bounded query returns
    const data = await fetchComebackTokenData('s1', { tournament_id: 'stage-1', last_round: 4 });

    expect(opsOf('matches', 'in')).toContainEqual(['tournament_id', ['stage-1']]);
    // Every page of the paged read carries the bound.
    const pages = opsOf('matches', 'range');
    expect(pages.length).toBeGreaterThan(0);
    expect(opsOf('matches', 'lte')).toEqual(pages.map(() => ['rounds.round_number', 4]));
    expect(data.matches.map((m) => m.id)).toEqual(['m-r4']);
    // Games are read for the kept matches only.
    expect(opsOf('games', 'in')).toContainEqual(['match_id', ['m-r4']]);
  });

  it('without a scope sets no round bound', async () => {
    await fetchComebackTokenData('s1');
    expect(opsOf('matches', 'lte')).toEqual([]);
  });

  it('fails loudly when a row past the Hinrunde comes back (the bound did not apply)', async () => {
    await expect(fetchComebackTokenData('s1', { tournament_id: 'stage-1', last_round: 4 })).rejects.toThrow(
      /match m-r5 of round 5 is past round 4/,
    );
  });

  it('an empty Hinrunde loads no match', async () => {
    const data = await fetchComebackTokenData('s1', { tournament_id: 'stage-1', last_round: 0 });

    expect(data.matches).toEqual([]);
    expect(db.state.calls.some((c) => c.table === 'matches')).toBe(false);
  });

  it('pages matches, games and battle stats past max_rows (never truncated)', async () => {
    const matches = [...Array.from({ length: 1000 }, (_, i) => matchRow(`m${i}`, 1)), matchRow('m-last', 2)];
    setResults('matches', { data: matches });
    const games = [...Array.from({ length: 1000 }, (_, i) => ({ id: `g${i}`, match_id: `m${i}` })), { id: 'g-last', match_id: 'm-last' }];
    setResults('games', { data: games });
    setResults('battle_stats', { data: [{ id: 1, game_id: 'g-last', player_id: 'p1', pokemon_name: 'A', was_koed: false }] });

    const data = await fetchComebackTokenData('s1');

    // A full page proves the server serves 1000 rows, so the short second page is the end.
    expect(opsOf('matches', 'range')).toEqual([[0, 999], [1000, 1999]]);
    expect(opsOf('matches', 'order')).toContainEqual(['id']);
    expect(opsOf('games', 'range')).toEqual([[0, 999], [1000, 1999]]);
    expect(opsOf('games', 'order')).toContainEqual(['id']);
    // A lone short page could be a lower server cap: one more read after it confirms the end.
    expect(opsOf('battle_stats', 'range')).toEqual([[0, 999], [1, 1000]]);
    expect(data.matches).toHaveLength(1001);
    expect(data.gamesByMatch.get('m-last')).toEqual(['g-last']);
    expect(data.statsByGame.get('g-last')).toHaveLength(1);
  });

  it('propagates a games read error instead of returning partial data', async () => {
    const failure = { code: '57014', message: 'canceling statement due to statement timeout' };
    setResults('games', { data: null, error: failure });

    await expect(fetchComebackTokenData('s1')).rejects.toBe(failure);
  });

  it('refuses a scope whose stage is not part of the season', async () => {
    await expect(fetchComebackTokenData('s1', { tournament_id: 'other-season-stage', last_round: 4 })).rejects.toThrow(
      'is not a stage of season s1',
    );
  });
});

describe('getRegisteredSpeciesByMatches (brought = registered team)', () => {
  it('maps match → player → species and leaves players without a team out', async () => {
    setResults('match_prep_teams', {
      data: [
        { id: 'a', match_id: 'm1', player_id: 'p1', pokemon: [{ species: 'Cosmog', moves: [] }, { species: 'Pichu' }] },
        { id: 'b', match_id: 'm2', player_id: 'p2', pokemon: [] },
      ],
    });

    const out = await getRegisteredSpeciesByMatches(['m1', 'm2', 'm1']);

    expect(out.get('m1')).toEqual(new Map([['p1', ['Cosmog', 'Pichu']]]));
    expect(out.get('m2')).toEqual(new Map([['p2', []]]));
    expect(opsOf('match_prep_teams', 'in')).toEqual([['match_id', ['m1', 'm2']]]);
    expect(opsOf('match_prep_teams', 'range')).toEqual([[0, 999]]);
  });

  it('pages past max_rows', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => ({ id: `r${i}`, match_id: `m${i}`, player_id: 'p1', pokemon: [{ species: 'Abra' }] }));
    setResults('match_prep_teams', { data: [...full, { id: 'z', match_id: 'm-last', player_id: 'p1', pokemon: [{ species: 'Gible' }] }] });

    const out = await getRegisteredSpeciesByMatches(['m-last']);

    expect(opsOf('match_prep_teams', 'range')).toEqual([[0, 999], [1000, 1999]]);
    expect(out.get('m-last')).toEqual(new Map([['p1', ['Gible']]]));
  });

  it('throws on a malformed stored team (never read as "no team")', async () => {
    setResults('match_prep_teams', { data: [{ id: 'a', match_id: 'm1', player_id: 'p1', pokemon: [{ name: 'Cosmog' }] }] });

    await expect(getRegisteredSpeciesByMatches(['m1'])).rejects.toThrow('match m1, player p1 has a malformed team');
  });

  it('propagates a read error', async () => {
    const failure = { code: '57014', message: 'canceling statement due to statement timeout' };
    setResults('match_prep_teams', { data: null, error: failure });

    await expect(getRegisteredSpeciesByMatch('m1')).rejects.toBe(failure);
  });

  it('no match ids → no query', async () => {
    expect(await getRegisteredSpeciesByMatches([])).toEqual(new Map());
    expect(db.state.calls).toEqual([]);
  });

  it('a single match without registered teams yields an empty map', async () => {
    setResults('match_prep_teams', { data: [] });
    expect(await getRegisteredSpeciesByMatch('m1')).toEqual(new Map());
  });
});

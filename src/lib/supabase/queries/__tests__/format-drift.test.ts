import { beforeEach, describe, expect, it, vi } from 'vitest';

// A chainable query builder whose `.range()` resolves with the queued result.
const h = vi.hoisted(() => {
  const calls: { method: string; args: unknown[] }[] = [];
  const results: { data: unknown[] | null; error: unknown }[] = [];
  const builder: Record<string, (...args: unknown[]) => unknown> = {};
  for (const method of ['from', 'select', 'not', 'order']) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.range = (...args: unknown[]) => {
    calls.push({ method: 'range', args });
    return Promise.resolve(results.shift() ?? { data: [], error: null });
  };
  return { calls, results, builder };
});

vi.mock('../../client', () => ({ supabase: h.builder }));

import {
  FORMAT_DRIFT_MAX_ROWS,
  FORMAT_DRIFT_PAGE_SIZE,
  listFormatRulesOrders,
  listLeaguePhasesForDrift,
} from '../format-drift';

const ranges = () => h.calls.filter((c) => c.method === 'range').map((c) => c.args);

function ruleRows(count: number, offset = 0) {
  return Array.from({ length: count }, (_, i) => ({
    season_id: `s${offset + i}`,
    tiebreaker_order: ['match_points'],
    seasons: { name: `League ${offset + i}`, archived: false, is_test_season: false },
  }));
}

function phaseRows(count: number, offset = 0) {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${offset + i}`,
    season_id: `s${offset + i}`,
    name: 'Phase',
    stage_order: 1,
    status: 'upcoming',
    advancement_rule: null,
    seasons: { name: 'League', archived: false, is_test_season: false },
  }));
}

beforeEach(() => {
  h.calls.length = 0;
  h.results.length = 0;
});

describe('listFormatRulesOrders', () => {
  it('selects the order with the league fields, ordered by league id, and maps the rows', async () => {
    h.results.push({
      data: [
        {
          season_id: 's1',
          tiebreaker_order: ['match_points', 'head_to_head'],
          seasons: { name: 'Spring', archived: true, is_test_season: true },
        },
      ],
      error: null,
    });

    const { rows, truncated } = await listFormatRulesOrders();

    expect(h.calls.find((c) => c.method === 'from')!.args).toEqual(['format_rules']);
    expect(h.calls.find((c) => c.method === 'select')!.args).toEqual([
      'season_id, tiebreaker_order, seasons ( name, archived, is_test_season )',
    ]);
    expect(h.calls.filter((c) => c.method === 'order').map((c) => c.args)).toEqual([['season_id']]);
    expect(rows).toEqual([
      {
        season_id: 's1',
        season_name: 'Spring',
        archived: true,
        is_test: true,
        tiebreaker_order: ['match_points', 'head_to_head'],
      },
    ]);
    expect(truncated).toBe(false);
  });

  it('pages past 1000 rows with the right bounds and ends on the short page', async () => {
    h.results.push({ data: ruleRows(FORMAT_DRIFT_PAGE_SIZE), error: null });
    h.results.push({ data: ruleRows(3, FORMAT_DRIFT_PAGE_SIZE), error: null });

    const { rows, truncated } = await listFormatRulesOrders();

    expect(rows).toHaveLength(1003);
    expect(truncated).toBe(false);
    expect(ranges()).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it('stops on an empty page after a full one', async () => {
    h.results.push({ data: ruleRows(FORMAT_DRIFT_PAGE_SIZE), error: null });
    h.results.push({ data: [], error: null });

    const { rows, truncated } = await listFormatRulesOrders();

    expect(rows).toHaveLength(FORMAT_DRIFT_PAGE_SIZE);
    expect(truncated).toBe(false);
    expect(ranges()).toHaveLength(2);
  });

  it('stops at the row cap and reports the read as truncated', async () => {
    for (let i = 0; i < FORMAT_DRIFT_MAX_ROWS / FORMAT_DRIFT_PAGE_SIZE + 5; i += 1) {
      h.results.push({ data: ruleRows(FORMAT_DRIFT_PAGE_SIZE, i * FORMAT_DRIFT_PAGE_SIZE), error: null });
    }

    const { rows, truncated } = await listFormatRulesOrders();

    expect(rows).toHaveLength(FORMAT_DRIFT_MAX_ROWS);
    expect(truncated).toBe(true);
    expect(ranges()).toHaveLength(FORMAT_DRIFT_MAX_ROWS / FORMAT_DRIFT_PAGE_SIZE);
  });

  it('treats a missing embed and a malformed order as empty values', async () => {
    h.results.push({ data: [{ season_id: 's1', tiebreaker_order: null, seasons: null }], error: null });

    const { rows } = await listFormatRulesOrders();

    expect(rows).toEqual([
      { season_id: 's1', season_name: '', archived: false, is_test: false, tiebreaker_order: [] },
    ]);
  });

  it('throws the Supabase error', async () => {
    const error = new Error('boom');
    h.results.push({ data: null, error });

    await expect(listFormatRulesOrders()).rejects.toBe(error);
  });
});

describe('listLeaguePhasesForDrift', () => {
  it('selects league phases only, in a stable order, and normalizes the rule', async () => {
    h.results.push({
      data: [
        {
          id: 'p1',
          season_id: 's1',
          name: 'Groups',
          stage_order: 1,
          status: 'active',
          advancement_rule: { type: 'top_n', count: 4, per_group: true },
          seasons: [{ name: 'Spring', archived: false, is_test_season: true }],
        },
        {
          id: 'p2',
          season_id: 's1',
          name: 'Finals',
          stage_order: 2,
          status: 'upcoming',
          advancement_rule: { garbage: true },
          seasons: { name: 'Spring', archived: false, is_test_season: true },
        },
      ],
      error: null,
    });

    const { rows, truncated } = await listLeaguePhasesForDrift();

    expect(h.calls.find((c) => c.method === 'from')!.args).toEqual(['tournaments']);
    expect(h.calls.find((c) => c.method === 'select')!.args).toEqual([
      'id, season_id, name, stage_order, status, advancement_rule, seasons ( name, archived, is_test_season )',
    ]);
    expect(h.calls.find((c) => c.method === 'not')!.args).toEqual(['season_id', 'is', null]);
    expect(h.calls.filter((c) => c.method === 'order').map((c) => c.args)).toEqual([
      ['season_id'],
      ['stage_order'],
      ['id'],
    ]);
    expect(truncated).toBe(false);
    expect(rows[0]).toEqual({
      id: 'p1',
      season_id: 's1',
      season_name: 'Spring',
      archived: false,
      is_test: true,
      name: 'Groups',
      stage_order: 1,
      status: 'active',
      advancement_rule: { type: 'top_n', count: 4, per_group: true },
    });
    expect(rows[1].advancement_rule).toBeNull();
  });

  it('pages past 1000 rows, stops on an empty page and stops at the cap', async () => {
    h.results.push({ data: phaseRows(FORMAT_DRIFT_PAGE_SIZE), error: null });
    h.results.push({ data: phaseRows(3, FORMAT_DRIFT_PAGE_SIZE), error: null });
    const paged = await listLeaguePhasesForDrift();
    expect(paged.rows).toHaveLength(1003);
    expect(ranges()).toEqual([
      [0, 999],
      [1000, 1999],
    ]);

    h.calls.length = 0;
    h.results.push({ data: phaseRows(FORMAT_DRIFT_PAGE_SIZE), error: null });
    h.results.push({ data: [], error: null });
    const empty = await listLeaguePhasesForDrift();
    expect(empty.truncated).toBe(false);
    expect(ranges()).toHaveLength(2);

    h.calls.length = 0;
    for (let i = 0; i < FORMAT_DRIFT_MAX_ROWS / FORMAT_DRIFT_PAGE_SIZE + 5; i += 1) {
      h.results.push({ data: phaseRows(FORMAT_DRIFT_PAGE_SIZE, i * FORMAT_DRIFT_PAGE_SIZE), error: null });
    }
    const capped = await listLeaguePhasesForDrift();
    expect(capped.rows).toHaveLength(FORMAT_DRIFT_MAX_ROWS);
    expect(capped.truncated).toBe(true);
  });

  it('throws the Supabase error', async () => {
    const error = new Error('boom');
    h.results.push({ data: null, error });

    await expect(listLeaguePhasesForDrift()).rejects.toBe(error);
  });
});

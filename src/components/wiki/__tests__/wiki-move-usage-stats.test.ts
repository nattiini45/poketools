import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The widget module imports the shared Table; the loader under test never renders it.
vi.mock('@/components/ui/Table', () => ({ default: () => null }));

import {
  buildMoveUsageStatsUrl,
  loadMoveUsageView,
  moveUsageScopeNeedsId,
  moveUsageViewStatus,
} from '../WikiMoveUsageStats';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const EARTHQUAKE_ROWS = [
  { pokemon_name: 'Garchomp', move_name: 'Earthquake', count: 9, move_type: 'Ground', move_category: 'Physical' },
  { pokemon_name: 'Lucario', move_name: 'Earthquake', count: 2, move_type: 'Ground', move_category: 'Physical' },
];

const FILTERS = {
  leagues: [{ id: 'l1', name: 'Summer League' }],
  tournaments: [{ id: 't1', name: 'Weekly #1' }],
  players: [{ id: 'p1', name: 'Ash' }],
};

function makeFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/stats?')) {
      return jsonResponse({ success: true, data: { rows: EARTHQUAKE_ROWS, pokemonTotals: [] } });
    }
    if (url.startsWith('/api/pokemon/')) {
      return jsonResponse({ success: true, data: FILTERS });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

function statsCalls(fetchImpl: ReturnType<typeof makeFetch>): string[] {
  return fetchImpl.mock.calls
    .map(([input]) => String(input))
    .filter((url) => url.startsWith('/api/stats'));
}

describe('WikiMoveUsageStats data loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('makes exactly one stats request for the first view, filtered server-side by move', async () => {
    const fetchImpl = makeFetch();

    const view = await loadMoveUsageView(
      { moveName: 'Earthquake', scopeType: 'all_time', scopeId: '', withScopeOptions: true },
      fetchImpl as unknown as typeof fetch,
    );

    const stats = statsCalls(fetchImpl);
    expect(stats).toHaveLength(1);
    const url = new URL(stats[0], 'http://localhost');
    expect(url.searchParams.get('view')).toBe('moves');
    expect(url.searchParams.get('scope')).toBe('all_time');
    expect(url.searchParams.get('move')).toBe('Earthquake');
    expect(url.searchParams.has('scope_id')).toBe(false);

    // Scope options come from the move's top user, not from a second stats request.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[1][0])).toBe('/api/pokemon/Garchomp/filters');

    expect(view.rows).toEqual([
      { pokemon_name: 'Garchomp', move_name: 'Earthquake', count: 9 },
      { pokemon_name: 'Lucario', move_name: 'Earthquake', count: 2 },
    ]);
    expect(view.scopeOptions).toEqual({ leagues: FILTERS.leagues, tournaments: FILTERS.tournaments });
  });

  it('makes one stats request and nothing else once scope options are loaded', async () => {
    const fetchImpl = makeFetch();

    await loadMoveUsageView(
      { moveName: 'Earthquake', scopeType: 'league', scopeId: 'l1', withScopeOptions: false },
      fetchImpl as unknown as typeof fetch,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = new URL(statsCalls(fetchImpl)[0], 'http://localhost');
    expect(url.searchParams.get('scope_id')).toBe('l1');
    expect(url.searchParams.get('move')).toBe('Earthquake');
  });

  it('drops rows for other moves when the server ignores the move filter', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        success: true,
        data: {
          rows: [
            { pokemon_name: 'Pikachu', move_name: 'Thunderbolt', count: 50 },
            ...EARTHQUAKE_ROWS,
          ],
          pokemonTotals: [],
        },
      }),
    );

    const view = await loadMoveUsageView(
      { moveName: 'Earthquake', scopeType: 'all_time', scopeId: '', withScopeOptions: false },
      fetchImpl as unknown as typeof fetch,
    );

    expect(view.rows?.map((r) => r.pokemon_name)).toEqual(['Garchomp', 'Lucario']);
  });

  it('skips the filters lookup when nobody used the move', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ success: true, data: { rows: [], pokemonTotals: [] } }),
    );

    const view = await loadMoveUsageView(
      { moveName: 'Splash', scopeType: 'all_time', scopeId: '', withScopeOptions: true },
      fetchImpl as unknown as typeof fetch,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(view).toEqual({ rows: [], scopeOptions: null });
  });

  it('reports a failed stats request as null rows, and logs it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchImpl = vi.fn(async () => jsonResponse({ success: false, error: 'boom' }));

    const view = await loadMoveUsageView(
      { moveName: 'Earthquake', scopeType: 'all_time', scopeId: '', withScopeOptions: true },
      fetchImpl as unknown as typeof fetch,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(view).toEqual({ rows: null, scopeOptions: null });
    expect(error).toHaveBeenCalledWith('[WikiMoveUsageStats] stats request failed:', 'boom');
    error.mockRestore();
  });

  it('reports a network failure as null rows and logs it, but not an abort', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const request = { moveName: 'Earthquake', scopeType: 'all_time', scopeId: '', withScopeOptions: true } as const;
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });

    expect(await loadMoveUsageView(request, offline as unknown as typeof fetch)).toEqual({
      rows: null,
      scopeOptions: null,
    });
    expect(error).toHaveBeenCalledTimes(1);

    const controller = new AbortController();
    controller.abort();
    const aborted = vi.fn(async () => {
      throw new DOMException('aborted', 'AbortError');
    });
    expect(await loadMoveUsageView(request, aborted as unknown as typeof fetch, controller.signal)).toEqual({
      rows: null,
      scopeOptions: null,
    });
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it('never shows a view whose stats request failed as ready (the rows in state are the previous view\'s)', () => {
    const key = 'Earthquake|league|l1';
    expect(moveUsageViewStatus(key, null)).toBe('loading');
    expect(moveUsageViewStatus(key, { key: 'Earthquake|all_time|', failed: false })).toBe('loading');
    expect(moveUsageViewStatus(key, { key, failed: true })).toBe('failed');
    expect(moveUsageViewStatus(key, { key, failed: false })).toBe('ready');
    // Waiting for a league/tournament id: the previous view stays on screen,
    // its rows or its failure (never the "No battle data yet" empty state).
    // Nothing settled yet (the first response never landed): no claim about the data.
    expect(moveUsageViewStatus(null, null)).toBe('loading');
    expect(moveUsageViewStatus(null, { key: 'Earthquake|all_time|', failed: false })).toBe('ready');
    expect(moveUsageViewStatus(null, { key: 'Earthquake|all_time|', failed: true })).toBe('failed');
  });

  it('waits for a league or tournament id before querying', () => {
    expect(moveUsageScopeNeedsId('all_time', '')).toBe(false);
    expect(moveUsageScopeNeedsId('league', '')).toBe(true);
    expect(moveUsageScopeNeedsId('tournament', '')).toBe(true);
    expect(moveUsageScopeNeedsId('tournament', 't1')).toBe(false);
  });

  it('encodes the move name in the stats URL', () => {
    const url = new URL(buildMoveUsageStatsUrl("King's Shield", 'tournament', 't1'), 'http://localhost');
    expect(url.pathname).toBe('/api/stats');
    expect(url.searchParams.get('move')).toBe("King's Shield");
    expect(url.searchParams.get('scope_id')).toBe('t1');
  });

  it('keeps a single stats URL in the widget source (no duplicate or discovery fetch)', () => {
    const source = readFileSync(
      path.resolve(__dirname, '../WikiMoveUsageStats.tsx'),
      'utf8',
    );
    // Only the URL builder spells a stats request (`/api/stats?`); prose mentions don't count.
    expect(source.match(/\/api\/stats\?/g)).toHaveLength(1);
    expect(source.match(/\bfetchImpl\(buildMoveUsageStatsUrl\(/g)).toHaveLength(1);
    expect(source).not.toContain('view=raw');
  });
});

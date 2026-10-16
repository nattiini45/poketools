import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LineId, TokenOverviewDTO } from '@/types/draft-queue';
import { createHttpTokenSource, isTokenOverview } from '../token-source';

const OVERVIEW: TokenOverviewDTO = {
  season_id: 's1',
  player_id: 'p1',
  initial_draft_complete: true,
  redraft_complete: false,
  draft_kill: {
    window: 'open',
    cutoff_at: null,
    cost: 3,
    max: 2,
    owned: 0,
    unspent_points: 5,
    lines: [{ line_id: 'a--a' as LineId, has_token: false, progress: 1, next_threshold: 3, eligible: true, reason: null }],
  },
  comeback: { earned: 2, spent: 0, unspent: 2, history: [{ matchday: 1, score: '0:4', tokens: 1 }], spend_open: false },
  cosmo: null,
  lines: [
    {
      line_id: 'a--a' as LineId,
      stage: 1,
      self_earned_kills: 1,
      transferred_evo_progress: 0,
      draft_token_progress: 0,
      comeback_token_progress: 0,
      cosmo_token_progress: 0,
      total_progress: 1,
      next_threshold: 3,
    },
  ],
};

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isTokenOverview', () => {
  it('accepts the DTO and rejects broken shapes', () => {
    expect(isTokenOverview(OVERVIEW)).toBe(true);
    expect(isTokenOverview({ ...OVERVIEW, lines: [{ line_id: 'x' }] })).toBe(false);
    expect(isTokenOverview({ ...OVERVIEW, draft_kill: { ...OVERVIEW.draft_kill, window: 'later' } })).toBe(false);
    expect(isTokenOverview(null)).toBe(false);
  });
});

describe('createHttpTokenSource', () => {
  it('reads the own overview, or another player for the admin view', async () => {
    const fetchMock = respond(200, { success: true, data: OVERVIEW });
    vi.stubGlobal('fetch', fetchMock);
    const source = createHttpTokenSource('s 1');

    await expect(source.overview()).resolves.toEqual({ ok: true, data: OVERVIEW });
    await source.overview('p2');
    expect(fetchMock.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
      '/api/seasons/s%201/tokens/me',
      '/api/seasons/s%201/tokens/me?player_id=p2',
    ]);
  });

  it('buys one Draft Kill Token with the request id', async () => {
    const fetchMock = respond(200, { success: true, data: OVERVIEW });
    vi.stubGlobal('fetch', fetchMock);
    await createHttpTokenSource('s1').buyDraftKill('a--a' as LineId, 'req-1');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/seasons/s1/draft-kill-tokens');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ line_id: 'a--a', client_request_id: 'req-1' });
  });

  it('spends Comeback Tokens with the API field name `count`', async () => {
    const fetchMock = respond(200, { success: true, data: OVERVIEW });
    vi.stubGlobal('fetch', fetchMock);
    await createHttpTokenSource('s1').spendComeback(
      [
        { line_id: 'a--a' as LineId, tokens: 2 },
        { line_id: 'b--b' as LineId, tokens: 1 },
      ],
      'req-2',
    );
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/seasons/s1/comeback-tokens/spend');
    expect(JSON.parse(String(init.body))).toEqual({
      allocations: [
        { line_id: 'a--a', count: 2 },
        { line_id: 'b--b', count: 1 },
      ],
      client_request_id: 'req-2',
    });
  });

  it('returns rule errors as ApiErrorLike values (code + params), never text', async () => {
    vi.stubGlobal(
      'fetch',
      respond(422, { success: false, error: 'You need 3 unspent points (1 left).', code: 'TOKEN_POINTS_SHORT', params: { needed: 3, remaining: 1 } }),
    );
    const result = await createHttpTokenSource('s1').buyDraftKill('a--a' as LineId, 'req-3');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ code: 'TOKEN_POINTS_SHORT', params: { needed: 3, remaining: 1 } });
  });

  it('a network failure becomes network_error; a malformed success becomes unknown_error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    const net = await createHttpTokenSource('s1').overview();
    expect(net.ok).toBe(false);
    if (!net.ok) expect(net.error.code).toBe('network_error');

    vi.stubGlobal('fetch', respond(200, { success: true, data: { nope: true } }));
    const bad = await createHttpTokenSource('s1').overview();
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe('unknown_error');
  });
});

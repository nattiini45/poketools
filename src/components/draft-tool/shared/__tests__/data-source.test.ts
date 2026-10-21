import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHttpDataSource, DraftDataSourceError } from '@/components/draft-tool/data-source';
import { snapshot } from '@/lib/draft-ui/__tests__/fixtures';

type Call = { url: string; init: RequestInit | undefined };

function mockFetch(...responses: (Response | Error)[]) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error('unexpected fetch');
    if (next instanceof Error) throw next;
    return next;
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const signal = new AbortController().signal;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createHttpDataSource', () => {
  const source = createHttpDataSource('pool-1');

  it('fetches a full snapshot with since', async () => {
    const dto = snapshot();
    const calls = mockFetch(json(200, { success: true, data: dto }));
    await expect(source.fetchSnapshot(41, signal)).resolves.toEqual({ kind: 'full', dto });
    expect(calls[0].url).toBe('/api/drafts/pool-1/state?since=41');
    expect(calls[0].init?.method).toBe('GET');
  });

  it('reports an unchanged snapshot', async () => {
    const calls = mockFetch(
      json(200, { success: true, data: { unchanged: true, state_version: 42, server_now: '2026-10-09T12:00:00.000Z' } }),
    );
    await expect(source.fetchSnapshot(null, signal)).resolves.toEqual({
      kind: 'unchanged',
      version: 42,
      serverNow: '2026-10-09T12:00:00.000Z',
    });
    expect(calls[0].url).toBe('/api/drafts/pool-1/state');
  });

  it('maps 401/403 to auth and errors to ApiErrorLike', async () => {
    mockFetch(
      json(401, { success: false, error: 'Unauthorized', code: 'unauthorized' }),
      json(500, { success: false, error: 'Failed', code: 'DRAFT_NOT_FOUND' }),
      new TypeError('Failed to fetch'),
    );
    await expect(source.fetchSnapshot(null, signal)).resolves.toEqual({ kind: 'auth' });
    await expect(source.fetchSnapshot(null, signal)).resolves.toEqual({
      kind: 'error',
      error: { error: 'Failed', code: 'DRAFT_NOT_FOUND' },
    });
    await expect(source.fetchSnapshot(null, signal)).resolves.toEqual({ kind: 'error', error: { code: 'network_error' } });
  });

  it('posts a pick and returns the applied snapshot', async () => {
    const dto = snapshot();
    const calls = mockFetch(json(201, { success: true, data: { pick: {}, replay: false, state_version: 43, snapshot: dto } }));
    const result = await source.postPick({ slot_id: 'slot-3', line_id: 'mona--x', client_request_id: 'req-1' });
    expect(result).toEqual({ ok: true, data: { pick: {}, replay: false, state_version: 43, snapshot: dto } });
    expect(calls[0].url).toBe('/api/drafts/pool-1/picks');
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      slot_id: 'slot-3',
      line_id: 'mona--x',
      client_request_id: 'req-1',
    });
  });

  it('accepts a committed pick whose snapshot read failed (no snapshot in the body)', async () => {
    mockFetch(json(201, { success: true, data: { pick: {}, replay: false, state_version: 43 } }));
    const result = await source.postPick({ slot_id: 'slot-3', line_id: 'mona--x', client_request_id: 'req-1' });
    expect(result).toEqual({ ok: true, data: { pick: {}, replay: false, state_version: 43 } });
  });

  it('keeps the code, params and fresh snapshot of a rule error', async () => {
    const dto = snapshot();
    mockFetch(
      json(409, {
        success: false,
        error: 'That line is already taken.',
        code: 'LINE_TAKEN',
        params: { line: 'mona--x' },
        detail: { current_slot_id: 'slot-4' },
        snapshot: dto,
      }),
    );
    await expect(source.postPick({ slot_id: 's', line_id: 'mona--x', client_request_id: 'r' })).resolves.toEqual({
      ok: false,
      error: { error: 'That line is already taken.', code: 'LINE_TAKEN', params: { line: 'mona--x' } },
      snapshot: dto,
    });
  });

  it('turns a network failure into network_error', async () => {
    mockFetch(new TypeError('Failed to fetch'));
    await expect(source.postExtension('plus120', 'slot-3')).resolves.toEqual({
      ok: false,
      error: { code: 'network_error' },
    });
  });

  it('posts an extension', async () => {
    const calls = mockFetch(json(200, { success: true, data: { deadline_at: '2026-10-09T12:05:00.000Z', state_version: 44 } }));
    await expect(source.postExtension('plus60', 'slot-3')).resolves.toEqual({
      ok: true,
      data: { deadline_at: '2026-10-09T12:05:00.000Z', state_version: 44 },
    });
    expect(calls[0].url).toBe('/api/drafts/pool-1/extensions');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ kind: 'plus60', slot_id: 'slot-3' });
  });

  it('reads and writes favourites', async () => {
    const calls = mockFetch(
      json(200, { success: true, data: { line_ids: ['mona--x'] } }),
      json(200, { success: true, data: { line_ids: ['mona--x', 'gastly--gengar'] } }),
      json(500, { success: false, error: 'Failed' }),
    );
    await expect(source.getFavorites()).resolves.toEqual(['mona--x']);
    await expect(source.setFavorite('gastly--gengar', true)).resolves.toEqual({
      ok: true,
      data: ['mona--x', 'gastly--gengar'],
    });
    expect(calls[1].init?.method).toBe('PUT');
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ line_id: 'gastly--gengar', favorite: true });
    await expect(source.getFavorites()).resolves.toEqual([]);
  });

  it('returns my-turn data or null', async () => {
    const turn = {
      state_version: 42,
      server_now: '2026-10-09T12:00:00.000Z',
      status: 'in_progress',
      mode: 'slow',
      paused: false,
      on_clock: true,
      up_next: false,
      slot_id: 'slot-3',
      deadline_at: '2026-10-09T20:00:00.000Z',
      remaining_ms_at_pause: null,
      league_name: 'EvoLiga',
    };
    const calls = mockFetch(
      json(200, { success: true, data: turn }),
      json(403, { success: false, error: 'Forbidden' }),
      json(401, { success: false, error: 'Unauthorized' }),
      json(404, { success: false, error: 'Not found' }),
      json(409, { success: false, error: 'Conflict' }),
      json(500, { success: false, error: 'Internal' }),
      json(200, { success: true, data: { nope: true } }),
      new Error('offline'),
    );
    await expect(source.fetchMyTurn(signal)).resolves.toEqual({ kind: 'ok', dto: turn });
    expect(calls[0].url).toBe('/api/drafts/pool-1/my-turn');
    // 401/403/404/409 end the watch; 5xx, bad payloads and network failures are transient.
    for (let i = 0; i < 4; i++) await expect(source.fetchMyTurn(signal)).resolves.toEqual({ kind: 'stop' });
    for (let i = 0; i < 3; i++) await expect(source.fetchMyTurn(signal)).resolves.toEqual({ kind: 'error' });
  });

  it('fetches the search index bare or enveloped, and throws a typed error on failure', async () => {
    mockFetch(
      json(200, { v: 1, listVersionId: 'list-1' }),
      json(200, { success: true, data: { v: 1, listVersionId: 'list-2' } }),
      json(404, { success: false, error: 'Not found', code: 'not_found' }),
    );
    await expect(source.fetchIndex('/api/point-buy-lists/list-1/search-index?v=1&h=abc')).resolves.toEqual({
      v: 1,
      listVersionId: 'list-1',
    });
    await expect(source.fetchIndex('/x')).resolves.toEqual({ v: 1, listVersionId: 'list-2' });
    const failure = source.fetchIndex('/x');
    await expect(failure).rejects.toBeInstanceOf(DraftDataSourceError);
    await expect(failure).rejects.toMatchObject({ status: 404, apiError: { code: 'not_found' } });
  });
});

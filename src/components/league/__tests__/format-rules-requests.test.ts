import { describe, expect, it, vi } from 'vitest';
import { epbPack } from '@/lib/format-pack';
import type { FormatRules } from '@/types/format-rules';
import { defaultFormatRulesPayload } from '@/lib/league-admin/format-rules-form';
import { loadFormatRules, saveFormatRules } from '../format-rules-requests';

const ROW: FormatRules = {
  id: 'fr-1',
  season_id: 's1',
  banned_moves: ['Baton Pass'],
  banned_items: [],
  tera_rules: { ...epbPack.teraByStage },
  tiebreaker_order: ['match_points', 'head_to_head'],
  draft_budget: 180,
  draft_picks: 9,
  draft_token_ratio: 3,
  draft_token_max: 2,
  draft_token_max_per_line: 1,
  redraft_phase_open: false,
  created_at: '2026-01-01T00:00:00Z',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function fakeFetch(response: Response | Error) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    if (response instanceof Error) throw response;
    return response;
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe('loadFormatRules', () => {
  it('a row is loaded', async () => {
    const fetchImpl = fakeFetch(jsonResponse({ success: true, data: ROW }));
    expect(await loadFormatRules('s1', fetchImpl)).toEqual({ kind: 'loaded', rules: ROW });
  });

  it('success with data null is the only empty', async () => {
    const fetchImpl = fakeFetch(jsonResponse({ success: true, data: null }));
    expect(await loadFormatRules('s1', fetchImpl)).toEqual({ kind: 'empty' });
  });

  it('asks for the league’s rules with the id encoded', async () => {
    const fetchImpl = fakeFetch(jsonResponse({ success: true, data: null }));
    await loadFormatRules('a/b c', fetchImpl);
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/seasons/a%2Fb%20c/format-rules');
  });

  it('a 500 with a JSON error is a failure that keeps the error', async () => {
    const fetchImpl = fakeFetch(jsonResponse({ success: false, error: 'Failed to fetch format rules' }, 500));
    expect(await loadFormatRules('s1', fetchImpl)).toEqual({
      kind: 'failed',
      error: { error: 'Failed to fetch format rules' },
    });
  });

  it('a refusal (403, 401) is a failure with its code', async () => {
    for (const status of [401, 403]) {
      const fetchImpl = fakeFetch(jsonResponse({ success: false, error: 'Forbidden', code: 'forbidden' }, status));
      expect(await loadFormatRules('s1', fetchImpl), String(status)).toEqual({
        kind: 'failed',
        error: { error: 'Forbidden', code: 'forbidden' },
      });
    }
  });

  it('success false on an ok status is a failure, never empty', async () => {
    const fetchImpl = fakeFetch(jsonResponse({ success: false, error: 'Season is not a point-buy league', code: 'x' }));
    const result = await loadFormatRules('s1', fetchImpl);
    expect(result.kind).toBe('failed');
  });

  it('an ok status with success true but a failing http status is still a failure', async () => {
    const fetchImpl = fakeFetch(jsonResponse({ success: true, data: null }, 500));
    expect((await loadFormatRules('s1', fetchImpl)).kind).toBe('failed');
  });

  it('a non-JSON body is a failure without an error text', async () => {
    const fetchImpl = fakeFetch(new Response('<html>Bad gateway</html>', { status: 502 }));
    expect(await loadFormatRules('s1', fetchImpl)).toEqual({ kind: 'failed', error: null });
    const okButHtml = fakeFetch(new Response('<html></html>', { status: 200 }));
    expect(await loadFormatRules('s1', okButHtml)).toEqual({ kind: 'failed', error: null });
  });

  it('a thrown fetch is a failure (a network error carries its code)', async () => {
    const result = await loadFormatRules('s1', fakeFetch(new TypeError('Failed to fetch')));
    expect(result).toEqual({ kind: 'failed', error: { code: 'network_error' } });
  });

  it('a data object without a numeric draft_budget is a failure, not a row', async () => {
    for (const data of [{}, { ...ROW, draft_budget: '180' }, { id: 'x' }, 'rules', [], { ...ROW, banned_moves: null }]) {
      const fetchImpl = fakeFetch(jsonResponse({ success: true, data }));
      expect(await loadFormatRules('s1', fetchImpl), JSON.stringify(data)).toEqual({ kind: 'failed', error: null });
    }
  });

  it('a body without a data key is a failure', async () => {
    const fetchImpl = fakeFetch(jsonResponse({ success: true }));
    expect((await loadFormatRules('s1', fetchImpl)).kind).toBe('failed');
  });
});

describe('saveFormatRules', () => {
  const payload = defaultFormatRulesPayload();

  it('PUTs the full body as JSON and returns the stored row', async () => {
    const fetchImpl = fakeFetch(jsonResponse({ success: true, data: ROW }));
    const result = await saveFormatRules('s1', payload, fetchImpl);

    expect(result).toEqual({ ok: true, rules: ROW });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/seasons/s1/format-rules');
    expect(init?.method).toBe('PUT');
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(String(init?.body))).toEqual(JSON.parse(JSON.stringify(payload)));
  });

  it('surfaces the error and code of a 400', async () => {
    const fetchImpl = fakeFetch(
      jsonResponse(
        {
          success: false,
          error: 'Validation failed: Too big',
          code: 'validation_failed',
          params: { issues: 'Too big' },
        },
        400,
      ),
    );
    expect(await saveFormatRules('s1', payload, fetchImpl)).toEqual({
      ok: false,
      error: { error: 'Validation failed: Too big', code: 'validation_failed', params: { issues: 'Too big' } },
    });
  });

  it('a thrown fetch becomes a network error', async () => {
    const result = await saveFormatRules('s1', payload, fakeFetch(new TypeError('offline')));
    expect(result).toEqual({ ok: false, error: { code: 'network_error' } });
  });

  it('a non-JSON response and an ok answer without the row are the generic failure', async () => {
    const html = await saveFormatRules('s1', payload, fakeFetch(new Response('<html>', { status: 502 })));
    expect(html).toEqual({ ok: false, error: { code: 'unknown_error' } });
    const noRow = await saveFormatRules('s1', payload, fakeFetch(jsonResponse({ success: true, data: {} })));
    expect(noRow).toEqual({ ok: false, error: { code: 'unknown_error' } });
  });

  it('encodes the league id in the URL', async () => {
    const fetchImpl = fakeFetch(jsonResponse({ success: true, data: ROW }));
    await saveFormatRules('a/b', payload, fetchImpl);
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/seasons/a%2Fb/format-rules');
  });
});

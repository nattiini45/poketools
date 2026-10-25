import { describe, expect, it, vi } from 'vitest';
import { patchLeagueSettings } from '../league-settings-requests';

function jsonResponse(body: unknown): Response {
  return { json: async () => body } as Response;
}

describe('patchLeagueSettings', () => {
  it('PATCHes only the patch to the season route', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, data: {} }));
    const patch = { name: 'Autumn League', end_date: null };
    await expect(patchLeagueSettings('s/1', patch, fetchImpl as unknown as typeof fetch)).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/seasons/s%2F1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual(patch);
  });

  it('returns the API error body on failure', async () => {
    const failure = { success: false, error: 'Conflict', code: 'SEASON_FORMAT_LOCKED' };
    const fetchImpl = vi.fn(async () => jsonResponse(failure));
    await expect(
      patchLeagueSettings('s1', { format_type: 'draft' }, fetchImpl as unknown as typeof fetch),
    ).resolves.toMatchObject({ error: 'Conflict', code: 'SEASON_FORMAT_LOCKED' });
  });

  it('turns a network failure into an ApiErrorLike', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('offline');
    });
    await expect(patchLeagueSettings('s1', { name: 'x' }, fetchImpl as unknown as typeof fetch)).resolves.toEqual({
      code: 'network_error',
    });
  });
});

/**
 * Cast Studio's MatchSelector, League select. `GET /api/seasons` is the
 * public list and includes test leagues, so the studio (used to rehearse
 * casts on test leagues) reads it as is.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../CastStudioContext', () => ({ useCastStudio: vi.fn() }));

import { fetchSeasonOptions, STUDIO_SEASONS_URL } from '../MatchSelector';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
}

describe('fetchSeasonOptions', () => {
  it('reads the public /api/seasons list (test leagues included there)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, data: [] }));
    await fetchSeasonOptions(fetchImpl as unknown as typeof fetch);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = new URL(String((fetchImpl.mock.calls[0] as unknown[])[0]), 'http://localhost');
    expect(url.pathname).toBe('/api/seasons');
    expect(url.search).toBe('');
    expect(STUDIO_SEASONS_URL).toBe('/api/seasons');
  });

  it('lists every league the route returns, the test league included', async () => {
    const leagues = [
      { id: 's-live', name: 'Live League' },
      { id: 's-test', name: 'Cast Rehearsal (test)' },
    ];
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, data: leagues }));
    await expect(fetchSeasonOptions(fetchImpl as unknown as typeof fetch)).resolves.toEqual(leagues);
  });

  it('lists nothing when the route refuses or the request fails', async () => {
    const refused = vi.fn(async () => jsonResponse({ success: false, error: 'Content creator access required' }));
    await expect(fetchSeasonOptions(refused as unknown as typeof fetch)).resolves.toEqual([]);

    const failed = vi.fn(async () => {
      throw new TypeError('network down');
    });
    await expect(fetchSeasonOptions(failed as unknown as typeof fetch)).resolves.toEqual([]);
  });
});

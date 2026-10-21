import { describe, expect, it, vi } from 'vitest';
import { patchContentLanguage } from '../_components/content-language';

function jsonResponse(body: unknown): Response {
  return { json: async () => body } as Response;
}

describe('patchContentLanguage', () => {
  it('PATCHes only { language } to the season route', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, data: {} }));
    await expect(patchContentLanguage('s1', 'en', fetchImpl as unknown as typeof fetch)).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/seasons/s1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ language: 'en' });
  });

  it('returns the API error body on failure', async () => {
    const failure = { success: false, error: 'Forbidden', code: 'forbidden' };
    const fetchImpl = vi.fn(async () => jsonResponse(failure));
    await expect(patchContentLanguage('s1', 'de', fetchImpl as unknown as typeof fetch)).resolves.toMatchObject({
      error: 'Forbidden',
      code: 'forbidden',
    });
  });

  it('turns a network failure into an ApiErrorLike', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    });
    const res = await patchContentLanguage('s1', 'de', fetchImpl as unknown as typeof fetch);
    expect(res).not.toBeNull();
  });
});

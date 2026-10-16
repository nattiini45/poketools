import { describe, it, expect, vi, afterEach } from 'vitest';
import { createPokepaste } from '../pokepaste';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('createPokepaste', () => {
  it('follows the 303 and returns the absolute paste URL', async () => {
    const mockResponse = {
      status: 303,
      headers: new Headers({ location: '/abcdef0123456789' }),
    } as unknown as Response;
    const fetchMock = vi.fn().mockResolvedValue(mockResponse);
    vi.stubGlobal('fetch', fetchMock);

    const res = await createPokepaste({
      paste: 'Garchomp @ Life Orb\nAbility: Rough Skin\n- Earthquake\n',
      title: 'Test Team',
    });

    expect(res.url).toBe('https://pokepast.es/abcdef0123456789');

    // Verify the request was a form-encoded POST to /create with manual redirect.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://pokepast.es/create');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('manual');
    expect(String(init.body)).toContain('paste=');
    expect(String(init.body)).toContain('title=Test+Team');
  });

  it('throws when no Location header is returned', async () => {
    const mockResponse = {
      status: 400,
      headers: new Headers(),
    } as unknown as Response;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

    await expect(createPokepaste({ paste: 'bad' })).rejects.toThrow(/did not return a paste URL/);
  });

  it('throws on a 200 response that carries a Location header (not a real redirect)', async () => {
    const mockResponse = {
      status: 200,
      headers: new Headers({ location: '/should-not-be-trusted' }),
    } as unknown as Response;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

    await expect(createPokepaste({ paste: 'x' })).rejects.toThrow(/did not return a paste URL/);
  });

  // Optional live test — only runs with POKEPASTE_LIVE=1 to avoid hitting the
  // real service during normal CI runs.
  const live = process.env.POKEPASTE_LIVE === '1' ? it : it.skip;
  live('creates a real paste against pokepast.es', async () => {
    const res = await createPokepaste({
      paste: 'Pikachu @ Light Ball\nAbility: Static\n- Thunderbolt\n- Volt Switch\n',
      title: 'plc-toolkit smoke test',
    });
    expect(res.url).toMatch(/^https:\/\/pokepast\.es\/\w+/);
  }, 15000);
});

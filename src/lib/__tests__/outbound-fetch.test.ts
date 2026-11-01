import { afterEach, describe, expect, it, vi } from 'vitest';
import { DISCORD_TIMEOUT_MS, OutboundHttpError, outboundFetch, outboundHttpError, SOCIAL_TIMEOUT_MS } from '../outbound-fetch';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('outboundFetch', () => {
  it('refuses redirects and sets a deadline, keeping the caller init', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await outboundFetch('https://example.test/x', { method: 'POST', body: 'b', headers: { A: '1' } }, 1234);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://example.test/x');
    expect(init).toMatchObject({ method: 'POST', body: 'b', headers: { A: '1' }, redirect: 'error' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('cannot be told to follow redirects or to drop the deadline', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await outboundFetch(
      'https://example.test/x',
      { redirect: 'follow', signal: new AbortController().signal } as RequestInit,
      1000,
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.redirect).toBe('error');
    expect(init.signal?.aborted).toBe(false);
  });

  it('aborts with a TimeoutError once the deadline passes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
      ),
    );

    await expect(outboundFetch('https://example.test/x', {}, 5)).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it('uses 8 s for Discord and 10 s for the social providers', () => {
    expect(DISCORD_TIMEOUT_MS).toBe(8000);
    expect(SOCIAL_TIMEOUT_MS).toBe(10000);
  });
});

describe('outboundHttpError', () => {
  it('carries provider, step and status, and never the response body', async () => {
    const response = new Response('echoed handle alice.bsky.social and app password PLACEHOLDER-SECRET', { status: 401 });

    const err = await outboundHttpError('Bluesky', 'Session creation', response);

    expect(err).toBeInstanceOf(OutboundHttpError);
    expect(err).toMatchObject({ name: 'OutboundHttpError', provider: 'Bluesky', operation: 'Session creation', status: 401 });
    expect(err.message).toBe('[Bluesky] Session creation failed: 401');
    expect(JSON.stringify(err)).not.toContain('PLACEHOLDER-SECRET');
  });

  it('discards the body unread so the connection is released', async () => {
    const response = new Response('payload', { status: 500 });

    await outboundHttpError('X', 'POST /2/tweets', response);

    await expect(response.text()).rejects.toThrow();
  });

  it('accepts a response without a body stream', async () => {
    await expect(outboundHttpError('Threads', 'Publish post', { status: 502 })).resolves.toMatchObject({ status: 502 });
  });
});

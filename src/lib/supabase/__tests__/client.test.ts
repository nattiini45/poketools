import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The server client always installs a deadline fetch (timeout-fetch.ts, code
 * review H7). DATA-PLAN §4: it additionally wraps it in the metered fetch ONLY
 * when SUPABASE_METER=1 and NODE_ENV !== 'production'. The env group is
 * validated at import (src/lib/env.ts). createClient is mocked, so nothing
 * here builds a real client or touches the network.
 */

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn((..._args: unknown[]) => ({ mocked: true })) }));
vi.mock('@supabase/supabase-js', () => ({ createClient }));

async function loadClient() {
  vi.resetModules();
  return import('@/lib/supabase/client');
}

type Options = { global: { fetch: typeof fetch & { idle?: () => Promise<void> } } };

function options(): Options {
  return createClient.mock.calls[0][2] as Options;
}

describe('supabase server client', () => {
  beforeEach(() => {
    createClient.mockClear();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('installs the deadline fetch without the meter when SUPABASE_METER is unset', async () => {
    vi.stubEnv('SUPABASE_METER', '');
    vi.stubEnv('NODE_ENV', 'development');
    const { supabase } = await loadClient();
    expect(supabase).toEqual({ mocked: true });
    expect(createClient).toHaveBeenCalledTimes(1);
    const call = createClient.mock.calls[0];
    expect(call.slice(0, 2)).toEqual(['http://127.0.0.1:54321', 'test-service-role-key']);
    expect(Object.keys(options())).toEqual(['global']);
    expect(typeof options().global.fetch).toBe('function');
    expect(options().global.fetch.idle).toBeUndefined();
  });

  it('never meters in production, even with SUPABASE_METER=1, but keeps the deadline', async () => {
    vi.stubEnv('SUPABASE_METER', '1');
    vi.stubEnv('NODE_ENV', 'production');
    await loadClient();
    expect(createClient.mock.calls[0].slice(0, 2)).toEqual(['http://127.0.0.1:54321', 'test-service-role-key']);
    expect(typeof options().global.fetch).toBe('function');
    expect(options().global.fetch.idle).toBeUndefined();
  });

  it('ignores SUPABASE_METER values other than "1"', async () => {
    vi.stubEnv('SUPABASE_METER', 'true');
    vi.stubEnv('NODE_ENV', 'development');
    await loadClient();
    expect(options().global.fetch.idle).toBeUndefined();
  });

  it('passes a metered global.fetch with SUPABASE_METER=1 outside production', async () => {
    vi.stubEnv('SUPABASE_METER', '1');
    vi.stubEnv('NODE_ENV', 'development');
    await loadClient();
    expect(Object.keys(options())).toEqual(['global']);
    expect(typeof options().global.fetch.idle).toBe('function');
  });

  it('the production fetch adds a deadline signal and delegates to the global fetch at call time', async () => {
    vi.stubEnv('SUPABASE_METER', '');
    vi.stubEnv('NODE_ENV', 'production');
    await loadClient();
    const response = new Response('[]');
    const stub = vi.fn(async () => response);
    vi.stubGlobal('fetch', stub);

    const res = await options().global.fetch('http://127.0.0.1:54321/rest/v1/players?select=id', { method: 'GET' });

    // The deadline wrapper re-wraps the body stream (body-read timeouts), so compare content, not identity.
    expect(await res.text()).toBe('[]');
    expect(stub).toHaveBeenCalledWith('http://127.0.0.1:54321/rest/v1/players?select=id', {
      method: 'GET',
      signal: expect.any(AbortSignal),
    });
  });

  it('the production fetch turns the deadline into a SupabaseTimeoutError', async () => {
    vi.stubEnv('SUPABASE_METER', '');
    vi.stubEnv('NODE_ENV', 'production');
    const deadline = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    try {
      await loadClient();
      vi.stubGlobal(
        'fetch',
        vi.fn(
          (_input: RequestInfo | URL, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
            })
        )
      );

      const pending = options()
        .global.fetch('http://127.0.0.1:54321/rest/v1/players', { method: 'GET' })
        .catch((e: unknown) => e);
      expect(timeoutSpy).toHaveBeenCalledWith(10_000);
      deadline.abort(new DOMException('timed out', 'TimeoutError'));

      // resetModules gives the client its own copy of the class: compare by name.
      expect(await pending).toMatchObject({ name: 'SupabaseTimeoutError', service: 'rest', timeoutMs: 10_000 });
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it('the metered fetch carries the deadline and logs the request', async () => {
    vi.stubEnv('SUPABASE_METER', '1');
    vi.stubEnv('NODE_ENV', 'development');
    await loadClient();
    const response = new Response('[]', { status: 200, headers: { 'content-length': '2' } });
    const stub = vi.fn(async () => response);
    vi.stubGlobal('fetch', stub);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const res = await options().global.fetch('http://127.0.0.1:54321/rest/v1/players?select=id', { method: 'GET' });
      expect(await res.text()).toBe('[]');
      expect(stub).toHaveBeenCalledWith('http://127.0.0.1:54321/rest/v1/players?select=id', {
        method: 'GET',
        signal: expect.any(AbortSignal),
      });
      expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\[meter:rec\] \{.*"name":"players".*"bytes":2/));
    } finally {
      log.mockRestore();
    }
  });

  it('fails at import with every missing key of its env group', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    await expect(loadClient()).rejects.toThrow(
      /NEXT_PUBLIC_SUPABASE_URL \(missing\), SUPABASE_SERVICE_ROLE_KEY \(missing\)/
    );
    expect(createClient).not.toHaveBeenCalled();
  });

  it('rejects a Supabase URL that is not http(s)', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'not a url');
    await expect(loadClient()).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_URL \(not an http\(s\) URL\)/);
  });
});

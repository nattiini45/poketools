import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * DATA-PLAN §4: the server client installs the metered fetch ONLY when
 * SUPABASE_METER=1 and NODE_ENV !== 'production'. Otherwise createClient is
 * called exactly as before (url, key, no options). createClient is mocked, so
 * nothing here builds a real client or touches the network.
 */

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn((..._args: unknown[]) => ({ mocked: true })) }));
vi.mock('@supabase/supabase-js', () => ({ createClient }));

async function loadClient() {
  vi.resetModules();
  return import('@/lib/supabase/client');
}

describe('supabase server client metering gate', () => {
  beforeEach(() => {
    createClient.mockClear();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('builds the client with exactly (url, key) when SUPABASE_METER is unset', async () => {
    vi.stubEnv('SUPABASE_METER', '');
    vi.stubEnv('NODE_ENV', 'development');
    const { supabase } = await loadClient();
    expect(supabase).toEqual({ mocked: true });
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createClient.mock.calls[0]).toEqual(['http://127.0.0.1:54321', 'test-service-role-key']);
  });

  it('never meters in production, even with SUPABASE_METER=1', async () => {
    vi.stubEnv('SUPABASE_METER', '1');
    vi.stubEnv('NODE_ENV', 'production');
    await loadClient();
    expect(createClient.mock.calls[0]).toEqual(['http://127.0.0.1:54321', 'test-service-role-key']);
  });

  it('ignores values other than "1"', async () => {
    vi.stubEnv('SUPABASE_METER', 'true');
    vi.stubEnv('NODE_ENV', 'development');
    await loadClient();
    expect(createClient.mock.calls[0]).toHaveLength(2);
  });

  it('passes a metered global.fetch with SUPABASE_METER=1 outside production', async () => {
    vi.stubEnv('SUPABASE_METER', '1');
    vi.stubEnv('NODE_ENV', 'development');
    await loadClient();
    const call = createClient.mock.calls[0];
    expect(call).toHaveLength(3);
    expect(call.slice(0, 2)).toEqual(['http://127.0.0.1:54321', 'test-service-role-key']);
    const options = call[2] as { global: { fetch: unknown } };
    expect(Object.keys(options)).toEqual(['global']);
    expect(typeof options.global.fetch).toBe('function');
    expect(typeof (options.global.fetch as { idle?: unknown }).idle).toBe('function');
  });

  it('the metered fetch delegates to the global fetch at call time and logs the request', async () => {
    vi.stubEnv('SUPABASE_METER', '1');
    vi.stubEnv('NODE_ENV', 'development');
    await loadClient();
    const { global } = createClient.mock.calls[0][2] as { global: { fetch: typeof fetch & { idle(): Promise<void> } } };
    const response = new Response('[]', { status: 200, headers: { 'content-length': '2' } });
    const stub = vi.fn(async () => response);
    vi.stubGlobal('fetch', stub);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const res = await global.fetch('http://127.0.0.1:54321/rest/v1/players?select=id', { method: 'GET' });
      expect(res).toBe(response);
      expect(stub).toHaveBeenCalledWith('http://127.0.0.1:54321/rest/v1/players?select=id', { method: 'GET' });
      expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\[meter:rec\] \{.*"name":"players".*"bytes":2/));
    } finally {
      log.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});

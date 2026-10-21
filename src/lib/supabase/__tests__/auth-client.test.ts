import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn((..._args: unknown[]) => ({ mocked: true })) }));
vi.mock('@supabase/supabase-js', () => ({ createClient }));

import { createAuthClient } from '@/lib/supabase/auth-client';

describe('createAuthClient', () => {
  beforeEach(() => {
    createClient.mockClear();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('builds a stateless GoTrue client with the deadline fetch', async () => {
    createAuthClient();

    const [url, key, options] = createClient.mock.calls[0] as [
      string,
      string,
      { auth: Record<string, boolean>; global: { fetch: typeof fetch } },
    ];
    expect(url).toBe('http://127.0.0.1:54321');
    expect(key).toBe('test-anon-key');
    expect(options.auth).toEqual({ persistSession: false, autoRefreshToken: false, detectSessionInUrl: false });

    const stub = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', stub);
    await options.global.fetch('http://127.0.0.1:54321/auth/v1/user');
    expect(stub).toHaveBeenCalledWith('http://127.0.0.1:54321/auth/v1/user', { signal: expect.any(AbortSignal) });
  });

  it('builds a fresh client per call', () => {
    createAuthClient();
    createAuthClient();
    expect(createClient).toHaveBeenCalledTimes(2);
  });

  it('throws one error naming both keys when they are unset', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    expect(() => createAuthClient()).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL \(missing\), NEXT_PUBLIC_SUPABASE_ANON_KEY \(missing\)/
    );
    expect(createClient).not.toHaveBeenCalled();
  });
});

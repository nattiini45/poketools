import { describe, expect, it, vi } from 'vitest';
import { assertLocalSupabaseEnv, EvalEgressError, EvalHostError, installEgressGuard, isLocalUrl, MODEL_API_HOST, prepareEvalEnv } from '../host-guard';

/**
 * Plan 7.2 and 7.4 test 15: the eval refuses any non-local Supabase address before it imports anything, and `fetch` cannot
 * leave the machine (the model API only on a live run). The messages name the variable or the host, never a URL or a key.
 */
describe('assertLocalSupabaseEnv', () => {
  it('refuses a hosted Supabase project and names the variable, not the value', () => {
    let message = '';
    try {
      assertLocalSupabaseEnv({ NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghij.supabase.co' });
    } catch (error) {
      expect(error).toBeInstanceOf(EvalHostError);
      message = (error as Error).message;
    }
    expect(message).toContain('NEXT_PUBLIC_SUPABASE_URL');
    expect(message).not.toContain('abcdefghij');
    expect(message).not.toContain('supabase.co');
  });

  it('refuses the placeholder host the unit-test environment uses', () => {
    expect(() => assertLocalSupabaseEnv({ NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co' })).toThrow(EvalHostError);
  });

  it.each([
    ['SUPABASE_URL', 'https://x.supabase.co'],
    ['DATABASE_URL', 'postgresql://postgres:secret@db.abcdefghij.supabase.co:5432/postgres'],
    ['SUPABASE_DB_URL', 'postgres://u:p@aws-0-eu.pooler.supabase.com:6543/postgres'],
    ['LOCAL_DB_URL', 'http://10.0.0.5:54321'],
    ['POSTGRES_URL', 'not a url'],
  ])('refuses a non-local %s', (key, value) => {
    expect(() => assertLocalSupabaseEnv({ [key]: value })).toThrow(EvalHostError);
  });

  it('names every offending variable and no value', () => {
    let message = '';
    try {
      assertLocalSupabaseEnv({ NEXT_PUBLIC_SUPABASE_URL: 'https://a.supabase.co', DATABASE_URL: 'postgresql://u:topsecretpw@h.supabase.co/db' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('NEXT_PUBLIC_SUPABASE_URL, DATABASE_URL');
    expect(message).not.toContain('topsecretpw');
  });

  it.each([
    'http://127.0.0.1:54321',
    'http://localhost:54321',
    'http://[::1]:54321',
    'http://supabase.localhost:54321',
    'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  ])('passes the local address %s', (value) => {
    expect(() => assertLocalSupabaseEnv({ NEXT_PUBLIC_SUPABASE_URL: value, DATABASE_URL: value })).not.toThrow();
  });

  it('is not fooled by a local-looking prefix or suffix', () => {
    expect(isLocalUrl('http://127.0.0.1.evil.example')).toBe(false);
    expect(isLocalUrl('http://localhost.evil.example')).toBe(false);
    expect(isLocalUrl('http://evil.example/127.0.0.1')).toBe(false);
    expect(isLocalUrl('http://user@evil.example#127.0.0.1')).toBe(false);
    expect(isLocalUrl('')).toBe(false);
  });

  it('treats unset and blank variables as unset', () => {
    expect(() => assertLocalSupabaseEnv({})).not.toThrow();
    expect(() => assertLocalSupabaseEnv({ NEXT_PUBLIC_SUPABASE_URL: '  ', DATABASE_URL: undefined })).not.toThrow();
  });
});

describe('prepareEvalEnv', () => {
  it('points the unset database variables at the local stack and switches the AI forecast off', () => {
    const env: Record<string, string | undefined> = { NEXT_PUBLIC_ENABLE_KALE_CABBAGE: 'true' };
    const set = prepareEvalEnv(env);
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe('http://127.0.0.1:54321');
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
    expect(env.NEXT_PUBLIC_ENABLE_KALE_CABBAGE).toBe('false');
    expect(set).toEqual(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_ENABLE_KALE_CABBAGE']);
  });

  it('keeps a local address and key that are already set', () => {
    const env: Record<string, string | undefined> = { NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54399', SUPABASE_SERVICE_ROLE_KEY: 'local-key', NEXT_PUBLIC_ENABLE_KALE_CABBAGE: 'false' };
    expect(prepareEvalEnv(env)).toEqual([]);
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe('http://localhost:54399');
  });

  it('refuses a hosted address without changing the environment', () => {
    const env: Record<string, string | undefined> = { NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co' };
    expect(() => prepareEvalEnv(env)).toThrow(EvalHostError);
    expect(env).toEqual({ NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co' });
  });
});

describe('installEgressGuard', () => {
  type Guarded = (input: unknown) => Promise<unknown>;

  function target() {
    const calls: string[] = [];
    const fetch = vi.fn(async (input: unknown) => {
      calls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : (input as { url: string }).url);
      return 'sent';
    });
    return { holder: { fetch } as { fetch: unknown }, calls, fetch };
  }

  it('lets local hosts through and blocks everything else before it is sent', async () => {
    const { holder, calls } = target();
    const blocked: string[] = [];
    installEgressGuard(holder, { allowModelApi: false, onBlocked: (host) => blocked.push(host) });
    const guarded = holder.fetch as Guarded;
    await expect(guarded('http://127.0.0.1:54321/rest/v1/players')).resolves.toBe('sent');
    await expect(guarded(new URL('http://localhost:3000/api'))).resolves.toBe('sent');
    await expect(guarded('/relative/path')).resolves.toBe('sent');
    await expect(guarded('https://example.supabase.co/rest/v1/players')).rejects.toBeInstanceOf(EvalEgressError);
    await expect(guarded(new Request('https://discord.com/api/webhooks/1/x'))).rejects.toBeInstanceOf(EvalEgressError);
    await expect(guarded('https://127.0.0.1.evil.example/x')).rejects.toBeInstanceOf(EvalEgressError);
    expect(calls).toEqual(['http://127.0.0.1:54321/rest/v1/players', 'http://localhost:3000/api', '/relative/path']);
    expect(blocked).toEqual(['example.supabase.co', 'discord.com', '127.0.0.1.evil.example']);
  });

  it('blocks the model API unless the run uses the real model', async () => {
    const offline = target();
    installEgressGuard(offline.holder, { allowModelApi: false });
    await expect((offline.holder.fetch as Guarded)(`https://${MODEL_API_HOST}/v1/messages`)).rejects.toBeInstanceOf(EvalEgressError);

    const live = target();
    installEgressGuard(live.holder, { allowModelApi: true });
    await expect((live.holder.fetch as Guarded)(`https://${MODEL_API_HOST}/v1/messages`)).resolves.toBe('sent');
    await expect((live.holder.fetch as Guarded)('https://api.anthropic.com.evil.example/v1/messages')).rejects.toBeInstanceOf(EvalEgressError);
  });

  it('names the host and nothing else in the error, and restores the original fetch', async () => {
    const { holder, fetch } = target();
    const restore = installEgressGuard(holder, { allowModelApi: false });
    let message = '';
    try {
      await (holder.fetch as Guarded)('https://user:pw@example.supabase.co/rest/v1/x?apikey=secretkey');
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('example.supabase.co');
    expect(message).not.toContain('secretkey');
    expect(message).not.toContain('pw@');
    restore();
    expect(holder.fetch).toBe(fetch);
  });
});

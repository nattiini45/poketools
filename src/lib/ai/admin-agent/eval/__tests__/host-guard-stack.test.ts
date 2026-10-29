import { describe, expect, it } from 'vitest';

import { applyStackEnv, EVAL_TOKEN_SECRET, EvalHostError, parseLocalStackStatus } from '../host-guard';

/**
 * The host guard of the local-stack stages: the address and key come from `supabase status -o json`, any host but this machine
 * is refused before a key is read, and the environment the stage sets cannot point a run at a hosted project.
 */
const status = (patch: Record<string, unknown> = {}): string =>
  `WARN: config section [inbucket] is deprecated.\n${JSON.stringify({ API_URL: 'http://127.0.0.1:54321', SERVICE_ROLE_KEY: 'local-service-key', ANON_KEY: 'x', ...patch }, null, 2)}\nA new version of the CLI is available.\n`;

describe('parseLocalStackStatus', () => {
  it('reads the address and the service key out of the CLI text, warnings around the object included', () => {
    expect(parseLocalStackStatus(status())).toEqual({ apiUrl: 'http://127.0.0.1:54321', serviceRoleKey: 'local-service-key' });
    expect(parseLocalStackStatus(status({ API_URL: 'http://localhost:54321' })).apiUrl).toBe('http://localhost:54321');
    // The newer CLI names the key SECRET_KEY.
    expect(parseLocalStackStatus(status({ SERVICE_ROLE_KEY: undefined, SECRET_KEY: 'sb_secret_local' })).serviceRoleKey).toBe('sb_secret_local');
  });

  it('refuses a host that is not this machine, and says nothing of the address or the key', () => {
    for (const apiUrl of ['https://example.supabase.co', 'http://192.168.1.20:54321', 'http://127.0.0.1.evil.example:54321']) {
      let message = '';
      try {
        parseLocalStackStatus(status({ API_URL: apiUrl, SERVICE_ROLE_KEY: 'secret-key-value' }));
      } catch (error) {
        expect(error).toBeInstanceOf(EvalHostError);
        message = (error as Error).message;
      }
      expect(message, apiUrl).toMatch(/does not point at this machine/);
      expect(message).not.toContain('secret-key-value');
      expect(message).not.toContain(apiUrl);
    }
  });

  it('refuses a stack that is not running or reports no key', () => {
    expect(() => parseLocalStackStatus('')).toThrow(/could not read the local Supabase stack/);
    expect(() => parseLocalStackStatus('not json {')).toThrow(EvalHostError);
    expect(() => parseLocalStackStatus(status({ SERVICE_ROLE_KEY: undefined }))).toThrow(/did not report/);
    expect(() => parseLocalStackStatus(status({ API_URL: '' }))).toThrow(/did not report/);
  });
});

describe('applyStackEnv', () => {
  const local = { apiUrl: 'http://127.0.0.1:54321', serviceRoleKey: 'local-service-key' };

  it('points the run at the local stack, switches the assistant on at phase 1 with Go-live, and replaces what the shell held', () => {
    const env: Record<string, string | undefined> = { SUPABASE_SERVICE_ROLE_KEY: 'from-the-shell', NEXTAUTH_SECRET: 'the-real-secret', ADMIN_AGENT_ALLOWED_PLAYER_IDS: 'x', NEXT_PUBLIC_ENABLE_KALE_CABBAGE: 'true' };
    const set = applyStackEnv(env, local);
    expect(env).toMatchObject({
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_SERVICE_ROLE_KEY: 'local-service-key',
      NEXTAUTH_SECRET: EVAL_TOKEN_SECRET,
      NEXT_PUBLIC_ENABLE_KALE_CABBAGE: 'false',
      ADMIN_AGENT_ENABLED: '1',
      ADMIN_AGENT_MAX_PHASE: '1',
      ADMIN_AGENT_GOLIVE: '1',
      ADMIN_AGENT_ROLES: 'any',
    });
    expect(env.ADMIN_AGENT_ALLOWED_PLAYER_IDS).toBeUndefined();
    expect(set).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(EVAL_TOKEN_SECRET.length).toBeGreaterThanOrEqual(16);
  });

  it('refuses a hosted database variable, a production build and the hosted override', () => {
    expect(() => applyStackEnv({ DATABASE_URL: 'postgresql://postgres:x@db.example.supabase.co:5432/postgres' }, local)).toThrow(EvalHostError);
    expect(() => applyStackEnv({ NODE_ENV: 'production' }, local)).toThrow(/NODE_ENV=production/);
    expect(() => applyStackEnv({ ADMIN_AGENT_ALLOW_HOSTED: 'true' }, local)).toThrow(/ALLOW_HOSTED/);
    expect(() => applyStackEnv({ ADMIN_AGENT_ALLOW_HOSTED: '1' }, local)).toThrow(/ALLOW_HOSTED/);
    // A local variable is fine.
    expect(() => applyStackEnv({ DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' }, local)).not.toThrow();
  });
});

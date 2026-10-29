import { describe, expect, it } from 'vitest';
import { AdminAgentHostedDatabaseError, assertLocalDatabase, isLocalDatabaseUrl } from '../local-guard';

describe('the hosted-database guard (plan 6.2)', () => {
  const dev = { nodeEnv: 'development', allowHosted: false } as const;

  it('throws for a hosted project outside a production build', () => {
    expect(() => assertLocalDatabase({ ...dev, url: 'https://example.supabase.co' })).toThrow(AdminAgentHostedDatabaseError);
    expect(() => assertLocalDatabase({ nodeEnv: 'test', allowHosted: false, url: 'https://abcdefgh.supabase.co' })).toThrow(AdminAgentHostedDatabaseError);
  });

  it('accepts the local stack under any local spelling', () => {
    for (const url of ['http://127.0.0.1:54321', 'http://localhost:54321', 'http://[::1]:54321', 'http://127.0.0.1']) {
      expect(() => assertLocalDatabase({ ...dev, url })).not.toThrow();
    }
  });

  it('does not take a lookalike host for a local one', () => {
    for (const url of ['https://localhost.evil.example', 'https://127.0.0.1.evil.example', 'https://evil.example/?127.0.0.1', 'http://localhost@evil.example']) {
      expect(isLocalDatabaseUrl(url), url).toBe(false);
      expect(() => assertLocalDatabase({ ...dev, url })).toThrow(AdminAgentHostedDatabaseError);
    }
  });

  it('fails closed on a missing or unparsable URL', () => {
    expect(() => assertLocalDatabase({ ...dev, url: undefined })).toThrow(AdminAgentHostedDatabaseError);
    expect(() => assertLocalDatabase({ ...dev, url: '' })).toThrow(AdminAgentHostedDatabaseError);
    expect(() => assertLocalDatabase({ ...dev, url: 'not a url' })).toThrow(AdminAgentHostedDatabaseError);
  });

  it('lets a production build and an explicit opt-in through', () => {
    expect(() => assertLocalDatabase({ nodeEnv: 'production', allowHosted: false, url: 'https://example.supabase.co' })).not.toThrow();
    expect(() => assertLocalDatabase({ ...dev, allowHosted: true, url: 'https://example.supabase.co' })).not.toThrow();
  });

  it('names no host in its message', () => {
    try {
      assertLocalDatabase({ ...dev, url: 'https://secret-project.supabase.co' });
    } catch (error) {
      expect((error as Error).message).not.toContain('secret-project');
      expect((error as Error).message).not.toContain('supabase');
    }
  });
});

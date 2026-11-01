import { describe, expect, it } from 'vitest';
import {
  assertLoopbackUrl,
  ciAllowsLocalStack,
  isLoopbackUrl,
  localStackOptIn,
  requireLocalKey,
} from '../local-stack';

describe('isLoopbackUrl', () => {
  it.each([
    'http://127.0.0.1:54321',
    'http://localhost:54321',
    'http://LOCALHOST:54321/rest/v1',
    'http://[::1]:54321',
    'http://127.0.0.1',
  ])('accepts %s', (url) => {
    expect(isLoopbackUrl(url)).toBe(true);
  });

  it.each([
    'https://xyz.supabase.co',
    'https://example.supabase.co',
    'http://127.0.0.1.evil.example',
    'http://localhost.evil.example',
    'http://10.0.0.5:54321',
    'http://0.0.0.0:54321',
    'http://user@evil.example/@127.0.0.1',
  ])('refuses %s', (url) => {
    expect(isLoopbackUrl(url)).toBe(false);
  });

  it.each([undefined, '', '   ', 'not a url', '127.0.0.1:54321'])('refuses the empty or garbage value %j', (value) => {
    expect(isLoopbackUrl(value)).toBe(false);
  });
});

describe('assertLoopbackUrl', () => {
  it('passes for a loopback URL', () => {
    expect(() => assertLoopbackUrl('http://127.0.0.1:54321', 'NEXT_PUBLIC_SUPABASE_URL')).not.toThrow();
  });

  it('names the variable and the host, never the path or credentials, when it refuses a hosted URL', () => {
    expect(() => assertLoopbackUrl('https://xyz.supabase.co/rest/v1?apikey=secret', 'NEXT_PUBLIC_SUPABASE_URL')).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL.*xyz\.supabase\.co/,
    );
    try {
      assertLoopbackUrl('https://xyz.supabase.co/rest/v1?apikey=secret', 'NEXT_PUBLIC_SUPABASE_URL');
    } catch (err) {
      expect(String(err)).not.toContain('secret');
    }
  });

  it('refuses an empty and a malformed value', () => {
    expect(() => assertLoopbackUrl(undefined, 'LOCAL_DB_URL')).toThrow(/LOCAL_DB_URL is not a valid URL/);
    expect(() => assertLoopbackUrl('garbage', 'LOCAL_DB_URL')).toThrow(/LOCAL_DB_URL is not a valid URL/);
  });
});

describe('ciAllowsLocalStack', () => {
  it('allows a developer machine (CI unset)', () => {
    expect(ciAllowsLocalStack({})).toBe(true);
  });

  it('refuses CI unless LOCAL_STACK_CI=1', () => {
    expect(ciAllowsLocalStack({ CI: 'true' })).toBe(false);
    expect(ciAllowsLocalStack({ CI: 'true', LOCAL_STACK_CI: '0' })).toBe(false);
    expect(ciAllowsLocalStack({ CI: 'true', LOCAL_STACK_CI: 'true' })).toBe(false);
  });

  it('allows CI that explicitly declares an ephemeral local stack', () => {
    expect(ciAllowsLocalStack({ CI: 'true', LOCAL_STACK_CI: '1' })).toBe(true);
  });
});

describe('localStackOptIn', () => {
  it('is off without a flag', () => {
    expect(localStackOptIn('LOCAL_RULESETS', {})).toBe(false);
  });

  it('turns on with the suite flag or the shared LOCAL_STACK flag', () => {
    expect(localStackOptIn('LOCAL_RULESETS', { LOCAL_RULESETS: '1' })).toBe(true);
    expect(localStackOptIn('LOCAL_RULESETS', { LOCAL_STACK: '1' })).toBe(true);
    expect(localStackOptIn('LOCAL_RULESETS', { LOCAL_RULESETS: 'true' })).toBe(false);
  });

  it('stays off in CI without LOCAL_STACK_CI=1 even when the flag is set', () => {
    expect(localStackOptIn('LOCAL_RULESETS', { LOCAL_RULESETS: '1', CI: 'true' })).toBe(false);
    expect(localStackOptIn('LOCAL_RULESETS', { LOCAL_STACK: '1', CI: 'true' })).toBe(false);
  });

  it('runs in CI only with both the flag and LOCAL_STACK_CI=1', () => {
    expect(localStackOptIn('LOCAL_RULESETS', { LOCAL_STACK: '1', CI: 'true', LOCAL_STACK_CI: '1' })).toBe(true);
    expect(localStackOptIn('LOCAL_RULESETS', { CI: 'true', LOCAL_STACK_CI: '1' })).toBe(false);
  });
});

describe('requireLocalKey', () => {
  it('returns a key passed in the environment', () => {
    expect(requireLocalKey('SUPABASE_SERVICE_ROLE_KEY', { SUPABASE_SERVICE_ROLE_KEY: 'local-key' })).toBe('local-key');
  });

  it('refuses a missing key and the vitest placeholder', () => {
    expect(() => requireLocalKey('SUPABASE_SERVICE_ROLE_KEY', {})).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(() => requireLocalKey('SUPABASE_SERVICE_ROLE_KEY', { SUPABASE_SERVICE_ROLE_KEY: 'dummy-service-role-key' })).toThrow(
      /SUPABASE_SERVICE_ROLE_KEY/,
    );
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const rpc = vi.fn();
vi.mock('@/lib/supabase/client', () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }));

import {
  checkPublicRateLimit,
  checkRateLimit,
  emailIdentity,
  findClientIp,
  getClientIp,
  getClientRateLimitIp,
  MEMORY_STORE_MAX_KEYS,
  RATE_LIMIT_RPC_TIMEOUT_MS,
  rateLimitIpIdentity,
  rateLimitKey,
  rateLimitStore,
  RateLimitUnavailableError,
  resetMemoryRateLimits,
} from '../rate-limit';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { MissingEnvError } from '@/lib/env';

function headers(init: Record<string, string>): Pick<Request, 'headers'> {
  return { headers: new Headers(init) };
}

describe('rateLimitKey', () => {
  it('hashes the identity: no raw IP or email in the key', () => {
    const key = rateLimitKey('signup-email', 'alice@example.com');
    expect(key).toMatch(/^signup-email:[0-9a-f]{32}$/);
    expect(key).not.toContain('alice');
  });

  it('is stable per identity and distinct across identities and buckets', () => {
    expect(rateLimitKey('b', 'x')).toBe(rateLimitKey('b', 'x'));
    expect(rateLimitKey('b', 'x')).not.toBe(rateLimitKey('b', 'y'));
    expect(rateLimitKey('a', 'x').split(':')[1]).toBe(rateLimitKey('b', 'x').split(':')[1]);
    expect(rateLimitKey('a', 'x')).not.toBe(rateLimitKey('b', 'x'));
  });
});

describe('checkRateLimit', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    rpc.mockReset();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('calls rate_limit_hit with the hashed key, window and max', async () => {
    rpc.mockResolvedValue({ data: [{ allowed: true, hits: 1, retry_after_seconds: 0 }], error: null });

    const result = await checkRateLimit('calc', '203.0.113.7', { limit: 60, windowSeconds: 60 });

    expect(rpc).toHaveBeenCalledWith('rate_limit_hit', {
      p_key: rateLimitKey('calc', '203.0.113.7'),
      p_window_seconds: 60,
      p_max: 60,
    });
    expect(result).toEqual({ allowed: true, remaining: 59, retryAfterSeconds: 0 });
  });

  it('reports a denied hit with the retry delay from the database', async () => {
    rpc.mockResolvedValue({ data: [{ allowed: false, hits: 21, retry_after_seconds: 754 }], error: null });

    const result = await checkRateLimit('import-team', 'player-1', { limit: 20, windowSeconds: 3600 });

    expect(result).toEqual({ allowed: false, remaining: 0, retryAfterSeconds: 754 });
  });

  it('never reports a zero retry delay for a denied hit', async () => {
    rpc.mockResolvedValue({ data: [{ allowed: false, hits: 3, retry_after_seconds: 0 }], error: null });

    const result = await checkRateLimit('b', 'x', { limit: 2, windowSeconds: 10 });

    expect(result.retryAfterSeconds).toBe(1);
  });

  it('fails open by default on an RPC error and logs it without the identity', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'connection refused' } });

    const result = await checkRateLimit('calc', 'secret@example.com', { limit: 5, windowSeconds: 60 });

    expect(result.allowed).toBe(true);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(errorSpy.mock.calls[0]);
    expect(logged).toContain('calc');
    expect(logged).toContain('fail open');
    expect(logged).not.toContain('secret@example.com');
  });

  it('fails closed with a 503 user-facing error when asked to', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'timeout' } });

    const call = checkRateLimit('signup-ip', '198.51.100.1', { limit: 5, windowSeconds: 3600, failMode: 'closed' });

    await expect(call).rejects.toBeInstanceOf(RateLimitUnavailableError);
    await expect(
      checkRateLimit('signup-ip', '198.51.100.1', { limit: 5, windowSeconds: 3600, failMode: 'closed' }),
    ).rejects.toMatchObject({ statusCode: 503, code: 'rate_limit_unavailable' });
    expect(errorSpy).toHaveBeenCalled();
  });

  it('treats a rejected RPC call (network failure, timeout) as limiter unavailable', async () => {
    rpc.mockRejectedValueOnce(new Error('fetch failed'));
    expect((await checkRateLimit('b', 'x', { limit: 1, windowSeconds: 1 })).allowed).toBe(true);

    rpc.mockRejectedValueOnce(new Error('fetch failed'));
    await expect(
      checkRateLimit('b', 'x', { limit: 1, windowSeconds: 1, failMode: 'closed' }),
    ).rejects.toBeInstanceOf(RateLimitUnavailableError);
    expect(errorSpy).toHaveBeenCalledTimes(2);
  });

  it('RateLimitUnavailableError is a UserFacingError (safeErrorResponse passes it through)', () => {
    expect(new RateLimitUnavailableError()).toBeInstanceOf(UserFacingError);
  });

  it('treats an empty or malformed reply as limiter unavailable', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect((await checkRateLimit('b', 'x', { limit: 1, windowSeconds: 1 })).allowed).toBe(true);

    rpc.mockResolvedValue({ data: [{ allowed: 'yes', hits: 1, retry_after_seconds: 0 }], error: null });
    await expect(
      checkRateLimit('b', 'x', { limit: 1, windowSeconds: 1, failMode: 'closed' }),
    ).rejects.toBeInstanceOf(RateLimitUnavailableError);
    expect(errorSpy).toHaveBeenCalledTimes(2);
  });

  it('rejects programming errors before touching the database', async () => {
    await expect(checkRateLimit('Bad Bucket', 'x', { limit: 1, windowSeconds: 1 })).rejects.toThrow(/bucket/);
    await expect(checkRateLimit('b', 'x', { limit: 0, windowSeconds: 1 })).rejects.toThrow(/limit/);
    await expect(checkRateLimit('b', 'x', { limit: 1, windowSeconds: 0 })).rejects.toThrow(/windowSeconds/);
    await expect(checkRateLimit('b', 'x', { limit: 1.5, windowSeconds: 1 })).rejects.toThrow(/limit/);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('getClientIp', () => {
  it('uses the last X-Forwarded-For hop (the one the proxy appended)', () => {
    expect(getClientIp(headers({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9' }))).toBe('203.0.113.9');
  });

  it('cannot be steered by a client-supplied first hop', () => {
    const a = getClientIp(headers({ 'x-forwarded-for': '1.1.1.1, 203.0.113.9' }));
    const b = getClientIp(headers({ 'x-forwarded-for': '2.2.2.2, 203.0.113.9' }));
    expect(a).toBe(b);
  });

  it('handles a single entry, blanks and falls back to X-Real-IP, then unknown', () => {
    expect(getClientIp(headers({ 'x-forwarded-for': '203.0.113.9' }))).toBe('203.0.113.9');
    expect(getClientIp(headers({ 'x-forwarded-for': ' , ', 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4');
    expect(getClientIp(headers({}))).toBe('unknown');
  });

  it('findClientIp reports a missing address as null instead of a shared identity', () => {
    expect(findClientIp(headers({}))).toBeNull();
    expect(findClientIp(headers({ 'x-forwarded-for': ' , ' }))).toBeNull();
    expect(findClientIp(headers({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4');
  });

  it('caps an oversized header value', () => {
    expect(getClientIp(headers({ 'x-forwarded-for': 'x'.repeat(500) })).length).toBe(64);
  });
});

describe('emailIdentity', () => {
  it('normalizes case and whitespace', () => {
    expect(emailIdentity('  Alice@Example.COM ')).toBe('alice@example.com');
  });

  it('keys one inbox once: a +tag is dropped, and Gmail ignores dots and its googlemail alias (#33)', () => {
    expect(emailIdentity('alice+spam1@example.com')).toBe('alice@example.com');
    expect(emailIdentity('A.L.I.C.E+x@GoogleMail.com')).toBe('alice@gmail.com');
    expect(emailIdentity('a.lice@gmail.com')).toBe('alice@gmail.com');
    // Dots matter elsewhere, and an address that is all tag or has no @ is left alone.
    expect(emailIdentity('a.lice@example.com')).toBe('a.lice@example.com');
    expect(emailIdentity('+tag@example.com')).toBe('+tag@example.com');
    expect(emailIdentity('not-an-address')).toBe('not-an-address');
  });
});

describe('rateLimitIpIdentity', () => {
  it('keys an IPv6 address on its /64, in any spelling (#33)', () => {
    expect(rateLimitIpIdentity('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64');
    expect(rateLimitIpIdentity('2001:0DB8:0001:0002::1')).toBe('2001:db8:1:2::/64');
    expect(rateLimitIpIdentity('[2001:db8:1:2::ffff]')).toBe('2001:db8:1:2::/64');
    expect(rateLimitIpIdentity('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(rateLimitIpIdentity('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
  });

  it('leaves IPv4, IPv4-mapped IPv6 and anything unparsable as it is', () => {
    expect(rateLimitIpIdentity('203.0.113.9')).toBe('203.0.113.9');
    expect(rateLimitIpIdentity('::ffff:203.0.113.9')).toBe('::ffff:203.0.113.9');
    expect(rateLimitIpIdentity('1:2:3')).toBe('1:2:3');
    expect(rateLimitIpIdentity('unknown')).toBe('unknown');
  });

  it('is what the request helper and the public limit key on', async () => {
    const ipv6 = { headers: new Headers({ 'x-forwarded-for': '2001:db8:1:2::abcd' }) };
    expect(getClientRateLimitIp(ipv6)).toBe('2001:db8:1:2::/64');
    expect(getClientRateLimitIp({ headers: new Headers() })).toBe('unknown');
  });
});

describe('checkRateLimit timeout', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    rpc.mockReset();
    vi.useFakeTimers();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    errorSpy.mockRestore();
  });

  it('treats a stalled RPC as limiter unavailable after the timeout (fail open)', async () => {
    rpc.mockReturnValue(new Promise(() => {}));

    const call = checkRateLimit('calc', '203.0.113.7', { limit: 5, windowSeconds: 60 });
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_RPC_TIMEOUT_MS);

    await expect(call).resolves.toEqual({ allowed: true, remaining: 0, retryAfterSeconds: 0 });
    expect(JSON.stringify(errorSpy.mock.calls[0])).toContain('fail open');
  });

  it('a stalled RPC on a fail-closed bucket becomes the 503 after the timeout', async () => {
    rpc.mockReturnValue(new Promise(() => {}));

    const call = checkRateLimit('signup-ip', '203.0.113.7', { limit: 5, windowSeconds: 60, failMode: 'closed' });
    const settled = expect(call).rejects.toBeInstanceOf(RateLimitUnavailableError);
    await vi.advanceTimersByTimeAsync(RATE_LIMIT_RPC_TIMEOUT_MS);

    await settled;
  });

  it('an answer inside the timeout is used as is', async () => {
    rpc.mockReturnValue(
      new Promise((resolve) =>
        setTimeout(() => resolve({ data: [{ allowed: false, hits: 6, retry_after_seconds: 30 }], error: null }), 100),
      ),
    );

    const call = checkRateLimit('calc', '203.0.113.7', { limit: 5, windowSeconds: 60 });
    await vi.advanceTimersByTimeAsync(100);

    await expect(call).resolves.toEqual({ allowed: false, remaining: 0, retryAfterSeconds: 30 });
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe('rateLimitStore (store selection)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('RATE_LIMIT_STORE wins when set', () => {
    expect(rateLimitStore({ RATE_LIMIT_STORE: 'postgres' })).toBe('postgres');
    expect(rateLimitStore({ RATE_LIMIT_STORE: 'memory', VERCEL: '1' })).toBe('memory');
    expect(rateLimitStore({ RATE_LIMIT_STORE: ' postgres ' })).toBe('postgres');
  });

  it('unset: postgres only on a Vercel deployment (VERCEL=1)', () => {
    expect(rateLimitStore({ VERCEL: '1' })).toBe('postgres');
    expect(rateLimitStore({ RATE_LIMIT_STORE: '', VERCEL: '1' })).toBe('postgres');
  });

  it('unset and not on Vercel: memory, whatever NODE_ENV says (dev, local next start, capture harness)', () => {
    expect(rateLimitStore({})).toBe('memory');
    expect(rateLimitStore({ NODE_ENV: 'production' })).toBe('memory');
    expect(rateLimitStore({ NODE_ENV: 'development' })).toBe('memory');
    expect(rateLimitStore({ VERCEL: '0' })).toBe('memory');
    expect(rateLimitStore({ VERCEL: '' })).toBe('memory');
  });

  it('an invalid RATE_LIMIT_STORE throws MissingEnvError instead of guessing', () => {
    expect(() => rateLimitStore({ RATE_LIMIT_STORE: 'redis' })).toThrow(MissingEnvError);
    expect(() => rateLimitStore({ RATE_LIMIT_STORE: 'redis' })).toThrow(/RATE_LIMIT_STORE/);
  });

  it('reads process.env by default', () => {
    vi.stubEnv('RATE_LIMIT_STORE', 'memory');
    expect(rateLimitStore()).toBe('memory');
    vi.stubEnv('RATE_LIMIT_STORE', '');
    vi.stubEnv('VERCEL', '1');
    expect(rateLimitStore()).toBe('postgres');
  });

  it('an invalid RATE_LIMIT_STORE fails the check loudly (no silent fallback, no RPC)', async () => {
    rpc.mockReset();
    vi.stubEnv('RATE_LIMIT_STORE', 'redis');
    await expect(checkRateLimit('calc', '203.0.113.7', { limit: 5, windowSeconds: 60 })).rejects.toThrow(
      MissingEnvError,
    );
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('in-memory store (RATE_LIMIT_STORE=memory, or unset off Vercel)', () => {
  beforeEach(() => {
    rpc.mockReset();
    resetMemoryRateLimits();
    vi.stubEnv('RATE_LIMIT_STORE', 'memory');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    resetMemoryRateLimits();
  });

  it('never calls the database (dev and capture runs spend no Supabase quota)', async () => {
    for (let i = 0; i < 3; i++) {
      await checkRateLimit('proxy-image', '127.0.0.1', { limit: 60, windowSeconds: 60 });
    }
    await checkRateLimit('signup-ip', '127.0.0.1', { limit: 5, windowSeconds: 3600, failMode: 'closed' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('counts a fixed window per bucket and identity and resets after it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-18T12:00:00Z'));
    const opts = { limit: 2, windowSeconds: 60 };

    expect(await checkRateLimit('calc', 'a', opts)).toEqual({ allowed: true, remaining: 1, retryAfterSeconds: 0 });
    expect(await checkRateLimit('calc', 'a', opts)).toEqual({ allowed: true, remaining: 0, retryAfterSeconds: 0 });
    vi.advanceTimersByTime(15_000);
    expect(await checkRateLimit('calc', 'a', opts)).toEqual({ allowed: false, remaining: 0, retryAfterSeconds: 45 });
    // Other identities and buckets are independent.
    expect((await checkRateLimit('calc', 'b', opts)).allowed).toBe(true);
    expect((await checkRateLimit('calc-threats', 'a', opts)).allowed).toBe(true);

    vi.advanceTimersByTime(45_000);
    expect(await checkRateLimit('calc', 'a', opts)).toEqual({ allowed: true, remaining: 1, retryAfterSeconds: 0 });
  });

  it('stays bounded: never holds more than MEMORY_STORE_MAX_KEYS keys', async () => {
    for (let i = 0; i < MEMORY_STORE_MAX_KEYS + 25; i++) {
      await checkRateLimit('proxy-image', `ip-${i}`, { limit: 60, windowSeconds: 60 });
    }
    expect(resetMemoryRateLimits()).toBeLessThanOrEqual(MEMORY_STORE_MAX_KEYS);
  });

  it('still rejects programming errors', async () => {
    await expect(checkRateLimit('Bad Bucket', 'x', { limit: 1, windowSeconds: 1 })).rejects.toThrow(/bucket/);
  });
});

describe('checkPublicRateLimit (per-IP limit of a public route)', () => {
  const opts = { limit: 2, windowSeconds: 60 };
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: [{ allowed: true, hits: 1, retry_after_seconds: 0 }], error: null });
    resetMemoryRateLimits();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    warnSpy.mockRestore();
    resetMemoryRateLimits();
  });

  it('keys on the last X-Forwarded-For hop', async () => {
    vi.stubEnv('RATE_LIMIT_STORE', 'postgres');
    await checkPublicRateLimit('proxy-image', headers({ 'x-forwarded-for': '1.1.1.1, 203.0.113.9' }), opts);
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_key: rateLimitKey('proxy-image', '203.0.113.9') });
  });

  it('memory store (local run) without a client IP: allowed, no shared bucket, no RPC', async () => {
    vi.stubEnv('RATE_LIMIT_STORE', 'memory');
    for (let i = 0; i < 5; i++) {
      expect(await checkPublicRateLimit('proxy-image', headers({}), opts)).toEqual({
        allowed: true,
        remaining: 2,
        retryAfterSeconds: 0,
      });
    }
    expect(rpc).not.toHaveBeenCalled();
    // A client WITH an address is still limited locally.
    await checkPublicRateLimit('proxy-image', headers({ 'x-real-ip': '198.51.100.4' }), opts);
    await checkPublicRateLimit('proxy-image', headers({ 'x-real-ip': '198.51.100.4' }), opts);
    expect((await checkPublicRateLimit('proxy-image', headers({ 'x-real-ip': '198.51.100.4' }), opts)).allowed).toBe(false);
  });

  it('Postgres store (deployment) without a client IP: the shared unknown bucket, with a warning', async () => {
    vi.stubEnv('RATE_LIMIT_STORE', 'postgres');
    await checkPublicRateLimit('replay-frames', headers({}), opts);
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_key: rateLimitKey('replay-frames', 'unknown') });
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('shared');
  });

  it('still rejects a bad bucket name on the skip path (programming errors stay loud)', async () => {
    vi.stubEnv('RATE_LIMIT_STORE', 'memory');
    await expect(checkPublicRateLimit('Bad Bucket', headers({}), opts)).rejects.toThrow(/invalid bucket/);
  });
});

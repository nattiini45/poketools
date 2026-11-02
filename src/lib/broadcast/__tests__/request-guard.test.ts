import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMemoryRateLimits } from '@/lib/utils/rate-limit';
import {
  BROADCAST_ROUTE_LIMITS,
  guardBroadcastRequest,
} from '../request-guard';

vi.stubEnv('RATE_LIMIT_STORE', 'memory');

function requestFrom(ip: string | null, query = ''): Request {
  const headers = new Headers();
  if (ip) headers.set('x-forwarded-for', ip);
  return new Request(`http://localhost:3150/api/broadcast/state/x${query}`, { headers });
}

const STATE = { bucket: 'broadcast-state', limit: 3, allowedParams: { enrich: ['true', 'false'] } } as const;

describe('guardBroadcastRequest', () => {
  beforeEach(() => {
    resetMemoryRateLimits();
  });

  it('lets requests through up to the limit, then answers 429 with Retry-After', async () => {
    for (let i = 0; i < 3; i += 1) {
      expect(await guardBroadcastRequest(requestFrom('203.0.113.1'), STATE)).toBeNull();
    }
    const denied = await guardBroadcastRequest(requestFrom('203.0.113.1'), STATE);
    expect(denied?.status).toBe(429);
    expect(Number(denied?.headers.get('Retry-After'))).toBeGreaterThan(0);
    const body = await denied?.json();
    expect(body).toMatchObject({ success: false, code: 'rate_limited' });
    expect(typeof body.error).toBe('string');
  });

  it('keeps one bucket per IP', async () => {
    for (let i = 0; i < 4; i += 1) await guardBroadcastRequest(requestFrom('203.0.113.1'), STATE);
    expect(await guardBroadcastRequest(requestFrom('203.0.113.2'), STATE)).toBeNull();
  });

  it('keeps one bucket per route', async () => {
    for (let i = 0; i < 4; i += 1) await guardBroadcastRequest(requestFrom('203.0.113.1'), STATE);
    const other = { bucket: 'broadcast-preview', limit: 3, allowedParams: {} } as const;
    expect(await guardBroadcastRequest(requestFrom('203.0.113.1'), other)).toBeNull();
  });

  it('refuses an unknown parameter with a coded 400', async () => {
    const res = await guardBroadcastRequest(requestFrom('203.0.113.1', '?x=1'), STATE);
    expect(res?.status).toBe(400);
    expect(await res?.json()).toMatchObject({ success: false, code: 'broadcast_query_invalid' });
  });

  it('refuses any parameter when the route accepts none', async () => {
    const none = { bucket: 'broadcast-solo', limit: 3, allowedParams: {} } as const;
    expect((await guardBroadcastRequest(requestFrom('203.0.113.1', '?enrich=true'), none))?.status).toBe(400);
  });

  it('refuses an unlisted value and a repeated parameter (both mint a new CDN cache key)', async () => {
    expect((await guardBroadcastRequest(requestFrom('203.0.113.1', '?enrich=yes'), STATE))?.status).toBe(400);
    expect((await guardBroadcastRequest(requestFrom('203.0.113.1', '?enrich=true&enrich=true'), STATE))?.status).toBe(400);
  });

  it('accepts enrich=true and enrich=false', async () => {
    expect(await guardBroadcastRequest(requestFrom('203.0.113.1', '?enrich=true'), STATE)).toBeNull();
    expect(await guardBroadcastRequest(requestFrom('203.0.113.1', '?enrich=false'), STATE)).toBeNull();
  });

  it('does not spend the bucket on refused requests', async () => {
    for (let i = 0; i < 20; i += 1) {
      expect((await guardBroadcastRequest(requestFrom('203.0.113.1', '?x=1'), STATE))?.status).toBe(400);
    }
    for (let i = 0; i < 3; i += 1) {
      expect(await guardBroadcastRequest(requestFrom('203.0.113.1'), STATE)).toBeNull();
    }
  });

  it('skips the limit for a request without a client address on the memory store', async () => {
    for (let i = 0; i < 10; i += 1) {
      expect(await guardBroadcastRequest(requestFrom(null), STATE)).toBeNull();
    }
  });
});

describe('BROADCAST_ROUTE_LIMITS', () => {
  it('sizes each route per IP and minute', () => {
    expect(BROADCAST_ROUTE_LIMITS.state).toMatchObject({ bucket: 'broadcast-state', limit: 300 });
    expect(BROADCAST_ROUTE_LIMITS.solo).toMatchObject({ bucket: 'broadcast-solo', limit: 150 });
    expect(BROADCAST_ROUTE_LIMITS.preview).toMatchObject({ bucket: 'broadcast-preview', limit: 60 });
    expect(BROADCAST_ROUTE_LIMITS.standings).toMatchObject({ bucket: 'broadcast-standings', limit: 60 });
  });

  it('accepts only `enrich` on the state route and nothing elsewhere', () => {
    expect(Object.keys(BROADCAST_ROUTE_LIMITS.state.allowedParams)).toEqual(['enrich']);
    for (const key of ['solo', 'preview', 'standings'] as const) {
      expect(BROADCAST_ROUTE_LIMITS[key].allowedParams).toEqual({});
    }
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMemoryRateLimits } from '@/lib/utils/rate-limit';

vi.stubEnv('RATE_LIMIT_STORE', 'memory');

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchById: vi.fn(async () => null),
  getH2HBetweenPlayers: vi.fn(),
  getMatchesByTournament: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonById: vi.fn(async () => null) }));
vi.mock('@/lib/supabase/queries/cast-sessions', () => ({ getCastSessionById: vi.fn(async () => null) }));

import { GET as getState } from '../state/[mid]/route';
import { GET as getSolo } from '../solo/[sessionId]/route';
import { GET as getPreview } from '../preview/[mid]/route';
import { GET as getStandings } from '../standings/[sid]/route';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getCastSessionById } from '@/lib/supabase/queries/cast-sessions';

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

interface RouteUnderTest {
  name: string;
  limit: number;
  path: string;
  call: (request: never, context: never) => Promise<Response>;
  params: Record<string, string>;
  read: ReturnType<typeof vi.fn>;
}

const ROUTES: RouteUnderTest[] = [
  { name: 'state', limit: 300, path: `/api/broadcast/state/${ID}`, call: getState as never, params: { mid: ID }, read: vi.mocked(getMatchById) },
  { name: 'solo', limit: 150, path: `/api/broadcast/solo/${ID}`, call: getSolo as never, params: { sessionId: ID }, read: vi.mocked(getCastSessionById) },
  { name: 'preview', limit: 60, path: `/api/broadcast/preview/${ID}`, call: getPreview as never, params: { mid: ID }, read: vi.mocked(getMatchById) },
  { name: 'standings', limit: 60, path: `/api/broadcast/standings/${ID}`, call: getStandings as never, params: { sid: ID }, read: vi.mocked(getSeasonById) },
];

function hit(route: RouteUnderTest, ip: string, query = ''): Promise<Response> {
  const url = `http://localhost:3150${route.path}${query}`;
  const request = new Request(url, { headers: { 'x-forwarded-for': ip } });
  Object.assign(request, { nextUrl: new URL(url) });
  return route.call(request as never, { params: Promise.resolve(route.params) } as never);
}

async function hitsUntilDenied(route: RouteUnderTest, ip: string): Promise<number> {
  for (let n = 1; n <= route.limit + 5; n += 1) {
    if ((await hit(route, ip)).status === 429) return n;
  }
  return -1;
}

describe('public overlay data routes', () => {
  beforeEach(() => {
    resetMemoryRateLimits();
    vi.clearAllMocks();
  });

  describe.each(ROUTES)('$name', (route) => {
    it(`answers 429 with Retry-After on request ${route.limit + 1} from one IP`, async () => {
      expect(await hitsUntilDenied(route, '198.51.100.7')).toBe(route.limit + 1);
      const denied = await hit(route, '198.51.100.7');
      expect(denied.status).toBe(429);
      expect(Number(denied.headers.get('Retry-After'))).toBeGreaterThan(0);
      expect(await denied.json()).toMatchObject({ success: false, code: 'rate_limited' });
    });

    it('does not limit another IP', async () => {
      await hitsUntilDenied(route, '198.51.100.7');
      expect((await hit(route, '198.51.100.8')).status).not.toBe(429);
    });

    it('refuses an unknown parameter with 400 before any read and without spending the bucket', async () => {
      for (let n = 0; n < route.limit + 20; n += 1) {
        const res = await hit(route, '198.51.100.9', '?x=1');
        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe('broadcast_query_invalid');
      }
      expect(route.read).not.toHaveBeenCalled();
      for (let n = 0; n < 10; n += 1) {
        expect((await hit(route, '198.51.100.9')).status).not.toBe(429);
      }
    });
  });

  it('keeps one bucket per route for the same IP', async () => {
    const [state, solo, preview, standings] = ROUTES;
    expect(await hitsUntilDenied(preview, '198.51.100.10')).toBe(61);
    for (const other of [state, solo, standings]) {
      expect((await hit(other, '198.51.100.10')).status).not.toBe(429);
    }
  });

  it('accepts enrich=true and enrich=false on the state route and refuses other parameters beside them', async () => {
    const [state] = ROUTES;
    expect((await hit(state, '198.51.100.11', '?enrich=true')).status).toBe(404);
    expect((await hit(state, '198.51.100.11', '?enrich=false')).status).toBe(404);
    expect(getMatchById).toHaveBeenCalledTimes(2);
    expect((await hit(state, '198.51.100.11', '?enrich=true&x=1')).status).toBe(400);
    expect(getMatchById).toHaveBeenCalledTimes(2);
  });

  it('refuses even a known name on routes that read no parameter', async () => {
    const [, solo, preview, standings] = ROUTES;
    for (const route of [solo, preview, standings]) {
      expect((await hit(route, '198.51.100.12', '?enrich=true')).status).toBe(400);
    }
  });
});

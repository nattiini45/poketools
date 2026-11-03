import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { assertLoopbackUrl, localStackOptIn } from '@/test/local-stack';

// LIVE-LOCAL proof that every original shared-team request spends the one `team-shared` allowance (60 per minute per
// IP) exactly once, whichever surface answers it: the proxy's missing-link 404, the live page and the API route. It
// runs the real proxy, the real page loader and the real route handler against the Postgres rate-limit store
// (`rate_limit_hit`) of the local stack; only the team reads are stubbed.
// Opt-in only (`npm run test:db`), never in CI without LOCAL_STACK_CI=1, and it never loads `.env`.
const optIn = localStackOptIn('LOCAL_SUPABASE_SHARE_LIMIT');

if (optIn) {
  assertLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
}

const LIVE = '3f2c1a9e-7b4d-4c8a-9e61-5d0a2b7c4e11';
const LIMIT = 60;

const mocks = vi.hoisted(() => ({ headers: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: mocks.headers }));
vi.mock('@/lib/supabase/queries/page-existence', () => ({
  shareLinkIsLive: async (token: string) => token === '3f2c1a9e-7b4d-4c8a-9e61-5d0a2b7c4e11',
  libraryEntryIsPublished: async () => true,
  leagueExists: async () => true,
  tournamentExists: async () => true,
}));
vi.mock('@/lib/supabase/queries/teams', () => ({
  getTeamByShareToken: async (token: string) =>
    token === '3f2c1a9e-7b4d-4c8a-9e61-5d0a2b7c4e11'
      ? { id: 't1', player_id: 'p1', pokemon: [], share_token: token, share_enabled_at: '2026-10-02T10:00:00Z', created_at: '', updated_at: '' }
      : null,
}));

type Kind = 'missing' | 'live' | 'api';

describe.skipIf(!optIn)('team-shared allowance across proxy, page and API (local stack, Postgres store)', () => {
  let proxy: typeof import('@/proxy').proxy;
  let loadSharedTeam: typeof import('@/lib/team/page-loaders').loadSharedTeam;
  let apiGet: typeof import('@/app/api/teams/shared/[token]/route').GET;

  beforeAll(async () => {
    vi.stubEnv('RATE_LIMIT_STORE', 'postgres');
    ({ proxy } = await import('@/proxy'));
    ({ loadSharedTeam } = await import('@/lib/team/page-loaders'));
    ({ GET: apiGet } = await import('@/app/api/teams/shared/[token]/route'));
  });

  afterAll(() => vi.unstubAllEnvs());

  /** A fresh client per test: a random address in the documentation range (2001:db8::/32), so no other run shares the bucket. */
  function freshIp(): string {
    return `2001:db8:${randomBytes(2).toString('hex')}:${randomBytes(2).toString('hex')}::1`;
  }

  /** What Next hands the render: the headers the proxy listed in `x-middleware-override-headers`, with its values. */
  function renderHeaders(response: Response): Headers {
    const forwarded = new Headers();
    for (const name of (response.headers.get('x-middleware-override-headers') ?? '').split(',').filter(Boolean)) {
      const value = response.headers.get(`x-middleware-request-${name}`);
      if (value !== null) forwarded.set(name, value);
    }
    return forwarded;
  }

  /** One original page request: the proxy first, then the page when the proxy lets it through. */
  async function pageRequest(token: string, ip: string, extra: Record<string, string> = {}) {
    const response = await proxy(
      new NextRequest(`https://poketools.test/teams/shared/${token}`, { headers: { 'x-forwarded-for': ip, ...extra } }),
    );
    if (response.status === 404) return { proxyStatus: 404 as const };
    mocks.headers.mockResolvedValue(renderHeaders(response));
    // `loadSharedTeam` is React `cache()`d per render; a second render is a fresh call here.
    return { proxyStatus: 200 as const, result: await loadSharedTeam.call(undefined, token) };
  }

  async function request(kind: Kind, ip: string, extra: Record<string, string> = {}) {
    if (kind === 'api') {
      const response = await apiGet(
        new NextRequest(`https://poketools.test/api/teams/shared/${LIVE}`, { headers: { 'x-forwarded-for': ip } }),
        { params: Promise.resolve({ token: LIVE }) },
      );
      return response.status === 429 ? 'denied' : 'served';
    }
    const token = kind === 'live' ? LIVE : randomUUID();
    const outcome = await pageRequest(token, ip, extra);
    if (outcome.proxyStatus === 404) return 'missing';
    if (outcome.result.status === 'rate_limited') return 'denied';
    return outcome.result.status === 'ok' ? 'served' : outcome.result.status;
  }

  it('counts mixed missing, live and API requests as one allowance, each request once', async () => {
    const ip = freshIp();
    const order: Kind[] = ['missing', 'live', 'api'];
    const outcomes: string[] = [];
    for (let i = 0; i < LIMIT; i++) outcomes.push(await request(order[i % 3], ip));

    // Sixty requests spent the whole allowance: no more, no fewer.
    expect(outcomes.filter((o) => o === 'denied')).toEqual([]);
    expect(outcomes.filter((o) => o === 'missing')).toHaveLength(20);
    expect(outcomes.filter((o) => o === 'served')).toHaveLength(40);

    // The 61st of every kind is refused, so nothing was left over for any of them.
    for (const kind of order) {
      expect(await request(kind, ip), kind).toBe('denied');
    }
  });

  it('spends the allowance on guessed links alone, and then refuses a live link and the API', async () => {
    const ip = freshIp();
    for (let i = 0; i < LIMIT; i++) expect(await request('missing', ip)).toBe('missing');
    expect(await request('live', ip)).toBe('denied');
    expect(await request('api', ip)).toBe('denied');
  });

  it('counts a live page request once, not once in the proxy and again in the page', async () => {
    const ip = freshIp();
    for (let i = 0; i < LIMIT; i++) expect(await request('live', ip), `request ${i + 1}`).toBe('served');
    expect(await request('live', ip)).toBe('denied');
  });

  it('cannot be made to skip the count with a header the client sends', async () => {
    const ip = freshIp();
    for (let i = 0; i < LIMIT; i++) await request('live', ip);
    for (const kind of ['live', 'missing'] as const) {
      expect(await request(kind, ip, { 'x-poketools-share-limit': 'allowed' }), kind).toBe('denied');
    }
  });

  it('keeps clients apart: one spent IP does not limit another', async () => {
    const spent = freshIp();
    for (let i = 0; i < LIMIT; i++) await request('missing', spent);
    expect(await request('live', spent)).toBe('denied');
    expect(await request('live', freshIp())).toBe('served');
  });
});

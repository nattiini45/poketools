/**
 * D36 fix 5 acceptance for the public list pages: a second anonymous render
 * within the TTL issues no Supabase query (DATA-PLAN §5 D: "a second
 * anonymous render of /leagues within the TTL shows 0 Supabase requests").
 *
 * The pages run for real against the in-memory PostgREST and the in-memory
 * `next/cache`; UI components are stubbed (the JSX is never rendered).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { createFakeSupabase, type FakeSupabase } from '@/lib/worlds/__tests__/fake-postgrest';
import { buildFixtureTables, PLAYERS } from '@/lib/worlds/__tests__/world-fixture-db';

const fake = vi.hoisted(() => ({ current: null as FakeSupabase | null }));

vi.mock('@/lib/supabase/client', () => ({
  get supabase() {
    return fake.current!.client;
  },
}));
vi.mock('next/cache', async () =>
  (await import('@/lib/cache/__tests__/fake-next-cache')).fakeNextCache.module,
);
// The pages read the locale cookie (src/i18n/server.ts getLocale). There is no
// request scope here, so the cookie store is empty and the default locale
// applies. A cookie read is not a Supabase query.
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));
vi.mock('@/lib/auth/helpers', () => ({
  getSessionPlayer: vi.fn(async () => null),
}));
vi.mock('@/lib/supabase/queries/players', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/supabase/queries/players')>();
  return { ...actual, getPublicPlayers: vi.fn(actual.getPublicPlayers) };
});

function stub(name: string) {
  const component = (props: { children?: ReactNode }) => props.children ?? null;
  Object.defineProperty(component, 'name', { value: name });
  return { default: component };
}
vi.mock('@/components/ui/PageContainer', () => stub('PageContainer'));
vi.mock('@/components/ui/Card', () => stub('Card'));
vi.mock('@/components/ui/Badge', () => stub('Badge'));
vi.mock('@/components/ui/Button', () => stub('Button'));
vi.mock('@/components/shared/DiscordLoginButton', () => stub('DiscordLoginButton'));
vi.mock('@/components/agent/AgentChatWidget', () => stub('AgentChatWidget'));
vi.mock('@/components/shared/Pokeball', () => stub('Pokeball'));
vi.mock('@/components/shared/PlayerAvatar', () => stub('PlayerAvatar'));
vi.mock('@/components/gamification/RatingBadge', () => stub('RatingBadge'));
vi.mock('@/components/shared/GuestBadge', () => stub('GuestBadge'));

import Home from '../page';
import LeaguesPage from '../leagues/page';
import TournamentsPage from '../tournaments/page';
import PlayersDirectoryPage from '../players/page';
import { fakeNextCache } from '@/lib/cache/__tests__/fake-next-cache';
import { getPublicPlayers } from '@/lib/supabase/queries/players';

function queryCount(): number {
  return fake.current!.queries.length;
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeNextCache.reset();
  const tables = buildFixtureTables();
  fake.current = createFakeSupabase({
    ...tables,
    // The completed-records read embeds `rounds!inner( round_number )`; the
    // fake returns rows whole, so the fixture rows carry the embed.
    matches: tables.matches.map((m) => ({ ...m, rounds: { round_number: 1 } })),
    rulesets: [],
    player_ratings: [],
  });
});

describe('public list pages — warm renders issue no query', () => {
  it.each([
    ['/leagues', () => LeaguesPage()],
    ['/tournaments', () => TournamentsPage()],
    ['/ (anonymous)', () => Home()],
    ['/players (unsearched)', () => PlayersDirectoryPage({ searchParams: Promise.resolve({}) })],
  ] as const)('%s', async (_route, render) => {
    await render();
    const cold = queryCount();
    expect(cold).toBeGreaterThan(0);

    await render();

    expect(queryCount()).toBe(cold);
  });

  it('a /players search is read live (its key space is visitor input)', async () => {
    vi.mocked(getPublicPlayers).mockResolvedValue({ data: [], total: 0 });
    const render = () => PlayersDirectoryPage({ searchParams: Promise.resolve({ q: 'Mara' }) });

    await render();
    await render();

    expect(getPublicPlayers).toHaveBeenCalledTimes(2);
    expect(getPublicPlayers).toHaveBeenCalledWith({ limit: 48, offset: 0, search: 'Mara' });
    expect(fakeNextCache.reads).toHaveLength(0);
  });

  it('the list entries are 60 s entries with their list tags', async () => {
    await LeaguesPage();
    await TournamentsPage();

    expect(fakeNextCache.reads.map((r) => [r.keyParts[1], r.tags, r.revalidate])).toEqual([
      ['season-list', ['seasons'], 60],
      ['tournament-list', ['tournaments'], 60],
    ]);
  });

  it('/leagues reads the league list in one query, test leagues included (no per-row fan-out)', async () => {
    const tables = buildFixtureTables();
    const testLeague = { ...tables.seasons[1], id: 'season-test', name: 'Test league', is_test_season: true };
    fake.current = createFakeSupabase({
      ...tables,
      seasons: [...tables.seasons, testLeague],
      matches: tables.matches.map((m) => ({ ...m, rounds: { round_number: 1 } })),
      rulesets: [],
      player_ratings: [],
    });

    await LeaguesPage();

    const seasonReads = fake.current.queries.filter((q) => q.table === 'seasons');
    expect(seasonReads).toHaveLength(1);
    expect(seasonReads[0].filters).toEqual([{ op: 'eq', column: 'archived', value: false }]);
    expect(seasonReads[0].orders).toEqual([
      { column: 'is_test_season', ascending: true },
      { column: 'created_at', ascending: false },
    ]);
    expect(seasonReads[0].limit).toBe(100);
    // The page's other reads do not grow with the number of leagues listed.
    const cold = queryCount();
    fakeNextCache.reset();
    fake.current = createFakeSupabase({
      ...tables,
      seasons: [...tables.seasons, testLeague, { ...testLeague, id: 'season-test-2' }],
      matches: tables.matches.map((m) => ({ ...m, rounds: { round_number: 1 } })),
      rulesets: [],
      player_ratings: [],
    });
    await LeaguesPage();
    expect(queryCount()).toBe(cold);
  });

  it('the home page caches nothing about the viewer', async () => {
    await Home();

    for (const entry of fakeNextCache.entries.values()) {
      for (const player of PLAYERS) {
        for (const key of ['discord_id', 'auth_user_id', 'ban_reason'] as const) {
          const secret = player[key];
          if (typeof secret === 'string') expect(entry.body).not.toContain(secret);
        }
      }
    }
    expect(fakeNextCache.reads.every((r) => r.tags.length > 0)).toBe(true);
  });
});

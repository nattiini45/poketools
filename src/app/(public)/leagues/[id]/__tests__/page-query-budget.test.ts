/**
 * D36 fix 4 acceptance: the league page's route-world branch stays within its
 * query budget and never touches the stats-tab reads, and the payload it
 * hands the (client) world carries no private player data.
 *
 * The page runs for real against an in-memory PostgREST (no network, no
 * Supabase). World components are stubbed — this test is about the data
 * path, not rendering — and the stats getters are wrapped in spies around
 * their real implementations.
 *
 * `next/cache` is the in-memory fake, emptied before every test: the budgets
 * below are cold-cache budgets. The last block renders twice to prove a warm
 * render issues only the viewer-scoped reads (D36 fix 5).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { createFakeSupabase, type FakeSupabase } from '@/lib/worlds/__tests__/fake-postgrest';
import {
  buildFixtureTables,
  EPB_SEASON_ID,
  PLAYERS,
  SAKURA_SEASON_ID,
} from '@/lib/worlds/__tests__/world-fixture-db';
import type { SessionPlayer } from '@/types/auth';

const fake = vi.hoisted(() => ({ current: null as FakeSupabase | null }));

vi.mock('next/cache', async () =>
  (await import('@/lib/cache/__tests__/fake-next-cache')).fakeNextCache.module,
);

vi.mock('@/lib/supabase/client', () => ({
  get supabase() {
    return fake.current!.client;
  },
}));

vi.mock('@/lib/auth/helpers', () => ({
  getSessionPlayer: vi.fn(async () => null),
}));

// The viewer's language is a cookie (i18n-core §1.2), never a query: the page
// reads it through `next/headers`, which only exists inside a request, so the
// cookie store is a jar each test may fill (empty = English, the default).
const { cookieJar } = vi.hoisted(() => ({ cookieJar: new Map<string, string>() }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name) as string } : undefined),
  }),
}));

// Spies around the REAL stats getters: the world branch must never call them.
vi.mock('@/lib/supabase/queries/games', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/supabase/queries/games')>();
  return { ...actual, getBattleStatsForSeason: vi.fn(actual.getBattleStatsForSeason) };
});
vi.mock('@/lib/supabase/queries/aggregates', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/supabase/queries/aggregates')>();
  return {
    ...actual,
    getAggregates: vi.fn(actual.getAggregates),
    getAggregatesSummary: vi.fn(actual.getAggregatesSummary),
    getTotalGamesInScope: vi.fn(actual.getTotalGamesInScope),
  };
});
vi.mock('@/lib/supabase/queries/rulesets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/supabase/queries/rulesets')>();
  return { ...actual, getRulesetById: vi.fn(actual.getRulesetById) };
});
vi.mock('@/lib/worlds/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/worlds/registry')>();
  return { ...actual, resolveViewerWorld: vi.fn(actual.resolveViewerWorld) };
});

// Rendering stubs: the page's JSX is inspected, never rendered.
function stub(name: string) {
  const component = (props: { children?: ReactNode }) => props.children ?? null;
  Object.defineProperty(component, 'name', { value: name });
  return { default: component };
}
vi.mock('@/components/world/evoliga/EvoligaWorld', () => stub('EvoligaWorld'));
vi.mock('@/components/world/themes/sakura/SakuraWorld', () => stub('SakuraWorld'));
vi.mock('@/components/world/themes/mountain/MountainWorld', () => stub('MountainWorld'));
vi.mock('@/components/world/themes/clouds/CloudsWorld', () => stub('CloudsWorld'));
vi.mock('@/components/world/default/DefaultWorld', () => stub('DefaultWorld'));
vi.mock('@/components/world/route/WorldOverrideRedirect', () => stub('WorldOverrideRedirect'));
vi.mock('@/components/ui/PageContainer', () => stub('PageContainer'));
vi.mock('@/components/ruleset/RulesetDetail', () => stub('RulesetDetail'));

import LeagueDetailPage from '../page';
import { fakeNextCache } from '@/lib/cache/__tests__/fake-next-cache';
import { getSessionPlayer } from '@/lib/auth/helpers';
import { getBattleStatsForSeason } from '@/lib/supabase/queries/games';
import {
  getAggregates,
  getAggregatesSummary,
  getTotalGamesInScope,
} from '@/lib/supabase/queries/aggregates';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { resolveViewerWorld } from '@/lib/worlds/registry';

// 10 + the league-groups read (group tables of the standings; league groups, 2026-10).
const WORLD_BRANCH_BUDGET = 11;

type AnyElement = ReactElement<Record<string, unknown>>;

function childrenOf(element: AnyElement): AnyElement[] {
  const children = element.props.children as ReactNode;
  const list = Array.isArray(children) ? children : [children];
  return list.filter((c): c is AnyElement => typeof c === 'object' && c !== null && 'props' in c);
}

function findByName(element: AnyElement, name: string): AnyElement | undefined {
  return childrenOf(element).find(
    (child) => typeof child.type === 'function' && (child.type as { name: string }).name === name,
  );
}

async function renderPage(seasonId: string): Promise<AnyElement> {
  return (await LeagueDetailPage({
    params: Promise.resolve({ id: seasonId }),
    searchParams: Promise.resolve({}),
  })) as AnyElement;
}

function expectNoStatsReads(): void {
  expect(getBattleStatsForSeason).not.toHaveBeenCalled();
  expect(getAggregates).not.toHaveBeenCalled();
  expect(getAggregatesSummary).not.toHaveBeenCalled();
  expect(getRulesetById).not.toHaveBeenCalled();
  expect(getTotalGamesInScope).not.toHaveBeenCalled();
}

function expectNoPrivatePlayerData(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const player of PLAYERS) {
    for (const key of ['discord_id', 'auth_user_id', 'ban_reason'] as const) {
      const secret = player[key];
      if (typeof secret === 'string') expect(serialized).not.toContain(secret);
    }
  }
  for (const key of ['discord_id', 'auth_user_id', 'ban_reason', 'suspended_until', 'is_admin', 'is_test_account']) {
    expect(serialized).not.toContain(`"${key}"`);
  }
}

const SIGNED_IN: SessionPlayer = {
  playerId: 'p2',
  name: 'Jonas Riedl',
  isAdmin: false,
  isResourceAdmin: false,
  isCreator: false,
  psUsername: '',
  championsUsername: '',
  avatarUrl: null,
  status: 'active',
};

beforeEach(() => {
  vi.clearAllMocks();
  cookieJar.clear();
  fakeNextCache.reset();
  fake.current = createFakeSupabase(
    {
      ...buildFixtureTables(),
      rulesets: [],
      aggregates: [
        {
          id: 'agg-1',
          scope_type: 'league',
          scope_id: EPB_SEASON_ID,
          pokemon_name: 'Charizard',
          total_appearances: 4,
          total_brought: 3,
          total_led: 1,
          total_kos_dealt: 5,
          total_koed: 2,
          total_wins: 3,
          total_games: 4,
          move_counts: { Flamethrower: 9 },
          last_updated: '2026-09-20T00:00:00.000Z',
        },
      ],
      battle_stats: [],
      tournament_groups: [],
      tournament_reports: [],
    },
    { get_total_games_in_scope: () => 7 },
  );
});

describe('league page — route-world branch query budget', () => {
  it.each([EPB_SEASON_ID, SAKURA_SEASON_ID])(
    'season %s: the viewer language (plc_locale=de) is a cookie read and adds no query',
    async (seasonId) => {
      await renderPage(seasonId);
      const english = fake.current!.queries.map((q) => q.table).sort();

      fakeNextCache.reset();
      fake.current!.reset();
      cookieJar.set('plc_locale', 'de');
      await renderPage(seasonId);
      const german = fake.current!.queries.map((q) => q.table).sort();

      expect(german).toEqual(english);
      expect(german.length).toBeLessThanOrEqual(WORLD_BRANCH_BUDGET);
      expectNoStatsReads();
    },
  );

  it(`EPB, anonymous: ≤ ${WORLD_BRANCH_BUDGET} queries and no stats-tab reads`, async () => {
    const page = await renderPage(EPB_SEASON_ID);

    const queries = fake.current!.queries;
    expect(queries.length).toBeLessThanOrEqual(WORLD_BRANCH_BUDGET);
    expect(queries.map((q) => q.table).sort()).toEqual([
      'draft_pools',
      'evolution_tracker',
      'format_rules',
      'matches',
      'point_buy_list_entries',
      // League groups: the standings' group tables (none in this fixture league; one read).
      'season_groups',
      'season_participants',
      'seasons',
      'teams',
      // The public world aces (spec §7) read the team leads twice: the season's
      // rows and its stages' rows (where a played match's team lives). Each read
      // embeds its own visibility facts (linked match status + tournament
      // setting), so no separate facts read follows. Required: without the stage
      // rows a hidden_until_match league shows no aces.
      'teams',
      'tournaments',
    ]);
    expectNoStatsReads();
    expect(findByName(page, 'EvoligaWorld')).toBeDefined();
  });

  it(`non-EPB (sakura), anonymous: ≤ ${WORLD_BRANCH_BUDGET} queries and no stats-tab reads`, async () => {
    const page = await renderPage(SAKURA_SEASON_ID);

    expect(fake.current!.queries.length).toBeLessThanOrEqual(WORLD_BRANCH_BUDGET);
    // 8 route-world reads + the second team-lead read (the stage rows; each lead
    // read embeds its spec §7 facts, see the EPB case above) + the league-groups read.
    expect(fake.current!.queries).toHaveLength(10);
    expectNoStatsReads();
    expect(findByName(page, 'SakuraWorld')).toBeDefined();
  });

  it('each table is read at most once (no season, stage, participant or tracker re-read)', async () => {
    await renderPage(EPB_SEASON_ID);

    const counts = new Map<string, number>();
    for (const q of fake.current!.queries) counts.set(q.table, (counts.get(q.table) ?? 0) + 1);
    for (const [table, count] of counts) {
      // `teams` is read twice by design: the season-row and the stage-row team
      // leads, each with its spec §7 facts embedded. Every other table exactly once.
      expect({ table, count }).toEqual({ table, count: table === 'teams' ? 2 : 1 });
    }
  });

  it('EPB, signed in: only the viewer-scoped world-preference read is added (trades are retired)', async () => {
    vi.mocked(getSessionPlayer).mockResolvedValue(SIGNED_IN);

    await renderPage(EPB_SEASON_ID);

    const tables = fake.current!.queries.map((q) => q.table);
    // 9 bare reads + the stage-row team-lead read (facts embedded, spec §7) + the league-groups read +
    // the viewer's world preference.
    expect(tables).toHaveLength(11 + 1);
    expect(tables.filter((t) => t === 'players')).toHaveLength(1);
    expect(tables).not.toContain('redraft_trade_requests');
    expectNoStatsReads();
  });
});

describe('league page — the world payload is public-only', () => {
  it.each([EPB_SEASON_ID, SAKURA_SEASON_ID])('season %s: no private player field or value', async (seasonId) => {
    const page = await renderPage(seasonId);
    const world = findByName(page, 'EvoligaWorld') ?? findByName(page, 'SakuraWorld');

    expect(world).toBeDefined();
    const data = world!.props.data as { participants: Record<string, unknown>[] };
    expect(data.participants.length).toBe(4);
    for (const participant of data.participants) {
      expect(Object.keys(participant).sort()).toEqual(['gym_type', 'id', 'name']);
    }
    expectNoPrivatePlayerData(world!.props);
  });
});

describe('league page — the 3D world is opt-in (DEFAULT_WORLD_EXPERIENCE)', () => {
  it.each([EPB_SEASON_ID, SAKURA_SEASON_ID])('season %s, anonymous: the world gets the default off', async (seasonId) => {
    vi.mocked(getSessionPlayer).mockResolvedValue(null);
    const page = await renderPage(seasonId);
    const world = findByName(page, 'EvoligaWorld') ?? findByName(page, 'SakuraWorld');

    expect(world).toBeDefined();
    expect(world!.props.worldExperience).toBe('off');
  });

  it('signed in: the stored choice is threaded, not the default', async () => {
    vi.mocked(getSessionPlayer).mockResolvedValue(SIGNED_IN);
    const page = await renderPage(EPB_SEASON_ID);
    const world = findByName(page, 'EvoligaWorld');

    // The fixture row stores 'auto' (world-fixture-db.ts).
    expect(world!.props.worldExperience).toBe('auto');
  });
});

describe('league page — DefaultWorld fallback branch', () => {
  it('reads the stats tab data, with aggregate counters only', async () => {
    const actual = await vi.importActual<typeof import('@/lib/worlds/registry')>('@/lib/worlds/registry');
    vi.mocked(resolveViewerWorld).mockImplementationOnce((season, override) => ({
      ...actual.resolveViewerWorld(season, override),
      id: 'unregistered-theme',
    }));

    const page = await renderPage(EPB_SEASON_ID);

    const fallback = findByName(page, 'DefaultWorld');
    expect(fallback).toBeDefined();
    expect(getAggregatesSummary).toHaveBeenCalledWith('league', EPB_SEASON_ID);
    expect(getAggregates).not.toHaveBeenCalled();
    expect(getBattleStatsForSeason).toHaveBeenCalledWith(EPB_SEASON_ID);
    expect(getTotalGamesInScope).toHaveBeenCalledWith('league', EPB_SEASON_ID);

    const aggregateRead = fake.current!.queries.find((q) => q.table === 'aggregates')!;
    expect(aggregateRead.select).not.toContain('move_counts');
    const usageRows = fallback!.props.usageRows as { pokemon_name: string; usage_percent: number }[];
    expect(usageRows).toEqual([expect.objectContaining({ pokemon_name: 'Charizard', usage_percent: (4 / 7) * 100 })]);
    // The schedule reuses the stages and participants the page already read.
    expect(fake.current!.queries.filter((q) => q.table === 'season_participants')).toHaveLength(1);
    expect(fake.current!.queries.filter((q) => q.table === 'matches')).toHaveLength(1);
    expectNoPrivatePlayerData(fallback!.props.typeCoreParticipants ?? []);
  });
});

describe('league page — public read cache (D36 fix 5)', () => {
  // `clearAllMocks` keeps an earlier test's signed-in session; start anonymous.
  beforeEach(() => {
    vi.mocked(getSessionPlayer).mockResolvedValue(null);
  });

  it.each([EPB_SEASON_ID, SAKURA_SEASON_ID])('season %s, anonymous: a warm render issues no query', async (seasonId) => {
    await renderPage(seasonId);
    const cold = fake.current!.queries.length;
    expect(cold).toBeGreaterThan(0);

    await renderPage(seasonId);

    expect(fake.current!.queries).toHaveLength(cold);
    expect(fakeNextCache.reads.slice(-4).every((r) => r.hit)).toBe(true);
  });

  it('EPB, signed in: a warm render issues only the viewer-scoped world-preference read', async () => {
    vi.mocked(getSessionPlayer).mockResolvedValue(SIGNED_IN);
    await renderPage(EPB_SEASON_ID);
    const cold = fake.current!.queries.length;

    await renderPage(EPB_SEASON_ID);

    const warm = fake.current!.queries.slice(cold).map((q) => q.table).sort();
    expect(warm).toEqual(['players']);
  });

  it('the warm world payload is still public-only', async () => {
    await renderPage(EPB_SEASON_ID);
    const page = await renderPage(EPB_SEASON_ID);

    const world = findByName(page, 'EvoligaWorld');
    expect(world).toBeDefined();
    const data = world!.props.data as { participants: Record<string, unknown>[] };
    for (const participant of data.participants) {
      expect(Object.keys(participant).sort()).toEqual(['gym_type', 'id', 'name']);
    }
    expectNoPrivatePlayerData(world!.props);
    for (const entry of fakeNextCache.entries.values()) expectNoPrivatePlayerData(entry.body);
  });

  it('every read the page caches is tagged with its season', async () => {
    await renderPage(EPB_SEASON_ID);

    expect(fakeNextCache.reads.length).toBeGreaterThan(0);
    for (const read of fakeNextCache.reads) {
      expect(read.tags).toContain(`season:${EPB_SEASON_ID}`);
      expect(read.revalidate).toBe(30);
    }
  });
});

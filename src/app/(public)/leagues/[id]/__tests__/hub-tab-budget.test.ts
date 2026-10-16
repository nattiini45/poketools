/**
 * League hub acceptance: the tabbed overview inside the route world's #pulse
 * section reads ONLY the selected tab's data, and a bare league URL keeps the
 * route-world budget of `page-query-budget.test.ts` exactly.
 *
 * Same harness as that test: the page runs for real against the in-memory
 * PostgREST (no network, no Supabase, no .env), `next/cache` is the in-memory
 * fake (emptied before every test, so budgets are cold-cache budgets), the
 * stats getters and `getRulesetById` are spies around their real
 * implementations, and the world roots are stubs that keep their props. The
 * hub reaches a world as its `hub` prop: a `LeagueHub` element whose props
 * (tabs, activeTab, panel, query) are inspected without rendering. The tab
 * links are read from the hub's own element tree (`LeagueHub(props)` is a
 * hook-free server component; its children are never invoked).
 *
 * The shared fixture is extended HERE only (the golden route-data test owns
 * `world-fixture-db.ts`): rounds for every stage, phase enrollments, two
 * groups on the first EPB stage, a single-elimination playoff stage on the
 * EPB season (with its own matches), a Swiss stage on the sakura season, two
 * rulesets and one Kale report.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import {
  createFakeSupabase,
  type FakeRow,
  type FakeSupabase,
  type FakeTables,
  type RecordedQuery,
} from '@/lib/worlds/__tests__/fake-postgrest';
import {
  buildFixtureTables,
  EPB_SEASON_ID,
  PLAYERS,
  SAKURA_SEASON_ID,
} from '@/lib/worlds/__tests__/world-fixture-db';
import type { SessionPlayer } from '@/types/auth';
import type { LeagueHubPanelData } from '@/lib/league-hub/load';
import type { LeagueHubTab } from '@/lib/league-hub/tabs';

const fake = vi.hoisted(() => ({ current: null as FakeSupabase | null }));
// The Kale flag is read per access, so a test can switch the reports tab on.
const flags = vi.hoisted(() => ({ kale: false }));

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

vi.mock('@/lib/feature-flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/feature-flags')>();
  return {
    ...actual,
    get ENABLE_KALE_CABBAGE() {
      return flags.kale;
    },
  };
});

// Spies around the REAL getters: only the tab that renders them may call them.
vi.mock('@/lib/supabase/queries/games', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/supabase/queries/games')>();
  return {
    ...actual,
    getBattleStatsForSeason: vi.fn(actual.getBattleStatsForSeason),
    getBattleStatsForTournament: vi.fn(actual.getBattleStatsForTournament),
  };
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

// Rendering stubs: the page's JSX is inspected, never rendered. LeagueHub is
// NOT stubbed: the page only creates its element, and the link test walks the
// element tree the real component returns.
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
vi.mock('@/components/league/TradeConsentPrompt', () => stub('TradeConsentPrompt'));
vi.mock('@/components/ui/PageContainer', () => stub('PageContainer'));
vi.mock('@/components/ruleset/RulesetDetail', () => stub('RulesetDetail'));

import LeagueDetailPage from '../page';
import LeagueHub, { LEAGUE_HUB_PANEL_ID, type LeagueHubProps } from '@/components/league/hub/LeagueHub';
import { fakeNextCache } from '@/lib/cache/__tests__/fake-next-cache';
import { getSessionPlayer } from '@/lib/auth/helpers';
import { getBattleStatsForSeason, getBattleStatsForTournament } from '@/lib/supabase/queries/games';
import {
  getAggregates,
  getAggregatesSummary,
  getTotalGamesInScope,
} from '@/lib/supabase/queries/aggregates';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';

// ─── Fixture extension (local to this file) ───────────────────────────────

const ISO = '2026-09-01T12:00:00.000Z';

/** The EPB season's added single-elimination stage (stage_order after the two round robins). */
const PLAYOFF_STAGE = 'e-stage-3';
/** The sakura season's added Swiss stage (a table stage that is not round robin). */
const SWISS_STAGE = 's-stage-2';

const EPB_TABLE_STAGES = ['e-stage-1', 'e-stage-2'];
const EPB_STAGES = [...EPB_TABLE_STAGES, PLAYOFF_STAGE];
const SAKURA_STAGES = ['s-stage-1', SWISS_STAGE];
const ALL = ['p1', 'p2', 'p3', 'p4'];
/** Playoff seeding differs from the season order, so seed order is observable. */
const PLAYOFF_SEEDING = ['p4', 'p1', 'p2', 'p3'];

const playerById = new Map(PLAYERS.map((p) => [p.id as string, p]));

function playerRow(id: string): FakeRow {
  const row = playerById.get(id);
  if (!row) throw new Error(`unknown fixture player ${id}`);
  return row;
}

function roundRow(
  id: string,
  tournamentId: string,
  name: string,
  roundNumber: number,
  status: 'pending' | 'active' | 'completed',
  bracketSide: string | null = null,
): FakeRow {
  return {
    id,
    tournament_id: tournamentId,
    name,
    round_number: roundNumber,
    best_of: 3,
    status,
    pairings_generated: true,
    deadline: null,
    bracket_side: bracketSide,
    created_at: ISO,
    updated_at: ISO,
  };
}

/** Phase enrollment rows. `players ( * )` embeds the FULL player row, private columns included. */
function enrollmentRows(tournamentId: string, seeding: readonly string[] = ALL): FakeRow[] {
  return seeding.map((playerId, index) => ({
    tournament_id: tournamentId,
    player_id: playerId,
    seed: index + 1,
    starting_bracket: 'winners',
    players: playerRow(playerId),
  }));
}

function groupRow(id: string, tournamentId: string, name: string, groupNumber: number, memberIds: string[]): FakeRow {
  return {
    id,
    tournament_id: tournamentId,
    name,
    group_number: groupNumber,
    created_at: ISO,
    updated_at: ISO,
    tournament_group_members: memberIds.map((playerId, index) => ({
      group_id: id,
      player_id: playerId,
      seed: index + 1,
      // Full row: the members select narrows it to `players ( name )`.
      players: playerRow(playerId),
    })),
  };
}

/** A playoff match. Player embeds are FULL rows; the matches select narrows them. */
function playoffMatch(
  id: string,
  roundId: string,
  p1: string,
  p2: string,
  winner: string | null,
  bracketPos: number,
  scheduledAt: string,
): FakeRow {
  const completed = winner !== null;
  return {
    id,
    round_id: roundId,
    tournament_id: PLAYOFF_STAGE,
    player_1_id: p1,
    player_2_id: p2,
    winner_id: winner,
    status: completed ? 'completed' : 'scheduled',
    submitter_id: completed ? p1 : null,
    date_played: completed ? scheduledAt : null,
    scheduled_at: scheduledAt,
    auto_confirm_at: null,
    confirmed_at: null,
    notes: null,
    social_image_url: null,
    bracket_side: 'winners',
    bracket_pos: bracketPos,
    created_at: ISO,
    updated_at: ISO,
    player_1: playerRow(p1),
    player_2: playerRow(p2),
    winner: winner ? playerRow(winner) : null,
    games: completed
      ? [1, 2].map((gameNumber) => ({
          id: `g-${id}-${gameNumber}`,
          game_number: gameNumber,
          winner_id: winner,
          replay_url: '',
          source: 'manual',
          stats_locked: false,
        }))
      : [],
    round: { status: 'active' },
  };
}

function rulesetRow(id: string, name: string): FakeRow {
  return {
    id,
    name,
    base_format: 'gen9vgc2026',
    is_doubles: false,
    clauses: ['Species Clause'],
    banned_pokemon: ['Mewtwo'],
    banned_moves: [],
    banned_items: [],
    banned_abilities: [],
    added_pokemon: [],
    custom_rules_string: '',
    min_shared_type_pct: 0,
    team_constraints: null,
    created_by: null,
    created_at: ISO,
    updated_at: ISO,
  };
}

function buildHubTables(): FakeTables {
  const base = buildFixtureTables();
  const stageRow = (id: string): FakeRow => {
    const row = base.tournaments.find((t) => t.id === id);
    if (!row) throw new Error(`unknown fixture stage ${id}`);
    return row;
  };
  const stageIdsBySeason: Record<string, string[]> = {
    [EPB_SEASON_ID]: EPB_STAGES,
    [SAKURA_SEASON_ID]: SAKURA_STAGES,
  };

  return {
    ...base,
    seasons: base.seasons.map((season) => ({
      ...season,
      tournaments: stageIdsBySeason[season.id as string].map((id) => ({ id })),
    })),
    tournaments: [
      ...base.tournaments,
      {
        ...stageRow('e-stage-2'),
        id: PLAYOFF_STAGE,
        name: 'Playoffs',
        bracket_type: 'single_elim',
        stage_order: 2,
        best_of_default: 5,
      },
      {
        ...stageRow('s-stage-1'),
        id: SWISS_STAGE,
        name: 'Swiss Round',
        bracket_type: 'swiss',
        stage_order: 1,
        status: 'upcoming',
      },
    ],
    matches: [
      ...base.matches,
      playoffMatch('m8', 'r5', 'p4', 'p3', 'p4', 0, '2026-10-03T18:00:00.000Z'),
      playoffMatch('m9', 'r5', 'p1', 'p2', null, 1, '2026-10-03T19:00:00.000Z'),
    ],
    rounds: [
      roundRow('r1', 'e-stage-1', 'Spieltag 1', 1, 'completed'),
      roundRow('r2', 'e-stage-1', 'Spieltag 2', 2, 'completed'),
      roundRow('r3', 'e-stage-2', 'Spieltag 3', 1, 'completed'),
      roundRow('r4', 'e-stage-2', 'Spieltag 4', 2, 'active'),
      roundRow('r5', PLAYOFF_STAGE, 'Halbfinale', 1, 'active', 'winners'),
      roundRow('r6', PLAYOFF_STAGE, 'Finale', 2, 'pending', 'winners'),
      roundRow('sr1', 's-stage-1', 'Round 1', 1, 'completed'),
      roundRow('sr2', 's-stage-1', 'Round 2', 2, 'active'),
    ],
    tournament_participants: [
      ...enrollmentRows('e-stage-1'),
      ...enrollmentRows('e-stage-2'),
      ...enrollmentRows(PLAYOFF_STAGE, PLAYOFF_SEEDING),
      ...enrollmentRows('s-stage-1'),
      ...enrollmentRows(SWISS_STAGE),
    ],
    tournament_groups: [
      groupRow('grp-b', 'e-stage-1', 'Gruppe B', 2, ['p3', 'p4']),
      groupRow('grp-a', 'e-stage-1', 'Gruppe A', 1, ['p1', 'p2']),
    ],
    rulesets: [rulesetRow('ruleset-1', 'Liga-Regelwerk'), rulesetRow('ruleset-stage', 'Phasen-Regelwerk')],
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
    tournament_reports: [
      {
        id: 'report-1',
        tournament_id: 'e-stage-1',
        round_id: 'r1',
        report_type: 'round_recap',
        model_id: 'model-x',
        content: { headline: 'Spieltag 1' },
        prompt_tokens: null,
        completion_tokens: null,
        generation_time_ms: null,
        status: 'completed',
        error: null,
        created_at: ISO,
        updated_at: ISO,
      },
    ],
    redraft_trade_requests: [],
  };
}

function installFake(mutate?: (tables: FakeTables) => void): void {
  const tables = buildHubTables();
  mutate?.(tables);
  fake.current = createFakeSupabase(tables, { get_total_games_in_scope: () => 7 });
}

// ─── Page harness ─────────────────────────────────────────────────────────

/** The route-world budget of a bare league URL (`page-query-budget.test.ts`). */
const WORLD_BRANCH_BUDGET = 10;

/** The tables a bare EPB league URL reads, anonymous and cold (`page-query-budget.test.ts`). */
const EPB_BASE_TABLES = [
  'draft_pools',
  'evolution_tracker',
  'format_rules',
  'matches',
  'point_buy_list_entries',
  'season_participants',
  'seasons',
  'teams',
  'tournaments',
];

/** The EPB season's hub tabs with the Kale flag off: no reports tab. */
const EPB_TABS: LeagueHubTab[] = ['standings', 'matches', 'groups', 'playoffs', 'phases', 'insights', 'rules'];
/** The sakura season has table stages (round robin + Swiss) but no elimination stage. */
const SAKURA_TABS: LeagueHubTab[] = ['standings', 'matches', 'groups', 'phases', 'insights', 'rules'];

/** What each non-default tab adds to the bare EPB reads (cold cache, anonymous). */
const EPB_TAB_READS: Array<[LeagueHubTab, string[]]> = [
  // One rounds read per stage (names and order); matches come from the world payload.
  ['matches', ['rounds', 'rounds', 'rounds']],
  // Enrollment and groups per table stage; battle stats per round robin stage
  // (both EPB table stages are round robin).
  [
    'groups',
    [
      'battle_stats',
      'battle_stats',
      'tournament_groups',
      'tournament_groups',
      'tournament_participants',
      'tournament_participants',
    ],
  ],
  // Rounds and enrollment of the one elimination stage.
  ['playoffs', ['rounds', 'tournament_participants']],
  // Groups and enrollment of each table stage (round robin and Swiss), never
  // the elimination stage: the cards list the members the group tables show
  // (`resolveGroupMembers`), so they read the same enrollment as `groups`.
  ['phases', ['tournament_groups', 'tournament_groups', 'tournament_participants', 'tournament_participants']],
  // Aggregate counters, the game total rpc, and the season battle stats (which
  // resolve the season's stage ids themselves: `getBattleStatsForSeason`).
  ['insights', ['aggregates', 'battle_stats', 'get_total_games_in_scope', 'tournaments']],
  // The ruleset, read live.
  ['rules', ['rulesets']],
];

type SearchQuery = Record<string, string | string[] | undefined>;
type AnyElement = ReactElement<Record<string, unknown>>;
type HubElement = ReactElement<LeagueHubProps>;

const WORLD_NAMES = ['EvoligaWorld', 'SakuraWorld', 'MountainWorld', 'CloudsWorld'];

function childrenOf(element: AnyElement): AnyElement[] {
  const children = element.props.children as ReactNode;
  const list = Array.isArray(children) ? children : [children];
  return list.filter((c): c is AnyElement => typeof c === 'object' && c !== null && 'props' in c);
}

function componentName(element: AnyElement): string | null {
  return typeof element.type === 'function' ? (element.type as { name: string }).name : null;
}

async function renderPage(seasonId: string, query: SearchQuery = {}): Promise<AnyElement> {
  return (await LeagueDetailPage({
    params: Promise.resolve({ id: seasonId }),
    searchParams: Promise.resolve(query),
  })) as AnyElement;
}

function worldOf(page: AnyElement): AnyElement {
  const world = childrenOf(page).find((child) => WORLD_NAMES.includes(componentName(child) ?? ''));
  if (!world) throw new Error('the page rendered no route world');
  return world;
}

function hubOf(page: AnyElement): HubElement {
  const hub = worldOf(page).props.hub as HubElement | undefined;
  if (!hub) throw new Error('the route world received no hub');
  expect(hub.type).toBe(LeagueHub);
  return hub;
}

function panelOf<T extends LeagueHubPanelData['tab']>(
  hub: HubElement,
  tab: T,
): Extract<LeagueHubPanelData, { tab: T }> {
  expect(hub.props.panel.tab).toBe(tab);
  return hub.props.panel as Extract<LeagueHubPanelData, { tab: T }>;
}

function tablesRead(queries: readonly RecordedQuery[] = fake.current!.queries): string[] {
  return queries.map((q) => q.table).sort();
}

/** The full shape of every read, order-insensitive: identical shapes mean identical reads. */
function readShapes(queries: readonly RecordedQuery[]): string[] {
  return queries
    .map((q) =>
      JSON.stringify({
        table: q.table,
        kind: q.kind,
        select: q.select,
        filters: q.filters,
        orders: q.orders,
        limit: q.limit,
        range: q.range ?? null,
        single: q.single,
        args: q.args ?? null,
      }),
    )
    .sort();
}

/** The `eq` values of `column` across every read of `table`, sorted. */
function eqValuesRead(table: string, column = 'tournament_id'): string[] {
  return fake.current!.queries
    .filter((q) => q.table === table)
    .map((q) => q.filters.find((f) => f.column === column && f.op === 'eq')?.value)
    .filter((value): value is string => typeof value === 'string')
    .sort();
}

/** Render cold (cache and query log emptied first) and return the page and its reads. */
async function coldRender(seasonId: string, query: SearchQuery = {}): Promise<{ page: AnyElement; queries: RecordedQuery[] }> {
  fakeNextCache.reset();
  fake.current!.reset();
  const page = await renderPage(seasonId, query);
  return { page, queries: [...fake.current!.queries] };
}

function expectNoStatsReads(): void {
  expect(getBattleStatsForSeason).not.toHaveBeenCalled();
  expect(getBattleStatsForTournament).not.toHaveBeenCalled();
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

/** Every element under `node` (depth first) that satisfies `predicate`. Components are not invoked. */
function collect(node: ReactNode, predicate: (element: AnyElement) => boolean, out: AnyElement[] = []): AnyElement[] {
  if (Array.isArray(node)) {
    for (const child of node) collect(child as ReactNode, predicate, out);
    return out;
  }
  if (typeof node !== 'object' || node === null || !('props' in node)) return out;
  const element = node as AnyElement;
  if (predicate(element)) out.push(element);
  collect(element.props.children as ReactNode, predicate, out);
  return out;
}

/** The hub's tab links, read from the element tree the real LeagueHub returns. */
function tabLinks(hub: HubElement): AnyElement[] {
  const tree = LeagueHub(hub.props) as ReactNode;
  return collect(tree, (element) => typeof element.props['data-hub-tab'] === 'string');
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
  // `clearAllMocks` keeps an earlier test's resolved session; start anonymous.
  vi.mocked(getSessionPlayer).mockResolvedValue(null);
  flags.kale = false;
  cookieJar.clear();
  fakeNextCache.reset();
  installFake();
});

// ─── 1. The default tab ───────────────────────────────────────────────────

describe('league hub — the default tab keeps the bare league budget', () => {
  it(`EPB: a bare URL reads exactly the ${EPB_BASE_TABLES.length} route-world tables, ≤ ${WORLD_BRANCH_BUDGET} queries, no stats getter`, async () => {
    const page = await renderPage(EPB_SEASON_ID);

    expect(fake.current!.queries.length).toBeLessThanOrEqual(WORLD_BRANCH_BUDGET);
    expect(tablesRead()).toEqual(EPB_BASE_TABLES);
    expectNoStatsReads();

    const hub = hubOf(page);
    expect(componentName(worldOf(page))).toBe('EvoligaWorld');
    expect(hub.props.activeTab).toBe('standings');
    expect(hub.props.tabs).toEqual(EPB_TABS);
    // The hub follows the viewer, not the world: no language cookie = English, even on the plaza.
    expect(hub.props.locale).toBe('en');
  });

  it('EPB: the added elimination stage costs the default render nothing (one stages read, one batched matches read)', async () => {
    const page = await renderPage(EPB_SEASON_ID);

    const stageReads = fake.current!.queries.filter((q) => q.table === 'tournaments');
    const matchReads = fake.current!.queries.filter((q) => q.table === 'matches');
    expect(stageReads).toHaveLength(1);
    expect(matchReads).toHaveLength(1);
    const batched = matchReads[0].filters.find((f) => f.op === 'in' && f.column === 'tournament_id');
    expect([...(batched?.value as string[])].sort()).toEqual([...EPB_STAGES].sort());

    // The playoff matches are part of the payload the default tab renders from.
    const data = worldOf(page).props.data as { fixtures: { stageId: string; match: { id: string } }[] };
    expect(data.fixtures.filter((f) => f.stageId === PLAYOFF_STAGE).map((f) => f.match.id)).toEqual(['m8', 'm9']);
  });

  it.each([
    [EPB_SEASON_ID, true],
    [SAKURA_SEASON_ID, false],
  ])('season %s: ?tab=standings issues exactly the reads of the bare URL', async (seasonId, epb) => {
    const bare = await coldRender(seasonId);
    const standings = await coldRender(seasonId, { tab: 'standings' });

    expect(readShapes(standings.queries)).toEqual(readShapes(bare.queries));
    expect(standings.queries.length).toBeLessThanOrEqual(WORLD_BRANCH_BUDGET);
    expectNoStatsReads();

    for (const { page } of [bare, standings]) {
      const hub = hubOf(page);
      expect(hub.props.activeTab).toBe('standings');
      const panel = panelOf(hub, 'standings');
      // Rendered from the world payload alone: the very same standings rows.
      expect(panel.standings).toEqual((worldOf(page).props.data as { standings: unknown }).standings);
      expect(panel.standings.length).toBe(4);
      expect(panel.isEvolutionPointBuy).toBe(epb);
    }
  });

  it('sakura: a bare URL keeps its 8-query budget and the hub speaks English', async () => {
    const page = await renderPage(SAKURA_SEASON_ID);

    expect(fake.current!.queries).toHaveLength(8);
    expectNoStatsReads();
    expect(componentName(worldOf(page))).toBe('SakuraWorld');
    const hub = hubOf(page);
    expect(hub.props.tabs).toEqual(SAKURA_TABS);
    expect(hub.props.locale).toBe('en');
  });

  it.each([
    [EPB_SEASON_ID, 'EvoligaWorld'],
    [SAKURA_SEASON_ID, 'SakuraWorld'],
  ])(
    'season %s: a German viewer (plc_locale=de) gets a German hub in any world, for the same reads',
    async (seasonId, worldName) => {
      const english = await coldRender(seasonId);
      cookieJar.set('plc_locale', 'de');
      const german = await coldRender(seasonId);

      expect(readShapes(german.queries)).toEqual(readShapes(english.queries));
      expect(german.queries.length).toBeLessThanOrEqual(WORLD_BRANCH_BUDGET);
      expect(componentName(worldOf(german.page))).toBe(worldName);
      expect(hubOf(english.page).props.locale).toBe('en');
      expect(hubOf(german.page).props.locale).toBe('de');
    },
  );

  it('Kale flag on: the reports tab is offered, and the bare URL still reads nothing more', async () => {
    flags.kale = true;
    const page = await renderPage(EPB_SEASON_ID);

    expect(tablesRead()).toEqual(EPB_BASE_TABLES);
    expectNoStatsReads();
    expect(hubOf(page).props.tabs).toEqual([...EPB_TABS, 'reports']);
  });
});

// ─── 2. Each other tab adds only its own reads ────────────────────────────

describe('league hub — each tab adds only its own reads (EPB, anonymous, cold)', () => {
  it.each(EPB_TAB_READS)('?tab=%s adds exactly %j', async (tab, extra) => {
    const page = await renderPage(EPB_SEASON_ID, { tab });

    expect(tablesRead()).toEqual([...EPB_BASE_TABLES, ...extra].sort());
    // The route-world reads themselves are unchanged: still one each.
    for (const table of ['seasons', 'season_participants', 'matches', 'evolution_tracker', 'teams']) {
      expect(fake.current!.queries.filter((q) => q.table === table)).toHaveLength(1);
    }
    const hub = hubOf(page);
    expect(hub.props.activeTab).toBe(tab);
    expect(hub.props.panel.tab).toBe(tab);
    expect(hub.props.tabs).toEqual(EPB_TABS);
  });

  it('matches: one rounds read per stage; the matches come from the world payload, not a second matches read', async () => {
    const page = await renderPage(EPB_SEASON_ID, { tab: 'matches' });

    expect(eqValuesRead('rounds')).toEqual([...EPB_STAGES].sort());
    expect(fake.current!.queries.filter((q) => q.table === 'matches')).toHaveLength(1);
    expectNoStatsReads();

    const panel = panelOf(hubOf(page), 'matches');
    expect(panel.stages.map((s) => s.stage.id)).toEqual(EPB_STAGES);
    const view = panel.stages.map((s) => ({
      stage: s.stage.id,
      rounds: s.rounds.map((r) => ({ id: r.roundId, name: r.name, matches: r.matches.map((m) => m.id) })),
    }));
    expect(view).toEqual([
      {
        stage: 'e-stage-1',
        rounds: [
          { id: 'r1', name: 'Spieltag 1', matches: ['m1', 'm2'] },
          { id: 'r2', name: 'Spieltag 2', matches: ['m3', 'm4'] },
        ],
      },
      {
        stage: 'e-stage-2',
        rounds: [
          { id: 'r3', name: 'Spieltag 3', matches: ['m5', 'm6'] },
          { id: 'r4', name: 'Spieltag 4', matches: ['m7'] },
        ],
      },
      { stage: PLAYOFF_STAGE, rounds: [{ id: 'r5', name: 'Halbfinale', matches: ['m8', 'm9'] }] },
    ]);
  });

  it('groups: enrollment and groups of each table stage, battle stats of each round robin stage, never the elimination stage', async () => {
    const page = await renderPage(EPB_SEASON_ID, { tab: 'groups' });

    expect(eqValuesRead('tournament_participants')).toEqual(EPB_TABLE_STAGES);
    expect(eqValuesRead('tournament_groups')).toEqual(EPB_TABLE_STAGES);
    expect(eqValuesRead('battle_stats', 'games.matches.tournament_id')).toEqual(EPB_TABLE_STAGES);
    for (const q of fake.current!.queries.filter((q) => q.table === 'tournament_groups')) {
      expect(q.select).toContain('tournament_group_members');
    }
    // Per-stage battle stats only; no season-wide stats, aggregates or ruleset.
    expect(vi.mocked(getBattleStatsForTournament).mock.calls.map(([id]) => id).sort()).toEqual(EPB_TABLE_STAGES);
    expect(getBattleStatsForSeason).not.toHaveBeenCalled();
    expect(getAggregatesSummary).not.toHaveBeenCalled();
    expect(getTotalGamesInScope).not.toHaveBeenCalled();
    expect(getRulesetById).not.toHaveBeenCalled();

    const panel = panelOf(hubOf(page), 'groups');
    expect(panel.isEvolutionPointBuy).toBe(true);
    expect(panel.stages.map((s) => s.stage.id)).toEqual(EPB_TABLE_STAGES);
    const [grouped, ungrouped] = panel.stages;
    // Grouped round robin: one table per group, in group order, with only intra-group matches.
    expect(grouped.scoring).toBe('round_robin');
    expect(
      grouped.tables.map((t) => ({
        name: t.name,
        members: t.members.map((m) => m.id).sort(),
        matches: t.matches.map((m) => m.id),
      })),
    ).toEqual([
      { name: 'Gruppe A', members: ['p1', 'p2'], matches: ['m1'] },
      { name: 'Gruppe B', members: ['p3', 'p4'], matches: ['m2'] },
    ]);
    expect(grouped.tables[0].standings[0].player_id).toBe('p1');
    expect(grouped.tables[1].standings[0].player_id).toBe('p4');
    // Ungrouped round robin: one table over the stage enrollment.
    expect(ungrouped.tables).toHaveLength(1);
    expect(ungrouped.tables[0].name).toBeNull();
    expect(ungrouped.tables[0].members.map((m) => m.id).sort()).toEqual(ALL);
    expect(ungrouped.tables[0].matches.map((m) => m.id)).toEqual(['m5', 'm6', 'm7']);
  });

  it('groups (sakura): the Swiss stage gets its enrollment and groups read, but no battle stats', async () => {
    const bare = await coldRender(SAKURA_SEASON_ID);
    const groups = await coldRender(SAKURA_SEASON_ID, { tab: 'groups' });

    expect(tablesRead(groups.queries)).toEqual(
      [
        ...tablesRead(bare.queries),
        'battle_stats',
        'tournament_groups',
        'tournament_groups',
        'tournament_participants',
        'tournament_participants',
      ].sort(),
    );
    expect(eqValuesRead('tournament_participants')).toEqual(SAKURA_STAGES);
    expect(eqValuesRead('tournament_groups')).toEqual(SAKURA_STAGES);
    expect(eqValuesRead('battle_stats', 'games.matches.tournament_id')).toEqual(['s-stage-1']);
    expect(vi.mocked(getBattleStatsForTournament).mock.calls.map(([id]) => id)).toEqual(['s-stage-1']);

    const panel = panelOf(hubOf(groups.page), 'groups');
    expect(panel.isEvolutionPointBuy).toBe(false);
    expect(panel.stages.map((s) => [s.stage.id, s.scoring])).toEqual([
      ['s-stage-1', 'round_robin'],
      [SWISS_STAGE, 'swiss'],
    ]);
    // The Swiss stage has no group rows: one table over its enrollment.
    expect(panel.stages[1].tables).toHaveLength(1);
    expect(panel.stages[1].tables[0].name).toBeNull();
    expect(panel.stages[1].tables[0].members.map((m) => m.id).sort()).toEqual(ALL);
  });

  it('groups (sakura): a grouped Swiss stage gets one Swiss table per group', async () => {
    installFake((tables) => {
      tables.tournament_groups = [
        ...tables.tournament_groups,
        groupRow('sw-grp-2', SWISS_STAGE, 'Pool 2', 2, ['p2', 'p4']),
        groupRow('sw-grp-1', SWISS_STAGE, 'Pool 1', 1, ['p3', 'p1']),
      ];
    });

    const page = await renderPage(SAKURA_SEASON_ID, { tab: 'groups' });

    expect(eqValuesRead('tournament_groups')).toEqual(SAKURA_STAGES);
    expect(eqValuesRead('battle_stats', 'games.matches.tournament_id')).toEqual(['s-stage-1']);

    const swiss = panelOf(hubOf(page), 'groups').stages[1];
    expect(swiss.stage.id).toBe(SWISS_STAGE);
    expect(swiss.scoring).toBe('swiss');
    expect(
      swiss.tables.map((t) => ({ key: t.key, name: t.name, members: t.members.map((m) => m.id).sort() })),
    ).toEqual([
      { key: 'sw-grp-1', name: 'Pool 1', members: ['p1', 'p3'] },
      { key: 'sw-grp-2', name: 'Pool 2', members: ['p2', 'p4'] },
    ]);
    // Nothing played yet: Swiss rows, all level.
    for (const table of swiss.tables) {
      for (const standing of table.standings) {
        expect(standing).toMatchObject({ points: 0, buchholz: 0, kill_differential: 0 });
      }
    }
  });

  it('playoffs: rounds and enrollment of the elimination stage only', async () => {
    const page = await renderPage(EPB_SEASON_ID, { tab: 'playoffs' });

    expect(eqValuesRead('rounds')).toEqual([PLAYOFF_STAGE]);
    expect(eqValuesRead('tournament_participants')).toEqual([PLAYOFF_STAGE]);
    expectNoStatsReads();

    const panel = panelOf(hubOf(page), 'playoffs');
    expect(panel.stages).toHaveLength(1);
    const [bracket] = panel.stages;
    expect(bracket.stage.id).toBe(PLAYOFF_STAGE);
    expect(bracket.stage.bracket_type).toBe('single_elim');
    expect(bracket.rounds.map((r) => r.id)).toEqual(['r5', 'r6']);
    expect(bracket.matches.map((m) => m.id)).toEqual(['m8', 'm9']);
    // Seed order, public fields only.
    expect(bracket.participants.map((p) => p.id)).toEqual(PLAYOFF_SEEDING);
    for (const participant of bracket.participants) {
      expect(Object.keys(participant).sort()).toEqual(['avatar_url', 'id', 'name', 'seed', 'starting_bracket']);
    }
  });

  it('phases: the groups of each table stage only (never the elimination stage), members carrying the season gym bands', async () => {
    const page = await renderPage(EPB_SEASON_ID, { tab: 'phases' });

    expect(eqValuesRead('tournament_groups')).toEqual(EPB_TABLE_STAGES);
    expect(eqValuesRead('tournament_participants')).toEqual(EPB_TABLE_STAGES);
    expectNoStatsReads();

    const panel = panelOf(hubOf(page), 'phases');
    expect(panel.phases.map((p) => [p.stage.id, p.groups.length])).toEqual([
      ['e-stage-1', 2],
      ['e-stage-2', 0],
      [PLAYOFF_STAGE, 0],
    ]);
    expect(panel.phases[0].groups.map((g) => g.name)).toEqual(['Gruppe A', 'Gruppe B']);
    expect(panel.phases[0].groups.flatMap((g) => g.members)).toEqual([
      { player_id: 'p1', player_name: 'Mara Feldkamp', seed: 1, gym_type: 'Fire' },
      { player_id: 'p2', player_name: 'Jonas Riedl', seed: 2, gym_type: 'Water' },
      { player_id: 'p3', player_name: 'Lea Brandt', seed: 1, gym_type: null },
      { player_id: 'p4', player_name: 'Timo Kessler', seed: 2, gym_type: 'Grass' },
    ]);
  });

  it('phases (sakura): the Swiss stage is a table stage, so its groups and enrollment are read too', async () => {
    const bare = await coldRender(SAKURA_SEASON_ID);
    installFake((tables) => {
      tables.tournament_groups = [
        ...tables.tournament_groups,
        groupRow('sw-grp-1', SWISS_STAGE, 'Pool 1', 1, ['p1', 'p3']),
      ];
    });
    const phases = await coldRender(SAKURA_SEASON_ID, { tab: 'phases' });

    expect(tablesRead(phases.queries)).toEqual(
      [
        ...tablesRead(bare.queries),
        'tournament_groups',
        'tournament_groups',
        'tournament_participants',
        'tournament_participants',
      ].sort(),
    );
    expect(eqValuesRead('tournament_groups')).toEqual(SAKURA_STAGES);
    expect(eqValuesRead('tournament_participants')).toEqual(SAKURA_STAGES);
    expectNoStatsReads();

    const panel = panelOf(hubOf(phases.page), 'phases');
    expect(panel.phases.map((p) => [p.stage.id, p.groups.map((g) => g.name)])).toEqual([
      ['s-stage-1', []],
      [SWISS_STAGE, ['Pool 1']],
    ]);
    expect(panel.phases[1].groups[0].members).toEqual([
      { player_id: 'p1', player_name: 'Mara Feldkamp', seed: 1, gym_type: 'Dragon' },
      { player_id: 'p3', player_name: 'Lea Brandt', seed: 2, gym_type: 'Ice' },
    ]);
  });

  it('phases: member names come from the season participants, not the cached group embed (a rename expires only the former)', async () => {
    // p1 renamed: the season participants read carries the new name, while
    // the groups read (no `players` tag, so not expired by the rename) still
    // embeds the old one.
    installFake((tables) => {
      tables.season_participants = tables.season_participants.map((row) =>
        row.season_id === EPB_SEASON_ID && row.player_id === 'p1'
          ? { ...row, players: { ...playerRow('p1'), name: 'Mara Neuhaus' } }
          : row,
      );
    });

    const page = await renderPage(EPB_SEASON_ID, { tab: 'phases' });

    const [groupsEntry, ...otherGroupsEntries] = [...fakeNextCache.entries.entries()].filter(
      ([key]) => key.includes('tournament-groups') && key.includes('e-stage-1'),
    );
    expect(otherGroupsEntries).toHaveLength(0);
    expect(groupsEntry[1].body).toContain('Mara Feldkamp');
    expect(groupsEntry[1].body).not.toContain('Mara Neuhaus');

    const members = panelOf(hubOf(page), 'phases').phases[0].groups.flatMap((g) => g.members);
    expect(members.map((m) => [m.player_id, m.player_name])).toEqual([
      ['p1', 'Mara Neuhaus'],
      ['p2', 'Jonas Riedl'],
      ['p3', 'Lea Brandt'],
      ['p4', 'Timo Kessler'],
    ]);
  });

  it('insights: aggregate counters (no move_counts), the game total rpc and the season battle stats', async () => {
    const page = await renderPage(EPB_SEASON_ID, { tab: 'insights' });

    expect(getAggregatesSummary).toHaveBeenCalledTimes(1);
    expect(getAggregatesSummary).toHaveBeenCalledWith('league', EPB_SEASON_ID);
    expect(getTotalGamesInScope).toHaveBeenCalledTimes(1);
    expect(getTotalGamesInScope).toHaveBeenCalledWith('league', EPB_SEASON_ID);
    expect(getBattleStatsForSeason).toHaveBeenCalledTimes(1);
    expect(getBattleStatsForSeason).toHaveBeenCalledWith(EPB_SEASON_ID);
    expect(getAggregates).not.toHaveBeenCalled();
    expect(getBattleStatsForTournament).not.toHaveBeenCalled();
    expect(getRulesetById).not.toHaveBeenCalled();

    const aggregateRead = fake.current!.queries.find((q) => q.table === 'aggregates')!;
    expect(aggregateRead.select).not.toContain('move_counts');
    const rpc = fake.current!.queries.find((q) => q.table === 'get_total_games_in_scope')!;
    expect(rpc.kind).toBe('rpc');
    expect(rpc.args).toEqual({ p_scope_type: 'league', p_scope_id: EPB_SEASON_ID });

    const panel = panelOf(hubOf(page), 'insights');
    expect(panel.usageRows).toEqual([
      expect.objectContaining({ pokemon_name: 'Charizard', usage_percent: (4 / 7) * 100 }),
    ]);
    expect(panel.killRanking).toEqual([]);
    expect(panel.isDoubles).toBe(false);
  });

  it('rules: the season ruleset, read live, and nothing else', async () => {
    const page = await renderPage(EPB_SEASON_ID, { tab: 'rules' });

    expect(getRulesetById).toHaveBeenCalledTimes(1);
    expect(getRulesetById).toHaveBeenCalledWith('ruleset-1');
    expect(eqValuesRead('rulesets', 'id')).toEqual(['ruleset-1']);
    expect(getAggregatesSummary).not.toHaveBeenCalled();
    expect(getTotalGamesInScope).not.toHaveBeenCalled();
    expect(getBattleStatsForSeason).not.toHaveBeenCalled();
    // Live: no cached entry is written for the ruleset.
    expect(fakeNextCache.reads.some((r) => r.keyParts.join('|').includes('ruleset'))).toBe(false);

    const panel = panelOf(hubOf(page), 'rules');
    expect(panel.ruleset).toEqual(expect.objectContaining({ id: 'ruleset-1', name: 'Liga-Regelwerk' }));
  });

  it('rules: a season without a ruleset falls back to its first stage ruleset', async () => {
    installFake((tables) => {
      tables.seasons = tables.seasons.map((s) => (s.id === EPB_SEASON_ID ? { ...s, ruleset_id: null } : s));
      tables.tournaments = tables.tournaments.map((t) =>
        t.id === 'e-stage-1' ? { ...t, ruleset_id: 'ruleset-stage' } : t,
      );
    });

    const page = await renderPage(EPB_SEASON_ID, { tab: 'rules' });

    expect(getRulesetById).toHaveBeenCalledTimes(1);
    expect(getRulesetById).toHaveBeenCalledWith('ruleset-stage');
    expect(tablesRead()).toEqual([...EPB_BASE_TABLES, 'rulesets'].sort());
    expect(panelOf(hubOf(page), 'rules').ruleset).toEqual(
      expect.objectContaining({ id: 'ruleset-stage', name: 'Phasen-Regelwerk' }),
    );
  });

  it('rules: no ruleset on the season or its stages → no read, an empty panel', async () => {
    installFake((tables) => {
      tables.seasons = tables.seasons.map((s) => (s.id === EPB_SEASON_ID ? { ...s, ruleset_id: null } : s));
      tables.tournaments = tables.tournaments.map((t) => ({ ...t, ruleset_id: null }));
    });

    const page = await renderPage(EPB_SEASON_ID, { tab: 'rules' });

    expect(getRulesetById).not.toHaveBeenCalled();
    expect(tablesRead()).toEqual(EPB_BASE_TABLES);
    expect(panelOf(hubOf(page), 'rules').ruleset).toBeNull();
  });

  it('reports (Kale flag on): one reports read per stage, nothing else', async () => {
    flags.kale = true;
    const page = await renderPage(EPB_SEASON_ID, { tab: 'reports' });

    expect(tablesRead()).toEqual(
      [...EPB_BASE_TABLES, 'tournament_reports', 'tournament_reports', 'tournament_reports'].sort(),
    );
    expect(eqValuesRead('tournament_reports')).toEqual([...EPB_STAGES].sort());
    expectNoStatsReads();

    const hub = hubOf(page);
    expect(hub.props.activeTab).toBe('reports');
    const panel = panelOf(hub, 'reports');
    expect(panel.reports.map((r) => [r.stage.id, r.reports.map((report) => report.id)])).toEqual([
      ['e-stage-1', ['report-1']],
      ['e-stage-2', []],
      [PLAYOFF_STAGE, []],
    ]);
  });

  it('signed in + ?tab=groups: the two viewer-scoped reads plus the tab reads, nothing else', async () => {
    vi.mocked(getSessionPlayer).mockResolvedValue(SIGNED_IN);

    await renderPage(EPB_SEASON_ID, { tab: 'groups' });

    const groupsExtra = EPB_TAB_READS.find(([tab]) => tab === 'groups')![1];
    expect(tablesRead()).toEqual(
      [...EPB_BASE_TABLES, 'players', 'redraft_trade_requests', ...groupsExtra].sort(),
    );
  });
});

// ─── 3. Fallbacks ─────────────────────────────────────────────────────────

describe('league hub — an unknown or unavailable tab falls back to the default reads', () => {
  it.each<[string, string | string[]]>([
    ['an unknown tab', 'foo'],
    ['the reports tab while ENABLE_KALE_CABBAGE is off', 'reports'],
    ['an empty tab', ''],
    ['a differently cased tab', 'Groups'],
    ['a repeated tab param', ['groups', 'matches']],
  ])('EPB, %s (%j): the bare reads and the standings panel', async (_label, tab) => {
    const bare = await coldRender(EPB_SEASON_ID);
    const fallback = await coldRender(EPB_SEASON_ID, { tab });

    expect(readShapes(fallback.queries)).toEqual(readShapes(bare.queries));
    expect(tablesRead(fallback.queries)).toEqual(EPB_BASE_TABLES);
    expectNoStatsReads();

    const hub = hubOf(fallback.page);
    expect(hub.props.activeTab).toBe('standings');
    expect(hub.props.panel.tab).toBe('standings');
    expect(hub.props.tabs).toEqual(EPB_TABS);
    expect(hub.props.tabs).not.toContain('reports');
  });

  it('sakura (no elimination stage), ?tab=playoffs: the tab is not offered and the bare reads are issued', async () => {
    const bare = await coldRender(SAKURA_SEASON_ID);
    const playoffs = await coldRender(SAKURA_SEASON_ID, { tab: 'playoffs' });

    expect(readShapes(playoffs.queries)).toEqual(readShapes(bare.queries));
    expect(playoffs.queries).toHaveLength(8);
    expectNoStatsReads();

    const hub = hubOf(playoffs.page);
    expect(hub.props.tabs).toEqual(SAKURA_TABS);
    expect(hub.props.tabs).not.toContain('playoffs');
    expect(hub.props.activeTab).toBe('standings');
    expect(hub.props.panel.tab).toBe('standings');
  });
});

// ─── 4. Tab links keep the rest of the query ──────────────────────────────

describe('league hub — tab links keep ?world= and every other param', () => {
  it('the page hands the hub the full query; each tab link keeps it and swaps only ?tab=', async () => {
    const query: SearchQuery = { world: 'mountain', tab: 'playoffs', focus: 'm8', debug: ['a', 'b'] };
    const page = await renderPage(EPB_SEASON_ID, query);

    expect(componentName(worldOf(page))).toBe('MountainWorld');
    const hub = hubOf(page);
    expect(hub.props.query).toEqual(query);
    expect(hub.props.activeTab).toBe('playoffs');
    expect(hub.props.locale).toBe('en');

    const links = tabLinks(hub);
    expect(links.map((link) => link.props['data-hub-tab'])).toEqual(EPB_TABS);
    const base = `/leagues/${EPB_SEASON_ID}?world=mountain&focus=m8&debug=a&debug=b`;
    for (const link of links) {
      const tab = link.props['data-hub-tab'] as LeagueHubTab;
      expect(link.props.href).toBe(tab === 'standings' ? base : `${base}&tab=${tab}`);
      expect(link.props.id).toBe(`league-hub-tab-${tab}`);
      expect(link.props.scroll).toBe(false);
      expect(link.props.prefetch).toBe(false);
      expect(link.props['aria-current']).toBe(tab === 'playoffs' ? 'page' : undefined);
      expect(link.props['aria-controls']).toBe(tab === 'playoffs' ? LEAGUE_HUB_PANEL_ID : undefined);
    }

    const [panelRegion] = collect(LeagueHub(hub.props) as ReactNode, (el) => el.props.id === LEAGUE_HUB_PANEL_ID);
    expect(panelRegion.props.role).toBe('region');
    expect(panelRegion.props['aria-labelledby']).toBe('league-hub-tab-playoffs');
  });

  it('a bare URL: the default tab link stays bare, the others add only ?tab=', async () => {
    const page = await renderPage(EPB_SEASON_ID);

    const links = tabLinks(hubOf(page));
    expect(links.map((link) => [link.props['data-hub-tab'], link.props.href])).toEqual(
      EPB_TABS.map((tab) => [
        tab,
        tab === 'standings' ? `/leagues/${EPB_SEASON_ID}` : `/leagues/${EPB_SEASON_ID}?tab=${tab}`,
      ]),
    );
  });
});

// ─── 5. Public-only hub props ─────────────────────────────────────────────

describe('league hub — the hub props are public-only', () => {
  it.each<[LeagueHubTab, boolean]>([
    ...EPB_TABS.map((tab): [LeagueHubTab, boolean] => [tab, false]),
    ['reports', true],
  ])('EPB ?tab=%s (Kale flag %s): no private player field or value', async (tab, kale) => {
    flags.kale = kale;
    const page = await renderPage(EPB_SEASON_ID, { tab });

    const hub = hubOf(page);
    expect(hub.props.activeTab).toBe(tab);
    for (const participant of hub.props.participants) {
      expect(Object.keys(participant).sort()).toEqual(['avatar_url', 'core_types', 'gym_type', 'id', 'name']);
    }
    expectNoPrivatePlayerData(hub.props);
    expectNoPrivatePlayerData(worldOf(page).props);
    // The cached entries behind the panel hold public shapes only, too.
    for (const entry of fakeNextCache.entries.values()) expectNoPrivatePlayerData(JSON.parse(entry.body));
  });

  it('sakura ?tab=groups: no private player field or value', async () => {
    const page = await renderPage(SAKURA_SEASON_ID, { tab: 'groups' });

    expectNoPrivatePlayerData(hubOf(page).props);
    for (const entry of fakeNextCache.entries.values()) expectNoPrivatePlayerData(JSON.parse(entry.body));
  });

  it('groups and playoffs: the cached stage enrollments are narrowed to the public tournament participant', async () => {
    await renderPage(EPB_SEASON_ID, { tab: 'groups' });
    await renderPage(EPB_SEASON_ID, { tab: 'playoffs' });

    const enrollments = [...fakeNextCache.entries.entries()].filter(([key]) => key.includes('tournament-participants'));
    expect(enrollments).toHaveLength(EPB_STAGES.length);
    for (const [, entry] of enrollments) {
      const rows = JSON.parse(entry.body) as Record<string, unknown>[];
      expect(rows).toHaveLength(4);
      for (const row of rows) {
        expect(Object.keys(row).sort()).toEqual(['avatar_url', 'id', 'name', 'seed', 'starting_bracket']);
      }
    }
  });
});

// ─── 6. Warm renders ──────────────────────────────────────────────────────

describe('league hub — warm renders', () => {
  it.each<LeagueHubTab>(['matches', 'groups', 'playoffs', 'phases', 'insights'])(
    'EPB ?tab=%s, anonymous: a warm render issues no query',
    async (tab) => {
      await renderPage(EPB_SEASON_ID, { tab });
      const cold = fake.current!.queries.length;
      const coldReads = fakeNextCache.reads.length;
      expect(cold).toBeGreaterThan(EPB_BASE_TABLES.length);

      const page = await renderPage(EPB_SEASON_ID, { tab });

      expect(fake.current!.queries).toHaveLength(cold);
      const warmReads = fakeNextCache.reads.slice(coldReads);
      expect(warmReads.length).toBeGreaterThan(0);
      expect(warmReads.every((r) => r.hit)).toBe(true);
      expect(hubOf(page).props.panel.tab).toBe(tab);
    },
  );

  it('EPB ?tab=rules: a warm render issues exactly one query, the live ruleset', async () => {
    await renderPage(EPB_SEASON_ID, { tab: 'rules' });
    const cold = fake.current!.queries.length;

    const page = await renderPage(EPB_SEASON_ID, { tab: 'rules' });

    expect(fake.current!.queries.slice(cold).map((q) => q.table)).toEqual(['rulesets']);
    expect(getRulesetById).toHaveBeenCalledTimes(2);
    expect(panelOf(hubOf(page), 'rules').ruleset).toEqual(expect.objectContaining({ id: 'ruleset-1' }));
  });

  it('a warm hub panel is still public-only', async () => {
    await renderPage(EPB_SEASON_ID, { tab: 'playoffs' });
    const page = await renderPage(EPB_SEASON_ID, { tab: 'playoffs' });

    const panel = panelOf(hubOf(page), 'playoffs');
    for (const participant of panel.stages[0].participants) {
      expect(Object.keys(participant).sort()).toEqual(['avatar_url', 'id', 'name', 'seed', 'starting_bracket']);
    }
    expectNoPrivatePlayerData(hubOf(page).props);
  });

  it.each<LeagueHubTab>(['matches', 'groups', 'playoffs', 'phases', 'insights'])(
    'EPB ?tab=%s: every read it caches is expired by a write to the league, one of its stages, or its aggregate scope',
    async (tab) => {
      await renderPage(EPB_SEASON_ID, { tab });

      const owners = [
        `season:${EPB_SEASON_ID}`,
        `aggregates:league:${EPB_SEASON_ID}`,
        ...EPB_STAGES.map((id) => `tournament:${id}`),
      ];
      expect(fakeNextCache.reads.length).toBeGreaterThan(0);
      for (const read of fakeNextCache.reads) {
        expect(read.tags.some((tag) => owners.includes(tag))).toBe(true);
        expect(read.revalidate).toBe(30);
      }
    },
  );
});

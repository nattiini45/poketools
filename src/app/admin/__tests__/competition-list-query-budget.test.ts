/**
 * The five competition list pages and the league trash (redesign A4) run for real against an in-memory PostgREST
 * (no network, no Supabase) and their reads per render are pinned to the counts they had before CompetitionList:
 * the redesign changed the markup, never what a page reads. getLiveAccess is mocked because the admin layout
 * shares its one memoised read with every page; what is counted is each page's own reads.
 *
 * Site admin: one read per list. A resource admin adds the scope lookup (resource_admins, plus the stages of their
 * leagues for tournaments). The trash is the list, the pending rebuilds (two reads) and the schema version.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabase, type FakeSupabase } from '@/lib/worlds/__tests__/fake-postgrest';

const mocks = vi.hoisted(() => ({
  fake: { current: null as FakeSupabase | null },
  getLiveAccess: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/client', () => ({
  get supabase() {
    return mocks.fake.current!.client;
  },
}));
vi.mock('@/lib/auth/helpers', () => ({ getLiveAccess: mocks.getLiveAccess }));
vi.mock('@/i18n/server', async () => {
  const { createTranslator } = await import('@/i18n/core');
  return {
    getLocale: async () => 'en',
    getT: async (ns: Parameters<typeof createTranslator>[0]) => createTranslator(ns, 'en'),
  };
});

import AdminLeaguesPage from '../leagues/page';
import ArchivedLeaguesPage from '../leagues/archived/page';
import LeagueTrashPage from '../leagues/trash/page';
import AdminTournamentsPage from '../tournaments/page';
import ArchivedTournamentsPage from '../tournaments/archived/page';

const SEASON = {
  id: 's1',
  name: 'Open League',
  description: '',
  format_type: 'singles',
  ruleset_id: null,
  start_date: '2026-10-01',
  end_date: '2026-10-31',
  status: 'active',
  archived: false,
  legacy: false,
  is_test_season: false,
  core_pool: null,
  point_buy_list_id: null,
  route_theme: 'auto',
  language: 'en',
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  rulesets: null,
  season_participants: [{}, {}],
  tournaments: [{}],
};

const TOURNAMENT = {
  id: 't1',
  name: 'Open Cup',
  description: '',
  season_id: null,
  bracket_type: 'swiss',
  ruleset_id: 'r1',
  best_of_default: 3,
  bo_overrides: {},
  is_doubles: false,
  team_visibility: 'always_public',
  status: 'active',
  current_round: 1,
  stage_order: 1,
  advancement_rule: null,
  enrollment_source: null,
  archived: false,
  legacy: false,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  rulesets: { name: 'Reg H' },
  seasons: null,
  tournament_participants: [{}, {}],
};

const TRASH = {
  id: 'tr1',
  season_id: 's9',
  season_name: 'Old League',
  format_type: 'singles',
  deleted_at: '2026-10-20T09:30:00Z',
  deleted_by: null,
  deleted_by_name: null,
  purge_after: '2027-01-18T09:30:00Z',
  counts: {},
  rebuild_pending: true,
  schema_version: '1',
  phase_ids: [],
  player_ids: [],
};

function access(flags: { isSiteAdmin?: boolean; isSuperadmin?: boolean }) {
  return { player: { playerId: 'p1' }, isAnyAdmin: true, isSiteAdmin: false, isCreator: false, isSuperadmin: false, ...flags };
}

const SITE_ADMIN = access({ isSiteAdmin: true });
const RESOURCE_ADMIN = access({});
const SUPERADMIN = access({ isSiteAdmin: true, isSuperadmin: true });

/** The tables (or RPCs) one render read, in call order. */
async function readsOf(page: () => Promise<unknown>, live: ReturnType<typeof access>): Promise<string[]> {
  mocks.fake.current!.reset();
  mocks.getLiveAccess.mockResolvedValue(live);
  await page();
  return mocks.fake.current!.queries.map((q) => (q.kind === 'rpc' ? 'rpc:' : '') + q.table);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fake.current = createFakeSupabase(
    {
      seasons: [SEASON],
      tournaments: [TOURNAMENT],
      resource_admins: [
        { player_id: 'p1', resource_type: 'season', resource_id: 's1' },
        { player_id: 'p1', resource_type: 'tournament', resource_id: 't1' },
      ],
      league_trash: [TRASH],
      league_trash_restore_rebuilds: [],
    },
    { league_trash_schema_version: () => '1' },
  );
});

describe('competition list pages: reads per render (budget)', () => {
  it.each([
    ['/admin/leagues', AdminLeaguesPage, ['seasons'], ['resource_admins', 'seasons']],
    ['/admin/leagues/archived', ArchivedLeaguesPage, ['seasons'], ['resource_admins', 'seasons']],
    ['/admin/tournaments', AdminTournamentsPage, ['tournaments'], ['resource_admins', 'tournaments', 'tournaments']],
    ['/admin/tournaments/archived', ArchivedTournamentsPage, ['tournaments'], ['resource_admins', 'tournaments', 'tournaments']],
  ] as const)('%s: a site admin reads one list, a resource admin adds the scope lookup', async (_url, page, siteReads, scopedReads) => {
    expect(await readsOf(page, SITE_ADMIN)).toEqual(siteReads);
    expect(await readsOf(page, RESOURCE_ADMIN)).toEqual(scopedReads);
  });

  it('/admin/leagues/trash: the list, both pending-rebuild reads and the schema version, nothing else', async () => {
    const reads = await readsOf(LeagueTrashPage, SUPERADMIN);
    expect([...reads].sort()).toEqual(['league_trash', 'league_trash', 'league_trash_restore_rebuilds', 'rpc:league_trash_schema_version']);
  });

  it.each([
    ['/admin/leagues', AdminLeaguesPage],
    ['/admin/leagues/archived', ArchivedLeaguesPage],
    ['/admin/tournaments', AdminTournamentsPage],
    ['/admin/tournaments/archived', ArchivedTournamentsPage],
    ['/admin/leagues/trash', LeagueTrashPage],
  ] as const)('%s: a viewer who is not allowed in reads nothing', async (_url, page) => {
    expect(await readsOf(page, { ...access({}), isAnyAdmin: false })).toEqual([]);
  });

  it('a superadmin reads the same list as any site admin (the Trash link is a prop, not a read)', async () => {
    expect(await readsOf(AdminLeaguesPage, SUPERADMIN)).toEqual(['seasons']);
    expect(await readsOf(ArchivedLeaguesPage, SUPERADMIN)).toEqual(['seasons']);
  });
});

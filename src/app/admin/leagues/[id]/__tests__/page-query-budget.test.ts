/**
 * Query budget of the league workspace (`/admin/leagues/[id]?tab=`, redesign A5; plan §6.3): the reads per render
 * are fixed at the counts the page had before the workspace frame was built.
 *
 * The page runs for real against an in-memory PostgREST (no network, no Supabase): the gate's live access read is
 * the one mock, so every count below is the page's own queries. The league row is the one read every tab shares;
 * each tab adds only its own.
 *
 * Two tabs are merges of two earlier tabs and cost what those two cost together, never more:
 * - Format and rules = the former Format tab + the former Rules tab (classic draft: the participants for the
 *   wildcard picker; Evolution Point Buy: the phase start signals), minus the league row they shared;
 * - Settings = the former Settings tab + the former Danger zone tab, which reads nothing.
 *
 * The header's primary action and the overview's attention list are decided from the league row: no read.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabase, type FakeSupabase } from '@/lib/worlds/__tests__/fake-postgrest';
import { buildFixtureTables, EPB_SEASON_ID, SAKURA_SEASON_ID } from '@/lib/worlds/__tests__/world-fixture-db';
import type { SeasonFormatType, SeasonStatus } from '@/types/season';

const fake = vi.hoisted(() => ({ current: null as FakeSupabase | null }));

vi.mock('server-only', () => ({}));
vi.mock('next/cache', async () => (await import('@/lib/cache/__tests__/fake-next-cache')).fakeNextCache.module);
vi.mock('@/lib/supabase/client', () => ({
  get supabase() {
    return fake.current!.client;
  },
}));
// The live gate (one memoised read, shared with the admin layout) is not the page's own query.
vi.mock('@/lib/auth/helpers', () => ({
  getLiveAccess: vi.fn(async () => ({ player: { playerId: 'p1' }, isSiteAdmin: true, isAnyAdmin: true, isCreator: true })),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
}));

import AdminLeagueDetailPage from '../page';
import { fakeNextCache } from '@/lib/cache/__tests__/fake-next-cache';

/** The tables one render of the page queried, sorted. The fixture league takes the format and status under test. */
async function queriesOf(format: SeasonFormatType, tab: string | undefined, status: SeasonStatus = 'active'): Promise<string[]> {
  const seasonId = format === 'evolution_point_buy' ? EPB_SEASON_ID : SAKURA_SEASON_ID;
  const tables = buildFixtureTables();
  for (const row of tables.seasons) if (row.id === seasonId) Object.assign(row, { format_type: format, status });
  fake.current = createFakeSupabase(tables);
  await AdminLeagueDetailPage({
    params: Promise.resolve({ id: seasonId }),
    searchParams: Promise.resolve(tab === undefined ? {} : { tab }),
  });
  return fake.current.queries.map((q) => q.table).sort();
}

const ROW = ['seasons'];
/** `loadLeagueFormat`: the stages twice (outline, start signals of the view), the league groups, the type assignments twice. */
const FORMAT_VIEW = ['season_groups', 'season_participants', 'season_participants', 'tournaments', 'tournaments'];
const SETTINGS = ['ruleset_definitions', 'tournaments'];
/** A custom league's attached format and start signals (`loadLeagueFormatState`). */
const FORMAT_STATE = ['season_formats', 'seasons', 'tournaments'];

type Budget = [format: SeasonFormatType, tab: string | undefined, tables: string[]];

/** Reads per render, as counted on the page before the workspace frame (2026-11-11). */
const BUDGETS: Budget[] = [
  // The default tab renders from the league row alone.
  ['singles', undefined, ROW],
  ['draft', undefined, ROW],
  ['evolution_point_buy', undefined, ROW],
  // A custom league's overview adds its readiness checklist.
  ['custom', undefined, [...ROW, ...FORMAT_STATE]],

  ['singles', 'participants', ROW],
  ['evolution_point_buy', 'participants', ROW],

  ['singles', 'phases', [...ROW, 'ruleset_definitions']],
  ['evolution_point_buy', 'phases', [...ROW, 'ruleset_definitions']],

  // Format and rules.
  ['singles', 'format', [...ROW, ...FORMAT_VIEW]],
  // Former Format tab (7) + former Rules tab's participants read (1).
  ['draft', 'format', [...ROW, ...FORMAT_VIEW, 'draft_tier_limits', 'season_participants']],
  // Former Format tab (5) + former Rules tab's phase start signals (1).
  ['evolution_point_buy', 'format', [...ROW, 'format_rules', 'season_groups', 'tournaments', 'tournaments', 'tournaments']],
  ['custom', 'format', [...ROW, ...FORMAT_VIEW, ...FORMAT_STATE, 'format_definitions']],

  ['draft', 'draft', [...ROW, 'draft_pools', 'season_groups', 'season_groups']],
  ['evolution_point_buy', 'draft', [...ROW, 'draft_pools', 'draft_pools', 'format_rules', 'season_groups', 'season_participants']],

  // No kit context in the fixture: the "not running" notice after one read.
  ['custom', 'live', [...ROW, 'season_formats']],

  // Settings, with the danger zone (no read) at its end.
  ['singles', 'settings', [...ROW, ...SETTINGS]],
  ['draft', 'settings', [...ROW, ...SETTINGS]],
  ['evolution_point_buy', 'settings', [...ROW, ...SETTINGS]],
  ['custom', 'settings', [...ROW, ...SETTINGS]],
];

beforeEach(() => {
  fakeNextCache.reset();
});

describe('league workspace query budget', () => {
  it.each(BUDGETS)('%s ?tab=%s reads exactly its tables', async (format, tab, tables) => {
    expect(await queriesOf(format, tab)).toEqual([...tables].sort());
  });

  it('the overview of every non-custom league is one query: the league row', async () => {
    for (const format of ['singles', 'doubles', 'draft', 'evolution_point_buy'] as const) {
      expect(await queriesOf(format, undefined), format).toHaveLength(1);
      // The primary action differs by status (Activate, Manage rounds, the public page) and never costs a read.
      for (const status of ['upcoming', 'completed'] as const) expect(await queriesOf(format, undefined, status), `${format} ${status}`).toHaveLength(1);
    }
  });

  it('a custom league that is not active adds one read on every tab: whether a format is attached', async () => {
    expect(await queriesOf('custom', undefined, 'upcoming')).toEqual([...ROW, ...FORMAT_STATE, 'season_formats'].sort());
    expect(await queriesOf('custom', 'participants', 'upcoming')).toEqual([...ROW, 'season_formats'].sort());
    expect(await queriesOf('custom', 'settings', 'upcoming')).toEqual([...ROW, ...SETTINGS, 'season_formats'].sort());
  });

  it('the earlier tab ids cost what their tab costs', async () => {
    for (const format of ['singles', 'draft', 'evolution_point_buy', 'custom'] as const) {
      expect(await queriesOf(format, 'rules'), `${format} rules`).toEqual(await queriesOf(format, 'format'));
      expect(await queriesOf(format, 'danger'), `${format} danger`).toEqual(await queriesOf(format, 'settings'));
      expect(await queriesOf(format, 'schedule'), `${format} schedule`).toEqual(await queriesOf(format, 'phases'));
    }
  });

  it('an unknown tab, or one the format does not have, costs what the overview costs', async () => {
    for (const tab of ['nope', 'draft', 'live']) expect(await queriesOf('singles', tab), tab).toEqual(ROW);
  });
});

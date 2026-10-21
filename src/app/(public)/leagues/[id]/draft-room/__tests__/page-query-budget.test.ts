/**
 * Draft-room query budget (draft-frontend §3.1 step 7): a cold render makes at
 * most 7 Supabase calls, and the snapshot seed runs the `draft_snapshot` RPC
 * without a tick (critique B9). The 7th is the live player read of a
 * signed-in viewer (`getLiveAccess`, W3: the pool-admin flag and the admin
 * links must not come from the up-to-5-minutes-stale session copy); a
 * spectator still stays within 6. The admin sheet adds no server read.
 *
 * The real query modules run against a counting in-memory client: every
 * `from()` and `rpc()` is one call. No network, no Supabase project.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionPlayer } from '@/types/auth';

interface Call {
  kind: 'from' | 'rpc';
  name: string;
  args?: Record<string, unknown>;
}

const state = vi.hoisted(() => ({
  calls: [] as Call[],
  player: null as SessionPlayer | null,
}));

/** A UUID: the page answers 404 for a malformed league id before any read. */
const SEASON_ID = '55555555-5555-4555-8555-555555555555';

const SEASON_ROW = {
  id: SEASON_ID,
  name: 'Evo Liga',
  description: null,
  format_type: 'evolution_point_buy',
  ruleset_id: null,
  start_date: null,
  end_date: null,
  status: 'active',
  archived: false,
  legacy: false,
  is_test_season: false,
  core_pool: null,
  point_buy_list_id: 'list-1',
  route_theme: null,
  language: 'en',
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
  rulesets: null,
  season_participants: [{ count: 2 }],
  tournaments: [{ count: 0 }],
};

const ENTRY_ROW = {
  id: 'e1',
  list_version_id: 'list-1',
  line_number: 1,
  line_id: 'charmander--charizard',
  base_pokemon: 'Charmander',
  stage2_pokemon: 'Charmeleon',
  stage3_pokemon: 'Charizard',
  price: 30,
  kills_to_stage2: 3,
  additional_kills_to_stage3: 4,
  price_group: 'mid',
  early_rating: null,
  mid_rating: null,
  late_rating: null,
  rationale: null,
  historical_data: null,
  special_rules: null,
  special_rules_text: null,
  sources: null,
  legacy_tier: null,
  species_ids: null,
};

function rowsFor(table: string): unknown[] {
  switch (table) {
    case 'seasons':
      return [SEASON_ROW];
    case 'draft_pools':
      return [{ id: '11111111-1111-4111-8111-111111111111', engine: 'queue', kind: 'initial', phase: 'drafting', mode: 'live', status: 'in_progress' }];
    case 'point_buy_list_entries':
      return [ENTRY_ROW];
    case 'resource_admins':
      return [{ id: 'ra1' }];
    default:
      return [];
  }
}

/** A chainable PostgREST stand-in: every filter returns the builder; awaiting resolves the table's rows. */
function builder(table: string) {
  let single = false;
  const self: Record<string, unknown> = {};
  const chain = () => self;
  for (const m of ['select', 'eq', 'neq', 'in', 'is', 'order', 'limit', 'filter', 'match', 'or']) self[m] = chain;
  self.maybeSingle = () => {
    single = true;
    return self;
  };
  self.single = self.maybeSingle;
  self.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
    const rows = rowsFor(table);
    return Promise.resolve({ data: single ? (rows[0] ?? null) : rows, error: null, count: rows.length }).then(resolve, reject);
  };
  return self;
}

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (name: string) => {
      state.calls.push({ kind: 'from', name });
      return builder(name);
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      state.calls.push({ kind: 'rpc', name, args });
      return Promise.resolve({ data: { state_version: 1 }, error: null });
    },
  },
}));

vi.mock('next/cache', async () =>
  (await import('@/lib/cache/__tests__/fake-next-cache')).fakeNextCache.module,
);
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('next/link', () => ({ default: function LinkStub() { return null; } }));
// The live access check: one `players` read for a signed-in viewer (counted like the real helper's select).
vi.mock('@/lib/auth/helpers', async () => {
  const { supabase } = await import('@/lib/supabase/client');
  return {
    getLiveAccess: vi.fn(async () => {
      if (!state.player) return null;
      await supabase.from('players').select('id').eq('id', state.player.playerId).maybeSingle();
      const p = state.player;
      return { player: p, isSiteAdmin: p.isAdmin, isAnyAdmin: p.isAdmin || p.isResourceAdmin, isCreator: p.isCreator };
    }),
  };
});
vi.mock('@/lib/draft/snapshot', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/draft/snapshot')>();
  return { ...actual, getDraftSnapshot: vi.fn(actual.getDraftSnapshot) };
});
vi.mock('@/lib/worlds/registry', () => ({
  resolveViewerWorld: vi.fn(() => 'default'),
  WORLD_OVERRIDE_URL_PARAM: 'world',
}));
vi.mock('@/components/world/WorldShell', () => ({ default: function WorldShellStub() { return null; } }));
vi.mock('@/components/world/route/WorldOverrideRedirect', () => ({
  default: function WorldOverrideRedirectStub() { return null; },
}));
vi.mock('../client', () => ({ default: function DraftRoomClientStub() { return null; } }));

import DraftRoomPage from '../page';
import { getDraftSnapshot } from '@/lib/draft/snapshot';

function render() {
  return DraftRoomPage({ params: Promise.resolve({ id: SEASON_ID }), searchParams: Promise.resolve({}) });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.calls = [];
  state.player = null;
});

describe('DraftRoomPage: query budget', () => {
  it('a spectator render stays within 6 Supabase calls and seeds without a tick', async () => {
    await render();
    expect(state.calls.length).toBeLessThanOrEqual(6);
    expect(getDraftSnapshot).toHaveBeenCalledWith(expect.any(String), null, { tick: false });
    const rpcs = state.calls.filter((c) => c.kind === 'rpc');
    expect(rpcs).toHaveLength(1);
    expect(rpcs[0].name).toBe('draft_snapshot');
    expect(rpcs[0].args?.p_tick).toBe(false);
  });

  it('a resource admin (the worst case) stays within 7 Supabase calls, one of them the live player read', async () => {
    state.player = {
      playerId: 'p9',
      name: 'Oak',
      isAdmin: false,
      isResourceAdmin: true,
      isCreator: false,
      psUsername: '',
      championsUsername: '',
      avatarUrl: null,
      status: 'active',
    };
    await render();
    expect(state.calls.length).toBeLessThanOrEqual(7);
    expect(state.calls.filter((c) => c.name === 'players')).toHaveLength(1);
    expect(getDraftSnapshot).toHaveBeenCalledWith(
      expect.any(String),
      { playerId: 'p9', isPoolAdmin: true },
      { tick: false },
    );
  });
});

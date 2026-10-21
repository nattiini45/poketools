import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PointBuyListEntry } from '@/types/point-buy';
import { fullPlayerRow, expectNoPrivatePlayerData } from '@/lib/players/__tests__/private-player-fields';
import { snapshot } from '@/lib/draft-ui/__tests__/fixtures';

// ─── Mocks ──────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  getLiveAccess: vi.fn(),
  isResourceAdminFor: vi.fn(),
  getSeasonWithDetails: vi.fn(),
  getSeasonParticipants: vi.fn(),
  getDraftPoolsBySeasonWithGroups: vi.fn(),
  getListEntries: vi.fn(),
  getFormatRules: vi.fn(),
  getDraftSnapshot: vi.fn(),
  refusalQuery: vi.fn(),
  locale: { current: 'en' as 'en' | 'de' },
}));

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('next/link', () => ({ default: function LinkStub() { return null; } }));
vi.mock('@/i18n/server', async () => {
  const { createTranslator } = await import('@/i18n/core');
  return {
    getLocale: async () => mocks.locale.current,
    getT: async (ns: Parameters<typeof createTranslator>[0]) => createTranslator(ns, mocks.locale.current),
  };
});
vi.mock('@/lib/auth/helpers', () => ({ getLiveAccess: mocks.getLiveAccess }));
vi.mock('@/lib/supabase/queries/resource-admins', () => ({ isResourceAdminFor: mocks.isResourceAdminFor }));
vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonWithDetails: mocks.getSeasonWithDetails,
  getSeasonParticipants: mocks.getSeasonParticipants,
}));
vi.mock('@/lib/supabase/queries/drafts', () => ({ getDraftPoolsBySeasonWithGroups: mocks.getDraftPoolsBySeasonWithGroups }));
vi.mock('@/lib/supabase/queries/point-buy-lists', () => ({ getListEntries: mocks.getListEntries }));
vi.mock('@/lib/supabase/queries/format-rules', () => ({ getFormatRules: mocks.getFormatRules }));
vi.mock('@/lib/draft/snapshot', () => ({ getDraftSnapshot: mocks.getDraftSnapshot }));
/** `loadPublishRefusals` -> `getPublishRefusals`: draft_pools.select(...).in('id', ids). */
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (table: string) => ({
      select: (cols: string) => ({
        in: (col: string, ids: string[]) => mocks.refusalQuery({ table, cols, col, ids }),
      }),
    }),
  },
}));
vi.mock('@/components/shared/AdminGuard', () => ({
  default: function AdminGuardStub({ children }: { children: ReactNode }) {
    return children;
  },
}));
vi.mock('@/components/ui/PageContainer', () => ({
  default: function PageContainerStub({ children }: { children: ReactNode }) {
    return children;
  },
}));
vi.mock('@/components/draft-admin/DraftControlPanel', () => ({ default: function PanelStub() { return null; } }));
vi.mock('@/components/draft-admin/DraftAuditViewer', () => ({ default: function AuditStub() { return null; } }));

import Link from 'next/link';
import AdminDraftPage from '../page';
import AdminDraftAuditPage from '../audit/page';
import DraftControlPanel from '@/components/draft-admin/DraftControlPanel';
import DraftAuditViewer from '@/components/draft-admin/DraftAuditViewer';

// ─── Fixtures ───────────────────────────────────────────────────────

const ADMIN = { playerId: 'admin-1', name: 'Admin', isAdmin: false, isResourceAdmin: true };

function entry(overrides: Partial<PointBuyListEntry> = {}): PointBuyListEntry {
  return {
    id: 'e1',
    list_version_id: 'list-1',
    line_number: 1,
    base_pokemon: 'Charmander',
    stage2_pokemon: 'Charmeleon',
    stage3_pokemon: 'Charizard',
    price: 30,
    kills_to_stage2: 3,
    additional_kills_to_stage3: 4,
    price_group: 'mid' as PointBuyListEntry['price_group'],
    early_rating: 5,
    mid_rating: 5,
    late_rating: 5,
    rationale: 'SECRET rationale prose',
    historical_data: 'SECRET history',
    special_rules: null,
    special_rules_text: null,
    sources: 'SECRET sources',
    legacy_tier: null,
    species_ids: null,
    ...overrides,
  } as PointBuyListEntry;
}

function findByType(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>>[] {
  const found: ReactElement<Record<string, unknown>>[] = [];
  const visit = (n: ReactNode) => {
    if (Array.isArray(n)) {
      n.forEach(visit);
      return;
    }
    if (isValidElement<Record<string, unknown>>(n)) {
      if (n.type === type) found.push(n);
      visit(n.props.children as ReactNode);
    }
  };
  visit(node);
  return found;
}

/**
 * The props with the pools' and pick slots' own `status` removed (`pools[]`,
 * each seeded snapshot's `pool` and `active_slot`), so the privacy check runs with no key allowance and
 * would still catch a player `status` field anywhere else.
 */
function withoutPoolStatus(props: Record<string, unknown>): Record<string, unknown> {
  const strip = (v: unknown): unknown => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return v;
    const { status: _status, ...rest } = v as Record<string, unknown>;
    return rest;
  };
  const out: Record<string, unknown> = { ...props };
  if (Array.isArray(props.pools)) out.pools = props.pools.map(strip);
  const snaps = props.initialSnapshots;
  if (typeof snaps === 'object' && snaps !== null) {
    out.initialSnapshots = Object.fromEntries(
      Object.entries(snaps as Record<string, Record<string, unknown>>).map(([id, dto]) => [
        id,
        { ...dto, pool: strip(dto.pool), active_slot: strip(dto.active_slot) },
      ]),
    );
  }
  return out;
}

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

// `getDraftPoolsBySeasonWithGroups` rows of a league without groups (group fields null).
const NO_GROUP = { season_group_id: null, season_group_name: null };
const POOLS = [
  { id: 'pool-1', engine: 'queue', kind: 'initial', phase: 'complete', mode: 'live', status: 'complete', ...NO_GROUP },
  { id: 'pool-2', engine: 'queue', kind: 'redraft', phase: 'drafting', mode: 'slow', status: 'in_progress', ...NO_GROUP },
];

const SEASON_ID = '0b9f1c2e-5d4a-4c3b-9a8e-7f6d5c4b3a21';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.locale.current = 'en';
  mocks.getLiveAccess.mockResolvedValue({ player: ADMIN, isSiteAdmin: false, isAnyAdmin: true, isCreator: false });
  mocks.isResourceAdminFor.mockResolvedValue(true);
  mocks.getSeasonWithDetails.mockResolvedValue({
    id: SEASON_ID,
    name: 'Evo Liga',
    format_type: 'evolution_point_buy',
    point_buy_list_id: 'list-1',
    participant_count: 2,
  });
  // Full rows with private sentinels: only `{ id, name }` may cross into the client.
  mocks.getSeasonParticipants.mockResolvedValue([
    { ...fullPlayerRow({ id: 'p1', name: 'Dawn' }), gym_type: 'fire', core_types: [] },
    { ...fullPlayerRow({ id: 'p2', name: 'Misty' }), gym_type: 'water', core_types: [] },
  ]);
  mocks.getDraftPoolsBySeasonWithGroups.mockResolvedValue(POOLS);
  mocks.getListEntries.mockResolvedValue([entry()]);
  mocks.getFormatRules.mockResolvedValue({ banned_moves: [], comeback_spend_open: true });
  mocks.getDraftSnapshot.mockImplementation(async (poolId: string) => ({
    dto: snapshot({ pool: { ...snapshot().pool, id: poolId } }),
  }));
});

// ─── Panel page ─────────────────────────────────────────────────────

describe('/admin/leagues/[id]/draft', () => {
  const render = () => AdminDraftPage({ params: Promise.resolve({ id: SEASON_ID }) });

  it('passes narrow props: no participants or token data (tokens live on the league page), no list prose', async () => {
    const panels = findByType(await render(), DraftControlPanel);
    expect(panels).toHaveLength(1);
    const props = panels[0].props;
    expect(props).not.toHaveProperty('participants');
    expect(props).not.toHaveProperty('comebackSpendOpen');
    expect(props).not.toHaveProperty('hasRedraft');
    expect(props.pools).toEqual(POOLS);
    // No Redraft in its submission phase: no refusal read at all.
    expect(mocks.refusalQuery).not.toHaveBeenCalled();
    expect(props.publishRefusedAt).toEqual({});
    // Only the pools' and the slot's own `status` is removed; any other `status` key (a player's) still fails.
    expectNoPrivatePlayerData(withoutPoolStatus(props));
    expect(JSON.stringify(props)).not.toMatch(/"(discord_id|auth_user_id|is_admin|ban_reason)"/);
  });

  it('a league with groups: each pool carries its group (narrow: no budget, parent or timestamps cross)', async () => {
    const grouped = (id: string, kind: 'initial' | 'redraft', g: string) => ({
      id,
      engine: 'queue',
      kind,
      phase: 'complete',
      mode: 'live',
      status: 'complete',
      season_group_id: `g-${g}`,
      season_group_name: `Group ${g}`,
      sort_order: 0,
      parent_pool_id: null,
      point_budget: 100,
      created_at: '2026-10-01T00:00:00Z',
    });
    mocks.getDraftPoolsBySeasonWithGroups.mockResolvedValue([grouped('ia', 'initial', 'A'), grouped('ib', 'initial', 'B')]);
    const props = findByType(await render(), DraftControlPanel)[0].props;
    expect(props.pools).toEqual([
      { id: 'ia', engine: 'queue', kind: 'initial', phase: 'complete', mode: 'live', status: 'complete', season_group_id: 'g-A', season_group_name: 'Group A' },
      { id: 'ib', engine: 'queue', kind: 'initial', phase: 'complete', mode: 'live', status: 'complete', season_group_id: 'g-B', season_group_name: 'Group B' },
    ]);
  });

  it('reads publish_refused_at only for Redrafts in their submission phase and passes it as admin data', async () => {
    const submissions = { ...POOLS[1], id: 'pool-3', phase: 'submissions', status: 'pending' };
    const neverRefused = { ...POOLS[1], id: 'pool-4', phase: 'submissions', status: 'pending' };
    mocks.getDraftPoolsBySeasonWithGroups.mockResolvedValue([...POOLS, submissions, neverRefused]);
    mocks.refusalQuery.mockResolvedValue({
      data: [
        { id: 'pool-3', publish_refused_at: '2026-10-18T20:00:00Z' },
        { id: 'pool-4', publish_refused_at: null },
      ],
      error: null,
    });
    const props = findByType(await render(), DraftControlPanel)[0].props;
    expect(mocks.refusalQuery).toHaveBeenCalledTimes(1);
    expect(mocks.refusalQuery.mock.calls[0][0]).toEqual({
      table: 'draft_pools',
      cols: 'id, publish_refused_at',
      col: 'id',
      ids: ['pool-3', 'pool-4'],
    });
    // Only refused pools are listed (a null column = never refused).
    expect(props.publishRefusedAt).toEqual({ 'pool-3': '2026-10-18T20:00:00Z' });
    // The page adds no refusal to the snapshot seeds: they are exactly what `getDraftSnapshot` returned for this
    // admin. (The real mapper never maps the refusal instant, for any viewer:
    // src/lib/draft/__tests__/snapshot.test.ts, "publish_refused_at (never mapped ...)".)
    expect(JSON.stringify(props.initialSnapshots)).not.toContain('2026-10-18T20:00:00Z');
  });

  it('a failed refusal read throws (never read as "not refused")', async () => {
    mocks.getDraftPoolsBySeasonWithGroups.mockResolvedValue([{ ...POOLS[1], id: 'pool-3', phase: 'submissions', status: 'pending' }]);
    mocks.refusalQuery.mockResolvedValue({ data: null, error: { code: '57014', message: 'timeout' } });
    await expect(render()).rejects.toMatchObject({ code: '57014' });
  });

  it('the back link names its tab: league admin, Draft tab', async () => {
    const tree = await render();
    expect(findByType(tree, Link).map((l) => l.props.href)).toContain(`/admin/leagues/${SEASON_ID}?tab=draft`);
    expect(textOf(tree)).toContain('Back to league admin: Draft');
    expect(findByType(tree, Link).map((l) => l.props.href)).not.toContain(`/admin/leagues/${SEASON_ID}`);
  });

  it('seeds every pool snapshot without ticking (critique B9) as a pool admin', async () => {
    const props = findByType(await render(), DraftControlPanel)[0].props;
    expect(mocks.getDraftSnapshot).toHaveBeenCalledTimes(2);
    for (const call of mocks.getDraftSnapshot.mock.calls) {
      expect(call[1]).toEqual({ playerId: 'admin-1', isPoolAdmin: true });
      expect(call[2]).toEqual({ tick: false });
    }
    expect(Object.keys(props.initialSnapshots as object).sort()).toEqual(['pool-1', 'pool-2']);
  });

  it('?pool= opens that pool tab (the room sheet links here with its pool); an unknown pool is ignored', async () => {
    const open = async (query: Record<string, string | string[]>) =>
      findByType(
        await AdminDraftPage({ params: Promise.resolve({ id: SEASON_ID }), searchParams: Promise.resolve(query) }),
        DraftControlPanel,
      )[0].props.initialPoolId;
    expect(await open({ pool: 'pool-1' })).toBe('pool-1');
    expect(await open({ pool: ['pool-2', 'pool-1'] })).toBe('pool-2');
    expect(await open({ pool: 'pool-of-another-league' })).toBeNull();
    expect(await open({})).toBeNull();
    expect(findByType(await render(), DraftControlPanel)[0].props.initialPoolId).toBeNull();
  });

  it('a failed snapshot read reaches the error boundary (no logged fallback, no silently empty tab)', async () => {
    mocks.getDraftSnapshot.mockImplementation(async (poolId: string) => {
      if (poolId === 'pool-2') throw new Error('rpc down');
      return { dto: snapshot() };
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(render()).rejects.toThrow('rpc down');
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  describe('legacy-engine (pre-M2) pools', () => {
    const LEGACY = {
      id: 'pool-legacy',
      engine: 'legacy',
      kind: 'initial',
      phase: 'complete',
      mode: 'live',
      status: 'complete',
      ...NO_GROUP,
    };
    const hrefs = (tree: ReactNode) => findByType(tree, Link).map((l) => l.props.href);

    it('mixed season: tabs and snapshot seeds for the queue pools only, legacy listed with links', async () => {
      mocks.getDraftPoolsBySeasonWithGroups.mockResolvedValue([LEGACY, ...POOLS]);
      const tree = await render();
      const props = findByType(tree, DraftControlPanel)[0].props;
      expect(props.pools).toEqual(POOLS);
      expect(mocks.getDraftSnapshot).toHaveBeenCalledTimes(2);
      expect(mocks.getDraftSnapshot.mock.calls.map((c) => c[0])).not.toContain('pool-legacy');
      expect(textOf(tree)).toContain('Earlier drafts');
      expect(textOf(tree)).toContain('Initial draft');
      expect(hrefs(tree)).toEqual(
        expect.arrayContaining([`/admin/leagues/${SEASON_ID}?tab=draft`, `/leagues/${SEASON_ID}/draft?board=legacy`]),
      );
    });

    it('legacy-only season: no panel, no snapshot read, the legacy list and a bilingual hint', async () => {
      mocks.getDraftPoolsBySeasonWithGroups.mockResolvedValue([LEGACY]);
      const tree = await render();
      expect(findByType(tree, DraftControlPanel)).toHaveLength(0);
      expect(mocks.getDraftSnapshot).not.toHaveBeenCalled();
      expect(textOf(tree)).toContain('No draft of this league runs in the draft control yet.');
      expect(textOf(tree)).toContain('Manage in league admin: Draft');

      mocks.locale.current = 'de';
      const de = textOf(await render());
      expect(de).toContain('Frühere Drafts');
      expect(de).toContain('In der Draft-Steuerung läuft noch kein Draft dieser Liga.');
    });
  });

  it('refuses an admin of another league before reading any draft data', async () => {
    mocks.isResourceAdminFor.mockResolvedValue(false);
    const tree = await render();
    expect(findByType(tree, DraftControlPanel)).toHaveLength(0);
    expect(textOf(tree)).toContain('Only admins of this league can open the draft control.');
    expect(mocks.getSeasonWithDetails).not.toHaveBeenCalled();
    expect(mocks.getDraftPoolsBySeasonWithGroups).not.toHaveBeenCalled();
    expect(mocks.getDraftSnapshot).not.toHaveBeenCalled();
  });

  it('leaves signed-out viewers and non-admins to AdminGuard without reading data', async () => {
    mocks.getLiveAccess.mockResolvedValue(null);
    const tree = await render();
    expect(findByType(tree, DraftControlPanel)).toHaveLength(0);
    expect(mocks.getSeasonWithDetails).not.toHaveBeenCalled();
  });

  it('site admins pass without the resource check', async () => {
    mocks.getLiveAccess.mockResolvedValue({ player: { ...ADMIN, isAdmin: true }, isSiteAdmin: true, isAnyAdmin: true });
    expect(findByType(await render(), DraftControlPanel)).toHaveLength(1);
    expect(mocks.isResourceAdminFor).not.toHaveBeenCalled();
  });

  it('non-EPB leagues get a message, no panel', async () => {
    mocks.getSeasonWithDetails.mockResolvedValue({ id: SEASON_ID, name: 'Cup', format_type: 'draft', point_buy_list_id: null });
    const tree = await render();
    expect(findByType(tree, DraftControlPanel)).toHaveLength(0);
    expect(textOf(tree)).toContain('only for Evolution Point Buy leagues');
  });

  it('a missing league is a 404', async () => {
    mocks.getSeasonWithDetails.mockResolvedValue(null);
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('a non-uuid id is a 404 before any auth or admin read', async () => {
    await expect(AdminDraftPage({ params: Promise.resolve({ id: 'not-a-uuid' }) })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.getLiveAccess).not.toHaveBeenCalled();
    expect(mocks.isResourceAdminFor).not.toHaveBeenCalled();
    expect(mocks.getSeasonWithDetails).not.toHaveBeenCalled();
  });
});

// ─── Audit page ─────────────────────────────────────────────────────

describe('/admin/leagues/[id]/draft/audit', () => {
  const render = (query: Record<string, string | string[]> = {}) =>
    AdminDraftAuditPage({ params: Promise.resolve({ id: SEASON_ID }), searchParams: Promise.resolve(query) });

  it('passes narrow props and valid initial filters only', async () => {
    const viewers = findByType(
      await render({ pool: 'pool-1', action: ['paused', 'bogus', 'pick_voided'], player: 'p2' }),
      DraftAuditViewer,
    );
    expect(viewers).toHaveLength(1);
    const props = viewers[0].props;
    expect(props.initialPoolId).toBe('pool-1');
    expect(props.initialActions).toEqual(['pick_voided', 'paused']);
    expect(props.initialPlayer).toBe('p2');
    expect(props.participants).toEqual([
      { id: 'p1', name: 'Dawn' },
      { id: 'p2', name: 'Misty' },
    ]);
    expectNoPrivatePlayerData(withoutPoolStatus(props));
    // Entries are read client-side from the guarded route; the page reads no snapshot.
    expect(mocks.getDraftSnapshot).not.toHaveBeenCalled();
  });

  it('defaults to the running pool and ignores an unknown pool or player', async () => {
    const props = findByType(await render({ pool: 'nope', player: 'stranger' }), DraftAuditViewer)[0].props;
    expect(props.initialPoolId).toBe('pool-2');
    expect(props.initialPlayer).toBeNull();
    expect(props.initialActions).toEqual([]);
  });

  it('refuses an admin of another league', async () => {
    mocks.isResourceAdminFor.mockResolvedValue(false);
    const tree = await render();
    expect(findByType(tree, DraftAuditViewer)).toHaveLength(0);
    expect(mocks.getDraftPoolsBySeasonWithGroups).not.toHaveBeenCalled();
  });
});

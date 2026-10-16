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
  getDraftPoolsBySeason: vi.fn(),
  getListEntries: vi.fn(),
  getFormatRules: vi.fn(),
  getDraftSnapshot: vi.fn(),
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
vi.mock('@/lib/supabase/queries/drafts', () => ({ getDraftPoolsBySeason: mocks.getDraftPoolsBySeason }));
vi.mock('@/lib/supabase/queries/point-buy-lists', () => ({ getListEntries: mocks.getListEntries }));
vi.mock('@/lib/supabase/queries/format-rules', () => ({ getFormatRules: mocks.getFormatRules }));
vi.mock('@/lib/draft/snapshot', () => ({ getDraftSnapshot: mocks.getDraftSnapshot }));
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

const POOLS = [
  { id: 'pool-1', engine: 'queue', kind: 'initial', phase: 'complete', mode: 'live', status: 'complete' },
  { id: 'pool-2', engine: 'queue', kind: 'redraft', phase: 'drafting', mode: 'slow', status: 'in_progress' },
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
  mocks.getDraftPoolsBySeason.mockResolvedValue(POOLS);
  mocks.getListEntries.mockResolvedValue([entry()]);
  mocks.getFormatRules.mockResolvedValue({ banned_moves: [], comeback_spend_open: true });
  mocks.getDraftSnapshot.mockImplementation(async (poolId: string) => ({
    dto: snapshot({ pool: { ...snapshot().pool, id: poolId } }),
  }));
});

// ─── Panel page ─────────────────────────────────────────────────────

describe('/admin/leagues/[id]/draft', () => {
  const render = () => AdminDraftPage({ params: Promise.resolve({ id: SEASON_ID }) });

  it('passes narrow props: participants as { id, name }, no private player data, no list prose', async () => {
    const panels = findByType(await render(), DraftControlPanel);
    expect(panels).toHaveLength(1);
    const props = panels[0].props;
    expect(props.participants).toEqual([
      { id: 'p1', name: 'Dawn' },
      { id: 'p2', name: 'Misty' },
    ]);
    expect(props.pools).toEqual(POOLS);
    expect(props.comebackSpendOpen).toBe(true);
    expect(props.hasRedraft).toBe(false);
    // Only the pools' and the slot's own `status` is removed; any other `status` key (a player's) still fails.
    expectNoPrivatePlayerData(withoutPoolStatus(props));
    expect(JSON.stringify(props)).not.toMatch(/"(discord_id|auth_user_id|is_admin|ban_reason)"/);
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

  it('a failed snapshot read seeds nothing for that pool', async () => {
    mocks.getDraftSnapshot.mockImplementation(async (poolId: string) => {
      if (poolId === 'pool-2') throw new Error('rpc down');
      return { dto: snapshot() };
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const props = findByType(await render(), DraftControlPanel)[0].props;
    expect(Object.keys(props.initialSnapshots as object)).toEqual(['pool-1']);
    errSpy.mockRestore();
  });

  describe('legacy-engine (pre-M2) pools', () => {
    const LEGACY = { id: 'pool-legacy', engine: 'legacy', kind: 'initial', phase: 'complete', mode: 'live', status: 'complete' };
    const hrefs = (tree: ReactNode) => findByType(tree, Link).map((l) => l.props.href);

    it('mixed season: tabs and snapshot seeds for the queue pools only, legacy listed with links', async () => {
      mocks.getDraftPoolsBySeason.mockResolvedValue([LEGACY, ...POOLS]);
      const tree = await render();
      const props = findByType(tree, DraftControlPanel)[0].props;
      expect(props.pools).toEqual(POOLS);
      expect(mocks.getDraftSnapshot).toHaveBeenCalledTimes(2);
      expect(mocks.getDraftSnapshot.mock.calls.map((c) => c[0])).not.toContain('pool-legacy');
      expect(textOf(tree)).toContain('Earlier drafts');
      expect(textOf(tree)).toContain('Initial draft');
      expect(hrefs(tree)).toEqual(
        expect.arrayContaining([`/admin/leagues/${SEASON_ID}`, `/leagues/${SEASON_ID}/draft?board=legacy`]),
      );
    });

    it('legacy-only season: no panel, no snapshot read, the legacy list and a bilingual hint', async () => {
      mocks.getDraftPoolsBySeason.mockResolvedValue([LEGACY]);
      const tree = await render();
      expect(findByType(tree, DraftControlPanel)).toHaveLength(0);
      expect(mocks.getDraftSnapshot).not.toHaveBeenCalled();
      expect(textOf(tree)).toContain('No draft of this league runs in the draft control yet.');
      expect(textOf(tree)).toContain('Manage on the league admin page');

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
    expect(mocks.getDraftPoolsBySeason).not.toHaveBeenCalled();
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
    expect(mocks.getDraftPoolsBySeason).not.toHaveBeenCalled();
  });
});

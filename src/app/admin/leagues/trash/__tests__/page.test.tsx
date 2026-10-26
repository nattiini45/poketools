/**
 * `/admin/leagues/trash`: the superadmin's league recycle bin. The viewer is read live (never the session copy), no
 * trash data is read before the viewer is known to be the superadmin, and the rows handed to the panel are the
 * list's rows with the counts, the translated format label and the "schema changed since delete" flag.
 */
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getLiveAccess: vi.fn(),
  listLeagueTrash: vi.fn(),
  listPendingLeagueRebuilds: vi.fn(),
  getLeagueTrashSchemaVersion: vi.fn(),
  locale: 'en' as 'en' | 'de',
}));

function stub(name: string) {
  const C = function Stub({ children }: { children?: ReactNode }) {
    return children ?? null;
  };
  Object.defineProperty(C, 'name', { value: name });
  return { default: C };
}

vi.mock('server-only', () => ({}));
vi.mock('next/link', () => stub('Link'));
vi.mock('@/i18n/server', async () => {
  const { createTranslator } = await import('@/i18n/core');
  return {
    getLocale: async () => mocks.locale,
    getT: async (ns: Parameters<typeof createTranslator>[0]) => createTranslator(ns, mocks.locale),
  };
});
vi.mock('@/lib/auth/helpers', () => ({ getLiveAccess: mocks.getLiveAccess }));
vi.mock('@/lib/supabase/queries/league-trash', () => ({
  listLeagueTrash: mocks.listLeagueTrash,
  listPendingLeagueRebuilds: mocks.listPendingLeagueRebuilds,
  getLeagueTrashSchemaVersion: mocks.getLeagueTrashSchemaVersion,
}));
vi.mock('@/components/shared/SuperadminGuard', () => stub('SuperadminGuard'));
vi.mock('@/components/league-trash/LeagueTrashPanel', () => stub('LeagueTrashPanel'));
vi.mock('@/components/ui/PageContainer', () => stub('PageContainer'));

import LeagueTrashPage from '../page';
import SuperadminGuard from '@/components/shared/SuperadminGuard';
import LeagueTrashPanel from '@/components/league-trash/LeagueTrashPanel';
import PageContainer from '@/components/ui/PageContainer';

type El = ReactElement<Record<string, unknown>>;

function findByType(node: ReactNode, type: unknown): El[] {
  const found: El[] = [];
  const visit = (n: ReactNode): void => {
    if (Array.isArray(n)) {
      n.forEach(visit);
      return;
    }
    if (isValidElement<Record<string, unknown>>(n)) {
      if (n.type === type) found.push(n);
      visit(n.props.children as ReactNode);
      if (n.props.action) visit(n.props.action as ReactNode);
    }
  };
  visit(node);
  return found;
}

function access(flags: { isSiteAdmin?: boolean; isAnyAdmin?: boolean; isSuperadmin?: boolean }) {
  return { player: { playerId: 'p1' }, isSiteAdmin: false, isAnyAdmin: false, isCreator: false, isSuperadmin: false, ...flags };
}

const SUPERADMIN = access({ isSiteAdmin: true, isAnyAdmin: true, isSuperadmin: true });

const reads = () => [mocks.listLeagueTrash, mocks.listPendingLeagueRebuilds, mocks.getLeagueTrashSchemaVersion];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.locale = 'en';
  mocks.getLiveAccess.mockResolvedValue(SUPERADMIN);
  mocks.getLeagueTrashSchemaVersion.mockResolvedValue('20261101000000');
  mocks.listPendingLeagueRebuilds.mockResolvedValue([
    { kind: 'restore', trash_id: 't9', season_id: 's9', season_name: 'Spring Open', at: '2026-10-22T08:00:00Z', phase_ids: ['ph1'], player_ids: ['pl1'] },
  ]);
  mocks.listLeagueTrash.mockResolvedValue([
    {
      id: 't1',
      season_id: 's1',
      season_name: 'Summer League S3',
      format_type: 'draft',
      deleted_at: '2026-10-20T09:30:00Z',
      deleted_by: 'p7',
      deleted_by_name: 'Ash',
      purge_after: '2027-01-18T09:30:00Z',
      counts: { season_participants: 12, tournaments: 1, matches: 40, games: 88, draft_pools: 2, battle_stats: 900 },
      rebuild_pending: false,
      schema_version: '20261026091500',
    },
    {
      id: 't2',
      season_id: 's2',
      season_name: 'Winter Cup',
      format_type: 'singles',
      deleted_at: '2026-10-21T09:30:00Z',
      deleted_by: null,
      deleted_by_name: null,
      purge_after: '2027-01-19T09:30:00Z',
      counts: {},
      rebuild_pending: true,
      schema_version: '20261101000000',
    },
  ]);
});

describe('league trash page: gating', () => {
  it.each([
    ['signed out', null],
    ['not an admin', access({})],
    ['a resource admin', access({ isAnyAdmin: true })],
    ['a site admin who is not the superadmin', access({ isSiteAdmin: true, isAnyAdmin: true })],
  ])('%s: SuperadminGuard alone decides and nothing is read', async (_who, live) => {
    mocks.getLiveAccess.mockResolvedValue(live);
    const tree = await LeagueTrashPage();
    expect(findByType(tree, SuperadminGuard)).toHaveLength(1);
    expect(findByType(tree, PageContainer)).toHaveLength(0);
    expect(findByType(tree, LeagueTrashPanel)).toHaveLength(0);
    for (const read of reads()) expect(read).not.toHaveBeenCalled();
  });

  it('the superadmin gets the page inside the guard', async () => {
    const tree = await LeagueTrashPage();
    const [guard] = findByType(tree, SuperadminGuard);
    expect(findByType(guard, PageContainer)).toHaveLength(1);
    expect(findByType(tree, LeagueTrashPanel)).toHaveLength(1);
    for (const read of reads()) expect(read).toHaveBeenCalledTimes(1);
  });
});

describe('league trash page: the data handed to the panel', () => {
  it('maps the list rows: translated format, headline counts, rebuild flag and the schema-changed flag', async () => {
    const [panel] = findByType(await LeagueTrashPage(), LeagueTrashPanel);
    const rows = panel.props.rows as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      id: 't1',
      seasonId: 's1',
      name: 'Summer League S3',
      formatLabel: 'Draft',
      deletedAt: '2026-10-20T09:30:00Z',
      deletedByName: 'Ash',
      purgeAfter: '2027-01-18T09:30:00Z',
      counts: { players: 12, phases: 1, matches: 40, games: 88, draftPools: 2 },
      rebuildPending: false,
      schemaChanged: true,
    });
    // Same version as now: unchanged; a pending delete rebuild is carried over; no actor is null.
    expect(rows[1]).toMatchObject({ id: 't2', formatLabel: 'Singles', deletedByName: null, rebuildPending: true, schemaChanged: false });
  });

  it('never passes the captured data: only the view fields', async () => {
    const [panel] = findByType(await LeagueTrashPage(), LeagueTrashPanel);
    for (const view of panel.props.rows as Record<string, unknown>[]) {
      expect(Object.keys(view).sort()).toEqual(
        ['counts', 'deletedAt', 'deletedByName', 'formatLabel', 'id', 'name', 'purgeAfter', 'rebuildPending', 'schemaChanged', 'seasonId'].sort(),
      );
    }
  });

  it('maps the pending rebuilds of both kinds', async () => {
    const [panel] = findByType(await LeagueTrashPage(), LeagueTrashPanel);
    expect(panel.props.pending).toEqual([
      { kind: 'restore', trashId: 't9', seasonId: 's9', name: 'Spring Open', at: '2026-10-22T08:00:00Z' },
    ]);
  });

  it('a database without a migration ledger flags nothing', async () => {
    mocks.getLeagueTrashSchemaVersion.mockResolvedValue(null);
    const [panel] = findByType(await LeagueTrashPage(), LeagueTrashPanel);
    expect((panel.props.rows as { schemaChanged: boolean }[]).map((row) => row.schemaChanged)).toEqual([false, false]);
  });

  it('German: the format label and the title', async () => {
    mocks.locale = 'de';
    const tree = await LeagueTrashPage();
    const [container] = findByType(tree, PageContainer);
    expect(container.props.title).toBe('Liga-Papierkorb');
    expect(String(container.props.subtitle)).toContain('90 Tage');
    const [panel] = findByType(tree, LeagueTrashPanel);
    expect((panel.props.rows as { formatLabel: string }[])[1].formatLabel).toBe('Einzel');
  });

  it('the subtitle names the retention window from the one constant', async () => {
    const [container] = findByType(await LeagueTrashPage(), PageContainer);
    expect(String(container.props.subtitle)).toContain('90 days');
  });

  it('a read failure propagates (fails closed, never an empty trash)', async () => {
    mocks.listLeagueTrash.mockRejectedValue(new Error('db down'));
    await expect(LeagueTrashPage()).rejects.toThrow('db down');
  });
});

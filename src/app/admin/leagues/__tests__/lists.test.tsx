/**
 * Admin league lists. The viewer is read live (never the session copy). A
 * site admin sees every league; a resource admin only their own, and the
 * active list never shows archived leagues while the archived list shows
 * only the admin's own archived ones. The rows reach `CompetitionList` as
 * display data (redesign A4); the list itself is tested in
 * `components/admin/competitions/__tests__`.
 */
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getLiveAccess: vi.fn(),
  listSeasons: vi.fn(),
  listArchivedSeasons: vi.fn(),
  listSeasonsByIds: vi.fn(),
  getAdminSeasonIds: vi.fn(),
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
    getLocale: async () => 'en',
    getT: async (ns: Parameters<typeof createTranslator>[0]) => createTranslator(ns, 'en'),
  };
});
vi.mock('@/lib/auth/helpers', () => ({ getLiveAccess: mocks.getLiveAccess }));
vi.mock('@/lib/supabase/queries/seasons', () => ({
  listSeasons: mocks.listSeasons,
  listArchivedSeasons: mocks.listArchivedSeasons,
  listSeasonsByIds: mocks.listSeasonsByIds,
}));
vi.mock('@/lib/supabase/queries/resource-admins', () => ({ getAdminSeasonIds: mocks.getAdminSeasonIds }));
vi.mock('@/components/shared/AdminGuard', () => stub('AdminGuard'));
vi.mock('@/components/ui/PageContainer', () => stub('PageContainer'));

import AdminLeaguesPage from '../page';
import ArchivedLeaguesPage from '../archived/page';
import CompetitionList from '@/components/admin/competitions/CompetitionList';
import AdminGuard from '@/components/shared/AdminGuard';
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

/** The list the page rendered: its props, and the names of its rows. */
function listOf(tree: ReactNode) {
  const [list] = findByType(tree, CompetitionList);
  const rows = (list.props.rows as { name: string }[]).map((row) => row.name);
  return { props: list.props, rows };
}

function league(id: string, name: string, archived = false) {
  return {
    id,
    name,
    archived,
    format_type: 'singles',
    ruleset_name: null,
    tournament_count: 1,
    participant_count: 8,
    status: 'active',
    is_test_season: false,
  };
}

function access(flags: { isSiteAdmin?: boolean; isAnyAdmin?: boolean; isSuperadmin?: boolean }) {
  return {
    player: { playerId: 'p1' },
    isSiteAdmin: false,
    isAnyAdmin: false,
    isCreator: false,
    isSuperadmin: false,
    ...flags,
  };
}

const allReads = () => [
  mocks.listSeasons,
  mocks.listArchivedSeasons,
  mocks.listSeasonsByIds,
  mocks.getAdminSeasonIds,
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listSeasons.mockResolvedValue([league('s1', 'Open League'), league('s2', 'Other League')]);
  mocks.listArchivedSeasons.mockResolvedValue([league('s9', 'Old League', true)]);
  mocks.getAdminSeasonIds.mockResolvedValue(['s2']);
  mocks.listSeasonsByIds.mockResolvedValue([league('s2', 'Other League')]);
});

describe('admin leagues list', () => {
  it('site admin: every active league, nothing scoped', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: true, isAnyAdmin: true }));
    const tree = await AdminLeaguesPage();
    expect(mocks.listSeasons).toHaveBeenCalledWith({ includeTestSeasons: true });
    expect(mocks.listSeasonsByIds).not.toHaveBeenCalled();
    expect(listOf(tree).rows).toEqual(['Open League', 'Other League']);
    expect(listOf(tree).props).toMatchObject({ kind: 'league', view: 'active' });
  });

  it('resource admin: only their own leagues, archived ones excluded', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    const tree = await AdminLeaguesPage();
    expect(mocks.getAdminSeasonIds).toHaveBeenCalledWith('p1');
    expect(mocks.listSeasonsByIds).toHaveBeenCalledWith(['s2'], { archived: false });
    expect(mocks.listSeasons).not.toHaveBeenCalled();
    expect(listOf(tree).rows).toEqual(['Other League']);
  });

  it('offers the league trash link to the superadmin only, from the live read', async () => {
    const canViewTrash = async (live: ReturnType<typeof access>) => {
      mocks.getLiveAccess.mockResolvedValue(live);
      return listOf(await AdminLeaguesPage()).props.canViewTrash;
    };
    expect(await canViewTrash(access({ isSiteAdmin: true, isAnyAdmin: true }))).toBe(false);
    expect(await canViewTrash(access({ isAnyAdmin: true }))).toBe(false);
    expect(await canViewTrash(access({ isSiteAdmin: true, isAnyAdmin: true, isSuperadmin: true }))).toBe(true);
  });

  it('a resource admin with no assignments gets an empty list (the list shows the empty state)', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    mocks.getAdminSeasonIds.mockResolvedValue([]);
    mocks.listSeasonsByIds.mockResolvedValue([]);
    expect(listOf(await AdminLeaguesPage()).rows).toEqual([]);
  });

  it('maps a league to display data: translated labels, counts, dates and the next step', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: true, isAnyAdmin: true }));
    mocks.listSeasons.mockResolvedValue([
      { ...league('s1', 'Open League'), format_type: 'draft', ruleset_name: 'Gen 9 OU', start_date: '2026-10-01', end_date: '2026-10-31', created_at: '2026-09-01T00:00:00Z', tournament_count: 2, status: 'upcoming' },
      { ...league('s3', 'Kit League'), format_type: 'custom', status: 'upcoming' },
    ]);
    const { props } = listOf(await AdminLeaguesPage());
    expect(props.rows).toEqual([
      expect.objectContaining({
        id: 's1',
        href: '/admin/leagues/s1',
        actionHref: '/admin/leagues/s1',
        action: 'setup',
        formatLabel: 'Draft',
        statusLabel: 'Upcoming',
        rulesetName: 'Gen 9 OU',
        detail: '2 stages',
        players: 8,
        startDate: '2026-10-01',
        endDate: '2026-10-31',
      }),
      expect.objectContaining({ id: 's3', action: 'setup', actionHref: '/admin/leagues/s3?tab=format' }),
    ]);
  });

  it.each([
    ['signed out', null],
    ['not an admin', access({})],
    ['an admin flag without a player', { ...access({ isAnyAdmin: true }), player: null }],
  ])('%s: AdminGuard alone decides and nothing is read', async (_who, live) => {
    mocks.getLiveAccess.mockResolvedValue(live);
    const tree = await AdminLeaguesPage();
    expect(findByType(tree, AdminGuard)).toHaveLength(1);
    expect(findByType(tree, PageContainer)).toHaveLength(0);
    for (const read of allReads()) expect(read).not.toHaveBeenCalled();
  });
});

describe('admin archived leagues list', () => {
  it('site admin: every archived league', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: true, isAnyAdmin: true }));
    const tree = await ArchivedLeaguesPage();
    expect(mocks.listArchivedSeasons).toHaveBeenCalledTimes(1);
    expect(mocks.listSeasonsByIds).not.toHaveBeenCalled();
    expect(listOf(tree).rows).toEqual(['Old League']);
    expect(listOf(tree).props).toMatchObject({ kind: 'league', view: 'archived' });
  });

  it('resource admin: only their own archived leagues, not every archived league', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    mocks.listSeasonsByIds.mockResolvedValue([league('s2', 'My Archived', true)]);
    const tree = await ArchivedLeaguesPage();
    expect(mocks.getAdminSeasonIds).toHaveBeenCalledWith('p1');
    expect(mocks.listSeasonsByIds).toHaveBeenCalledWith(['s2'], { archived: true });
    expect(mocks.listArchivedSeasons).not.toHaveBeenCalled();
    expect(listOf(tree).rows).toEqual(['My Archived']);
  });

  it.each([
    ['signed out', null],
    ['not an admin', access({})],
  ])('%s: AdminGuard alone decides and nothing is read', async (_who, live) => {
    mocks.getLiveAccess.mockResolvedValue(live);
    const tree = await ArchivedLeaguesPage();
    expect(findByType(tree, AdminGuard)).toHaveLength(1);
    expect(findByType(tree, PageContainer)).toHaveLength(0);
    for (const read of allReads()) expect(read).not.toHaveBeenCalled();
  });
});

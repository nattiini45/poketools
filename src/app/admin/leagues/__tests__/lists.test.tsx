/**
 * Admin league lists. The viewer is read live (never the session copy). A
 * site admin sees every league; a resource admin only their own, and the
 * active list never shows archived leagues while the archived list shows
 * only the admin's own archived ones.
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
vi.mock('@/components/ui/Card', () => stub('Card'));
vi.mock('@/components/ui/Badge', () => stub('Badge'));

import AdminLeaguesPage from '../page';
import ArchivedLeaguesPage from '../archived/page';
import Link from 'next/link';
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

function text(node: ReactNode): string {
  const out: string[] = [];
  const visit = (n: ReactNode): void => {
    if (typeof n === 'string' || typeof n === 'number') out.push(String(n));
    else if (Array.isArray(n)) n.forEach(visit);
    else if (isValidElement<Record<string, unknown>>(n)) visit(n.props.children as ReactNode);
  };
  visit(node);
  return out.join(' | ');
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
    expect(text(tree)).toContain('Open League');
    expect(text(tree)).toContain('Other League');
  });

  it('resource admin: only their own leagues, archived ones excluded', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    const tree = await AdminLeaguesPage();
    expect(mocks.getAdminSeasonIds).toHaveBeenCalledWith('p1');
    expect(mocks.listSeasonsByIds).toHaveBeenCalledWith(['s2'], { archived: false });
    expect(mocks.listSeasons).not.toHaveBeenCalled();
    expect(text(tree)).toContain('Other League');
    expect(text(tree)).not.toContain('Open League');
  });

  it('links the league trash for the superadmin only', async () => {
    const trashLinks = async (live: ReturnType<typeof access>) => {
      mocks.getLiveAccess.mockResolvedValue(live);
      return findByType(await AdminLeaguesPage(), Link).filter((link) => link.props.href === '/admin/leagues/trash');
    };
    expect(await trashLinks(access({ isSiteAdmin: true, isAnyAdmin: true }))).toHaveLength(0);
    expect(await trashLinks(access({ isAnyAdmin: true }))).toHaveLength(0);
    const [link] = await trashLinks(access({ isSiteAdmin: true, isAnyAdmin: true, isSuperadmin: true }));
    expect(text(link)).toBe('League trash');
  });

  it('a resource admin with no assignments sees the empty state', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    mocks.getAdminSeasonIds.mockResolvedValue([]);
    mocks.listSeasonsByIds.mockResolvedValue([]);
    expect(text(await AdminLeaguesPage())).toContain('No leagues yet');
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
    expect(text(tree)).toContain('Old League');
  });

  it('resource admin: only their own archived leagues, not every archived league', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    mocks.listSeasonsByIds.mockResolvedValue([league('s2', 'My Archived', true)]);
    const tree = await ArchivedLeaguesPage();
    expect(mocks.getAdminSeasonIds).toHaveBeenCalledWith('p1');
    expect(mocks.listSeasonsByIds).toHaveBeenCalledWith(['s2'], { archived: true });
    expect(mocks.listArchivedSeasons).not.toHaveBeenCalled();
    expect(text(tree)).toContain('My Archived');
    expect(text(tree)).not.toContain('Old League');
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

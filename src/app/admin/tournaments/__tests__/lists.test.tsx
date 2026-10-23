/**
 * Admin tournament lists. The viewer is read live (never the session copy).
 * A site admin sees every standalone tournament; a resource admin only their
 * own standalone ones, active and archived kept apart.
 */
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getLiveAccess: vi.fn(),
  listTournaments: vi.fn(),
  listArchivedTournaments: vi.fn(),
  listTournamentsByIds: vi.fn(),
  getAdminTournamentIds: vi.fn(),
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
vi.mock('@/lib/supabase/queries/tournaments', () => ({
  listTournaments: mocks.listTournaments,
  listArchivedTournaments: mocks.listArchivedTournaments,
  listTournamentsByIds: mocks.listTournamentsByIds,
}));
vi.mock('@/lib/supabase/queries/resource-admins', () => ({
  getAdminTournamentIds: mocks.getAdminTournamentIds,
}));
vi.mock('@/components/shared/AdminGuard', () => stub('AdminGuard'));
vi.mock('@/components/ui/PageContainer', () => stub('PageContainer'));
vi.mock('@/components/ui/Card', () => stub('Card'));
vi.mock('@/components/ui/Badge', () => stub('Badge'));

import AdminTournamentsPage from '../page';
import ArchivedTournamentsPage from '../archived/page';
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

function tournament(id: string, name: string) {
  return {
    id,
    name,
    bracket_type: 'swiss',
    best_of_default: 3,
    is_doubles: false,
    ruleset_name: 'Reg H',
    participant_count: 8,
    status: 'active',
  };
}

function access(flags: { isSiteAdmin?: boolean; isAnyAdmin?: boolean }) {
  return {
    player: { playerId: 'p1' },
    isSiteAdmin: false,
    isAnyAdmin: false,
    isCreator: false,
    ...flags,
  };
}

const allReads = () => [
  mocks.listTournaments,
  mocks.listArchivedTournaments,
  mocks.listTournamentsByIds,
  mocks.getAdminTournamentIds,
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listTournaments.mockResolvedValue([tournament('t1', 'Open Cup'), tournament('t2', 'Mine Cup')]);
  mocks.listArchivedTournaments.mockResolvedValue([tournament('t9', 'Old Cup')]);
  mocks.getAdminTournamentIds.mockResolvedValue(['t2']);
  mocks.listTournamentsByIds.mockResolvedValue([tournament('t2', 'Mine Cup')]);
});

describe('admin tournaments list', () => {
  it('site admin: every active standalone tournament, nothing scoped', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: true, isAnyAdmin: true }));
    const tree = await AdminTournamentsPage();
    expect(mocks.listTournaments).toHaveBeenCalledTimes(1);
    expect(mocks.listTournamentsByIds).not.toHaveBeenCalled();
    expect(text(tree)).toContain('Open Cup');
    expect(text(tree)).toContain('Mine Cup');
  });

  it('resource admin: only their own standalone tournaments, archived excluded', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    const tree = await AdminTournamentsPage();
    expect(mocks.getAdminTournamentIds).toHaveBeenCalledWith('p1');
    expect(mocks.listTournamentsByIds).toHaveBeenCalledWith(['t2'], { archived: false, standaloneOnly: true });
    expect(mocks.listTournaments).not.toHaveBeenCalled();
    expect(text(tree)).toContain('Mine Cup');
    expect(text(tree)).not.toContain('Open Cup');
  });

  it.each([
    ['signed out', null],
    ['not an admin', access({})],
    ['an admin flag without a player', { ...access({ isAnyAdmin: true }), player: null }],
  ])('%s: AdminGuard alone decides and nothing is read', async (_who, live) => {
    mocks.getLiveAccess.mockResolvedValue(live);
    const tree = await AdminTournamentsPage();
    expect(findByType(tree, AdminGuard)).toHaveLength(1);
    expect(findByType(tree, PageContainer)).toHaveLength(0);
    for (const read of allReads()) expect(read).not.toHaveBeenCalled();
  });
});

describe('admin archived tournaments list', () => {
  it('site admin: every archived standalone tournament', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: true, isAnyAdmin: true }));
    const tree = await ArchivedTournamentsPage();
    expect(mocks.listArchivedTournaments).toHaveBeenCalledTimes(1);
    expect(mocks.listTournamentsByIds).not.toHaveBeenCalled();
    expect(text(tree)).toContain('Old Cup');
  });

  it('resource admin: only their own archived tournaments, not every archived one', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    mocks.listTournamentsByIds.mockResolvedValue([tournament('t2', 'My Archived Cup')]);
    const tree = await ArchivedTournamentsPage();
    expect(mocks.getAdminTournamentIds).toHaveBeenCalledWith('p1');
    expect(mocks.listTournamentsByIds).toHaveBeenCalledWith(['t2'], { archived: true, standaloneOnly: true });
    expect(mocks.listArchivedTournaments).not.toHaveBeenCalled();
    expect(text(tree)).toContain('My Archived Cup');
    expect(text(tree)).not.toContain('Old Cup');
  });

  it.each([
    ['signed out', null],
    ['not an admin', access({})],
  ])('%s: AdminGuard alone decides and nothing is read', async (_who, live) => {
    mocks.getLiveAccess.mockResolvedValue(live);
    const tree = await ArchivedTournamentsPage();
    expect(findByType(tree, AdminGuard)).toHaveLength(1);
    expect(findByType(tree, PageContainer)).toHaveLength(0);
    for (const read of allReads()) expect(read).not.toHaveBeenCalled();
  });
});

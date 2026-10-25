/**
 * The league create page. The viewer is read live and nothing is read before
 * they are known to be an admin. The clone sources are scoped: a site admin
 * may start from any league, a resource admin only from their own (never an
 * unscoped list), and only lean option rows reach the client component.
 */
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getLiveAccess: vi.fn(),
  getAdminSeasonIds: vi.fn(),
  listRulesets: vi.fn(),
  listCloneSourceOptions: vi.fn(),
}));

function stub(name: string) {
  const C = function Stub({ children }: { children?: ReactNode }) {
    return children ?? null;
  };
  Object.defineProperty(C, 'name', { value: name });
  return { default: C };
}

vi.mock('server-only', () => ({}));
vi.mock('@/i18n/server', async () => {
  const { createTranslator } = await import('@/i18n/core');
  return {
    getLocale: async () => 'en',
    getT: async (ns: Parameters<typeof createTranslator>[0]) => createTranslator(ns, 'en'),
  };
});
vi.mock('@/lib/auth/helpers', () => ({ getLiveAccess: mocks.getLiveAccess }));
vi.mock('@/lib/supabase/queries/rulesets', () => ({ listRulesets: mocks.listRulesets }));
vi.mock('@/lib/supabase/queries/resource-admins', () => ({ getAdminSeasonIds: mocks.getAdminSeasonIds }));
vi.mock('@/lib/supabase/queries/season-clone', () => ({ listCloneSourceOptions: mocks.listCloneSourceOptions }));
vi.mock('@/components/shared/AdminGuard', () => stub('AdminGuard'));
vi.mock('@/components/ui/PageContainer', () => stub('PageContainer'));
vi.mock('@/components/league/LeagueCreator', () => stub('LeagueCreator'));

import NewLeaguePage from '../page';
import AdminGuard from '@/components/shared/AdminGuard';
import LeagueCreator from '@/components/league/LeagueCreator';

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
    }
  };
  visit(node);
  return found;
}

function access(flags: { isSiteAdmin?: boolean; isAnyAdmin?: boolean }, player: object | null = { playerId: 'p1' }) {
  return { player, isSiteAdmin: false, isAnyAdmin: false, isCreator: false, ...flags };
}

const option = {
  id: 's2',
  name: 'Other League',
  format_type: 'singles',
  status: 'completed',
  archived: true,
  is_test_season: false,
  ruleset_id: null,
  route_theme: 'auto',
  language: 'de',
  description: '',
  phase_count: 2,
  participant_count: 9,
};

const allReads = () => [mocks.getAdminSeasonIds, mocks.listRulesets, mocks.listCloneSourceOptions];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listRulesets.mockResolvedValue([]);
  mocks.listCloneSourceOptions.mockResolvedValue([option]);
  mocks.getAdminSeasonIds.mockResolvedValue(['s2']);
});

describe('new league page', () => {
  it('site admin: every league may be a source (no scope), and may copy the admins', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: true, isAnyAdmin: true }));

    const tree = await NewLeaguePage();

    expect(mocks.listCloneSourceOptions).toHaveBeenCalledTimes(1);
    expect(mocks.listCloneSourceOptions).toHaveBeenCalledWith(null);
    expect(mocks.getAdminSeasonIds).not.toHaveBeenCalled();
    const [creator] = findByType(tree, LeagueCreator);
    expect(creator.props.isSiteAdmin).toBe(true);
    expect(creator.props.sources).toEqual([option]);
  });

  it('resource admin: only the leagues they administer, never an unscoped list', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    mocks.getAdminSeasonIds.mockResolvedValue(['s2', 's7']);

    const tree = await NewLeaguePage();

    expect(mocks.getAdminSeasonIds).toHaveBeenCalledWith('p1');
    expect(mocks.listCloneSourceOptions).toHaveBeenCalledWith(['s2', 's7']);
    expect(mocks.listCloneSourceOptions).not.toHaveBeenCalledWith(null);
    expect(findByType(tree, LeagueCreator)[0].props.isSiteAdmin).toBe(false);
  });

  it('a resource admin without leagues is scoped to the empty list, not to everything', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    mocks.getAdminSeasonIds.mockResolvedValue([]);
    mocks.listCloneSourceOptions.mockResolvedValue([]);

    const tree = await NewLeaguePage();

    expect(mocks.listCloneSourceOptions).toHaveBeenCalledWith([]);
    expect(findByType(tree, LeagueCreator)[0].props.sources).toEqual([]);
  });

  it.each([
    ['signed out', null],
    ['not an admin', access({})],
    ['an admin identity without a player', access({ isAnyAdmin: true }, null)],
  ])('%s: the guard only, no reads', async (_label, live) => {
    mocks.getLiveAccess.mockResolvedValue(live);

    const tree = await NewLeaguePage();

    expect(isValidElement(tree) && tree.type).toBe(AdminGuard);
    expect(findByType(tree, LeagueCreator)).toEqual([]);
    for (const read of allReads()) expect(read).not.toHaveBeenCalled();
  });

  it('hands the client only lean option rows, no player data', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isSiteAdmin: true, isAnyAdmin: true }));

    const tree = await NewLeaguePage();
    const [creator] = findByType(tree, LeagueCreator);
    const rows = JSON.parse(JSON.stringify(creator.props.sources)) as Record<string, unknown>[];

    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual(Object.keys(option).sort());
    expect(JSON.stringify(rows)).not.toMatch(/players|discord|email|auth_user/);
  });
});

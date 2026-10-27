/**
 * `/admin/tournaments/new`: the live gate comes before any read, and the ruleset select lists what the viewer may use
 * (their own private rulesets next to the shared ones, none that belongs to a league).
 */
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getLiveAccess: vi.fn(),
  listRulesetOptionsFor: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/i18n/server', async () => {
  const { createTranslator } = await import('@/i18n/core');
  return { getT: async (ns: Parameters<typeof createTranslator>[0]) => createTranslator(ns, 'en') };
});
vi.mock('@/lib/auth/helpers', () => ({ getLiveAccess: mocks.getLiveAccess }));
vi.mock('@/lib/supabase/queries/rulesets', () => ({ listRulesetOptionsFor: mocks.listRulesetOptionsFor }));
vi.mock('@/components/shared/AdminGuard', () => ({ default: ({ children }: { children?: ReactNode }) => children ?? null }));
vi.mock('@/components/ui/PageContainer', () => ({ default: ({ children }: { children?: ReactNode }) => children ?? null }));
vi.mock('../TournamentCreator', () => ({ default: () => null }));

import NewTournamentPage from '../page';
import AdminGuard from '@/components/shared/AdminGuard';
import TournamentCreator from '../TournamentCreator';

type El = ReactElement<Record<string, unknown>>;

function findByType(node: ReactNode, type: unknown): El[] {
  const found: El[] = [];
  const visit = (n: ReactNode): void => {
    if (Array.isArray(n)) return n.forEach(visit);
    if (isValidElement<Record<string, unknown>>(n)) {
      if (n.type === type) found.push(n);
      visit(n.props.children as ReactNode);
    }
  };
  visit(node);
  return found;
}

const access = (flags: { isSiteAdmin?: boolean; isAnyAdmin?: boolean }, player: object | null = { playerId: 'p1' }) => ({
  player,
  isSiteAdmin: false,
  isAnyAdmin: false,
  isCreator: false,
  ...flags,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listRulesetOptionsFor.mockResolvedValue([]);
});

describe('new tournament page', () => {
  it('hands the creator the rulesets of the viewer, scoped to no league', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    mocks.listRulesetOptionsFor.mockResolvedValue([{ id: 'v1' }]);
    const tree = await NewTournamentPage();
    expect(mocks.listRulesetOptionsFor).toHaveBeenCalledWith({ actor: { playerId: 'p1', isAdmin: false }, seasonId: null });
    expect(findByType(tree, TournamentCreator)[0].props.rulesets).toEqual([{ id: 'v1' }]);
  });

  it('the site-admin flag is the live one', async () => {
    mocks.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true, isSiteAdmin: true }));
    await NewTournamentPage();
    expect(mocks.listRulesetOptionsFor).toHaveBeenCalledWith({ actor: { playerId: 'p1', isAdmin: true }, seasonId: null });
  });

  it.each([
    ['signed out', null],
    ['not an admin', access({})],
    ['an admin identity without a player', access({ isAnyAdmin: true }, null)],
  ])('%s: the guard only, nothing read', async (_label, live) => {
    mocks.getLiveAccess.mockResolvedValue(live);
    const tree = await NewTournamentPage();
    expect(isValidElement(tree) && tree.type).toBe(AdminGuard);
    expect(findByType(tree, TournamentCreator)).toHaveLength(0);
    expect(mocks.listRulesetOptionsFor).not.toHaveBeenCalled();
  });
});

/**
 * Standalone tournament rounds page: the live per-resource gate runs before
 * any tournament read, in both branches (standalone page and the redirect of
 * a league stage to its phase page).
 */
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ID = '0b9f1c2e-5d4a-4c3b-9a8e-7f6d5c4b3a21';
const SEASON_ID = '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';

const mocks = vi.hoisted(() => ({
  gateResourceAdmin: vi.fn(),
  getTournamentById: vi.fn(),
}));

function stub(name: string) {
  const C = function Stub({ children }: { children?: ReactNode }) {
    return children ?? null;
  };
  Object.defineProperty(C, 'name', { value: name });
  return { default: C };
}

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock('@/lib/auth/resource-gate', () => ({ gateResourceAdmin: mocks.gateResourceAdmin }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentById: mocks.getTournamentById }));
vi.mock('@/components/shared/AdminGuard', () => stub('AdminGuard'));
vi.mock('@/components/shared/ResourceForbidden', () => stub('ResourceForbidden'));
vi.mock('../LegacyRoundsPage', () => stub('LegacyRoundsPage'));

import TournamentRoundsPage from '../page';
import AdminGuard from '@/components/shared/AdminGuard';
import ResourceForbidden from '@/components/shared/ResourceForbidden';
import LegacyRoundsPage from '../LegacyRoundsPage';

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

const render = (id = ID) => TournamentRoundsPage({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.gateResourceAdmin.mockResolvedValue({ kind: 'ok', playerId: 'admin-1', isSiteAdmin: true });
  mocks.getTournamentById.mockResolvedValue({ id: ID, season_id: null, name: 'Cup' });
});

describe('admin tournament rounds page gate', () => {
  it('checks the tournament gate with the route id before the read', async () => {
    await render();
    expect(mocks.gateResourceAdmin).toHaveBeenCalledWith('tournament', ID);
  });

  it('forbidden: the forbidden panel inside the guard, no tournament read, no redirect', async () => {
    mocks.gateResourceAdmin.mockResolvedValue({ kind: 'forbidden' });
    const tree = await render();
    expect(findByType(tree, AdminGuard)).toHaveLength(1);
    expect(findByType(tree, ResourceForbidden)).toHaveLength(1);
    expect(mocks.getTournamentById).not.toHaveBeenCalled();
  });

  it('forbidden on a league stage does not redirect or read the stage', async () => {
    mocks.gateResourceAdmin.mockResolvedValue({ kind: 'forbidden' });
    mocks.getTournamentById.mockResolvedValue({ id: ID, season_id: SEASON_ID, name: 'Stage' });
    await expect(render()).resolves.toBeDefined();
    expect(mocks.getTournamentById).not.toHaveBeenCalled();
  });

  it('guard: AdminGuard alone decides, no read', async () => {
    mocks.gateResourceAdmin.mockResolvedValue({ kind: 'guard' });
    const tree = await render();
    expect(findByType(tree, AdminGuard)).toHaveLength(1);
    expect(findByType(tree, ResourceForbidden)).toHaveLength(0);
    expect(mocks.getTournamentById).not.toHaveBeenCalled();
  });

  it('a non-uuid id is a 404 from the gate', async () => {
    mocks.gateResourceAdmin.mockRejectedValue(new Error('NEXT_NOT_FOUND'));
    await expect(render('nope')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.getTournamentById).not.toHaveBeenCalled();
  });

  it('a league stage redirects to its phase page for an admin the gate passed (season admin cascade)', async () => {
    mocks.gateResourceAdmin.mockResolvedValue({ kind: 'ok', playerId: 'p9', isSiteAdmin: false });
    mocks.getTournamentById.mockResolvedValue({ id: ID, season_id: SEASON_ID, name: 'Stage' });
    await expect(render()).rejects.toThrow(`REDIRECT:/admin/leagues/${SEASON_ID}/phases/${ID}`);
  });

  it('a standalone tournament renders the legacy page with the live site-admin flag', async () => {
    const [site] = findByType(await render(), LegacyRoundsPage);
    expect(site.props).toEqual({ id: ID, playerId: 'admin-1', isSiteAdmin: true });

    mocks.gateResourceAdmin.mockResolvedValue({ kind: 'ok', playerId: 'p9', isSiteAdmin: false });
    const [scoped] = findByType(await render(), LegacyRoundsPage);
    expect(scoped.props).toEqual({ id: ID, playerId: 'p9', isSiteAdmin: false });
  });

  it('a missing tournament is a 404 for an admin the gate passed', async () => {
    mocks.getTournamentById.mockResolvedValue(null);
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

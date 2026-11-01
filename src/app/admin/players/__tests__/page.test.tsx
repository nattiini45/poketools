import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/helpers', () => ({ isSuperadminNow: vi.fn() }));
vi.mock('@/lib/auth/superadmin', () => ({ resolveSuperadminPlayerId: vi.fn() }));
vi.mock('@/i18n/server', () => ({ getT: vi.fn(async () => (key: string) => key) }));
vi.mock('@/components/shared/SiteAdminGuard', () => ({ default: () => null }));

import AdminPlayersPage from '../page';
import PlayerRoster from '../PlayerRoster';
import { isSuperadminNow } from '@/lib/auth/helpers';
import { resolveSuperadminPlayerId } from '@/lib/auth/superadmin';

function findRoster(node: ReactNode): ReactElement<Record<string, unknown>> | null {
  if (!isValidElement(node)) return null;
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (element.type === PlayerRoster) return element as ReactElement<Record<string, unknown>>;
  const children = Array.isArray(element.props.children) ? element.props.children : [element.props.children];
  for (const child of children) {
    const found = findRoster(child);
    if (found) return found;
  }
  return null;
}

describe('admin players page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('protects the superadmin row for a viewer who is not the superadmin now', async () => {
    vi.mocked(isSuperadminNow).mockResolvedValue(false);
    vi.mocked(resolveSuperadminPlayerId).mockResolvedValue('row-1');

    const roster = findRoster(await AdminPlayersPage());

    expect(roster?.props).toMatchObject({ canManageCreators: false, protectedPlayerId: 'row-1' });
  });

  it('protects nothing and offers creator management to the live superadmin', async () => {
    vi.mocked(isSuperadminNow).mockResolvedValue(true);

    const roster = findRoster(await AdminPlayersPage());

    expect(roster?.props).toMatchObject({ canManageCreators: true, protectedPlayerId: null });
    expect(resolveSuperadminPlayerId).not.toHaveBeenCalled();
  });

  it('errors instead of offering an action when the live read fails', async () => {
    vi.mocked(isSuperadminNow).mockResolvedValue(false);
    vi.mocked(resolveSuperadminPlayerId).mockRejectedValue(new Error('db down'));

    await expect(AdminPlayersPage()).rejects.toThrow('db down');
  });
});

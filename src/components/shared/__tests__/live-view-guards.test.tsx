/**
 * D37 live view gates: AdminGuard, CreatorGuard and the admin layout decide
 * from getLiveAccess() (the live player row), never from the up-to-5-minute
 * session copy. A session that still says "admin" must not open admin pages
 * once the live row says otherwise.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { LiveAccess } from '@/lib/auth/helpers';

const auth = vi.hoisted(() => ({
  getLiveAccess: vi.fn<() => Promise<LiveAccess | null>>(),
  getSession: vi.fn(),
  isSuperadmin: vi.fn(() => false),
  // Token-copy checks: wired to say "yes" so a guard that still used them
  // would wrongly let the revoked player through.
  isAdmin: vi.fn(() => true),
  isAnyAdmin: vi.fn(() => true),
  isCreator: vi.fn(() => true),
}));
const redirect = vi.hoisted(() =>
  vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
);

// The denial copy is translated server-side (getT reads the plc_locale cookie).
const cookieJar = vi.hoisted(() => ({ locale: undefined as string | undefined }));

vi.mock('@/lib/auth/helpers', () => auth);
vi.mock('next/navigation', () => ({ redirect }));
vi.mock('next/headers', () => ({
  headers: async () => ({ get: (name: string) => (name === 'x-poketools-path' ? '/admin/formats?tab=x' : null) }),
  cookies: async () => ({
    get: (name: string) =>
      name === 'plc_locale' && cookieJar.locale !== undefined ? { name, value: cookieJar.locale } : undefined,
  }),
}));
vi.mock('@/components/shared/NavBar', () => ({ default: () => null }));
vi.mock('@/components/shared/PageTransitionWrapper', () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/admin/AdminShell', () => ({ default: ({ children }: { children: ReactNode }) => children }));

import AdminGuard from '../AdminGuard';
import CreatorGuard from '../CreatorGuard';
import AuthGuard from '../AuthGuard';
import AdminLayout from '@/app/admin/layout';

const ADMIN_SESSION = { player: { id: 'p1', isAdmin: true, isCreator: true } };

function access(flags: Partial<Omit<LiveAccess, 'player'>>): LiveAccess {
  return { player: null, isSiteAdmin: false, isAnyAdmin: false, isCreator: false, isSuperadmin: false, ...flags };
}

/** Depth-first search for the element whose props carry `roles`. */
type AdminRolesProp = { isSiteAdmin: boolean; isSuperadmin: boolean; assistantEnabled?: boolean };

function findRoles(node: ReactNode): AdminRolesProp | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findRoles(child);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const props = node.props as { roles?: AdminRolesProp; children?: ReactNode };
  if (props.roles) return props.roles;
  return findRoles(props.children);
}

beforeEach(() => {
  vi.clearAllMocks();
  cookieJar.locale = undefined;
  auth.getSession.mockResolvedValue(ADMIN_SESSION);
});

describe('AdminGuard', () => {
  it('denies a player whose live row lost admin, whatever the session copy says', async () => {
    auth.getLiveAccess.mockResolvedValue(access({}));
    const html = renderToStaticMarkup(await AdminGuard({ children: 'SECRET' }));
    expect(html).toContain('Access Denied');
    expect(html).not.toContain('SECRET');
    expect(auth.isAnyAdmin).not.toHaveBeenCalled();
  });

  it('denies in German when the viewer reads German', async () => {
    cookieJar.locale = 'de';
    auth.getLiveAccess.mockResolvedValue(access({}));
    const html = renderToStaticMarkup(await AdminGuard({ children: 'SECRET' }));
    expect(html).toContain('Kein Zugriff');
    expect(html).toContain('Für diese Seite brauchst du Admin-Rechte.');
    expect(html).not.toContain('Access Denied');
    expect(html).not.toContain('SECRET');
  });

  it('renders for a live admin', async () => {
    auth.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true }));
    expect(renderToStaticMarkup(await AdminGuard({ children: 'SECRET' }))).toBe('SECRET');
  });

  it('sends a signed-out visitor to sign-in', async () => {
    auth.getLiveAccess.mockResolvedValue(null);
    await expect(AdminGuard({ children: 'SECRET' })).rejects.toThrow(
      'redirect:/auth/signin?callbackUrl=%2Fadmin%2Fformats%3Ftab%3Dx',
    );
  });

  it('fails closed when the live read fails', async () => {
    auth.getLiveAccess.mockRejectedValue(new Error('db down'));
    await expect(AdminGuard({ children: 'SECRET' })).rejects.toThrow('db down');
  });
});

describe('CreatorGuard', () => {
  it('denies a player whose live row lost creator, whatever the session copy says', async () => {
    auth.getLiveAccess.mockResolvedValue(access({}));
    const html = renderToStaticMarkup(await CreatorGuard({ children: 'SECRET' }));
    expect(html).toContain('Access Denied');
    expect(html).not.toContain('SECRET');
    expect(auth.isCreator).not.toHaveBeenCalled();
  });

  it('denies in German when the viewer reads German', async () => {
    cookieJar.locale = 'de';
    auth.getLiveAccess.mockResolvedValue(access({}));
    const html = renderToStaticMarkup(await CreatorGuard({ children: 'SECRET' }));
    expect(html).toContain('Kein Zugriff');
    expect(html).toContain('Creator-Rechte');
    expect(html).not.toContain('SECRET');
  });

  it('sends a signed-out visitor to sign-in with the page they wanted', async () => {
    auth.getLiveAccess.mockResolvedValue(null);
    await expect(CreatorGuard({ children: 'SECRET' })).rejects.toThrow(
      'redirect:/auth/signin?callbackUrl=%2Fadmin%2Fformats%3Ftab%3Dx',
    );
  });

  it('renders for a live creator (site admins included via isCreator)', async () => {
    auth.getLiveAccess.mockResolvedValue(access({ isCreator: true }));
    expect(renderToStaticMarkup(await CreatorGuard({ children: 'SECRET' }))).toBe('SECRET');
  });
});

describe('admin layout', () => {
  it('passes the live site-admin flag to the admin shell, not the session copy', async () => {
    auth.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true, isSiteAdmin: false }));
    const tree = await AdminLayout({ children: null });
    expect(findRoles(tree)).toMatchObject({ isSiteAdmin: false, isSuperadmin: false });
    expect(auth.isAdmin).not.toHaveBeenCalled();
  });

  it('passes the live superadmin flag, whatever the session copy says', async () => {
    // The session says superadmin; the live row (a revoked admin) says no.
    auth.isSuperadmin.mockReturnValue(true);
    auth.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true, isSiteAdmin: false, isSuperadmin: false }));
    expect(findRoles(await AdminLayout({ children: null }))).toMatchObject({ isSiteAdmin: false, isSuperadmin: false });
    expect(auth.isSuperadmin).not.toHaveBeenCalled();

    auth.getLiveAccess.mockResolvedValue(access({ isAnyAdmin: true, isSiteAdmin: true, isSuperadmin: true }));
    expect(findRoles(await AdminLayout({ children: null }))).toMatchObject({ isSiteAdmin: true, isSuperadmin: true });
  });
});

describe('AuthGuard', () => {
  it('sends a signed-out visitor to sign-in with the page they wanted', async () => {
    auth.getLiveAccess.mockResolvedValue(null);
    await expect(AuthGuard({ children: 'SECRET' })).rejects.toThrow(
      'redirect:/auth/signin?callbackUrl=%2Fadmin%2Fformats%3Ftab%3Dx',
    );
  });

  it('sends a revoked session to sign-in even though the token copy still says signed in', async () => {
    auth.getSession.mockResolvedValue(ADMIN_SESSION);
    auth.getLiveAccess.mockResolvedValue(null);
    await expect(AuthGuard({ children: 'SECRET' })).rejects.toThrow('redirect:/auth/signin?callbackUrl=');
  });

  it('renders for a signed-in visitor, with or without a linked player', async () => {
    auth.getLiveAccess.mockResolvedValue(access({}));
    expect(renderToStaticMarkup(await AuthGuard({ children: 'SECRET' }))).toBe('SECRET');
  });
});

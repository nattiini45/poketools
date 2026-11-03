import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ getSession: vi.fn(), getLiveAccess: vi.fn() }));
const redirect = vi.hoisted(() =>
  vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
);
const headerJar = vi.hoisted(() => ({ path: null as string | null }));

vi.mock('@/lib/auth/helpers', () => auth);
vi.mock('next/navigation', () => ({ redirect }));
vi.mock('next/headers', () => ({
  headers: async () => ({ get: (name: string) => (name === 'x-poketools-path' ? headerJar.path : null) }),
}));
vi.mock('@/components/shared/NavBar', () => ({ default: () => null }));
vi.mock('@/components/shared/PageTransitionWrapper', () => ({ default: () => null }));
vi.mock('@/lib/pack-extensions', () => ({ siteNavExtraLinks: async () => [] }));

import PlayerLayout from '../layout';

beforeEach(() => {
  vi.clearAllMocks();
  headerJar.path = null;
});

describe('(player) layout (#56)', () => {
  it('sends a signed-out visitor straight to the sign-in page with the page they wanted', async () => {
    auth.getLiveAccess.mockResolvedValue(null);
    headerJar.path = '/dashboard/confirm/m1?tab=y';
    await expect(PlayerLayout({ children: null })).rejects.toThrow(
      `redirect:/auth/signin?callbackUrl=${encodeURIComponent('/dashboard/confirm/m1?tab=y')}`,
    );
  });

  it('never goes through the Auth.js built-in endpoint', async () => {
    auth.getLiveAccess.mockResolvedValue(null);
    await expect(PlayerLayout({ children: null })).rejects.toThrow('redirect:/auth/signin');
    expect(redirect).not.toHaveBeenCalledWith(expect.stringContaining('/api/auth/signin'));
  });
});

describe('(player) layout gates the view on the live session (VAL-CROSS-002)', () => {
  it('redirects with the return path when the token session is present but the live read finds the session revoked', async () => {
    auth.getSession.mockResolvedValue({ player: { playerId: 'p1' } });
    auth.getLiveAccess.mockResolvedValue(null);
    headerJar.path = '/dashboard/settings?tab=security';
    await expect(PlayerLayout({ children: null })).rejects.toThrow(
      `redirect:/auth/signin?callbackUrl=${encodeURIComponent('/dashboard/settings?tab=security')}`,
    );
  });

  it('renders for a live player and never reads the token copy', async () => {
    auth.getLiveAccess.mockResolvedValue({ player: { playerId: 'p1' } });
    await expect(PlayerLayout({ children: null })).resolves.toBeTruthy();
    expect(auth.getSession).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('lets a signed-in identity with no linked player through, so the not-registered screens stay reachable', async () => {
    auth.getLiveAccess.mockResolvedValue({ player: null, isSiteAdmin: false });
    await expect(PlayerLayout({ children: null })).resolves.toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('fails closed when the live read fails', async () => {
    auth.getLiveAccess.mockRejectedValue(new Error('db down'));
    await expect(PlayerLayout({ children: null })).rejects.toThrow('db down');
  });
});

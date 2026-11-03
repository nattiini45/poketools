import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
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
    auth.getSession.mockResolvedValue(null);
    headerJar.path = '/dashboard/confirm/m1?tab=y';
    await expect(PlayerLayout({ children: null })).rejects.toThrow(
      `redirect:/auth/signin?callbackUrl=${encodeURIComponent('/dashboard/confirm/m1?tab=y')}`,
    );
  });

  it('never goes through the Auth.js built-in endpoint', async () => {
    auth.getSession.mockResolvedValue(null);
    await expect(PlayerLayout({ children: null })).rejects.toThrow('redirect:/auth/signin');
    expect(redirect).not.toHaveBeenCalledWith(expect.stringContaining('/api/auth/signin'));
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const headerJar = vi.hoisted(() => ({ value: null as string | null }));
const redirect = vi.hoisted(() =>
  vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
);

vi.mock('next/headers', () => ({
  headers: async () => ({ get: (name: string) => (name === 'x-poketools-path' ? headerJar.value : null) }),
}));
vi.mock('next/navigation', () => ({ redirect }));
const live = vi.hoisted(() => ({ getLiveSessionPlayer: vi.fn(), getLiveAccess: vi.fn() }));
vi.mock('@/lib/auth/helpers', () => live);

import { currentSignInPath, redirectToSignIn, requireLiveIdentityOrSignIn, requireLivePlayerOrSignIn } from '../redirect-to-sign-in';

beforeEach(() => {
  headerJar.value = null;
  redirect.mockClear();
  live.getLiveSessionPlayer.mockReset();
  live.getLiveAccess.mockReset();
});

describe('requireLivePlayerOrSignIn (VAL-CROSS-002)', () => {
  it('returns the live player', async () => {
    const player = { playerId: 'p1', name: 'Ash' };
    live.getLiveSessionPlayer.mockResolvedValue(player);
    await expect(requireLivePlayerOrSignIn()).resolves.toBe(player);
    expect(redirect).not.toHaveBeenCalled();
  });

  it('sends a visitor with no live player to sign-in with the return path, whatever the token copy says', async () => {
    live.getLiveSessionPlayer.mockResolvedValue(null);
    headerJar.value = '/dashboard/settings?tab=security';
    await expect(requireLivePlayerOrSignIn()).rejects.toThrow(
      `redirect:/auth/signin?callbackUrl=${encodeURIComponent('/dashboard/settings?tab=security')}`,
    );
  });

  it('fails closed when the live read fails', async () => {
    live.getLiveSessionPlayer.mockRejectedValue(new Error('db down'));
    await expect(requireLivePlayerOrSignIn()).rejects.toThrow('db down');
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe('requireLiveIdentityOrSignIn', () => {
  it('lets an authenticated identity with no linked player through', async () => {
    const access = { player: null, isSiteAdmin: false };
    live.getLiveAccess.mockResolvedValue(access);
    await expect(requireLiveIdentityOrSignIn()).resolves.toBe(access);
    expect(redirect).not.toHaveBeenCalled();
  });

  it('sends a signed-out or revoked session to sign-in with the return path', async () => {
    live.getLiveAccess.mockResolvedValue(null);
    headerJar.value = '/dashboard/broadcast';
    await expect(requireLiveIdentityOrSignIn()).rejects.toThrow(
      `redirect:/auth/signin?callbackUrl=${encodeURIComponent('/dashboard/broadcast')}`,
    );
  });

  it('fails closed when the live read fails', async () => {
    live.getLiveAccess.mockRejectedValue(new Error('db down'));
    await expect(requireLiveIdentityOrSignIn()).rejects.toThrow('db down');
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe('redirectToSignIn (#56)', () => {
  it('returns to the path the proxy recorded, query included', async () => {
    headerJar.value = '/dashboard/settings?tab=security';
    await expect(redirectToSignIn()).rejects.toThrow(
      `redirect:/auth/signin?callbackUrl=${encodeURIComponent('/dashboard/settings?tab=security')}`,
    );
  });

  it('prefers a path the page passes itself', async () => {
    headerJar.value = '/dashboard';
    await expect(redirectToSignIn('/dashboard/confirm/m1')).rejects.toThrow(
      `redirect:/auth/signin?callbackUrl=${encodeURIComponent('/dashboard/confirm/m1')}`,
    );
  });

  it('goes to the bare sign-in page, never the home page, when no path is known', async () => {
    await expect(redirectToSignIn()).rejects.toThrow('redirect:/auth/signin');
    expect(redirect).not.toHaveBeenCalledWith('/');
  });

  it('ignores a recorded value that is not a same-origin path', async () => {
    headerJar.value = 'https://evil.example/';
    await expect(redirectToSignIn()).rejects.toThrow('redirect:/auth/signin');
    expect(await currentSignInPath()).toBe('/auth/signin');
  });
});

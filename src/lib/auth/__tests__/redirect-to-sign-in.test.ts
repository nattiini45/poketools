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

import { currentSignInPath, redirectToSignIn } from '../redirect-to-sign-in';

beforeEach(() => {
  headerJar.value = null;
  redirect.mockClear();
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

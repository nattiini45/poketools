/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { withI18n } from '@/test/i18n';

const order: string[] = [];
const signOutMock = vi.hoisted(() => vi.fn());
const clearMock = vi.hoisted(() => vi.fn());

const sessionState = vi.hoisted(() => ({ signedIn: true }));
const navState = vi.hoisted(() => ({ pathname: '/' as string | null, search: '' }));

vi.mock('next-auth/react', () => ({
  signOut: signOutMock,
  useSession: () =>
    sessionState.signedIn
      ? { data: { user: { name: 'Ash' } }, status: 'authenticated' }
      : { data: null, status: 'unauthenticated' },
}));
vi.mock('next/navigation', () => ({
  usePathname: () => navState.pathname,
  useSearchParams: () => new URLSearchParams(navState.search),
}));
vi.mock('@/lib/pwa/caches', () => ({ clearPwaCaches: clearMock }));

import DiscordLoginButton from '../DiscordLoginButton';

beforeEach(() => {
  sessionState.signedIn = true;
  navState.pathname = '/';
  navState.search = '';
  order.length = 0;
  clearMock.mockReset().mockImplementation(async () => {
    await Promise.resolve();
    order.push('clear');
  });
  signOutMock.mockReset().mockImplementation(async () => {
    order.push('signOut');
  });
});
afterEach(() => vi.clearAllMocks());

describe('DiscordLoginButton sign-out', () => {
  it('clears the service worker caches before it signs out', async () => {
    render(withI18n(<DiscordLoginButton />));
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Sign Out' }));
    await vi.waitFor(() => expect(order).toEqual(['clear', 'signOut']), { timeout: 5000 });
  });
});

describe('DiscordLoginButton sign-in link (#56)', () => {
  const signInLink = async () => (await screen.findByRole('link', { name: 'Sign In' })).getAttribute('href');

  beforeEach(() => {
    sessionState.signedIn = false;
  });

  it('carries the current page and its query', async () => {
    navState.pathname = '/leagues/abc';
    navState.search = 'tab=standings';
    render(withI18n(<DiscordLoginButton />));
    expect(await signInLink()).toBe('/auth/signin?callbackUrl=%2Fleagues%2Fabc%3Ftab%3Dstandings');
  });

  it('carries a page without a query', async () => {
    navState.pathname = '/wiki/moves';
    render(withI18n(<DiscordLoginButton />));
    expect(await signInLink()).toBe('/auth/signin?callbackUrl=%2Fwiki%2Fmoves');
  });

  it('adds no callbackUrl on the sign-in and other auth pages', async () => {
    for (const pathname of ['/auth/signin', '/auth/signup']) {
      navState.pathname = pathname;
      navState.search = 'callbackUrl=%2Fx';
      const { unmount } = render(withI18n(<DiscordLoginButton />));
      expect(await signInLink(), pathname).toBe('/auth/signin');
      unmount();
    }
  });

  it('adds no callbackUrl on the home page', async () => {
    render(withI18n(<DiscordLoginButton />));
    expect(await signInLink()).toBe('/auth/signin');
  });
});
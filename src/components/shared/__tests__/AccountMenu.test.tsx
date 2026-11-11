/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { withI18n } from '@/test/i18n';

const session = vi.hoisted(() => ({
  current: null as null | { user: { image: null }; player: Record<string, unknown> },
}));
const signOut = vi.hoisted(() => vi.fn());
const setTheme = vi.hoisted(() => vi.fn());

vi.mock('next-auth/react', () => ({ useSession: () => ({ data: session.current }) }));
vi.mock('next/navigation', () => ({ usePathname: () => '/leagues', useRouter: () => ({ refresh: () => {} }) }));
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'light', setTheme }) }));
vi.mock('../DiscordLoginButton', () => ({ default: () => null, signOutAndClearCaches: signOut }));
vi.mock('../PwaInstallPrompt', () => ({ default: () => null }));
vi.mock('../SpriteStyleMenuGroup', () => ({ SpriteStyleMenuGroup: () => <div data-testid="sprites" /> }));

import AccountMenu from '../nav/AccountMenu';

const PLAYER = { playerId: 'p1', name: 'Ada', avatarUrl: null, isAdmin: false, isCreator: false, isResourceAdmin: false };

beforeEach(() => {
  signOut.mockReset();
  setTheme.mockReset();
});

async function openMenu(name: string) {
  const user = userEvent.setup();
  render(withI18n(<AccountMenu />));
  await user.click(screen.getByRole('button', { name }));
  return user;
}

describe('AccountMenu', () => {
  it('opens to profile, settings, Appearance, Language and sign out for a player, with no Admin or Creator Hub', async () => {
    session.current = { user: { image: null }, player: PLAYER };
    await openMenu('Account menu');
    expect(screen.getByRole('link', { name: /Ada.*View public profile/s }).getAttribute('href')).toBe('/players/p1');
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('/dashboard/settings');
    expect(screen.getByRole('button', { name: 'Appearance' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('button', { name: 'Language' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('button', { name: 'Sign Out' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Creator Hub' })).toBeNull();
  });

  it('adds Admin for a site admin and for a league admin, and Creator Hub for a creator', async () => {
    session.current = { user: { image: null }, player: { ...PLAYER, isResourceAdmin: true, isCreator: true } };
    await openMenu('Account menu');
    expect(screen.getByRole('link', { name: 'Admin' }).getAttribute('href')).toBe('/admin');
    expect(screen.getByRole('link', { name: 'Creator Hub' }).getAttribute('href')).toBe('/creator');
  });

  it('opens Appearance in place: theme, palette and sprite style, one group at a time', async () => {
    session.current = { user: { image: null }, player: PLAYER };
    const user = await openMenu('Account menu');
    await user.click(screen.getByRole('button', { name: 'Appearance' }));
    expect((screen.getByRole('radio', { name: 'Sunlit' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('group', { name: 'Color scheme' })).toBeTruthy();
    expect(screen.getByTestId('sprites')).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: 'Moonlit' }));
    expect(setTheme).toHaveBeenCalledWith('dark');

    await user.click(screen.getByRole('button', { name: 'Language' }));
    expect(screen.getByRole('button', { name: 'Appearance' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('radio', { name: 'Deutsch' })).toBeTruthy();
  });

  it('signs out from the menu', async () => {
    session.current = { user: { image: null }, player: PLAYER };
    const user = await openMenu('Account menu');
    await user.click(screen.getByRole('button', { name: 'Sign Out' }));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('gives a visitor Appearance and Language alone', async () => {
    session.current = null;
    await openMenu('Appearance and language');
    expect(screen.getByRole('button', { name: 'Appearance' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Language' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign Out' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
  });

  it('closes on Escape and hands focus back to its trigger', async () => {
    session.current = { user: { image: null }, player: PLAYER };
    const user = await openMenu('Account menu');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Account menu' }));
  });
});

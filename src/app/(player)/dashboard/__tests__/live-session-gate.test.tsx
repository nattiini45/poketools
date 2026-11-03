/**
 * The Settings and Avatar views gate on the live player, never on the 5-minute token copy (VAL-CROSS-002): a revoked
 * identity whose token still says "signed in" is sent to sign-in with the page it wanted.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ getSession: vi.fn(), getLiveSessionPlayer: vi.fn() }));
const redirect = vi.hoisted(() =>
  vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
);
const headerJar = vi.hoisted(() => ({ path: null as string | null }));
const players = vi.hoisted(() => ({ getPlayerById: vi.fn() }));

vi.mock('@/lib/auth/helpers', () => auth);
vi.mock('next/navigation', () => ({ redirect }));
vi.mock('next/headers', () => ({
  headers: async () => ({ get: (name: string) => (name === 'x-poketools-path' ? headerJar.path : null) }),
}));
vi.mock('@/lib/supabase/queries/players', () => players);
vi.mock('@/lib/pack-extensions', () => ({ packExtensions: {} }));
vi.mock('@/i18n/server', () => ({ getT: async () => (key: string) => key }));
vi.mock('@/lib/env', () => ({ discordOAuthEnabled: () => false }));
vi.mock('@/components/ui/PageContainer', () => ({ default: () => null }));
vi.mock('@/components/player/AgentSettingsForm', () => ({ default: () => null }));
vi.mock('@/components/player/PushDevicesCard', () => ({ default: () => null }));
vi.mock('@/components/player/AccountSecuritySection', () => ({ default: () => null }));
vi.mock('@/components/player/WorldExperienceSection', () => ({ default: () => null }));
vi.mock('@/components/shared/LanguagePicker', () => ({ LanguageSettingsSection: () => null }));
vi.mock('../settings/SpriteStyleSettingsSection', () => ({ default: () => null }));
vi.mock('../avatar/AvatarBuilderPage', () => ({ default: () => null }));

import SettingsPage from '../settings/page';
import AvatarPage from '../avatar/page';

const pages: [string, string, () => Promise<unknown>][] = [
  ['settings', '/dashboard/settings?tab=security', () => SettingsPage()],
  ['avatar', '/dashboard/avatar', () => AvatarPage()],
];

beforeEach(() => {
  vi.clearAllMocks();
  headerJar.path = null;
  players.getPlayerById.mockResolvedValue({ id: 'p1', avatar_config: null });
});

describe.each(pages)('%s page', (_name, path, render) => {
  it('redirects to sign-in with the return path when the token session is present but the live read finds no player', async () => {
    auth.getSession.mockResolvedValue({ player: { playerId: 'p1' } });
    auth.getLiveSessionPlayer.mockResolvedValue(null);
    headerJar.path = path;
    await expect(render()).rejects.toThrow(`redirect:/auth/signin?callbackUrl=${encodeURIComponent(path)}`);
    expect(players.getPlayerById).not.toHaveBeenCalled();
  });

  it('renders for a live player without reading the token copy', async () => {
    auth.getLiveSessionPlayer.mockResolvedValue({ playerId: 'p1' });
    await expect(render()).resolves.toBeTruthy();
    expect(auth.getSession).not.toHaveBeenCalled();
  });
});

describe('avatar page', () => {
  it('loads the live player, not the token player id', async () => {
    auth.getSession.mockResolvedValue({ player: { playerId: 'stale' } });
    auth.getLiveSessionPlayer.mockResolvedValue({ playerId: 'live' });
    await AvatarPage();
    expect(players.getPlayerById).toHaveBeenCalledWith('live');
  });
});

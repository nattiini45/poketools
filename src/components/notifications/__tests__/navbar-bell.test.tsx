import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';

const session = vi.hoisted(() => ({ current: null as null | { user: { image: null }; player: Record<string, unknown> } }));

vi.mock('next-auth/react', () => ({ useSession: () => ({ data: session.current }) }));
vi.mock('next/navigation', () => ({ usePathname: () => '/leagues' }));
vi.mock('@/components/shared/DiscordLoginButton', () => ({ default: () => null }));
vi.mock('@/components/shared/ThemeToggle', () => ({ default: () => null }));
vi.mock('@/components/shared/PalettePicker', () => ({ default: () => null, PalettePickerSection: () => null }));
vi.mock('@/components/shared/LanguagePicker', () => ({ default: () => null, LanguagePickerSection: () => null }));
vi.mock('@/components/shared/PwaInstallPrompt', () => ({ default: () => null }));
vi.mock('@/components/shared/PlayerAvatar', () => ({ default: () => null }));
vi.mock('../NotificationBell', () => ({ default: () => <span data-stub="bell" /> }));

import NavBar from '@/components/shared/NavBar';

describe('the bell in the NavBar', () => {
  it('is there for a registered player', () => {
    session.current = { user: { image: null }, player: { playerId: 'p1', name: 'Ada', avatarUrl: null } };
    expect(renderWithI18n(<NavBar />)).toContain('data-stub="bell"');
  });

  it('is not there for an anonymous visitor', () => {
    session.current = null;
    expect(renderWithI18n(<NavBar />)).not.toContain('data-stub="bell"');
  });
});

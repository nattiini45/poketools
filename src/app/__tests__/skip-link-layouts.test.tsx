/**
 * Every site layout opens with a "Skip to content" link ahead of the NavBar and lands on a focusable
 * `<main id="main-content">`. The auth layout has no navigation to skip, so it only carries the id.
 */
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';

vi.mock('@/components/shared/NavBar', () => ({ default: () => <nav data-testid="site-nav">nav</nav> }));
vi.mock('@/components/shared/nav/BottomTabBar', () => ({ default: () => <div data-testid="site-bottom-bar">bar</div> }));
vi.mock('@/components/shared/PageTransitionWrapper', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/components/shared/AdminGuard', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/components/admin/AdminSidebar', () => ({ default: () => <aside>sidebar</aside> }));
vi.mock('@/components/admin/assistant/AssistantDrawer', () => ({ default: () => null }));
vi.mock('@/components/creator/CreatorNav', () => ({ default: () => <div>creator nav</div> }));
vi.mock('@/lib/pack-extensions', () => ({
  siteNavExtraLinks: async () => [],
  extensionAdminLinks: async () => [],
}));
vi.mock('@/lib/auth/helpers', () => ({
  getSession: async () => ({ user: { id: 'p1' } }),
  getSessionPlayer: async () => ({ name: 'Ash' }),
  getLiveAccess: async () => ({ player: { playerId: 'p1', name: 'Ash' } }),
  getLiveSessionPlayer: async () => ({ playerId: 'p1', name: 'Ash' }),
}));
vi.mock('next/navigation', () => ({ redirect: vi.fn(), usePathname: () => '/' }));

import PublicLayout from '@/app/(public)/layout';
import PlayerLayout from '@/app/(player)/layout';
import CreatorLayout from '@/app/creator/layout';
import AdminLayout from '@/app/admin/layout';
import AuthLayout from '@/app/auth/layout';

const child = <p>Page body</p>;

const siteLayouts: [string, () => Promise<ReactNode>][] = [
  ['(public)', async () => PublicLayout({ children: child })],
  ['(player)', async () => PlayerLayout({ children: child })],
  ['creator', async () => CreatorLayout({ children: child })],
  ['admin', async () => AdminLayout({ children: child })],
];

describe.each(siteLayouts)('%s layout', (_name, build) => {
  it('puts the skip link before the navigation, pointing at main', async () => {
    const html = renderWithI18n(<>{await build()}</>);
    const link = html.indexOf('href="#main-content"');
    expect(link).toBeGreaterThanOrEqual(0);
    expect(link).toBeLessThan(html.indexOf('<nav'));
    expect(html).toContain('Skip to content');
  });

  it('has exactly one focusable main#main-content', async () => {
    const html = renderWithI18n(<>{await build()}</>);
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(/<main\b[^>]*\bid="main-content"[^>]*\btabindex="-1"/.test(html) || /<main\b[^>]*\btabindex="-1"[^>]*\bid="main-content"/.test(html)).toBe(true);
  });

  it('speaks German to a German viewer', async () => {
    const html = renderWithI18n(<>{await build()}</>, { locale: 'de' });
    expect(html).toContain('Zum Inhalt springen');
  });
});

describe('auth layout', () => {
  it('has main#main-content and no navigation to skip', () => {
    const html = renderWithI18n(<AuthLayout>{child}</AuthLayout>);
    expect(html).toMatch(/<main\b[^>]*\bid="main-content"/);
    expect(html).not.toContain('href="#main-content"');
    expect(html).not.toContain('<nav');
  });
});

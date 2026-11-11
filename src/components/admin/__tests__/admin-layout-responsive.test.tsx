/**
 * The admin shell's layout (redesign A1): the content column sits beside the sidebar and must be able to shrink below
 * its content (min-w-0), or a wide table pushes the page past the viewport; the rail is the one Admin nav landmark
 * (no second chip-row nav for phones: the sidebar is a drawer there); groups and items read in English and German.
 */
import { describe, it, expect, vi } from 'vitest';
import { isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/lib/auth/helpers', () => ({
  getSession: vi.fn(async () => ({ player: { id: 'p1', isAdmin: true } })),
  getLiveAccess: vi.fn(async () => ({ player: null, isSiteAdmin: true, isAnyAdmin: true, isCreator: false, isSuperadmin: true })),
  isSuperadmin: vi.fn(() => false),
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('next/navigation', () => ({ usePathname: () => '/admin/leagues', useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null }), signOut: vi.fn() }));
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'light', setTheme: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/notifications/NotificationBell', () => ({ default: () => null }));
vi.mock('@/components/shared/NavBar', () => ({ default: () => null }));
vi.mock('@/components/shared/AdminGuard', () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/shared/PageTransitionWrapper', () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));

import AdminLayout from '@/app/admin/layout';
import AdminShell from '../AdminShell';
import { renderWithI18n } from '@/test/i18n';

const ROLES = { isSiteAdmin: true, isSuperadmin: true };

function classesOf(className: unknown): Set<string> {
  return new Set(String(className ?? '').split(/\s+/).filter(Boolean));
}

function findShell(node: ReactNode): { roles?: unknown; children?: ReactNode } | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findShell(child);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const props = node.props as { roles?: unknown; children?: ReactNode };
  if (node.type === AdminShell) return props;
  return findShell(props.children);
}

describe('admin layout', () => {
  it('wraps the page in the admin shell for a live admin, with the page in a single main', async () => {
    const tree = await AdminLayout({ children: <p>content</p> });
    const shell = findShell(tree);
    expect(shell).not.toBeNull();
    expect(shell!.roles).toMatchObject({ isSiteAdmin: true, isSuperadmin: true });
    const html = renderToStaticMarkup(<>{shell!.children}</>);
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html).toContain('content');
  });
});

describe('admin shell below lg', () => {
  const shellHtml = (locale: 'en' | 'de' = 'en') =>
    renderWithI18n(
      <AdminShell roles={ROLES}>
        <main>content</main>
      </AdminShell>,
      { locale },
    );

  it('lets the content column shrink below its content, beside the sidebar', () => {
    const html = shellHtml();
    const column = [...html.matchAll(/<div class="([^"]*min-h-svh[^"]*)"/g)].map((m) => classesOf(m[1]));
    expect(column).toHaveLength(1);
    expect(column[0].has('min-w-0')).toBe(true);
    expect(column[0].has('flex-1')).toBe(true);
    expect(column[0].has('flex-col')).toBe(true);
    // The page sits in the column, after the top bar.
    expect(html.indexOf('<header')).toBeLessThan(html.indexOf('<main>content</main>'));
  });

  it('has one Admin nav landmark and no second chip-row nav', () => {
    const html = shellHtml();
    expect(html.match(/<nav aria-label="Admin"/g)).toHaveLength(1);
    expect(html).not.toContain('overflow-x-auto');
    expect(html).not.toContain('lg:hidden');
  });

  it('keeps the English groups and items', () => {
    const html = shellHtml();
    for (const label of ['Run', 'Library', 'Community', 'System', 'Competitions', 'Archived leagues', 'Players', 'Kale console', 'legacy']) {
      expect(html).toContain(`>${label}<`);
    }
  });

  it('renders German groups and items under a German provider', () => {
    const html = shellHtml('de');
    for (const label of ['Spielbetrieb', 'Bibliothek', 'Wettbewerbe', 'Archivierte Ligen', 'Spieler', 'Kale-Konsole', 'veraltet']) {
      expect(html).toContain(`>${label}<`);
    }
    expect(html).not.toContain('>Competitions<');
  });
});

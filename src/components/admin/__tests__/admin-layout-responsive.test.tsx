/**
 * Admin layout below lg (1024 px): AdminSidebar's chip-row nav must stack
 * above the content column. Side by side, the chip rows' intrinsic width
 * (about 687 px) squeezed the content to zero width and widened the page to
 * 1331 px at a 390 px viewport. The desktop rail layout (row, top-aligned,
 * gap-8) stays unchanged at lg and up.
 */
import { describe, it, expect, vi } from 'vitest';
import { isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/lib/auth/helpers', () => ({
  getSession: vi.fn(async () => ({ player: { id: 'p1', isAdmin: true } })),
  getLiveAccess: vi.fn(async () => ({ player: null, isSiteAdmin: true, isAnyAdmin: true, isCreator: false })),
  isSuperadmin: vi.fn(() => false),
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/admin/leagues' }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/shared/NavBar', () => ({ default: () => null }));
vi.mock('@/components/shared/AdminGuard', () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/shared/PageTransitionWrapper', () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));

import AdminLayout from '@/app/admin/layout';
import AdminSidebar from '../AdminSidebar';
import { renderWithI18n } from '@/test/i18n';

function classesOf(className: unknown): Set<string> {
  return new Set(String(className ?? '').split(/\s+/).filter(Boolean));
}

/** The element whose direct children include the AdminSidebar element. */
function findSidebarRow(node: ReactNode): { className?: string; children?: ReactNode } | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findSidebarRow(child);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const props = node.props as { className?: string; children?: ReactNode };
  const kids = Array.isArray(props.children) ? props.children : [props.children];
  if (kids.some((k) => isValidElement(k) && k.type === AdminSidebar)) return props;
  return findSidebarRow(props.children);
}

describe('admin layout below lg', () => {
  it('stacks the sidebar above the content and keeps the desktop row at lg', async () => {
    const tree = await AdminLayout({ children: <p>content</p> });
    const row = findSidebarRow(tree);
    expect(row).not.toBeNull();

    const cls = classesOf(row!.className);
    // Column below lg, so the chip nav can never sit beside the content.
    expect(cls.has('flex')).toBe(true);
    expect(cls.has('flex-col')).toBe(true);
    // Desktop layout unchanged: row, top-aligned, 2 rem gap.
    expect(cls.has('lg:flex-row')).toBe(true);
    expect(cls.has('lg:items-start')).toBe(true);
    expect(cls.has('lg:gap-8')).toBe(true);

    // The content column fills the row at lg and can shrink below its content.
    const kids = (Array.isArray(row!.children) ? row!.children : [row!.children]) as ReactNode[];
    const content = kids.find((k) => isValidElement(k) && k.type === 'div');
    expect(isValidElement(content)).toBe(true);
    const contentCls = classesOf((content as { props: { className?: string } }).props.className);
    expect(contentCls.has('min-w-0')).toBe(true);
    expect(contentCls.has('lg:flex-1')).toBe(true);
  });

  it('caps the mobile chip nav at the column width so rows scroll inside it', () => {
    const html = renderToStaticMarkup(<AdminSidebar roles={{ isSiteAdmin: true, isSuperadmin: false }} />);
    const navs = [...html.matchAll(/<nav aria-label="Admin" class="([^"]*)"/g)].map((m) => classesOf(m[1]));
    const mobile = navs.find((c) => c.has('lg:hidden'));
    expect(mobile).toBeDefined();
    expect(mobile!.has('min-w-0')).toBe(true);
    expect(mobile!.has('w-full')).toBe(true);
    // Each group's chip row scrolls horizontally instead of growing the nav.
    expect(html).toMatch(/class="flex gap-1\.5 overflow-x-auto pb-1"/);
    // The desktop rail is untouched.
    const desktop = navs.find((c) => c.has('lg:block'));
    expect(desktop).toBeDefined();
    expect(desktop!.has('w-56')).toBe(true);
  });
});

describe('admin sidebar labels', () => {
  const roles = { isSiteAdmin: true, isSuperadmin: true };

  it('keeps the English groups and items', () => {
    const html = renderToStaticMarkup(<AdminSidebar roles={roles} />);
    for (const label of ['Competitions', 'Archived leagues', 'Player roster', 'Kale console', 'legacy']) {
      expect(html).toContain(`>${label}<`);
    }
  });

  it('renders German groups and items under a German provider', () => {
    const html = renderWithI18n(<AdminSidebar roles={roles} />, { locale: 'de' });
    for (const label of ['Wettbewerbe', 'Archivierte Ligen', 'Spielerliste', 'Kale-Konsole', 'veraltet']) {
      expect(html).toContain(`>${label}<`);
    }
    expect(html).not.toContain('>Competitions<');
  });
});

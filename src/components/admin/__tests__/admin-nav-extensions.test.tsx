/**
 * Admin pages a pack extension adds (docs/format-packs.md, "Pack extensions"): they join the end
 * of their group under the same role rules as built-in items, render with the label the server
 * localized, and the built-in navigation is unchanged without them.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { ADMIN_NAV, visibleAdminNav, type AdminNavExtraItem } from '../adminNav';

vi.mock('next/navigation', () => ({ usePathname: () => '/admin/extra' }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} aria-current={rest['aria-current'] as 'page' | undefined}>
      {children}
    </a>
  ),
}));

import AdminSidebar from '../AdminSidebar';

const SITE_ADMIN = { isSiteAdmin: true, isSuperadmin: false };
const SUPERADMIN = { isSiteAdmin: true, isSuperadmin: true };
const RESOURCE_ADMIN = { isSiteAdmin: false, isSuperadmin: false };
const EXTRA: AdminNavExtraItem[] = [
  { href: '/admin/extra', label: 'Extra records', group: 'system', siteAdminOnly: true },
  { href: '/admin/open', label: 'Open page', group: 'competitions' },
];

const hrefs = (groups: ReturnType<typeof visibleAdminNav>) => groups.flatMap((g) => g.items.map((i) => i.href));

describe('admin navigation with pack extension items', () => {
  it('is the built-in navigation without extension items', () => {
    const builtIn = ADMIN_NAV.flatMap((g) => g.items.filter((i) => !i.superadminOnly && !i.assistant).map((i) => i.href));
    expect(hrefs(visibleAdminNav(SITE_ADMIN))).toEqual(builtIn);
    expect(hrefs(visibleAdminNav(SITE_ADMIN))).not.toContain('/admin/leagues/trash');
    expect(hrefs(visibleAdminNav(SUPERADMIN))).toContain('/admin/leagues/trash');
    expect(hrefs(visibleAdminNav(SITE_ADMIN, []))).toEqual(hrefs(visibleAdminNav(SITE_ADMIN)));
  });

  it('appends each item to the end of its group', () => {
    const groups = visibleAdminNav(SITE_ADMIN, EXTRA);
    const system = groups.find((g) => g.id === 'system')!;
    expect(system.items.at(-1)).toMatchObject({ href: '/admin/extra', label: 'Extra records' });
    const competitions = groups.find((g) => g.id === 'competitions')!;
    expect(competitions.items.at(-1)).toMatchObject({ href: '/admin/open', label: 'Open page' });
  });

  it('applies the same role rules as built-in items', () => {
    expect(hrefs(visibleAdminNav(RESOURCE_ADMIN, EXTRA))).not.toContain('/admin/extra');
    expect(hrefs(visibleAdminNav(RESOURCE_ADMIN, EXTRA))).toContain('/admin/open');
    const superOnly: AdminNavExtraItem[] = [{ href: '/admin/super', label: 'Super', group: 'system', superadminOnly: true }];
    expect(hrefs(visibleAdminNav(SITE_ADMIN, superOnly))).not.toContain('/admin/super');
    expect(hrefs(visibleAdminNav({ isSiteAdmin: true, isSuperadmin: true }, superOnly))).toContain('/admin/super');
  });

  it('renders the localized label as given and marks the active page', () => {
    const html = renderWithI18n(<AdminSidebar roles={SITE_ADMIN} extraItems={EXTRA} />);
    expect(html).toMatch(/href="\/admin\/extra"[^>]*>(?:<span[^>]*>)?Extra records/);
    expect(html).toContain('aria-current="page"');
  });
});

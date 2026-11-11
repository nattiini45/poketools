/**
 * Admin pages a pack extension adds (docs/format-packs.md, "Pack extensions"): whatever group the pack names, the shell
 * lists them at the end of System under the same role rules as built-in items, with the label the server localized;
 * the built-in navigation is unchanged without them. Also covers adminNavSections, which groups sub-views under their
 * primary item.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { SidebarProvider } from '@/components/ui/fluid/sidebar';
import { ADMIN_NAV, adminNavSections, visibleAdminNav, type AdminNavExtraItem } from '../adminNav';

vi.mock('next/navigation', () => ({ usePathname: () => '/admin/extra', useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null }), signOut: vi.fn() }));
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'light', setTheme: vi.fn() }) }));
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

  it('joins every extension item to the end of System, whichever group the pack names', () => {
    const groups = visibleAdminNav(SITE_ADMIN, EXTRA);
    const system = groups.find((g) => g.id === 'system')!;
    expect(system.items.slice(-2)).toMatchObject([
      { href: '/admin/extra', label: 'Extra records' },
      { href: '/admin/open', label: 'Open page' },
    ]);
    for (const group of groups.filter((g) => g.id !== 'system')) {
      expect(hrefs([group])).not.toContain('/admin/open');
      expect(hrefs([group])).not.toContain('/admin/extra');
    }
    expect(hrefs(groups.filter((g) => g.id !== 'system'))).toEqual(hrefs(visibleAdminNav(SITE_ADMIN).filter((g) => g.id !== 'system')));
  });

  it('applies the same role rules as built-in items', () => {
    expect(hrefs(visibleAdminNav(RESOURCE_ADMIN, EXTRA))).not.toContain('/admin/extra');
    expect(hrefs(visibleAdminNav(RESOURCE_ADMIN, EXTRA))).toContain('/admin/open');
    const superOnly: AdminNavExtraItem[] = [{ href: '/admin/super', label: 'Super', group: 'system', superadminOnly: true }];
    expect(hrefs(visibleAdminNav(SITE_ADMIN, superOnly))).not.toContain('/admin/super');
    expect(hrefs(visibleAdminNav({ isSiteAdmin: true, isSuperadmin: true }, superOnly))).toContain('/admin/super');
  });

  it('keeps System for a resource admin when only an extension item is left in it', () => {
    const groups = visibleAdminNav(RESOURCE_ADMIN, EXTRA);
    expect(groups.find((g) => g.id === 'system')?.items.map((i) => i.href)).toEqual(['/admin/open']);
  });

  it('renders the localized label as given and marks the active page', () => {
    const html = renderWithI18n(
      <SidebarProvider>
        <AdminSidebar groups={visibleAdminNav(SITE_ADMIN, EXTRA)} onOpenCommand={() => undefined} />
      </SidebarProvider>,
    );
    expect(html).toMatch(/href="\/admin\/extra"[^>]*>(?:<span[^>]*>)*Extra records/);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/<a href="\/admin\/extra" aria-current="page"/);
  });
});

describe('adminNavSections', () => {
  it('puts each sub-item under the primary item before it', () => {
    const run = visibleAdminNav(SUPERADMIN).find((g) => g.id === 'run')!;
    const sections = adminNavSections(run.items);
    const competitions = sections.find((s) => s.item.labelKey === 'competitions')!;
    expect(competitions.subs.map((s) => s.labelKey)).toEqual(['leagues', 'tournaments', 'archivedLeagues', 'archivedTournaments', 'leagueTrash']);
    expect(sections.map((s) => s.item.labelKey)).toEqual(['overview', 'competitions', 'matches', 'players']);
    expect(sections.filter((s) => s.item.labelKey !== 'competitions').every((s) => s.subs.length === 0)).toBe(true);
  });

  it('leaves out a view the viewer may not open (League trash is superadmin only)', () => {
    const run = visibleAdminNav(SITE_ADMIN).find((g) => g.id === 'run')!;
    const competitions = adminNavSections(run.items).find((s) => s.item.labelKey === 'competitions')!;
    expect(competitions.subs.map((s) => s.labelKey)).not.toContain('leagueTrash');
  });

  it('makes a sub-item without a primary item before it a section of its own', () => {
    const [first] = ADMIN_NAV[0].items;
    expect(adminNavSections([{ ...first, sub: true }])).toEqual([{ item: { ...first, sub: true }, subs: [] }]);
  });
});

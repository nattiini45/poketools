/**
 * Exactly one admin nav item carries aria-current="page": the most specific href the page sits under. Without that,
 * Leagues and Archived leagues (and every child page of both) lit up together, and an Overview item at /admin would
 * light up on every admin page. A section that has views (Competitions) is marked aria-current="true" while the page
 * is one of its views, so the sidebar still shows where the admin is without a second "page".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { SidebarProvider } from '@/components/ui/fluid/sidebar';
import { ADMIN_NAV, activeAdminNavHref, visibleAdminNav, type AdminNavExtraItem, type AdminRoles } from '../adminNav';

const nav = vi.hoisted(() => ({ pathname: '/admin' as string | null }));

vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null }), signOut: vi.fn() }));
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'light', setTheme: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} aria-current={rest['aria-current'] as 'page' | 'true' | undefined}>
      {children}
    </a>
  ),
}));

import AdminSidebar from '../AdminSidebar';

const HREFS = ADMIN_NAV.flatMap((group) => group.items.map((item) => item.href));
const SUPERADMIN: AdminRoles = { isSiteAdmin: true, isSuperadmin: true };
const RESOURCE_ADMIN: AdminRoles = { isSiteAdmin: false, isSuperadmin: false };

function sidebar(roles: AdminRoles, locale: 'en' | 'de' = 'en', extraItems: readonly AdminNavExtraItem[] = []): string {
  return renderWithI18n(
    <SidebarProvider>
      <AdminSidebar groups={visibleAdminNav(roles, extraItems)} onOpenCommand={() => undefined} />
    </SidebarProvider>,
    { locale },
  );
}

/** The rows of the sidebar's nav as `[href, aria-current]` pairs, in document order. */
function navRows(html: string): { href: string; current: string | null; text: string }[] {
  const nav = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'));
  return [...nav.matchAll(/<a href="([^"]*)"([^>]*)>(.*?)<\/a>/g)].map((m) => ({
    href: m[1],
    current: /aria-current="([^"]*)"/.exec(m[2])?.[1] ?? null,
    // The row renders a hidden bold copy of its label (weight without reflow): drop it, then the tags.
    text: m[3].replace(/<span[^>]*aria-hidden="true"[^>]*>.*?<\/span>/g, '').replace(/<[^>]*>/g, ''),
  }));
}
const pages = (html: string) => navRows(html).filter((row) => row.current === 'page');

beforeEach(() => {
  nav.pathname = '/admin';
});

describe('activeAdminNavHref', () => {
  it('is Overview alone at /admin, with or without a trailing slash', () => {
    expect(activeAdminNavHref('/admin', HREFS)).toBe('/admin');
    expect(activeAdminNavHref('/admin/', HREFS)).toBe('/admin');
  });

  it('does not let Overview match any other admin page', () => {
    expect(activeAdminNavHref('/admin/foo', HREFS)).toBeNull();
    expect(activeAdminNavHref('/admin/matches/abc', HREFS)).toBe('/admin/matches');
  });

  it('prefers the longest matching href', () => {
    expect(activeAdminNavHref('/admin/leagues', HREFS)).toBe('/admin/leagues');
    expect(activeAdminNavHref('/admin/leagues/archived', HREFS)).toBe('/admin/leagues/archived');
    expect(activeAdminNavHref('/admin/tournaments/archived', HREFS)).toBe('/admin/tournaments/archived');
  });

  it('gives child pages to their section', () => {
    expect(activeAdminNavHref('/admin/leagues/abc/phases/x', HREFS)).toBe('/admin/leagues');
    expect(activeAdminNavHref('/admin/leagues/new', HREFS)).toBe('/admin/leagues');
    expect(activeAdminNavHref('/admin/tournaments/abc/rounds', HREFS)).toBe('/admin/tournaments');
  });

  it('does not treat a longer sibling name as a child', () => {
    expect(activeAdminNavHref('/admin/leagues-old', HREFS)).toBeNull();
    expect(activeAdminNavHref('/admin/leagues/archived-x', HREFS)).toBe('/admin/leagues');
  });

  it('is null for an unknown page and for no pathname', () => {
    expect(activeAdminNavHref('/admin/foo', HREFS)).toBeNull();
    expect(activeAdminNavHref('/dashboard', HREFS)).toBeNull();
    expect(activeAdminNavHref(null, HREFS)).toBeNull();
    expect(activeAdminNavHref('/admin', [])).toBeNull();
  });
});

describe('AdminSidebar active item', () => {
  it('has exactly one Admin nav landmark', () => {
    const html = sidebar(SUPERADMIN);
    expect(html.match(/<nav\b/g)).toHaveLength(1);
    expect(html).toContain('<nav aria-label="Admin"');
  });

  it('marks Archived leagues as the page and its section Competitions as current at /admin/leagues/archived', () => {
    nav.pathname = '/admin/leagues/archived';
    const rows = navRows(sidebar(SUPERADMIN));
    expect(rows.filter((row) => row.current === 'page').map((row) => [row.href, row.text])).toEqual([['/admin/leagues/archived', 'Archived leagues']]);
    expect(rows.filter((row) => row.current === 'true').map((row) => [row.href, row.text])).toEqual([['/admin/leagues', 'Competitions']]);
    // Exactly one aria-current="page" in the whole sidebar.
    expect(sidebar(SUPERADMIN).match(/aria-current="page"/g)).toHaveLength(1);
  });

  it('marks the Leagues view on /admin/leagues/new', () => {
    nav.pathname = '/admin/leagues/new';
    const rows = navRows(sidebar(SUPERADMIN));
    expect(pages(sidebar(SUPERADMIN)).map((row) => [row.href, row.text])).toEqual([['/admin/leagues', 'Leagues']]);
    expect(rows.find((row) => row.text === 'Competitions')?.current).toBe('true');
  });

  it('marks a plain item without views as the page itself', () => {
    nav.pathname = '/admin/matches/abc';
    expect(pages(sidebar(SUPERADMIN)).map((row) => [row.href, row.text])).toEqual([['/admin/matches', 'Matches']]);
  });

  it('shows Overview first and selects it at /admin', () => {
    nav.pathname = '/admin';
    const rows = navRows(sidebar(RESOURCE_ADMIN));
    expect(rows[0]).toMatchObject({ href: '/admin', current: 'page', text: 'Overview' });
    expect(pages(sidebar(RESOURCE_ADMIN))).toHaveLength(1);
    expect(rows.findIndex((row) => row.href === '/admin')).toBeLessThan(rows.findIndex((row) => row.href === '/admin/leagues'));
  });

  it('translates Overview', () => {
    expect(sidebar(SUPERADMIN, 'de')).toContain('Übersicht');
  });

  it('selects nothing on a page the nav does not list', () => {
    nav.pathname = '/admin/foo';
    expect(sidebar(SUPERADMIN)).not.toContain('aria-current');
  });

  it('counts extension items when picking the most specific one', () => {
    nav.pathname = '/admin/leagues/archived/extra';
    const extra: AdminNavExtraItem[] = [{ href: '/admin/leagues/archived/extra', label: 'Extra', group: 'competitions' }];
    expect(pages(sidebar(SUPERADMIN, 'en', extra)).map((row) => [row.href, row.text])).toEqual([['/admin/leagues/archived/extra', 'Extra']]);
  });
});

/**
 * Exactly one admin nav item is highlighted: the most specific href the page sits under. Without
 * that, Leagues and Archived leagues (and every child page of both) lit up together, and an
 * Overview item at /admin would light up on every admin page.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '@/test/i18n';
import { ADMIN_NAV, activeAdminNavHref, type AdminNavExtraItem } from '../adminNav';

const nav = vi.hoisted(() => ({ pathname: '/admin' as string | null }));

vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} aria-current={rest['aria-current'] as 'page' | undefined}>
      {children}
    </a>
  ),
}));

import AdminSidebar from '../AdminSidebar';

const HREFS = ADMIN_NAV.flatMap((group) => group.items.map((item) => item.href));
const SUPERADMIN = { isSiteAdmin: true, isSuperadmin: true };

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
  /** The desktop rail and the mobile chip row, each with its own markup. */
  function navs(html: string): { rail: string; chips: string } {
    const parts = html.split('<nav').slice(1);
    expect(parts).toHaveLength(2);
    return { rail: parts[0], chips: parts[1] };
  }
  const current = (html: string) => [...html.matchAll(/<a href="([^"]*)" aria-current="page"/g)].map((m) => m[1]);

  it('highlights only Archived leagues at /admin/leagues/archived, in the rail and in the chips', () => {
    nav.pathname = '/admin/leagues/archived';
    const { rail, chips } = navs(renderWithI18n(<AdminSidebar roles={SUPERADMIN} />));
    expect(current(rail)).toEqual(['/admin/leagues/archived']);
    expect(current(chips)).toEqual(['/admin/leagues/archived']);
    expect((rail.match(/aria-current="page"/g) ?? []).length).toBe(1);
    expect((chips.match(/aria-current="page"/g) ?? []).length).toBe(1);
  });

  it('highlights only Leagues on /admin/leagues/new', () => {
    nav.pathname = '/admin/leagues/new';
    const { rail, chips } = navs(renderWithI18n(<AdminSidebar roles={SUPERADMIN} />));
    expect(current(rail)).toEqual(['/admin/leagues']);
    expect(current(chips)).toEqual(['/admin/leagues']);
  });

  it('shows Overview first and selects it at /admin', () => {
    nav.pathname = '/admin';
    const html = renderWithI18n(<AdminSidebar roles={{ isSiteAdmin: false, isSuperadmin: false }} />);
    const { rail, chips } = navs(html);
    expect(current(rail)).toEqual(['/admin']);
    expect(current(chips)).toEqual(['/admin']);
    expect(rail).toMatch(/aria-current="page"[^>]*>(?:<span[^>]*>)?Overview/);
    expect(rail.indexOf('href="/admin"')).toBeLessThan(rail.indexOf('href="/admin/leagues"'));
  });

  it('translates Overview', () => {
    const html = renderWithI18n(<AdminSidebar roles={SUPERADMIN} />, { locale: 'de' });
    expect(html).toContain('Übersicht');
  });

  it('selects nothing on a page the nav does not list', () => {
    nav.pathname = '/admin/foo';
    expect(renderWithI18n(<AdminSidebar roles={SUPERADMIN} />)).not.toContain('aria-current');
  });

  it('counts extension items when picking the most specific one', () => {
    nav.pathname = '/admin/leagues/archived/extra';
    const extra: AdminNavExtraItem[] = [{ href: '/admin/leagues/archived/extra', label: 'Extra', group: 'competitions' }];
    const { rail } = navs(renderWithI18n(<AdminSidebar roles={SUPERADMIN} extraItems={extra} />));
    expect(current(rail)).toEqual(['/admin/leagues/archived/extra']);
  });
});

/**
 * The nav hides `siteAdminOnly` items from resource admins and their APIs are
 * `requireAdmin()`. A page behind such an item must use `SiteAdminGuard`
 * (live `isSiteAdmin`); `AdminGuard` also lets a resource admin in, who would
 * then see a page of 403s. This walks `ADMIN_NAV` so a new site-admin item, or
 * a new page under one, cannot ship with the wrong guard.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ADMIN_NAV } from '../adminNav';

const APP_DIR = path.join(process.cwd(), 'src', 'app');

/** Every `page.tsx` at or below the route directory of an href. */
function pageFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...pageFiles(full));
    else if (name === 'page.tsx') out.push(full);
  }
  return out;
}

const siteAdminHrefs = ADMIN_NAV.flatMap((group) => group.items)
  .filter((item) => item.siteAdminOnly)
  .map((item) => item.href);

const superadminHrefs = ADMIN_NAV.flatMap((group) => group.items)
  .filter((item) => item.superadminOnly && !item.deprecated)
  .map((item) => item.href);

describe('site-admin-only admin pages', () => {
  it('the nav declares site-admin-only items to check', () => {
    expect(siteAdminHrefs.length).toBeGreaterThan(0);
  });

  it.each(siteAdminHrefs)('%s: every page under it is wrapped in SiteAdminGuard, not AdminGuard', (href) => {
    const dir = path.join(APP_DIR, ...href.split('/').filter(Boolean));
    const pages = pageFiles(dir);
    expect(pages.length, `no page.tsx under ${href}`).toBeGreaterThan(0);
    for (const file of pages) {
      const src = readFileSync(file, 'utf8');
      const label = path.relative(APP_DIR, file);
      expect(src, `${label} must use SiteAdminGuard`).toContain("from '@/components/shared/SiteAdminGuard'");
      expect(src, `${label} must render <SiteAdminGuard>`).toMatch(/<SiteAdminGuard>/);
      expect(src, `${label} must not use the any-admin AdminGuard`).not.toMatch(/(?<![A-Za-z])AdminGuard\b/);
    }
  });
});

describe('superadmin-only admin pages', () => {
  it('the nav declares superadmin-only items to check (the soft-deprecated Kale console has its own gate)', () => {
    expect(superadminHrefs).toContain('/admin/leagues/trash');
  });

  it.each(superadminHrefs)('%s: every page under it is wrapped in SuperadminGuard, not AdminGuard', (href) => {
    const dir = path.join(APP_DIR, ...href.split('/').filter(Boolean));
    const pages = pageFiles(dir);
    expect(pages.length, `no page.tsx under ${href}`).toBeGreaterThan(0);
    for (const file of pages) {
      const src = readFileSync(file, 'utf8');
      const label = path.relative(APP_DIR, file);
      expect(src, `${label} must use SuperadminGuard`).toContain("from '@/components/shared/SuperadminGuard'");
      expect(src, `${label} must render <SuperadminGuard>`).toMatch(/<SuperadminGuard>/);
      expect(src, `${label} must not use the any-admin AdminGuard`).not.toMatch(/(?<![A-Za-z])AdminGuard\b/);
    }
  });
});

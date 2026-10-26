/**
 * The Formats entry of the admin navigation: open to every admin (resource admins included, so it is not
 * site-admin-only), once, in the competitions group right after Rulesets, labelled in both languages.
 */
import { describe, expect, it } from 'vitest';
import shellDe from '@/i18n/messages/shell/de';
import shellEn from '@/i18n/messages/shell/en';
import { ADMIN_NAV, visibleAdminNav } from '../adminNav';

const SITE_ADMIN = { isSiteAdmin: true, isSuperadmin: false };
const RESOURCE_ADMIN = { isSiteAdmin: false, isSuperadmin: false };

describe('admin navigation: Formats', () => {
  it.each([
    ['a site admin', SITE_ADMIN],
    ['a resource admin', RESOURCE_ADMIN],
  ])('shows /admin/formats once, in the competitions group, to %s', (_who, roles) => {
    const groups = visibleAdminNav(roles);
    const hits = groups.flatMap((group) => group.items.filter((item) => item.href === '/admin/formats').map(() => group.id));
    expect(hits).toEqual(['competitions']);
  });

  it('is not restricted to site admins or superadmins', () => {
    const item = ADMIN_NAV.flatMap((group) => group.items).find((entry) => entry.href === '/admin/formats');
    expect(item).toMatchObject({ labelKey: 'formats' });
    expect(item?.siteAdminOnly).toBeUndefined();
    expect(item?.superadminOnly).toBeUndefined();
  });

  it('follows Rulesets in the competitions group', () => {
    const competitions = ADMIN_NAV.find((group) => group.id === 'competitions');
    const hrefs = competitions?.items.map((item) => item.href) ?? [];
    expect(hrefs.indexOf('/admin/formats')).toBe(hrefs.indexOf('/admin/rulesets') + 1);
  });

  it('is labelled in English and German', () => {
    expect(shellEn.admin.items.formats).toBe('Formats');
    expect(shellDe.admin.items.formats).toBe('Formate');
  });
});

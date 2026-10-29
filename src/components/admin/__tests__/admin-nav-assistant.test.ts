/**
 * The Assistant entry of the admin navigation: in the competitions group, not site-admin-only (the
 * assistant's tools are scoped by role), labelled in both languages, and rendered only while the
 * admin layout says the assistant is on for the live viewer (`AdminRoles.assistantEnabled`).
 */
import { describe, expect, it } from 'vitest';
import shellDe from '@/i18n/messages/shell/de';
import shellEn from '@/i18n/messages/shell/en';
import { ADMIN_NAV, visibleAdminNav } from '../adminNav';

const SITE_ADMIN = { isSiteAdmin: true, isSuperadmin: false };
const RESOURCE_ADMIN = { isSiteAdmin: false, isSuperadmin: false };
const SUPERADMIN = { isSiteAdmin: true, isSuperadmin: true };

function assistantHits(roles: Parameters<typeof visibleAdminNav>[0]): string[] {
  return visibleAdminNav(roles).flatMap((group) =>
    group.items.filter((item) => item.href === '/admin/assistant').map(() => group.id),
  );
}

describe('admin navigation: Assistant', () => {
  it('is hidden unless the layout enables it (unset and false both hide it)', () => {
    for (const roles of [SITE_ADMIN, RESOURCE_ADMIN, SUPERADMIN]) {
      expect(assistantHits(roles)).toEqual([]);
      expect(assistantHits({ ...roles, assistantEnabled: false })).toEqual([]);
    }
  });

  it.each([
    ['a site admin', SITE_ADMIN],
    ['a resource admin', RESOURCE_ADMIN],
    ['the superadmin', SUPERADMIN],
  ])('shows /admin/assistant once, in the competitions group, to %s when it is enabled', (_who, roles) => {
    expect(assistantHits({ ...roles, assistantEnabled: true })).toEqual(['competitions']);
  });

  it('is not restricted to site admins or superadmins (the audience gate is assistantEnabled)', () => {
    const item = ADMIN_NAV.flatMap((group) => group.items).find((entry) => entry.href === '/admin/assistant');
    expect(item).toMatchObject({ labelKey: 'assistant', assistant: true });
    expect(item?.siteAdminOnly).toBeUndefined();
    expect(item?.superadminOnly).toBeUndefined();
  });

  it('follows Formats in the competitions group', () => {
    const competitions = ADMIN_NAV.find((group) => group.id === 'competitions');
    const hrefs = competitions?.items.map((item) => item.href) ?? [];
    expect(hrefs.indexOf('/admin/assistant')).toBe(hrefs.indexOf('/admin/formats') + 1);
  });

  it('does not change what any other item shows', () => {
    const hrefsOf = (roles: Parameters<typeof visibleAdminNav>[0]) =>
      visibleAdminNav(roles).flatMap((group) => group.items.map((item) => item.href));
    expect(hrefsOf({ ...SITE_ADMIN, assistantEnabled: true }).filter((href) => href !== '/admin/assistant')).toEqual(
      hrefsOf(SITE_ADMIN),
    );
  });

  it('is labelled in English and German', () => {
    expect(shellEn.admin.items.assistant).toBe('Assistant');
    expect(shellDe.admin.items.assistant).toBe('Assistent');
  });
});

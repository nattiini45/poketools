/**
 * Admin navigation IA — one config drives the sidebar, the mobile menu and
 * (eventually) breadcrumbs. Groups follow the admin workflow: run
 * competitions, tend the community, then system-level tooling.
 *
 * Visibility mirrors the API guards: `siteAdminOnly` items require full
 * `isAdmin`, `superadminOnly` requires `isSuperadmin`; everything else is
 * available to any admin (including resource admins).
 *
 * Labels are keys of `shell.admin.groups` / `shell.admin.items`
 * (`src/i18n/messages/shell`), translated where the nav renders.
 */
import type shellEn from '@/i18n/messages/shell/en';

export type AdminNavGroupKey = keyof typeof shellEn.admin.groups;
export type AdminNavItemKey = keyof typeof shellEn.admin.items;

export interface AdminNavItem {
  href: string;
  labelKey: AdminNavItemKey;
  siteAdminOnly?: boolean;
  superadminOnly?: boolean;
  /** Soft-deprecated tooling — labelled, never removed silently. */
  deprecated?: boolean;
  /** Secondary destinations rendered indented under a primary item. */
  sub?: boolean;
}

export interface AdminNavGroup {
  id: AdminNavGroupKey;
  items: AdminNavItem[];
}

export const ADMIN_NAV: readonly AdminNavGroup[] = [
  {
    id: 'competitions',
    items: [
      { href: '/admin/leagues', labelKey: 'leagues' },
      { href: '/admin/leagues/archived', labelKey: 'archivedLeagues', sub: true },
      { href: '/admin/tournaments', labelKey: 'tournaments' },
      { href: '/admin/tournaments/archived', labelKey: 'archivedTournaments', sub: true },
      { href: '/admin/matches', labelKey: 'matches' },
      { href: '/admin/rulesets', labelKey: 'rulesets', siteAdminOnly: true },
    ],
  },
  {
    id: 'community',
    items: [
      { href: '/admin/players', labelKey: 'players', siteAdminOnly: true },
      { href: '/admin/achievements', labelKey: 'achievements', siteAdminOnly: true },
      { href: '/admin/wiki', labelKey: 'wiki', siteAdminOnly: true },
      { href: '/admin/social', labelKey: 'social', siteAdminOnly: true },
    ],
  },
  {
    id: 'system',
    items: [
      { href: '/admin/data', labelKey: 'data', siteAdminOnly: true },
      { href: '/admin/meta-data', labelKey: 'metaData', siteAdminOnly: true },
      { href: '/admin/audit', labelKey: 'audit', siteAdminOnly: true },
      { href: '/admin/test-players', labelKey: 'testPlayers', siteAdminOnly: true },
      {
        href: '/admin/kale',
        labelKey: 'kale',
        superadminOnly: true,
        deprecated: true,
      },
    ],
  },
];

export interface AdminRoles {
  isSiteAdmin: boolean;
  isSuperadmin: boolean;
}

/** Filter the IA down to what this viewer may open. */
export function visibleAdminNav(roles: AdminRoles): AdminNavGroup[] {
  return ADMIN_NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      if (item.superadminOnly) return roles.isSuperadmin;
      if (item.siteAdminOnly) return roles.isSiteAdmin;
      return true;
    }),
  })).filter((group) => group.items.length > 0);
}

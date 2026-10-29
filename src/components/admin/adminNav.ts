/**
 * Admin navigation IA — one config drives the sidebar, the mobile menu and
 * (eventually) breadcrumbs. Groups follow the admin workflow: run
 * competitions, tend the community, then system-level tooling.
 *
 * Visibility mirrors the API guards: `siteAdminOnly` items require full
 * `isAdmin`, `superadminOnly` requires `isSuperadmin`; everything else is
 * available to any admin (including resource admins). An `assistant` item
 * (the Admin Assistant) also needs `AdminRoles.assistantEnabled`, which the
 * admin layout derives from the live role (the public flag, the server switch
 * and the audience), so it never shows where the assistant would answer 404.
 *
 * Labels are keys of `shell.admin.groups` / `shell.admin.items`
 * (`src/i18n/messages/shell`), translated where the nav renders. Pages a pack
 * extension adds (docs/format-packs.md, "Pack extensions") arrive as
 * `AdminNavExtraItem`s with a label the server already localized.
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
  /** The Admin Assistant: shown only while `AdminRoles.assistantEnabled` is true. */
  assistant?: boolean;
}

export interface AdminNavGroup {
  id: AdminNavGroupKey;
  items: AdminNavItem[];
}

/** An admin page a pack extension adds: appended to its group, with a localized label. */
export interface AdminNavExtraItem {
  href: string;
  label: string;
  group: AdminNavGroupKey;
  siteAdminOnly?: boolean;
  superadminOnly?: boolean;
}

/** One rendered item: a built-in one (translated by key) or an extension's (label as given). */
export type VisibleAdminNavItem =
  | AdminNavItem
  | (Omit<AdminNavItem, 'labelKey'> & { labelKey?: undefined; label: string });

export interface VisibleAdminNavGroup {
  id: AdminNavGroupKey;
  items: VisibleAdminNavItem[];
}

export const ADMIN_NAV: readonly AdminNavGroup[] = [
  {
    id: 'competitions',
    items: [
      { href: '/admin', labelKey: 'overview' },
      { href: '/admin/leagues', labelKey: 'leagues' },
      { href: '/admin/leagues/archived', labelKey: 'archivedLeagues', sub: true },
      { href: '/admin/leagues/trash', labelKey: 'leagueTrash', superadminOnly: true, sub: true },
      { href: '/admin/tournaments', labelKey: 'tournaments' },
      { href: '/admin/tournaments/archived', labelKey: 'archivedTournaments', sub: true },
      { href: '/admin/matches', labelKey: 'matches' },
      { href: '/admin/rulesets', labelKey: 'rulesets' },
      { href: '/admin/formats', labelKey: 'formats' },
      { href: '/admin/assistant', labelKey: 'assistant', assistant: true },
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
  /** The Admin Assistant is on for this viewer (see `agentEnabledFor`); unset means off. */
  assistantEnabled?: boolean;
}

function mayOpen(
  item: { siteAdminOnly?: boolean; superadminOnly?: boolean; assistant?: boolean },
  roles: AdminRoles,
): boolean {
  if (item.assistant && roles.assistantEnabled !== true) return false;
  if (item.superadminOnly) return roles.isSuperadmin;
  if (item.siteAdminOnly) return roles.isSiteAdmin;
  return true;
}

/**
 * Filter the IA down to what this viewer may open. Extension items join the end of their group
 * under the same role rules (the extension's own routes still guard themselves).
 */
export function visibleAdminNav(
  roles: AdminRoles,
  extraItems: readonly AdminNavExtraItem[] = [],
): VisibleAdminNavGroup[] {
  return ADMIN_NAV.map((group) => ({
    id: group.id,
    items: [
      ...group.items.filter((item) => mayOpen(item, roles)),
      ...extraItems
        .filter((item) => item.group === group.id && mayOpen(item, roles))
        .map(
          (item): VisibleAdminNavItem => ({
            href: item.href,
            label: item.label,
            siteAdminOnly: item.siteAdminOnly,
            superadminOnly: item.superadminOnly,
          }),
        ),
    ],
  })).filter((group) => group.items.length > 0);
}

/**
 * The one nav item the current page belongs to: the longest href that is the path itself or a
 * parent of it (`/admin/leagues/archived` picks Archived leagues, not Leagues). `/admin` matches
 * only the exact path, otherwise Overview would light up on every admin page. A trailing slash
 * on the pathname is ignored. Null when no href matches.
 */
export function activeAdminNavHref(pathname: string | null, hrefs: readonly string[]): string | null {
  if (pathname === null) return null;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  let best: string | null = null;
  for (const href of hrefs) {
    const matches = href === '/admin' ? path === href : path === href || path.startsWith(`${href}/`);
    if (matches && (best === null || href.length > best.length)) best = href;
  }
  return best;
}

/**
 * The `scrollLeft` that centres a chip in its scrolling row, clamped to the row's range. All
 * measures are in px: `chipLeft` is the chip's left edge within the row's scrollable content.
 * A chip that already sits inside the row keeps the row where it is (returns `currentScrollLeft`).
 */
export function chipScrollLeft(m: {
  rowWidth: number;
  rowScrollWidth: number;
  currentScrollLeft: number;
  chipLeft: number;
  chipWidth: number;
}): number {
  const { rowWidth, rowScrollWidth, currentScrollLeft, chipLeft, chipWidth } = m;
  const visible = chipLeft >= currentScrollLeft && chipLeft + chipWidth <= currentScrollLeft + rowWidth;
  if (visible) return currentScrollLeft;
  const max = Math.max(0, rowScrollWidth - rowWidth);
  const centred = chipLeft - (rowWidth - chipWidth) / 2;
  return Math.min(max, Math.max(0, centred));
}

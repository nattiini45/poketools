/**
 * Admin navigation IA: one config drives the sidebar, the command menu and the breadcrumb. Groups follow the admin
 * workflow: run competitions, the format and ruleset library, the community, then system tooling (collapsed).
 *
 * Visibility mirrors the API guards: `siteAdminOnly` items require full `isAdmin`, `superadminOnly` requires
 * `isSuperadmin`; everything else is available to any admin (including resource admins). An `assistant` item (the
 * Admin Assistant) also needs `AdminRoles.assistantEnabled`, which the admin layout derives from the live role (the
 * public flag, the server switch and the audience), so it never shows where the assistant would answer 404.
 *
 * Labels are keys of `shell.admin.groups` / `shell.admin.items` (`src/i18n/messages/shell`), translated where the
 * nav renders. Pages a pack extension adds (docs/format-packs.md, "Pack extensions") arrive as `AdminNavExtraItem`s
 * with a label the server already localized; the shell lists them at the end of System.
 */
import type shellEn from '@/i18n/messages/shell/en';
import type { ItemIconId } from '@/lib/pkmn/item-icons';

export type AdminNavGroupKey = keyof typeof shellEn.admin.groups;
export type AdminNavItemKey = keyof typeof shellEn.admin.items;

export interface AdminNavItem {
  href: string;
  labelKey: AdminNavItemKey;
  /** The approved item icon (renders/design-direction/item-icon-map.png); sub-items and System items carry none. */
  icon?: ItemIconId;
  siteAdminOnly?: boolean;
  superadminOnly?: boolean;
  /** Soft-deprecated tooling: labelled, never removed silently. */
  deprecated?: boolean;
  /** A view of the primary item above it, listed under it while that section is open. */
  sub?: boolean;
  /** The Admin Assistant: shown only while `AdminRoles.assistantEnabled` is true. */
  assistant?: boolean;
}

export interface AdminNavGroup {
  id: AdminNavGroupKey;
  /** The group folds behind its label and opens when the page is inside it. */
  collapsed?: boolean;
  icon?: ItemIconId;
  items: AdminNavItem[];
}

/** An admin page a pack extension adds, with a localized label. `group` is the pack contract; the shell lists all of them in System. */
export interface AdminNavExtraItem {
  href: string;
  label: string;
  group: 'competitions' | 'community' | 'system';
  siteAdminOnly?: boolean;
  superadminOnly?: boolean;
}

/** One rendered item: a built-in one (translated by key) or an extension's (label as given). */
export type VisibleAdminNavItem =
  | AdminNavItem
  | (Omit<AdminNavItem, 'labelKey'> & { labelKey?: undefined; label: string });

export interface VisibleAdminNavGroup {
  id: AdminNavGroupKey;
  collapsed?: boolean;
  icon?: ItemIconId;
  items: VisibleAdminNavItem[];
}

/** Where the "New competition" button of the shell leads. */
export const ADMIN_NEW_COMPETITION_HREF = '/admin/leagues/new';

export const ADMIN_NAV: readonly AdminNavGroup[] = [
  {
    id: 'run',
    items: [
      { href: '/admin', labelKey: 'overview', icon: 'town-map' },
      { href: '/admin/leagues', labelKey: 'competitions', icon: 'poke-ball' },
      { href: '/admin/leagues', labelKey: 'leagues', sub: true },
      { href: '/admin/tournaments', labelKey: 'tournaments', sub: true },
      { href: '/admin/leagues/archived', labelKey: 'archivedLeagues', sub: true },
      { href: '/admin/tournaments/archived', labelKey: 'archivedTournaments', sub: true },
      { href: '/admin/leagues/trash', labelKey: 'leagueTrash', superadminOnly: true, sub: true },
      { href: '/admin/matches', labelKey: 'matches', icon: 'vs-seeker' },
      { href: '/admin/players', labelKey: 'players', icon: 'lucky-egg', siteAdminOnly: true },
    ],
  },
  {
    id: 'library',
    items: [
      { href: '/admin/formats', labelKey: 'formats', icon: 'up-grade' },
      { href: '/admin/rulesets', labelKey: 'rulesets', icon: 'ability-shield' },
    ],
  },
  {
    id: 'community',
    items: [
      { href: '/admin/achievements', labelKey: 'achievements', icon: 'gold-bottle-cap', siteAdminOnly: true },
      { href: '/admin/wiki', labelKey: 'wiki', icon: 'weakness-policy', siteAdminOnly: true },
      { href: '/admin/social', labelKey: 'social', icon: 'poke-flute', siteAdminOnly: true },
    ],
  },
  {
    id: 'system',
    collapsed: true,
    icon: 'rocky-helmet',
    items: [
      { href: '/admin/data', labelKey: 'data', siteAdminOnly: true },
      { href: '/admin/meta-data', labelKey: 'metaData', siteAdminOnly: true },
      { href: '/admin/audit', labelKey: 'audit', siteAdminOnly: true },
      { href: '/admin/test-players', labelKey: 'testPlayers', siteAdminOnly: true },
      { href: '/admin/assistant', labelKey: 'assistant', assistant: true },
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
 * Filter the IA down to what this viewer may open. Extension items join the end of System under the same role rules
 * (the extension's own routes still guard themselves).
 */
export function visibleAdminNav(
  roles: AdminRoles,
  extraItems: readonly AdminNavExtraItem[] = [],
): VisibleAdminNavGroup[] {
  return ADMIN_NAV.map((group) => ({
    id: group.id,
    collapsed: group.collapsed,
    icon: group.icon,
    items: [
      ...group.items.filter((item) => mayOpen(item, roles)),
      ...(group.id === 'system' ? extraItems : [])
        .filter((item) => mayOpen(item, roles))
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

/** A primary item with the views listed under it. */
export interface AdminNavSection {
  item: VisibleAdminNavItem;
  subs: VisibleAdminNavItem[];
}

/** A group's items as sections: every primary item with the sub-items that follow it. */
export function adminNavSections(items: readonly VisibleAdminNavItem[]): AdminNavSection[] {
  const sections: AdminNavSection[] = [];
  for (const item of items) {
    const last = sections.at(-1);
    if (item.sub && last) last.subs.push(item);
    else sections.push({ item, subs: [] });
  }
  return sections;
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

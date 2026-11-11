import type { ItemIconId } from '@/lib/pkmn/item-icons';
import type { navMessages } from '@/i18n/messages/nav';

/** A key of `navMessages.links`; the label is translated where the link renders. */
export type NavLabelKey = keyof typeof navMessages.en.links;

export interface SiteNavLink {
  href: string;
  labelKey: NavLabelKey;
  /** The approved item icon (renders/design-direction/item-icon-map.png). */
  icon: ItemIconId;
  /** Other path roots that light this link. */
  also?: readonly string[];
}

const HOME: SiteNavLink = { href: '/dashboard', labelKey: 'home', icon: 'exp-share' };
const LEAGUES: SiteNavLink = { href: '/leagues', labelKey: 'leagues', icon: 'poke-ball' };
const TOURNAMENTS: SiteNavLink = { href: '/tournaments', labelKey: 'tournaments', icon: 'kings-rock' };
const TEAMS: SiteNavLink = { href: '/teambuilder', labelKey: 'teams', icon: 'choice-scarf', also: ['/teams'] };
const INSIGHTS: SiteNavLink = { href: '/insights', labelKey: 'insights', icon: 'scope-lens' };
const WIKI: SiteNavLink = { href: '/wiki', labelKey: 'wiki', icon: 'weakness-policy', also: ['/pokemon'] };
const REPLAYS: SiteNavLink = { href: '/replays', labelKey: 'replays', icon: 'dubious-disc' };
const PLAYERS: SiteNavLink = { href: '/players', labelKey: 'players', icon: 'lucky-egg' };

/** The desktop link row (plan §3.1): a player gets Home first and Teams. */
export function primaryNavLinks(signedIn: boolean): readonly SiteNavLink[] {
  return signedIn ? [HOME, LEAGUES, TOURNAMENTS, TEAMS, INSIGHTS, WIKI] : [LEAGUES, TOURNAMENTS, INSIGHTS, WIKI];
}

/** Under More, ahead of the pack's extension links (History, when the pack provides it). */
export const MORE_NAV_LINKS: readonly SiteNavLink[] = [REPLAYS, PLAYERS];

/** The four tabs of the phone bottom bar; More is its fifth. */
export const BOTTOM_BAR_LINKS: readonly SiteNavLink[] = [HOME, LEAGUES, TEAMS, WIKI];

/** The bottom bar's More sheet, ahead of the extension links. */
export const BOTTOM_SHEET_LINKS: readonly SiteNavLink[] = [TOURNAMENTS, INSIGHTS, REPLAYS, PLAYERS];

/** Every built-in destination, for the search dialog's page list. */
export const ALL_NAV_LINKS: readonly SiteNavLink[] = [HOME, LEAGUES, TOURNAMENTS, TEAMS, INSIGHTS, WIKI, REPLAYS, PLAYERS];

const under = (pathname: string, root: string) => pathname === root || pathname.startsWith(`${root}/`);

export function isNavPathActive(pathname: string | null, href: string, also: readonly string[] = []): boolean {
  if (!pathname) return false;
  return [href, ...also].some((root) => under(pathname, root));
}

/** The pack's History page gets its approved icon; any other extension page the map. */
export function extensionLinkIcon(href: string): ItemIconId {
  return under(href, '/history') ? 'old-amber' : 'town-map';
}

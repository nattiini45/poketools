import type shellEn from '@/i18n/messages/shell/en';
import type { AdminNavItemKey } from './adminNav';

export type AdminCrumbKey = keyof typeof shellEn.admin.crumbs;

/**
 * One step of the admin breadcrumb. `nav` and `crumb` are keys of `shell.admin.items` / `shell.admin.crumbs`;
 * `label` is a ready label (a pack extension's page). `href` links the step unless it is the last one. `named` steps
 * stand for one league, format or match: the page can give them its name through `AdminCrumbName`, keyed by `href`.
 */
export type AdminCrumb = { href: string; named?: boolean } & (
  | { nav: AdminNavItemKey; crumb?: undefined; label?: undefined }
  | { crumb: AdminCrumbKey; nav?: undefined; label?: undefined }
  | { label: string; nav?: undefined; crumb?: undefined }
);

const nav = (key: AdminNavItemKey, href: string): AdminCrumb => ({ nav: key, href });
const step = (key: AdminCrumbKey, href: string): AdminCrumb => ({ crumb: key, href });
const named = (key: AdminCrumbKey, href: string): AdminCrumb => ({ crumb: key, href, named: true });

const COMPETITIONS = nav('competitions', '/admin/leagues');
const TOURNAMENTS = nav('tournaments', '/admin/tournaments');
const MATCHES = nav('matches', '/admin/matches');
const FORMATS = nav('formats', '/admin/formats');
const RULESETS = nav('rulesets', '/admin/rulesets');

/** Every admin page below a sidebar item: its path pattern (`*` is one segment) and the trail that leads to it. */
const TRAILS: readonly [pattern: string, trail: (path: string, at: (depth: number) => string) => AdminCrumb[]][] = [
  ['leagues/archived', (path) => [COMPETITIONS, nav('archivedLeagues', path)]],
  ['leagues/trash', (path) => [COMPETITIONS, nav('leagueTrash', path)]],
  ['leagues/new', (path) => [COMPETITIONS, step('newCompetition', path)]],
  ['leagues/*', (path) => [COMPETITIONS, named('league', path)]],
  ['leagues/*/draft', (path, at) => [COMPETITIONS, named('league', at(2)), step('draft', path)]],
  ['leagues/*/draft/audit', (path, at) => [COMPETITIONS, named('league', at(2)), step('draft', at(3)), step('draftAudit', path)]],
  ['leagues/*/phases/*', (path, at) => [COMPETITIONS, named('league', at(2)), named('phase', path)]],
  ['tournaments', () => [COMPETITIONS, TOURNAMENTS]],
  ['tournaments/archived', (path) => [COMPETITIONS, nav('archivedTournaments', path)]],
  ['tournaments/new', (path) => [COMPETITIONS, TOURNAMENTS, step('newTournament', path)]],
  ['tournaments/*/rounds', (path) => [COMPETITIONS, TOURNAMENTS, named('tournament', path)]],
  ['matches/*', (path) => [MATCHES, named('match', path)]],
  ['matches/*/games/*/edit', (path, at) => [MATCHES, named('match', at(2)), step('editGame', path)]],
  ['matches/*/import-replay', (path, at) => [MATCHES, named('match', at(2)), step('importReplay', path)]],
  ['formats/*', (path) => [FORMATS, named('format', path)]],
  ['formats/*/edit', (path, at) => [FORMATS, named('format', at(2)), step('edit', path)]],
  ['formats/example/*', (path) => [FORMATS, named('exampleFormat', path)]],
  ['formats/league/*', (path) => [FORMATS, named('leagueFormat', path)]],
  ['rulesets/new', (path) => [RULESETS, step('newRuleset', path)]],
  ['rulesets/*', (path) => [RULESETS, named('ruleset', path)]],
  ['rulesets/*/edit', (path, at) => [RULESETS, named('ruleset', at(2)), step('edit', path)]],
  ['rulesets/catalog/*', (path) => [RULESETS, named('catalogRuleset', path)]],
  ['assistant/*', (path) => [nav('assistant', '/admin/assistant'), named('conversation', path)]],
];

/** A literal pattern wins over a wildcard one of the same length (`leagues/new` over `leagues/*`). */
function matches(pattern: string, segments: readonly string[]): boolean {
  const parts = pattern.split('/');
  return parts.length === segments.length && parts.every((part, i) => part === '*' || part === segments[i]);
}

/**
 * The breadcrumb of an admin page: the sidebar item it belongs to, then the steps below it. `items` are the sidebar
 * items this viewer sees (extension pages included), so a page the sidebar lists is named exactly as it is there.
 * Empty for a path outside `/admin` or one nothing describes.
 */
export function adminBreadcrumb(
  pathname: string | null,
  items: readonly ({ href: string } & ({ labelKey: AdminNavItemKey } | { labelKey?: undefined; label: string }))[],
): AdminCrumb[] {
  if (pathname === null) return [];
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const segments = path.split('/').filter(Boolean);
  if (segments[0] !== 'admin') return [];
  if (segments.length === 1) return [nav('overview', '/admin')];

  const rest = segments.slice(1);
  const at = (depth: number) => '/' + segments.slice(0, depth + 1).join('/');
  const trail =
    TRAILS.find(([pattern]) => !pattern.includes('*') && matches(pattern, rest)) ?? TRAILS.find(([pattern]) => matches(pattern, rest));
  if (trail) return trail[1](path, at);

  // A page the sidebar lists (a primary item, not the view under it that shares its href).
  const item = items.find((entry) => entry.href === path);
  if (!item) return [];
  return item.labelKey === undefined ? [{ label: item.label, href: path }] : [nav(item.labelKey, path)];
}

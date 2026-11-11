import { describe, expect, it } from 'vitest';
import { adminBreadcrumb, type AdminCrumb } from '../admin-breadcrumb';
import { visibleAdminNav } from '../adminNav';

const ITEMS = visibleAdminNav({ isSiteAdmin: true, isSuperadmin: true, assistantEnabled: true }, [
  { href: '/admin/extra', label: 'Extra records', group: 'system' },
]).flatMap((group) => group.items.filter((item) => !item.sub));

const trail = (path: string | null) => adminBreadcrumb(path, ITEMS);
/** The trail as `label-or-key@href` strings, so one assertion shows the whole path. */
const show = (crumbs: AdminCrumb[]) => crumbs.map((c) => `${c.nav ?? c.crumb ?? c.label}@${c.href}`);

describe('adminBreadcrumb', () => {
  it('is Overview alone at /admin', () => {
    expect(show(trail('/admin'))).toEqual(['overview@/admin']);
  });

  it('names the Competitions item at /admin/leagues', () => {
    expect(show(trail('/admin/leagues'))).toEqual(['competitions@/admin/leagues']);
  });

  it('puts Archived leagues under Competitions', () => {
    expect(show(trail('/admin/leagues/archived'))).toEqual(['competitions@/admin/leagues', 'archivedLeagues@/admin/leagues/archived']);
  });

  it('lets the literal /admin/leagues/new win over the league wildcard', () => {
    const crumbs = trail('/admin/leagues/new');
    expect(show(crumbs)).toEqual(['competitions@/admin/leagues', 'newCompetition@/admin/leagues/new']);
    expect(crumbs.some((c) => c.named)).toBe(false);
  });

  it('gives one league a named step', () => {
    const crumbs = trail('/admin/leagues/abc');
    expect(show(crumbs)).toEqual(['competitions@/admin/leagues', 'league@/admin/leagues/abc']);
    expect(crumbs[1].named).toBe(true);
  });

  it('keeps the league step linking to the league on a phase page', () => {
    const crumbs = trail('/admin/leagues/abc/phases/p1');
    expect(show(crumbs)).toEqual(['competitions@/admin/leagues', 'league@/admin/leagues/abc', 'phase@/admin/leagues/abc/phases/p1']);
    expect(crumbs.map((c) => c.named)).toEqual([undefined, true, true]);
  });

  it('puts a tournament under Competitions and Tournaments', () => {
    expect(show(trail('/admin/tournaments/t1/rounds'))).toEqual([
      'competitions@/admin/leagues',
      'tournaments@/admin/tournaments',
      'tournament@/admin/tournaments/t1/rounds',
    ]);
  });

  it('walks a game edit page back through its match', () => {
    expect(show(trail('/admin/matches/m1/games/g1/edit'))).toEqual([
      'matches@/admin/matches',
      'match@/admin/matches/m1',
      'editGame@/admin/matches/m1/games/g1/edit',
    ]);
  });

  it('walks a format edit page back through its format', () => {
    expect(show(trail('/admin/formats/f1/edit'))).toEqual(['formats@/admin/formats', 'format@/admin/formats/f1', 'edit@/admin/formats/f1/edit']);
  });

  it('names an extension page the way the sidebar does', () => {
    expect(show(trail('/admin/extra'))).toEqual(['Extra records@/admin/extra']);
  });

  it('ignores a trailing slash', () => {
    expect(trail('/admin/leagues/archived/')).toEqual(trail('/admin/leagues/archived'));
    expect(trail('/admin/')).toEqual(trail('/admin'));
  });

  it('is empty for an admin path nothing describes', () => {
    expect(trail('/admin/nothing-here')).toEqual([]);
    expect(trail('/admin/leagues/abc/unknown/deep')).toEqual([]);
  });

  it('is empty outside /admin and without a pathname', () => {
    expect(trail('/dashboard')).toEqual([]);
    expect(trail('/administrator')).toEqual([]);
    expect(trail(null)).toEqual([]);
  });
});

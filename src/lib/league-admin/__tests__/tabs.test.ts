import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LEAGUE_ADMIN_TAB,
  LEAGUE_ADMIN_TABS,
  availableLeagueAdminTabs,
  leagueAdminHref,
  parseLeagueAdminTab,
} from '../tabs';

describe('availableLeagueAdminTabs (from getFormatCapabilities)', () => {
  it('singles and doubles: overview, participants, phases, format, settings, danger', () => {
    for (const format of ['singles', 'doubles'] as const) {
      expect(availableLeagueAdminTabs(format), format).toEqual([
        'overview',
        'participants',
        'phases',
        'format',
        'settings',
        'danger',
      ]);
    }
  });

  it('classic draft adds draft and rules', () => {
    expect(availableLeagueAdminTabs('draft')).toEqual([
      'overview',
      'participants',
      'draft',
      'phases',
      'rules',
      'format',
      'settings',
      'danger',
    ]);
  });

  it('Evolution Point Buy gets all eight, in display order', () => {
    expect(availableLeagueAdminTabs('evolution_point_buy')).toEqual([...LEAGUE_ADMIN_TABS]);
    expect(LEAGUE_ADMIN_TABS).toHaveLength(8);
  });

  it('the format tab sits between rules and settings and every format has it', () => {
    const order = [...LEAGUE_ADMIN_TABS];
    expect(order.indexOf('format')).toBe(order.indexOf('rules') + 1);
    expect(order.indexOf('settings')).toBe(order.indexOf('format') + 1);
    for (const format of ['singles', 'doubles', 'draft', 'evolution_point_buy'] as const) {
      expect(availableLeagueAdminTabs(format), format).toContain('format');
    }
  });
});

describe('parseLeagueAdminTab', () => {
  const epb = availableLeagueAdminTabs('evolution_point_buy');
  const singles = availableLeagueAdminTabs('singles');

  it('accepts an available tab', () => {
    for (const tab of epb) expect(parseLeagueAdminTab(tab, epb)).toBe(tab);
  });

  it('falls back to the overview for a missing, repeated, unknown or unavailable tab', () => {
    expect(DEFAULT_LEAGUE_ADMIN_TAB).toBe('overview');
    expect(parseLeagueAdminTab(undefined, epb)).toBe('overview');
    expect(parseLeagueAdminTab(['draft', 'rules'], epb)).toBe('overview');
    expect(parseLeagueAdminTab('nope', epb)).toBe('overview');
    expect(parseLeagueAdminTab('DRAFT', epb)).toBe('overview');
    expect(parseLeagueAdminTab('constructor', epb)).toBe('overview');
    expect(parseLeagueAdminTab('draft', singles)).toBe('overview');
    expect(parseLeagueAdminTab('rules', singles)).toBe('overview');
  });

  it('keeps old ?tab=schedule links working: they open the phases tab', () => {
    expect(parseLeagueAdminTab('schedule', epb)).toBe('phases');
    expect(parseLeagueAdminTab('schedule', singles)).toBe('phases');
    expect(parseLeagueAdminTab('format', singles)).toBe('format');
    expect(parseLeagueAdminTab('phases', singles)).toBe('phases');
    // Aliases never widen the whitelist: an inherited key is not an alias.
    expect(parseLeagueAdminTab('toString', epb)).toBe('overview');
  });
});

describe('leagueAdminHref', () => {
  it('keeps the overview URL bare and sets ?tab= for the others', () => {
    expect(leagueAdminHref('s1', 'overview')).toBe('/admin/leagues/s1');
    expect(leagueAdminHref('s1', 'draft')).toBe('/admin/leagues/s1?tab=draft');
    expect(leagueAdminHref('s1', 'danger')).toBe('/admin/leagues/s1?tab=danger');
    expect(leagueAdminHref('s1', 'phases')).toBe('/admin/leagues/s1?tab=phases');
    expect(leagueAdminHref('s1', 'format')).toBe('/admin/leagues/s1?tab=format');
  });
});

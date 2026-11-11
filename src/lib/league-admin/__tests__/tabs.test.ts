import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LEAGUE_ADMIN_TAB,
  LEAGUE_ADMIN_DANGER_SECTION,
  LEAGUE_ADMIN_RULES_SECTION,
  LEAGUE_ADMIN_TABS,
  LEAGUE_ADMIN_TAB_ALIASES,
  availableLeagueAdminTabs,
  leagueAdminAliasSection,
  leagueAdminHref,
  leagueHasRulesSection,
  parseLeagueAdminTab,
} from '../tabs';

describe('availableLeagueAdminTabs', () => {
  it('there are seven tabs, in display order', () => {
    expect(LEAGUE_ADMIN_TABS).toEqual(['overview', 'participants', 'phases', 'format', 'draft', 'live', 'settings']);
  });

  it('singles and doubles: overview, participants, phases, format, settings', () => {
    for (const format of ['singles', 'doubles'] as const) {
      expect(availableLeagueAdminTabs(format), format).toEqual(['overview', 'participants', 'phases', 'format', 'settings']);
    }
  });

  it('classic draft and Evolution Point Buy add draft', () => {
    for (const format of ['draft', 'evolution_point_buy'] as const) {
      expect(availableLeagueAdminTabs(format), format).toEqual(['overview', 'participants', 'phases', 'format', 'draft', 'settings']);
    }
  });

  it('a custom league gets the singles-like set plus live: no draft', () => {
    expect(availableLeagueAdminTabs('custom')).toEqual(['overview', 'participants', 'phases', 'format', 'live', 'settings']);
  });

  it('the live tab exists for custom leagues only', () => {
    for (const format of ['singles', 'doubles', 'draft', 'evolution_point_buy'] as const) {
      expect(availableLeagueAdminTabs(format), format).not.toContain('live');
    }
  });

  it('every format has the format and the settings tab, and settings is last', () => {
    for (const format of ['singles', 'doubles', 'draft', 'evolution_point_buy', 'custom'] as const) {
      const tabs = availableLeagueAdminTabs(format);
      expect(tabs, format).toContain('format');
      expect(tabs.at(-1), format).toBe('settings');
    }
  });

  it('the rules editors are part of the format tab for classic draft and Evolution Point Buy only', () => {
    expect(leagueHasRulesSection('draft')).toBe(true);
    expect(leagueHasRulesSection('evolution_point_buy')).toBe(true);
    for (const format of ['singles', 'doubles', 'custom'] as const) expect(leagueHasRulesSection(format), format).toBe(false);
  });
});

describe('parseLeagueAdminTab', () => {
  const epb = availableLeagueAdminTabs('evolution_point_buy');
  const singles = availableLeagueAdminTabs('singles');

  it('accepts an available tab', () => {
    for (const tab of epb) expect(parseLeagueAdminTab(tab, epb)).toBe(tab);
  });

  it('opens the live tab for a custom league and falls back to the overview for any other', () => {
    expect(parseLeagueAdminTab('live', availableLeagueAdminTabs('custom'))).toBe('live');
    expect(parseLeagueAdminTab('live', singles)).toBe('overview');
    expect(parseLeagueAdminTab('live', epb)).toBe('overview');
  });

  it('falls back to the overview for a missing, repeated, unknown or unavailable tab', () => {
    expect(DEFAULT_LEAGUE_ADMIN_TAB).toBe('overview');
    expect(parseLeagueAdminTab(undefined, epb)).toBe('overview');
    expect(parseLeagueAdminTab(['draft', 'format'], epb)).toBe('overview');
    expect(parseLeagueAdminTab('nope', epb)).toBe('overview');
    expect(parseLeagueAdminTab('DRAFT', epb)).toBe('overview');
    expect(parseLeagueAdminTab('constructor', epb)).toBe('overview');
    expect(parseLeagueAdminTab('draft', singles)).toBe('overview');
  });

  it('keeps old ?tab=schedule links working: they open the phases tab', () => {
    expect(parseLeagueAdminTab('schedule', epb)).toBe('phases');
    expect(parseLeagueAdminTab('schedule', singles)).toBe('phases');
    expect(parseLeagueAdminTab('format', singles)).toBe('format');
    expect(parseLeagueAdminTab('phases', singles)).toBe('phases');
    // Aliases never widen the whitelist: an inherited key is not an alias.
    expect(parseLeagueAdminTab('toString', epb)).toBe('overview');
  });

  it('keeps old ?tab=rules links working: they open Format and rules, for every format', () => {
    expect(LEAGUE_ADMIN_TAB_ALIASES.rules).toBe('format');
    expect(parseLeagueAdminTab('rules', epb)).toBe('format');
    expect(parseLeagueAdminTab('rules', availableLeagueAdminTabs('draft'))).toBe('format');
    // A format without rules editors has no such section; the link still lands on the tab that holds the rules text.
    expect(parseLeagueAdminTab('rules', singles)).toBe('format');
  });

  it('keeps old ?tab=danger links working: they open Settings', () => {
    expect(LEAGUE_ADMIN_TAB_ALIASES.danger).toBe('settings');
    for (const format of ['singles', 'doubles', 'draft', 'evolution_point_buy', 'custom'] as const) {
      expect(parseLeagueAdminTab('danger', availableLeagueAdminTabs(format)), format).toBe('settings');
    }
  });

  it('every alias points at a tab that exists', () => {
    for (const [alias, tab] of Object.entries(LEAGUE_ADMIN_TAB_ALIASES)) {
      expect(LEAGUE_ADMIN_TABS, alias).toContain(tab);
      expect(LEAGUE_ADMIN_TABS as readonly string[], alias).not.toContain(alias);
    }
  });
});

describe('leagueAdminAliasSection', () => {
  it('the former Rules and Danger zone tabs open their tab at their section', () => {
    expect(leagueAdminAliasSection('rules')).toBe(LEAGUE_ADMIN_RULES_SECTION);
    expect(leagueAdminAliasSection('danger')).toBe(LEAGUE_ADMIN_DANGER_SECTION);
  });

  it('nothing else names a section', () => {
    for (const raw of [undefined, 'schedule', 'settings', 'format', 'overview', 'toString', ['danger'], '']) {
      expect(leagueAdminAliasSection(raw), String(raw)).toBeNull();
    }
  });
});

describe('leagueAdminHref', () => {
  it('keeps the overview URL bare and sets ?tab= for the others', () => {
    expect(leagueAdminHref('s1', 'overview')).toBe('/admin/leagues/s1');
    expect(leagueAdminHref('s1', 'draft')).toBe('/admin/leagues/s1?tab=draft');
    expect(leagueAdminHref('s1', 'settings')).toBe('/admin/leagues/s1?tab=settings');
    expect(leagueAdminHref('s1', 'phases')).toBe('/admin/leagues/s1?tab=phases');
    expect(leagueAdminHref('s1', 'format')).toBe('/admin/leagues/s1?tab=format');
    expect(leagueAdminHref('s1', 'live')).toBe('/admin/leagues/s1?tab=live');
  });

  it('adds a section as the fragment', () => {
    expect(leagueAdminHref('s1', 'settings', LEAGUE_ADMIN_DANGER_SECTION)).toBe('/admin/leagues/s1?tab=settings#danger-zone');
    expect(leagueAdminHref('s1', 'format', LEAGUE_ADMIN_RULES_SECTION)).toBe('/admin/leagues/s1?tab=format#league-rules');
    expect(leagueAdminHref('s1', 'overview', 'x')).toBe('/admin/leagues/s1#x');
  });
});

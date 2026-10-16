/**
 * League hub tabs: which tabs a league shows, how a `?tab=` value is
 * whitelisted, and how a tab link keeps every other query parameter.
 *
 * Pure module: no reads, no mocks.
 */
import { describe, expect, it } from 'vitest';
import {
  availableLeagueHubTabs,
  DEFAULT_LEAGUE_HUB_TAB,
  LEAGUE_HUB_TAB_PARAM,
  LEAGUE_HUB_TABS,
  leagueHubHref,
  parseLeagueHubTab,
  stageKind,
  type LeagueHubTab,
} from '../tabs';
import type { BracketType } from '@/types/tournament';

const BRACKET_TYPES: readonly BracketType[] = ['round_robin', 'swiss', 'single_elim', 'double_elim'];

function stages(...types: BracketType[]): { bracket_type: BracketType }[] {
  return types.map((bracket_type) => ({ bracket_type }));
}

/** Asserts a tab list is a subsequence of LEAGUE_HUB_TABS (display order kept). */
function expectDisplayOrder(tabs: readonly LeagueHubTab[]): void {
  const indices = tabs.map((tab) => LEAGUE_HUB_TABS.indexOf(tab));
  expect(indices.every((index) => index >= 0)).toBe(true);
  expect([...indices].sort((a, b) => a - b)).toEqual(indices);
}

describe('league hub tab constants', () => {
  it('selects the tab through ?tab=', () => {
    expect(LEAGUE_HUB_TAB_PARAM).toBe('tab');
  });

  it('lists every tab once, standings first', () => {
    expect(LEAGUE_HUB_TABS).toEqual([
      'standings',
      'matches',
      'groups',
      'playoffs',
      'phases',
      'insights',
      'rules',
      'reports',
    ]);
    expect(new Set(LEAGUE_HUB_TABS).size).toBe(LEAGUE_HUB_TABS.length);
  });

  it('opens a bare league URL on standings', () => {
    expect(DEFAULT_LEAGUE_HUB_TAB).toBe('standings');
    expect(LEAGUE_HUB_TABS[0]).toBe(DEFAULT_LEAGUE_HUB_TAB);
  });
});

describe('stageKind', () => {
  it('reads round robin and Swiss as tables', () => {
    expect(stageKind('round_robin')).toBe('table');
    expect(stageKind('swiss')).toBe('table');
  });

  it('reads single and double elimination as brackets', () => {
    expect(stageKind('single_elim')).toBe('bracket');
    expect(stageKind('double_elim')).toBe('bracket');
  });

  it('classifies every bracket type', () => {
    for (const type of BRACKET_TYPES) expect(['table', 'bracket']).toContain(stageKind(type));
  });
});

describe('availableLeagueHubTabs', () => {
  const ALWAYS: LeagueHubTab[] = ['standings', 'matches', 'phases', 'insights', 'rules'];

  it('round robin only: group stage, no playoffs', () => {
    expect(availableLeagueHubTabs(stages('round_robin'), { reports: false })).toEqual([
      'standings',
      'matches',
      'groups',
      'phases',
      'insights',
      'rules',
    ]);
  });

  it('Swiss only: the group tab is there (a Swiss phase is a table), no playoffs', () => {
    expect(availableLeagueHubTabs(stages('swiss'), { reports: false })).toEqual([
      'standings',
      'matches',
      'groups',
      'phases',
      'insights',
      'rules',
    ]);
  });

  it('elimination only: playoffs, no group stage', () => {
    for (const type of ['single_elim', 'double_elim'] as const) {
      expect(availableLeagueHubTabs(stages(type), { reports: false })).toEqual([
        'standings',
        'matches',
        'playoffs',
        'phases',
        'insights',
        'rules',
      ]);
    }
  });

  it('mixed league: both phase tabs, in display order whatever the stage order', () => {
    const expected: LeagueHubTab[] = [
      'standings',
      'matches',
      'groups',
      'playoffs',
      'phases',
      'insights',
      'rules',
    ];
    expect(availableLeagueHubTabs(stages('round_robin', 'single_elim'), { reports: false })).toEqual(
      expected,
    );
    expect(availableLeagueHubTabs(stages('double_elim', 'swiss'), { reports: false })).toEqual(expected);
    expect(
      availableLeagueHubTabs(stages('single_elim', 'round_robin', 'swiss', 'double_elim'), {
        reports: false,
      }),
    ).toEqual(expected);
  });

  it('no stages: only the tabs with an empty state', () => {
    expect(availableLeagueHubTabs([], { reports: false })).toEqual(ALWAYS);
  });

  it('reports flag on: the reports tab comes last', () => {
    expect(availableLeagueHubTabs([], { reports: true })).toEqual([...ALWAYS, 'reports']);
    expect(availableLeagueHubTabs(stages('round_robin', 'double_elim'), { reports: true })).toEqual([
      'standings',
      'matches',
      'groups',
      'playoffs',
      'phases',
      'insights',
      'rules',
      'reports',
    ]);
  });

  it('reports flag off: never a reports tab', () => {
    for (const type of BRACKET_TYPES) {
      expect(availableLeagueHubTabs(stages(type), { reports: false })).not.toContain('reports');
    }
  });

  it('always includes the default tab and follows LEAGUE_HUB_TABS order', () => {
    const combos: BracketType[][] = [
      [],
      ['round_robin'],
      ['swiss'],
      ['single_elim'],
      ['double_elim'],
      ['double_elim', 'round_robin'],
      ['swiss', 'single_elim', 'round_robin'],
    ];
    for (const combo of combos) {
      for (const reports of [false, true]) {
        const tabs = availableLeagueHubTabs(stages(...combo), { reports });
        expect(tabs).toContain(DEFAULT_LEAGUE_HUB_TAB);
        for (const tab of ALWAYS) expect(tabs).toContain(tab);
        expectDisplayOrder(tabs);
      }
    }
  });
});

describe('parseLeagueHubTab', () => {
  const roundRobinOnly = availableLeagueHubTabs(stages('round_robin'), { reports: false });
  const everything = availableLeagueHubTabs(stages('round_robin', 'single_elim'), { reports: true });

  it('falls back to the default tab when the param is missing', () => {
    expect(parseLeagueHubTab(undefined, everything)).toBe(DEFAULT_LEAGUE_HUB_TAB);
  });

  it('falls back to the default tab when the param is repeated', () => {
    expect(parseLeagueHubTab(['matches', 'groups'], everything)).toBe(DEFAULT_LEAGUE_HUB_TAB);
    expect(parseLeagueHubTab(['matches'], everything)).toBe(DEFAULT_LEAGUE_HUB_TAB);
    expect(parseLeagueHubTab([], everything)).toBe(DEFAULT_LEAGUE_HUB_TAB);
  });

  it('falls back to the default tab for unknown values', () => {
    for (const raw of ['', 'bogus', 'Matches', 'MATCHES', ' matches', 'matches ', 'constructor', '__proto__']) {
      expect(parseLeagueHubTab(raw, everything)).toBe(DEFAULT_LEAGUE_HUB_TAB);
    }
  });

  it('falls back to the default tab for a tab this league does not have', () => {
    expect(parseLeagueHubTab('playoffs', roundRobinOnly)).toBe(DEFAULT_LEAGUE_HUB_TAB);
    expect(parseLeagueHubTab('reports', roundRobinOnly)).toBe(DEFAULT_LEAGUE_HUB_TAB);
    const elimOnly = availableLeagueHubTabs(stages('single_elim'), { reports: false });
    expect(parseLeagueHubTab('groups', elimOnly)).toBe(DEFAULT_LEAGUE_HUB_TAB);
  });

  it('returns a valid, available tab as is', () => {
    for (const tab of everything) expect(parseLeagueHubTab(tab, everything)).toBe(tab);
    expect(parseLeagueHubTab('groups', roundRobinOnly)).toBe('groups');
    expect(parseLeagueHubTab('standings', roundRobinOnly)).toBe('standings');
  });
});

describe('leagueHubHref', () => {
  const LEAGUE = '3f1c2a7e-0000-4000-8000-000000000001';

  it('drops the param for the default tab: the bare league URL', () => {
    expect(leagueHubHref(LEAGUE, {}, 'standings')).toBe(`/leagues/${LEAGUE}`);
  });

  it('adds ?tab= for any other tab', () => {
    expect(leagueHubHref(LEAGUE, {}, 'matches')).toBe(`/leagues/${LEAGUE}?tab=matches`);
    expect(leagueHubHref(LEAGUE, {}, 'reports')).toBe(`/leagues/${LEAGUE}?tab=reports`);
  });

  it('keeps every other param, ?world= included, in order with the tab last', () => {
    expect(leagueHubHref(LEAGUE, { world: 'sakura', focus: 'board' }, 'groups')).toBe(
      `/leagues/${LEAGUE}?world=sakura&focus=board&tab=groups`,
    );
  });

  it('keeps other params on the default tab, without a tab param', () => {
    expect(leagueHubHref(LEAGUE, { world: 'mountain' }, 'standings')).toBe(`/leagues/${LEAGUE}?world=mountain`);
  });

  it('keeps repeated (array) params, every value', () => {
    const href = leagueHubHref(LEAGUE, { world: 'clouds', focus: ['a', 'b'] }, 'playoffs');
    expect(href).toBe(`/leagues/${LEAGUE}?world=clouds&focus=a&focus=b&tab=playoffs`);
    const params = new URLSearchParams(href.split('?')[1]);
    expect(params.getAll('focus')).toEqual(['a', 'b']);
  });

  it('replaces an existing tab param instead of repeating it', () => {
    const href = leagueHubHref(LEAGUE, { tab: 'matches', world: 'sakura' }, 'insights');
    expect(href).toBe(`/leagues/${LEAGUE}?world=sakura&tab=insights`);
    expect(new URLSearchParams(href.split('?')[1]).getAll('tab')).toEqual(['insights']);
  });

  it('drops an existing tab param (single or repeated) on the default tab', () => {
    expect(leagueHubHref(LEAGUE, { tab: 'matches' }, 'standings')).toBe(`/leagues/${LEAGUE}`);
    expect(leagueHubHref(LEAGUE, { tab: ['matches', 'groups'], world: 'plaza' }, 'standings')).toBe(
      `/leagues/${LEAGUE}?world=plaza`,
    );
  });

  it('skips undefined values', () => {
    expect(leagueHubHref(LEAGUE, { world: undefined }, 'standings')).toBe(`/leagues/${LEAGUE}`);
    expect(leagueHubHref(LEAGUE, { world: undefined, focus: 'x' }, 'rules')).toBe(
      `/leagues/${LEAGUE}?focus=x&tab=rules`,
    );
  });

  it('never ends in a bare "?"', () => {
    const queries: Record<string, string | string[] | undefined>[] = [
      {},
      { world: undefined },
      { tab: 'groups' },
      { tab: ['a', 'b'] },
    ];
    for (const query of queries) {
      const href = leagueHubHref(LEAGUE, query, 'standings');
      expect(href.endsWith('?')).toBe(false);
      expect(href).not.toContain('?');
    }
  });

  it('encodes keys and values', () => {
    const href = leagueHubHref(LEAGUE, { 'q&x': 'a b&c=d', note: 'ü/#?' }, 'matches');
    expect(href).not.toContain(' ');
    expect(href).not.toContain('#');
    const [path, search] = href.split('?');
    expect(path).toBe(`/leagues/${LEAGUE}`);
    const params = new URLSearchParams(search);
    expect(params.get('q&x')).toBe('a b&c=d');
    expect(params.get('note')).toBe('ü/#?');
    expect(params.get('tab')).toBe('matches');
    expect([...params.keys()]).toEqual(['q&x', 'note', 'tab']);
  });

  it('keeps an empty-string param', () => {
    const href = leagueHubHref(LEAGUE, { debug: '' }, 'phases');
    expect(href).toBe(`/leagues/${LEAGUE}?debug=&tab=phases`);
  });

  it('does not mutate the query it is given', () => {
    const query = { tab: 'groups', world: 'sakura', focus: ['a', 'b'] };
    const snapshot = structuredClone(query);
    leagueHubHref(LEAGUE, query, 'matches');
    expect(query).toEqual(snapshot);
  });

  it('round-trips through parseLeagueHubTab', () => {
    const available = availableLeagueHubTabs(stages('round_robin', 'single_elim'), { reports: true });
    for (const tab of available) {
      const href = leagueHubHref(LEAGUE, { world: 'sakura' }, tab);
      const search = new URLSearchParams(href.split('?')[1] ?? '');
      const raw = search.get(LEAGUE_HUB_TAB_PARAM) ?? undefined;
      expect(parseLeagueHubTab(raw, available)).toBe(tab);
    }
  });
});

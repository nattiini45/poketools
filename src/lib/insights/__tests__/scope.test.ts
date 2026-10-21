import { describe, it, expect } from 'vitest';
import {
  parseScopeFromSearchParams,
  scopeToQueryString,
  scopeAggregateKey,
  parseInsightsTab,
  scopeLabel,
  insightsLeagueOptions,
} from '../scope';

describe('insights scope', () => {
  it('parses global scope by default', () => {
    expect(parseScopeFromSearchParams({})).toEqual({ type: 'global' });
  });

  it('parses league scope with id', () => {
    expect(parseScopeFromSearchParams({ scope: 'league', id: 'abc' })).toEqual({
      type: 'league',
      id: 'abc',
    });
  });

  it('parses tournament scope with id', () => {
    expect(parseScopeFromSearchParams({ scope: 'tournament', id: 't1' })).toEqual({
      type: 'tournament',
      id: 't1',
    });
  });

  it('maps scope to aggregate keys', () => {
    expect(scopeAggregateKey({ type: 'global' })).toEqual({
      scopeType: 'all_time',
      scopeId: null,
    });
    expect(scopeAggregateKey({ type: 'league', id: 'x' })).toEqual({
      scopeType: 'league',
      scopeId: 'x',
    });
  });

  it('serializes scope to query string', () => {
    expect(scopeToQueryString({ type: 'tournament', id: 't1' })).toBe(
      'scope=tournament&id=t1',
    );
  });

  it('parses insights tab', () => {
    expect(parseInsightsTab('ratings')).toBe('ratings');
    expect(parseInsightsTab(undefined)).toBe('usage');
  });

  it('labels global scope as all-time site data', () => {
    expect(scopeLabel({ type: 'global' })).toBe('Global (all time)');
  });

  it('labels every scope in German', () => {
    expect(scopeLabel({ type: 'global' }, 'de')).toBe('Global (gesamte Zeit)');
    expect(scopeLabel({ type: 'league', id: 'x' }, 'de')).toBe('Liga');
    expect(scopeLabel({ type: 'tournament', id: 't' }, 'de')).toBe('Turnier');
    expect(scopeLabel({ type: 'league', id: 'x' })).toBe('League');
  });
});

describe('insightsLeagueOptions', () => {
  it('offers every league but the test leagues, ids and names only', () => {
    expect(
      insightsLeagueOptions([
        { id: 'l1', name: 'Season 1', is_test_season: false },
        { id: 'l2', name: 'Sandbox', is_test_season: true },
        { id: 'l3', name: 'Season 2', is_test_season: null },
      ]),
    ).toEqual([
      { id: 'l1', name: 'Season 1' },
      { id: 'l3', name: 'Season 2' },
    ]);
  });
});

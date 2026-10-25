import { describe, expect, it } from 'vitest';
import { buildLeagueSettingsPatch, type LeagueSettingsValues } from '../settings-patch';

const INITIAL: LeagueSettingsValues = {
  name: 'Spring League',
  formatType: 'singles',
  rulesetId: 'rs-1',
  startDate: '2026-03-01',
  endDate: '2026-06-01',
};

describe('buildLeagueSettingsPatch', () => {
  it('is empty while nothing changed', () => {
    expect(buildLeagueSettingsPatch(INITIAL, { ...INITIAL }, null)).toEqual({});
  });

  it('sends only the changed fields', () => {
    expect(buildLeagueSettingsPatch(INITIAL, { ...INITIAL, endDate: '2026-07-01' }, null)).toEqual({
      end_date: '2026-07-01',
    });
    expect(buildLeagueSettingsPatch(INITIAL, { ...INITIAL, rulesetId: 'rs-2', name: 'Autumn League' }, null)).toEqual({
      name: 'Autumn League',
      ruleset_id: 'rs-2',
    });
  });

  it('trims the name and ignores a change that is only whitespace', () => {
    expect(buildLeagueSettingsPatch(INITIAL, { ...INITIAL, name: '  Autumn League  ' }, null)).toEqual({
      name: 'Autumn League',
    });
    expect(buildLeagueSettingsPatch(INITIAL, { ...INITIAL, name: ' Spring League ' }, null)).toEqual({});
  });

  it('maps a cleared ruleset and cleared dates to null', () => {
    expect(
      buildLeagueSettingsPatch(INITIAL, { ...INITIAL, rulesetId: '', startDate: '', endDate: '' }, null),
    ).toEqual({ ruleset_id: null, start_date: null, end_date: null });
  });

  it('sends a league type change only while the league type is not locked', () => {
    const doubles = { ...INITIAL, formatType: 'doubles' as const };
    expect(buildLeagueSettingsPatch(INITIAL, doubles, null)).toEqual({ format_type: 'doubles' });
    expect(buildLeagueSettingsPatch(INITIAL, doubles, 'started')).toEqual({});
    expect(buildLeagueSettingsPatch(INITIAL, doubles, 'point_buy')).toEqual({});
  });

  it('keeps the other changes when the locked league type was touched', () => {
    expect(
      buildLeagueSettingsPatch(INITIAL, { ...INITIAL, formatType: 'draft', name: 'Renamed' }, 'started'),
    ).toEqual({ name: 'Renamed' });
  });

  describe('point-buy leagues', () => {
    const POINT_BUY: LeagueSettingsValues = { ...INITIAL, formatType: 'evolution_point_buy', rulesetId: 'battle-rs' };

    it('never sends the ruleset or the league type, whatever the controls hold', () => {
      expect(
        buildLeagueSettingsPatch(POINT_BUY, { ...POINT_BUY, rulesetId: '', formatType: 'singles' }, 'point_buy'),
      ).toEqual({});
      expect(buildLeagueSettingsPatch(POINT_BUY, { ...POINT_BUY, rulesetId: 'other' }, null)).toEqual({});
      expect(buildLeagueSettingsPatch(POINT_BUY, { ...POINT_BUY, formatType: 'draft' }, null)).toEqual({});
    });

    it('never moves a classic league across the boundary', () => {
      expect(buildLeagueSettingsPatch(INITIAL, { ...INITIAL, formatType: 'evolution_point_buy' }, null)).toEqual({});
    });

    it('still sends name and dates', () => {
      expect(
        buildLeagueSettingsPatch(POINT_BUY, { ...POINT_BUY, name: 'Renamed', startDate: '' }, 'point_buy'),
      ).toEqual({ name: 'Renamed', start_date: null });
    });
  });
});

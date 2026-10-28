import { describe, expect, it } from 'vitest';
import { draftPushTag, draftRoomUrl, formatPushDuration, redraftPayload, turnPayload } from '../payload';

const base = { leagueName: 'EvoLiga S1', seasonId: 'season-1', poolId: 'pool-1', timerSeconds: 120 };

describe('formatPushDuration', () => {
  it.each([
    [90, 'en', '1 min'],
    [30, 'en', '1 min'],
    [120, 'en', '2 min'],
    [3600, 'en', '1 h'],
    [8 * 3600, 'en', '8 h'],
    [5400, 'en', '1 h 30 min'],
    [86_400, 'en', '1 d'],
    [90_000, 'en', '1 d 1 h'],
    [5400, 'de', '1 h 30 min'],
    [8 * 3600, 'de', '8 h'],
    [172_800, 'de', '2 d'],
  ] as const)('%s s in %s is %s', (seconds, locale, text) => {
    expect(formatPushDuration(seconds, locale)).toBe(text);
  });

  it('never goes negative or NaN', () => {
    expect(formatPushDuration(-5, 'en')).toBe('1 min');
    expect(formatPushDuration(Number.NaN, 'en')).toBe('1 min');
  });
});

describe('turnPayload', () => {
  it('builds the turn alert in English with the pick time', () => {
    expect(turnPayload({ ...base, kind: 'turn_started' }, 'en')).toEqual({
      kind: 'turn_started',
      title: 'Your pick in EvoLiga S1',
      body: 'You are on the clock – 2 min left.',
      url: '/leagues/season-1/draft-room?pool=pool-1',
      tag: 'draft-pool-1',
    });
  });

  it('builds the same alert in German', () => {
    expect(turnPayload({ ...base, kind: 'turn_started', timerSeconds: 12 * 3600 }, 'de')).toMatchObject({
      title: 'Dein Pick in EvoLiga S1',
      body: 'Du bist am Zug – noch 12 h.',
    });
  });

  it('a reminder names the threshold, not the slot length', () => {
    expect(turnPayload({ ...base, kind: 'turn_reminder', threshold: '1h', timerSeconds: 12 * 3600 }, 'en')).toMatchObject({
      kind: 'turn_reminder',
      body: '1 h left for your pick.',
    });
    expect(turnPayload({ ...base, kind: 'turn_reminder', threshold: '8h' }, 'de').body).toBe('Noch 8 h für deinen Pick.');
  });

  it('falls back to a title without the league when it has no name', () => {
    expect(turnPayload({ ...base, kind: 'turn_started', leagueName: '  ' }, 'en').title).toBe('Your pick');
    expect(turnPayload({ ...base, kind: 'turn_started', leagueName: '' }, 'de').title).toBe('Dein Pick');
  });

  it('keeps a hostile league name inside the size cap', () => {
    const payload = turnPayload({ ...base, kind: 'turn_started', leagueName: 'L'.repeat(5000) }, 'en');
    expect(payload.title.length).toBeLessThanOrEqual(120);
    expect(JSON.stringify(payload).length).toBeLessThan(1000);
  });

  it('carries only the five documented fields (no ids of players, no secrets)', () => {
    const payload = turnPayload({ ...base, kind: 'turn_started' }, 'en');
    expect(Object.keys(payload).sort()).toEqual(['body', 'kind', 'tag', 'title', 'url']);
  });
});

describe('redraftPayload', () => {
  it('announces the published redraft per language', () => {
    expect(redraftPayload(base, 'en')).toMatchObject({
      kind: 'redraft_published',
      title: 'Redraft published in EvoLiga S1',
      body: 'The redraft results are out. Check your roster.',
      url: '/leagues/season-1/draft-room?pool=pool-1',
      tag: 'draft-pool-1',
    });
    expect(redraftPayload({ ...base, leagueName: '' }, 'de').title).toBe('Redraft veröffentlicht');
  });
});

describe('urls and tags', () => {
  it('opens the pool in the league draft room, ids encoded', () => {
    expect(draftRoomUrl('a b', 'c&d')).toBe('/leagues/a%20b/draft-room?pool=c%26d');
    expect(draftPushTag('pool-9')).toBe('draft-pool-9');
  });
});

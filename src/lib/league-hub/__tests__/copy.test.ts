/**
 * League hub copy: both languages label every tab and every status the hub
 * prints (rebuilt from the `league-hub`, `enums` and `glossary` namespaces),
 * and the hub's dates follow the viewer: calendar days zone-free, kickoffs in
 * the viewer's zone (`createFormatter`, which `<LocalTime>` and the hub use;
 * the hub no longer prints a fixed "UTC").
 *
 * Intl output is matched on its stable parts (day, month word, time, year),
 * not as whole strings, so an ICU punctuation change does not break the test.
 */
import { describe, expect, it } from 'vitest';
import { createFormatter } from '@/i18n/format';
import { getMessages } from '@/i18n/core';
import { enumMessages } from '@/i18n/messages/enums';
import { glossaryMessages } from '@/i18n/messages/glossary';
import { leagueHubMessages } from '@/i18n/messages/league-hub';
import { hubSharedLabels, leagueHubCopy, type LeagueHubCopy } from '../copy';
import { LEAGUE_HUB_TABS } from '../tabs';

/** The hub's kickoff text: `<LocalTime preset="dateTime">` in the viewer's zone. */
function formatKickoff(iso: string, locale: 'en' | 'de', timeZone = 'UTC'): string {
  return createFormatter({ locale, timeZone }).instant(iso, 'dateTime');
}

/** The hub's calendar days (season start and end): zone-free. */
function formatDay(day: string, locale: 'en' | 'de', timeZone = 'UTC'): string {
  return createFormatter({ locale, timeZone }).calendarDate(day);
}

const MATCH_STATUSES = ['scheduled', 'in_progress', 'pending_confirmation', 'completed', 'disputed'];
const ROUND_STATUSES = ['pending', 'active', 'completed'];
const TOURNAMENT_STATUSES = ['upcoming', 'active', 'completed'];
const BRACKET_TYPES = ['round_robin', 'swiss', 'single_elim', 'double_elim'];
const FORMAT_TYPES = ['singles', 'doubles', 'draft', 'evolution_point_buy'];
const BRACKET_SIDES = ['winners', 'losers', 'grand_finals'];

/** Every key path of a copy object, functions included as leaves. */
function keyPaths(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [prefix];
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, child]) => keyPaths(child, prefix ? `${prefix}.${key}` : key))
    .sort();
}

describe('leagueHubCopy', () => {
  const en = leagueHubCopy('en');
  const de = leagueHubCopy('de');

  it('picks German for the plaza and English otherwise', () => {
    expect(de.heading).toBe('Liga-Übersicht');
    expect(en.heading).toBe('League hub');
    expect(de.tabs.standings).toBe('Tabelle');
    expect(en.tabs.standings).toBe('Standings');
  });

  it('both languages have the same keys', () => {
    expect(keyPaths(de)).toEqual(keyPaths(en));
  });

  for (const [locale, copy] of [
    ['en', en],
    ['de', de],
  ] as [string, LeagueHubCopy][]) {
    describe(locale, () => {
      it('labels every hub tab', () => {
        expect(Object.keys(copy.tabs).sort()).toEqual([...LEAGUE_HUB_TABS].sort());
        for (const tab of LEAGUE_HUB_TABS) expect(copy.tabs[tab].trim()).not.toBe('');
      });

      it('labels every match, round and phase status', () => {
        for (const status of MATCH_STATUSES) expect(copy.matchStatus[status]).toBeTruthy();
        for (const status of ROUND_STATUSES) expect(copy.roundStatus[status]).toBeTruthy();
        for (const status of TOURNAMENT_STATUSES) expect(copy.status[status]).toBeTruthy();
      });

      it('labels every bracket type, format and bracket side', () => {
        for (const type of BRACKET_TYPES) expect(copy.bracketType[type]).toBeTruthy();
        for (const format of FORMAT_TYPES) expect(copy.formatType[format]).toBeTruthy();
        for (const side of BRACKET_SIDES) expect(copy.bracketSide[side]).toBeTruthy();
      });

      it('formats counts into the string', () => {
        expect(copy.trainers(7)).toContain('7');
        expect(copy.players(5)).toContain('5');
        expect(copy.round(4)).toContain('4');
        expect(copy.bestOf(3)).toBe('Bo3');
        expect(copy.advances(2, true)).toContain('2');
        expect(copy.advances(2, true)).not.toBe(copy.advances(2, false));
      });
    });
  }

  it('English pluralises trainers and players', () => {
    expect(en.trainers(1)).toBe('1 trainer');
    expect(en.trainers(0)).toBe('0 trainers');
    expect(en.trainers(12)).toBe('12 trainers');
    expect(en.players(1)).toBe('1 player');
    expect(en.players(2)).toBe('2 players');
  });

  it('German counts read the same in singular and plural', () => {
    expect(de.trainers(1)).toBe('1 Teilnehmer');
    expect(de.trainers(8)).toBe('8 Teilnehmer');
    expect(de.players(1)).toBe('1 Spieler');
  });

  it('spells the advancement line per group and overall', () => {
    expect(en.advances(2, true)).toBe('Top 2 per group advance');
    expect(en.advances(4, false)).toBe('Top 4 overall advance');
    expect(de.advances(2, true)).toBe('Top 2 je Gruppe kommen weiter');
    expect(de.advances(4, false)).toBe('Top 4 gesamt kommen weiter');
  });

  it('names rounds by position', () => {
    expect(en.round(3)).toBe('Round 3');
    expect(de.round(3)).toBe('Runde 3');
  });

  it('English keeps every stored round name as written', () => {
    for (const name of ['Round 1', 'Semifinals', 'Losers Round 2', 'Grand Finals', 'Woche 1']) {
      expect(en.roundName(name)).toBe(name);
    }
  });

  it('German translates the round names the engines store', () => {
    expect(
      [
        'Round 11',
        'Winners Round 2',
        'Losers Round 3',
        'Winners Finals',
        'Losers Finals',
        'Grand Finals',
        'Grand Finals Reset',
        'Finals',
        'Semifinals',
        'Quarterfinals',
      ].map(de.roundName),
    ).toEqual([
      'Runde 11',
      'Gewinnerseite · Runde 2',
      'Verliererseite · Runde 3',
      'Gewinnerseite · Finale',
      'Verliererseite · Finale',
      'Großes Finale',
      'Großes Finale · Reset',
      'Finale',
      'Halbfinale',
      'Viertelfinale',
    ]);
  });

  it('German keeps a name an admin gave as written', () => {
    expect(de.roundName('Woche 3')).toBe('Woche 3');
    expect(de.roundName('Round of 16 (rematch)')).toBe('Round of 16 (rematch)');
  });

  it('labels the draft room link in German', () => {
    expect(de.links.draft).toBe('Draft-Raum');
    expect(en.links.draft).toBe('Draft room');
  });
});

describe('hubSharedLabels', () => {
  it('English passes nothing: the shared components keep their own English', () => {
    expect(hubSharedLabels('en')).toBeNull();
  });

  const de = hubSharedLabels('de');

  it('German labels the bracket renderer from the hub copy', () => {
    const copy = leagueHubCopy('de');
    expect(de?.bracket.labels).toMatchObject({
      winnersBracket: copy.bracketSide.winners,
      losersBracket: copy.bracketSide.losers,
      grandFinals: copy.bracketSide.grand_finals,
    });
    expect(de?.bracket.labels.matchStatus).toEqual(
      Object.fromEntries(MATCH_STATUSES.map((status) => [status, copy.matchStatus[status]])),
    );
    expect(de?.bracket.roundName('Semifinals')).toBe('Halbfinale');
  });

  it('German translates the feeder labels the bracket engine builds', () => {
    const slot = de!.bracket.slotLabel;
    expect(slot('Winner of M10')).toBe('Sieger aus M10');
    expect(slot('Loser of M10 (if necessary)')).toBe('Verlierer aus M10 (falls nötig)');
    expect(slot('Loser of M?')).toBe('Verlierer aus M?');
    expect(slot('Seed 3')).toBe('Setzplatz 3');
    expect(slot('Seed 5 (LB)')).toBe('Setzplatz 5 (Verliererseite)');
    expect(slot('BYE')).toBe('Freilos');
  });

  it('German results grid letters match the standings table', () => {
    const copy = leagueHubCopy('de');
    expect(de?.resultsGrid).toEqual({
      player: copy.table.trainer,
      win: copy.table.wins,
      loss: copy.table.losses,
      draw: copy.table.draws,
    });
  });

  it('German ruleset and insights labels', () => {
    expect(de?.ruleset.clauses).toBe('Klauseln');
    expect(de?.ruleset.sharedTypeRule(60)).toContain('60');
    expect(de?.insights.tabs).toMatchObject({ usage: 'Pokémon-Nutzung', moves: 'Attacken-Nutzung' });
    // The two counts the English tables both called "Battles" read apart.
    expect(de?.insights.usage.teams).not.toBe(de?.insights.kills.brought);
  });

  it("German labels the insights tables' pagination, the same chrome on both", () => {
    const pagination = de?.insights.usage.pagination;
    expect(pagination).toMatchObject({ rows: 'Zeilen', previousPage: 'Vorherige Seite', nextPage: 'Nächste Seite' });
    // The counts go in through placeholders (plain strings cross into the client table).
    expect(pagination?.showing).toContain('{start}');
    expect(pagination?.showing).toContain('{total}');
    expect(pagination?.page).toContain('{page}');
    expect(de?.insights.kills.pagination).toEqual(pagination);
  });

  it('German labels the double elimination loss marks like the standings loss column', () => {
    expect(de?.bracket.labels.lossesShort).toBe(leagueHubCopy('de').table.losses);
    expect(de?.bracket.labels.lossesEntering).toBe('Niederlagen vor diesem Spiel');
  });
});

describe('the namespaces behind the copy', () => {
  it('rebuilds the same object per locale (memoized adapter)', () => {
    expect(leagueHubCopy('de')).toBe(leagueHubCopy('de'));
    expect(leagueHubCopy('en')).not.toBe(leagueHubCopy('de'));
  });

  it('takes the words from the league-hub namespace', () => {
    for (const locale of ['en', 'de'] as const) {
      const messages = getMessages(leagueHubMessages, locale);
      const copy = leagueHubCopy(locale);
      expect(copy.heading).toBe(messages.heading);
      expect(copy.tabs).toEqual(messages.tabs);
      expect(copy.status).toEqual(messages.status);
      expect(copy.bracketSide).toEqual(messages.bracketSide);
    }
  });

  it('labels shared enums (match and round status, bracket type, format) from the enums namespace', () => {
    for (const locale of ['en', 'de'] as const) {
      const enums = getMessages(enumMessages, locale);
      const copy = leagueHubCopy(locale);
      expect(copy.matchStatus).toEqual(enums.matchStatus);
      expect(copy.roundStatus).toEqual(enums.roundStatus);
      expect(copy.bracketType).toEqual(enums.bracketType);
      expect(copy.formatType).toEqual(enums.formatType);
    }
    // The unified enum wording (i18n-core §5.3) replaces the hub's own "Live" / "Final".
    expect(leagueHubCopy('en').matchStatus.completed).toBe('Completed');
    expect(leagueHubCopy('en').matchStatus.in_progress).toBe('In progress');
    expect(leagueHubCopy('de').matchStatus.completed).toBe('Beendet');
  });

  it('takes the draft room link and the EP column from the glossary', () => {
    for (const locale of ['en', 'de'] as const) {
      const glossary = getMessages(glossaryMessages, locale);
      expect(leagueHubCopy(locale).links.draft).toBe(glossary.draft.draftRoom);
      expect(leagueHubCopy(locale).table.evolutionPoints).toBe(glossary.progress.evolutionPointsShort);
    }
  });

  it('builds the start and end lines as one sentence each', () => {
    expect(leagueHubCopy('en').startDate('1 Mar 2026')).toBe('Start: 1 Mar 2026');
    expect(leagueHubCopy('en').endDate('30 Jun 2026')).toBe('End: 30 Jun 2026');
    expect(leagueHubCopy('de').startDate('1. März 2026')).toBe('Start: 1. März 2026');
    expect(leagueHubCopy('de').endDate('30. Juni 2026')).toBe('Ende: 30. Juni 2026');
  });

  it('keeps round positions as plain digits', () => {
    expect(leagueHubCopy('en').round(1000)).toBe('Round 1000');
    expect(leagueHubCopy('de').round(1000)).toBe('Runde 1000');
  });
});

describe("kickoff times (the viewer's zone, no fixed UTC)", () => {
  // 23:05 UTC is already the next day in Europe/Berlin: the text follows the viewer's zone.
  const LATE = '2026-10-07T23:05:00Z';

  it('prints English day, month and time in a UTC viewer zone', () => {
    const text = formatKickoff(LATE, 'en');
    expect(text).not.toContain('UTC');
    expect(text).toMatch(/(^|\D)7(\D|$)/);
    expect(text).toContain('Oct');
    expect(text).toContain('23:05');
    expect(text).not.toMatch(/(^|\D)0?8(\D|$)/);
  });

  it('prints German day, month and time in a UTC viewer zone', () => {
    const text = formatKickoff(LATE, 'de');
    expect(text).not.toContain('UTC');
    expect(text).toContain('7.');
    expect(text).toContain('Okt');
    expect(text).toContain('23:05');
    expect(text).not.toContain('01:05');
  });

  it("moves to the viewer's own zone (Europe/Berlin: the next day)", () => {
    const text = formatKickoff(LATE, 'de', 'Europe/Berlin');
    expect(text).toContain('8.');
    expect(text).toContain('01:05');
  });

  it('reads offsets', () => {
    const text = formatKickoff('2026-10-08T01:05:00+02:00', 'en');
    expect(text).toMatch(/(^|\D)7(\D|$)/);
    expect(text).toContain('23:05');
  });

  it('uses a 24-hour clock', () => {
    const text = formatKickoff('2026-03-01T09:30:00Z', 'en');
    expect(text).toContain('09:30');
    expect(text).not.toMatch(/am|pm/i);
  });

  it('is empty for an unparseable timestamp', () => {
    expect(formatKickoff('not a date', 'en')).toBe('');
    expect(formatKickoff('', 'de')).toBe('');
  });
});

describe('calendar days (season start and end)', () => {
  it('prints an English calendar date', () => {
    const text = formatDay('2026-10-07', 'en');
    // The day stands alone (not padded) and never slips to the 6th.
    expect(text).toMatch(/(^|\D)7(\D|$)/);
    expect(text).not.toMatch(/(^|\D)0?6(\D|$)/);
    expect(text).toContain('Oct');
    expect(text).toContain('2026');
  });

  it('prints a German calendar date', () => {
    const text = formatDay('2026-03-01', 'de');
    expect(text).toContain('1.');
    expect(text).toContain('März');
    expect(text).toContain('2026');
  });

  it('never slips a day, whatever the viewer zone', () => {
    for (const zone of ['UTC', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Europe/Berlin']) {
      expect(formatDay('2026-10-07', 'en', zone)).toBe(formatDay('2026-10-07', 'en'));
    }
  });

  it('reads only the date part of a timestamp, as written', () => {
    // The date column may come back as a timestamp: the written day is kept.
    expect(formatDay('2026-10-07T23:30:00+02:00', 'en')).toBe(formatDay('2026-10-07', 'en'));
    expect(formatDay('2026-10-07T00:30:00-05:00', 'en')).toBe(formatDay('2026-10-07', 'en'));
  });

  it('returns the input unchanged when it is not a date', () => {
    expect(formatDay('soon', 'en')).toBe('soon');
    expect(formatDay('', 'de')).toBe('');
  });
});

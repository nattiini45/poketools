/**
 * T20 (i18n D11): the route engine's words follow the VIEWER's language, never
 * the theme's. Pure helpers only — the painters' recorded output is pinned in
 * `components/world/evoliga/route/plaza/__tests__/i18n-plaza.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { formatPack } from '@/lib/format-pack';
import type { PriceGroup } from '@/types/point-buy';

/** The active format pack's painted price-band word, upper-cased like the painters. */
const bandWord = (locale: 'en' | 'de', group: PriceGroup) =>
  formatPack.messages[locale].paint.priceBand[group].toLocaleUpperCase(locale);
import { paintMessages } from '@/i18n/messages/paint';
import { worldRouteMessages } from '@/i18n/messages/world-route';
import { loaderStageCopy, loaderStageLine, loaderWarmLine } from '../ball-loader-state';
import { englishKickoffLine, liveMatchPair, priceBandLabel, rosterTapNote } from '../board-text';
import { capsFor, paintCaps, paintT, routeT } from '../paint-copy';
import {
  EMPTY_DIGEST_FACTS,
  cardCtaLabel,
  cardRegionName,
  formatStationDigest,
  stationCardChrome,
  type StationDigestFacts,
} from '../station-digest';
import { themeVeilCopy } from '../theme-veil';
import { hoverHint } from '@/components/world/route/focus/hover-geometry';

const ZERO = { renderer: false, assets: false, firstFrame: false, count: 0 };

describe('paint copy helpers', () => {
  it('letters a sentence-case message in capitals, keeping params as given', () => {
    expect(paintCaps('de', 'board.liveTicker', { home: 'Wells', away: 'Ay' })).toBe('LÄUFT · Wells — Ay');
    expect(paintCaps('en', 'board.liveTicker', { home: 'WELLS', away: 'AY' })).toBe('LIVE · WELLS — AY');
  });

  it('upper-cases ß as SS (never ẞ) for data lettered on a canvas', () => {
    expect(capsFor('Großes Finale', 'de')).toBe('GROSSES FINALE');
    expect(capsFor('Rückrunde', 'de')).toBe('RÜCKRUNDE');
    expect(capsFor('Großes Finale', 'de')).not.toContain('ẞ');
  });

  it('plurals follow the count in both languages', () => {
    expect(paintCaps('de', 'board.gamesPlayed', { count: 1 })).toBe('1 SPIEL GESPIELT');
    expect(paintCaps('de', 'board.gamesPlayed', { count: 16 })).toBe('16 SPIELE GESPIELT');
    expect(paintCaps('en', 'board.gamesPlayed', { count: 1 })).toBe('1 MATCH PLAYED');
    expect(paintCaps('en', 'board.participants', { count: 8 })).toBe('8 PARTICIPANTS');
  });

  it('messages are stored in sentence case (no ALL-CAPS words but acronyms)', () => {
    const acronyms = new Set(['PC', 'STAB', 'EP', 'KO', 'KOS', 'II', 'I', 'W', 'L', 'D', 'S', 'N', 'U']);
    const walk = (node: unknown, path: string): void => {
      if (typeof node === 'string') {
        for (const word of node.replace(/\{[A-Za-z0-9_]+\}/g, ' ').split(/[^A-Za-zÄÖÜäöüß]+/)) {
          if (word.length >= 2 && word === word.toUpperCase() && !acronyms.has(word)) throw new Error(`${path}: ${word}`);
        }
        return;
      }
      if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`);
    };
    for (const ns of [paintMessages, worldRouteMessages]) {
      expect(() => walk(ns.en, `${ns.id}.en`)).not.toThrow();
      expect(() => walk(ns.de, `${ns.id}.de`)).not.toThrow();
    }
  });

  it('the translators are memoized per locale', () => {
    expect(paintT('de')).toBe(paintT('de'));
    expect(routeT('en')).toBe(routeT('en'));
  });
});

describe('price bands and roster notes', () => {
  it('paints the locale word for every stored price group, the raw key upper-cased otherwise', () => {
    expect(priceBandLabel('guenstig', 'de')).toBe(bandWord('de', 'guenstig'));
    expect(priceBandLabel('guenstig', 'en')).toBe(bandWord('en', 'guenstig'));
    expect(priceBandLabel('Hoch', 'de')).toBe(bandWord('de', 'hoch'));
    expect(priceBandLabel('fire', 'de')).toBe('FIRE');
  });

  it('the roster note is honest about the painted count in both languages', () => {
    expect(rosterTapNote(9, 30, 'de', 'SAIL')).toBe('9 VON 30 · TIPPE FÜR ALLE 30 LINIEN');
    expect(rosterTapNote(30, 30, 'en', 'SAIL')).toBe('TAP THE SAIL FOR ALL 30');
  });

  it('the isles’ kickoff line speaks the viewer language when given one', () => {
    const future = { iso: '2099-01-01T18:00:00Z', date: '1.1.', time: '18:00' };
    expect(englishKickoffLine({ next: future, live: null }, 0)).toBe('NEXT KICKOFF · 1.1. 18:00');
    expect(englishKickoffLine({ next: future, live: null }, 0, undefined, 'de')).toBe('NÄCHSTER ANPFIFF · 1.1. 18:00 UHR');
  });
});

describe('loader lines follow the viewer', () => {
  it('stage and warm lines in both languages', () => {
    expect(loaderStageLine('de', ZERO)).toBe('Welt wird geladen · 0/6');
    expect(loaderStageLine('en', { ...ZERO, renderer: true, count: 2 })).toBe('Starting graphics · 2/6');
    expect(loaderStageCopy('de').ready).toBe('Welt bereit');
    expect(loaderStageCopy('en').usable).toBe('The page is already usable.');
    expect(loaderWarmLine('de', { warmStage: 4, uploads: 1234 }, 5)).toBe('Texturen 1234 · 5/6');
    expect(loaderWarmLine('en', { warmStage: 9 }, 6)).toBe('Final frame · 6/6');
  });

  it('the theme veil and the hover pill speak the viewer language', () => {
    expect(themeVeilCopy('de').night).toBe('Die Welt wechselt in die Nacht');
    expect(themeVeilCopy('en').day).toBe('Switching the world to day');
    expect(hoverHint('de')).toBe('Klicken zum Vergrößern');
    expect(hoverHint('en')).toBe('Click to look closer');
  });
});

describe('Station Card copy in the viewer language', () => {
  const facts: StationDigestFacts = {
    ...EMPTY_DIGEST_FACTS,
    nextFixture: { home: 'REED', away: 'BELL', status: 'done', matchday: 3, date: { de: '24.9.', en: '9/24' }, time: '18:00' },
    roster: { count: 1, lines: true },
  };

  it('chrome, region name and CTA labels', () => {
    expect(stationCardChrome('de').readAsText).toBe('Als Text lesen');
    expect(stationCardChrome('en').railLabel).toBe('Trainers');
    expect(cardRegionName('Kaderliste', 'de')).toBe('Station: Kaderliste');
    expect(cardCtaLabel('roster', 'de')).toBe('Alle Linien lesen');
    expect(cardCtaLabel('schedule', 'en')).toBe('Open the schedule');
  });

  it('neutral status keys are labelled only when the line is written', () => {
    expect(formatStationDigest('nextKickoff', facts, 'de')).toBe(`Spieltag 3 · ${liveMatchPair('REED', 'BELL')} · beendet`);
    expect(formatStationDigest('nextKickoff', facts, 'en')).toBe(`Matchday 3 · ${liveMatchPair('REED', 'BELL')} · final`);
  });

  it('counts take the plural form (1 line, not 1 lines)', () => {
    expect(formatStationDigest('rosterCount', facts, 'en')).toBe('1 line on the roster');
    expect(formatStationDigest('rosterCount', facts, 'de')).toBe('1 Linie auf der Liste');
  });
});

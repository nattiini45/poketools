import { describe, expect, it } from 'vitest';
import { epbPack, formatPack } from '@/lib/format-pack';
import type { PriceGroup } from '@/types/point-buy';
import type { BoardContent, BoardTableRow } from '@/components/world/evoliga/route/plaza/board/board-content';
import type { BoardPaintTools } from '@/lib/route-world/board-paint-path';
import type { RulesCopyContext } from '@/components/world/sections/types';
import { worldThemesMessages } from '@/i18n/messages/world-themes';
import {
  fixtureStatusKey,
  isLiveFixture,
  kickoffLine,
  paintText,
  rosterBandLine,
  rosterTileName,
  statusPill,
} from '../paint-copy';
import { localizeThemeStations, themeLoaderCopy, themeStationText } from '../station-copy';
import { plazaTheme, PLAZA_STATIONS } from '../plaza/theme';
import { sakuraTheme, SAKURA_STATIONS } from '../sakura/theme';
import { mountainTheme } from '../mountain/theme';
import { cloudsTheme } from '../clouds/theme';
import { sakuraSectionCopyFor } from '../sakura/sections/copy';
import { mountainSectionCopyFor } from '../mountain/sections/copy';
import { cloudsSectionCopyFor } from '../clouds/sections/copy';
import {
  buildFestivalBannerPayloads,
  paintBoardPage,
  plaqueCopy as sakuraPlaqueCopy,
  sakuraKickoffStamp,
  standingsEmptyState as sakuraEmptyState,
} from '../sakura/content/paint';
import { rosterWallNote } from '../sakura/content/roster-note';
import {
  buildTrailSignPayloads,
  paintRegisterWall,
  plaqueCopy as mountainPlaqueCopy,
  registerNote,
  shortStageLabel,
} from '../mountain/content/paint';
import { gatePlaqueCopy, paintFixturesBoard, registerSailNote } from '../clouds/content/paint';

/** The active format pack's painted price-band word, upper-cased like the painters. */
const bandWord = (locale: 'en' | 'de', group: PriceGroup) =>
  formatPack.messages[locale].paint.priceBand[group].toLocaleUpperCase(locale);
/** The painted league defaults (the active pack). */
const BUDGET = epbPack.defaults.draftBudget;
const PICKS = String(epbPack.defaults.draftPicks);
const BANNED = String(epbPack.defaults.bannedMoves.length);

/**
 * T21 (i18n D11): the route themes carry no language of their own. Station,
 * loader, section, subject and painted copy come from `world-themes` in the
 * viewer's locale; English stays byte-identical to the old literals (the
 * other theme tests pin that), and these tests pin the German surfaces.
 */

const NOW = Date.UTC(2026, 9, 9, 12);

function row(name: string, points: number, rankChange: number | null): BoardTableRow {
  return { name, points, wins: points, losses: 1, draws: 0, diff: 2, rankChange };
}

function content(overrides: Partial<BoardContent> = {}): BoardContent {
  return {
    league: 'Große Liga',
    stage: 'Rückrunde',
    round: 3,
    participants: 8,
    completed: 12,
    top: [row('WELLS', 12, 2), row('AY', 10, null)],
    table: [row('WELLS', 12, 2), row('AY', 10, null)],
    live: null,
    upcoming: [{ home: 'WELLS', away: 'AY', date: '17.10.', time: '18:00', status: 'upcoming', matchday: 3 }],
    later: [{ home: 'HART', away: 'COLE', date: '24.10.', time: '18:00', status: 'upcoming', matchday: 4 }],
    results: [{ home: 'WELLS', away: 'HART', score: '2–1', date: '10.10.', winner: 'home' }],
    lastMatchday: [],
    lastMatchdayLabel: 'Rückrunde · Spieltag 2',
    next: { date: '17.10.', time: '18:00', iso: '2026-10-17T16:00:00Z' },
    locale: 'de',
    ...overrides,
  };
}

/** Records every painted string; `measureText` is proportional so fit helpers take real branches. */
function recordingContext(texts: string[]): CanvasRenderingContext2D {
  let fontPx = 16;
  const noop = () => undefined;
  const ctx: Record<string, unknown> = {
    fillText: (text: string) => {
      texts.push(String(text));
    },
    strokeText: noop,
    measureText: (text: string) => ({ width: String(text).length * fontPx * 0.55 }),
    fillRect: noop,
    strokeRect: noop,
    clearRect: noop,
    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    arcTo: noop,
    stroke: noop,
    fill: noop,
    setLineDash: noop,
    translate: noop,
    scale: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    textAlign: 'left',
    textBaseline: 'alphabetic',
  };
  Object.defineProperty(ctx, 'font', {
    get: () => `${fontPx}px`,
    set: (value: string) => {
      fontPx = Number(/(\d+(?:\.\d+)?)px/.exec(String(value))?.[1] ?? 16);
    },
  });
  return ctx as unknown as CanvasRenderingContext2D;
}

const TOOLS: BoardPaintTools = { fontPx: (n: number) => Math.ceil(n), fontFloorPx: 12 };
const EPB: RulesCopyContext = { format: 'evolution_point_buy', bestOf: 3 };
const SINGLES: RulesCopyContext = { format: 'singles', bestOf: 3 };

describe('world-themes namespace', () => {
  it('holds station copy for every theme and station in both languages', () => {
    for (const theme of ['plaza', 'sakura', 'mountain', 'clouds'] as const) {
      for (const station of ['pulse', 'roster', 'teams', 'schedule', 'rules'] as const) {
        expect(worldThemesMessages.en.stations[theme][station].beat.length).toBeGreaterThan(0);
        expect(worldThemesMessages.de.stations[theme][station].title.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('station and loader copy follow the viewer', () => {
  it('localizes the plaza stations into English and keeps the reviewed German', () => {
    const en = localizeThemeStations(plazaTheme.id, PLAZA_STATIONS, 'en');
    expect(en.map((s) => s.card?.title)).toEqual(['Pulse', 'Roster', 'Teams', 'Schedule', 'Rules']);
    expect(en[0].beat).toBe('The season exists — and this is where it stands.');
    const de = localizeThemeStations(plazaTheme.id, PLAZA_STATIONS, 'de');
    expect(de.map((s) => s.card?.title)).toEqual(['Puls', 'Kaderliste', 'Teams', 'Spielplan', 'Regelwerk']);
    expect(de[1].beat).toBe('Das sind die Linien, die du kaufen kannst.');
    // Everything but the words is the theme's own station.
    expect(de[0].camera).toBe(PLAZA_STATIONS[0].camera);
    expect(de[0].card?.cta).toEqual(PLAZA_STATIONS[0].card?.cta);
  });

  it('gives the isle themes German beats and titles', () => {
    const de = localizeThemeStations(sakuraTheme.id, SAKURA_STATIONS, 'de');
    expect(de[0].card?.title).toBe('Puls');
    expect(de[3].beat).toBe('Hier wird gespielt – und hier steht die Tabelle.');
    expect(themeStationText('mountain', 'rules', 'de')?.beat).toBe(
      'Und das sind die Regeln des Passes – sie gelten bei jedem Wetter.',
    );
    expect(themeStationText('clouds', 'teams', 'de')?.title).toBe('Teams');
  });

  it('leaves a theme without copy (gallery, probes) unchanged', () => {
    expect(localizeThemeStations('gallery', SAKURA_STATIONS, 'de')).toEqual(SAKURA_STATIONS);
    expect(themeStationText('plaza', 'nowhere', 'de')).toBeNull();
  });

  it('keeps each definition on its authored source copy and carries no language or loader copy', () => {
    expect(plazaTheme.stations[0].card?.title).toBe('Puls');
    for (const theme of [plazaTheme, sakuraTheme, mountainTheme, cloudsTheme]) {
      expect('locale' in theme).toBe(false);
      expect('loaderCopy' in theme).toBe(false);
    }
    for (const theme of [sakuraTheme, mountainTheme, cloudsTheme]) {
      expect(theme.stations[0].card?.title).toBe('Pulse');
    }
  });

  it('words the loader in both languages', () => {
    expect(themeLoaderCopy('en').retry).toBe('Retry 3D world');
    expect(themeLoaderCopy('de')).toEqual({
      loading: '3D-Welt wird geladen – die Seite ist bereits nutzbar',
      ready: '3D-Welt bereit',
      failed: 'Die 3D-Welt konnte nicht geladen werden.',
      retry: '3D-Welt erneut laden',
    });
  });
});

describe('paintText', () => {
  it('upper-cases the template but never the params', () => {
    expect(paintText('en', 'kickoffLive', { pair: 'Wells – Ay' })).toBe('LIVE · Wells – Ay');
    expect(paintText('de', 'kickoffNext', { date: '17.10.', time: '18:00' })).toBe('NÄCHSTER ANPFIFF · 17.10. 18:00');
  });

  it('selects plural forms per locale', () => {
    expect(paintText('en', 'matchesPlayed', { count: 1 })).toBe('1 MATCH PLAYED');
    expect(paintText('en', 'matchesPlayed', { count: 12 })).toBe('12 MATCHES PLAYED');
    expect(paintText('de', 'matchesPlayed', { count: 12 })).toBe('12 SPIELE GESPIELT');
    expect(paintText('de', 'trainers', { count: 1 })).toBe('1 TRAINER');
  });

  it('paints German capitals without ẞ', () => {
    expect(shortStageLabel('Rückrunde', 'de')).toBe('RÜCKRUNDE');
    expect(shortStageLabel('Second Half', 'de')).toBe('RÜCKRUNDE');
    expect(shortStageLabel('Second Half', 'en')).toBe('2ND HALF');
    expect(shortStageLabel('Große Runde', 'de')).toBe('GROSSE RUNDE');
  });
});

describe('fixture status pills', () => {
  it('maps the neutral board status keys to the painted pills', () => {
    expect(fixtureStatusKey('live')).toBe('live');
    expect(isLiveFixture('live')).toBe(true);
    expect(fixtureStatusKey('upcoming')).toBe('open');
    expect(fixtureStatusKey('done')).toBe('done');
    expect(isLiveFixture('upcoming')).toBe(false);
    expect(statusPill('upcoming', 'de')).toBe('OFFEN');
    expect(statusPill('done', 'de')).toBe('ENDE');
    expect(statusPill('done', 'en')).toBe('FT');
  });
});

describe('German painted payloads', () => {
  it('builds the sakura banners in German', () => {
    const banners = buildFestivalBannerPayloads(content(), NOW, 'de');
    expect(banners.map((b) => b.heading)).toEqual(['SPIELE', 'ALS NÄCHSTES', 'ERGEBNISSE', 'PULS', 'TABELLE']);
    const [fixture] = banners[0].rows;
    expect(fixture.detail).toBe('ST 3 · 17.10. 18:00 · OFFEN');
    expect(banners[0].footer).toBe('NÄCHSTER ANPFIFF · 17.10. 18:00');
    expect(banners[3].rows[0]).toMatchObject({ kind: 'stat', text: '8 TRAINER', detail: '12 SPIELE GESPIELT' });
    expect(banners[3].rows[1]).toMatchObject({ text: 'SPIELTAG 3', detail: 'RÜCKRUNDE' });
    expect(banners[4].rows[0].detail).toBe('12 PKT. ▲2');
  });

  it('keeps the English banners verbatim', () => {
    const banners = buildFestivalBannerPayloads({ ...content(), locale: 'en' }, NOW, 'en');
    expect(banners.map((b) => b.heading)).toEqual(['FIXTURES', 'UP NEXT', 'RESULTS', 'PULSE', 'TABLE']);
    expect(banners[0].rows[0].detail).toBe('MD 3 · 17.10. 18:00 · OPEN');
    expect(banners[3].rows[0]).toMatchObject({ text: '8 TRAINERS', detail: '12 MATCHES PLAYED' });
  });

  it('builds the mountain signs in German', () => {
    const signs = buildTrailSignPayloads(content(), NOW, 'de');
    expect(signs.map((s) => s.band)).toEqual(['SPIELTAG 3', 'SPIELTAG 4', 'NEUESTE', 'SAISON', 'TOP 2']);
    expect(signs[0].rows[0].detail).toBe('17.10. 18:00 · OFFEN');
    const empty = buildTrailSignPayloads(content({ upcoming: [], later: [], top: [] }), NOW, 'de');
    expect(empty.map((s) => s.band)).toEqual(['SPIELPLAN', 'SPÄTER', 'NEUESTE', 'SAISON', 'TABELLE']);
  });

  it('stamps, notes and empty states in German', () => {
    expect(sakuraKickoffStamp(content(), NOW, 'de')).toBe('NÄCHSTER ANPFIFF · 17.10. 18:00 · 8 TRAINER');
    expect(sakuraKickoffStamp(content({ next: null }), NOW, 'de')).toBe('12 SPIELE GESPIELT · 8 TRAINER');
    expect(sakuraEmptyState(content({ table: [] }), 'de')).toEqual({
      headline: 'NOCH KEINE TABELLE',
      copy: 'SIE ENTSTEHT MIT DEN ERSTEN ERGEBNISSEN IM PARK',
    });
    expect(rosterWallNote(12, 30, true, 'de')).toBe('KADERWAND – 12 VON 30 LINIEN · TIPPE AUF DIE WAND FÜR ALLE 30');
    expect(registerNote(9, 30, false, 'de')).toBe('9 VON 30 LINIEN · ZUM LESEN ANTIPPEN');
    expect(registerSailNote(9, 9, false, 'de')).toBe('DAS REGISTER · ZUM LESEN ANTIPPEN');
  });

  it('paints the German board words', () => {
    const texts: string[] = [];
    paintBoardPage(recordingContext(texts), 1280, 720, content({ live: { home: 'WELLS', away: 'AY' } }), {
      field: '#123456',
      accent: '#ff88aa',
      ink: '#eafcff',
    }, TOOLS, 'de');
    expect(texts).toEqual(expect.arrayContaining(['TABELLE · ', 'TRAINER', 'S', 'N', 'DIFF.', 'PKT.', 'GROSSE LIGA']));
    expect(texts).toContain('NÄCHSTER ANPFIFF · 17.10. 18:00 · 8 TRAINER');
    expect(texts.some((t) => t.startsWith('LIVE WELLS'))).toBe(true);
    expect(texts.some((t) => t.includes('RÜCKRUNDE · SPIELTAG 3'))).toBe(true);

    const fixtures: string[] = [];
    paintFixturesBoard(recordingContext(fixtures), 1280, 720, content(), {
      field: '#123456',
      accent: '#ff88aa',
      ink: '#eef6ff',
    }, TOOLS, 'de');
    expect(fixtures).toEqual(expect.arrayContaining(['SPIEL', 'ANPFIFF', 'OFFEN', 'WELLS vs. AY']));
  });

  it('paints roster tiles with German species, price groups and gym types', () => {
    const tiles = [
      { id: 'a', line: 1, name: 'Bulbasaur', band: 'guenstig', price: 27 },
      { id: 'b', line: 2, name: 'Eevee Fan', band: 'fire', price: null },
    ];
    expect(rosterTileName(tiles[0], 'de')).toBe('Bisasam');
    expect(rosterTileName(tiles[1], 'de')).toBe('Eevee Fan');
    expect(rosterBandLine(tiles[0], 'de', 'de')).toBe(`27 P · ${bandWord('de', 'guenstig')}`);
    expect(rosterBandLine(tiles[0], 'en', 'en')).toBe(`27 PTS · ${bandWord('en', 'guenstig')}`);
    expect(rosterBandLine(tiles[1], 'de', 'de')).toBe('FEUER-ARENA');
    expect(rosterBandLine(tiles[1], 'en', 'en')).toBe('FIRE GYM');
    expect(rosterBandLine({ band: 'open', price: null }, 'de', 'de')).toBe('OFFENE ARENA');
    expect(rosterBandLine({ band: 'open', price: null }, 'en', 'en')).toBe('OPEN GYM');
    // Keep-English Pokémon terms: German UI words, English species.
    expect(rosterTileName(tiles[0], 'en')).toBe('Bulbasaur');

    const texts: string[] = [];
    paintRegisterWall(recordingContext(texts), 1536, 640, tiles, {
      stone: '#54504a',
      ink: '#f3efe6',
      accent: '#e8862e',
    }, TOOLS, 'NOTIZ', 'de', 'de');
    expect(texts).toEqual(expect.arrayContaining(['KADER', 'BISASAM', `27 P ${bandWord('de', 'guenstig')}`, 'FEUER-ARENA']));
  });

  it('builds kickoff lines with the caller pair', () => {
    const live = content({ live: { home: 'WELLS', away: 'AY' }, next: null });
    expect(kickoffLine(live, NOW, 'de', (a, b) => `${a}/${b}`)).toBe('LIVE · WELLS/AY');
  });
});

describe('German plaques and section copy', () => {
  it('shapes the plaque copy in German', () => {
    const park = sakuraPlaqueCopy(null, null, EPB, 'de');
    expect(park.title).toBe('REGELN DES PARKS');
    expect(park.rulesetName).toBe('Evolution Point Buy');
    expect(park.rows).toEqual([
      ['Draft-Budget', `${BUDGET} P`],
      ['Linien pro Trainer', PICKS],
      ['Tera – Stufe 1', 'Freies Tera'],
      ['Gebannte Attacken', BANNED],
    ]);
    expect(park.note).toBe('Keine eigenen Regeln hinterlegt – es gelten die Liga-Standards.');
    expect(mountainPlaqueCopy(null, 'Liga-Regelwerk', EPB, 'de').rows[1]).toEqual(['Linien je Trainer', PICKS]);
    const isles = gatePlaqueCopy(null, null, SINGLES, 'de');
    expect(isles).toStrictEqual({
      title: 'REGELN DER INSELN',
      rulesetName: 'Einzel',
      rows: [
        ['Format', 'Einzel'],
        ['Best-of', '3'],
      ],
      note: null,
    });
  });

  it('builds the section copy in German, bound to a German plaque', () => {
    const copy = sakuraSectionCopyFor('de');
    expect(copy.place).toBe('Sakura Park');
    expect(copy.rosterPointBuy(1)).toMatch(/^1 Entwicklungslinie in voller Blüte/);
    expect(copy.rosterPointBuy(30)).toMatch(/^30 Entwicklungslinien in voller Blüte/);
    expect(copy.rulesCopy(null, null, EPB).rows[0]).toEqual(['Draft-Budget', `${BUDGET} P`]);
    expect(mountainSectionCopyFor('de').rulesPlaysBy).toBe('Der Pass spielt nach');
    expect(cloudsSectionCopyFor('de').scheduleUpcomingPainted).toBe('auf das Spielplan-Luftschiff gemalt');
  });

  it('keeps the English default section copy', () => {
    expect(sakuraSectionCopyFor('en').place).toBe('Sakura Park');
    expect(sakuraSectionCopyFor('en').rosterPointBuy(30)).toBe(
      '30 evolution lines in bloom — the full point-buy list, painted on the shrine wall and priced by group.',
    );
    expect(sakuraSectionCopyFor('en').rulesCopy(null, null, EPB).rows[0]).toEqual(['Draft budget', `${BUDGET} pts`]);
  });
});

/**
 * T20 (i18n D11): the plaza paints in the VIEWER's language. Every painter
 * receives the locale before its texture is built; these tests record the
 * painted text in both languages, pin the neutral fixture status keys, the
 * Pokémon-data names (`dataLocale`), the merged-KO sort (draft-frontend §8.3)
 * and the kiosk glyph coverage.
 */
import { describe, expect, it } from 'vitest';
import type { EvolutionTracker } from '@/types/evolution';
import { epbPack, formatPack } from '@/lib/format-pack';
import type { PriceGroup } from '@/types/point-buy';
import { localizeMove } from '@/lib/pkmn/i18n/names/moves';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';

/** The active format pack's painted price-band word, upper-cased like the painters. */
const bandWord = (locale: 'en' | 'de', group: PriceGroup) =>
  formatPack.messages[locale].paint.priceBand[group].toLocaleUpperCase(locale);
const DEFAULT_BANNED_MOVES = epbPack.defaults.bannedMoves;
import type { BoardPaintTools } from '@/lib/route-world/board-paint-path';
import { pickAceTracker } from '@/components/world/route/teams/teams-roster';
import { heightText, ledgerKicker, ledgerRankSpan, setBackWord } from '@/components/world/route/teams/ledger-painter';
import { nextKickoffTicker, type BoardContent, type BoardFixture } from '../board/board-content';
import {
  BOARD_TEX_H,
  BOARD_TEX_W,
  paintErgebnisseBoard,
  paintPulseBoard,
  paintScheduleBoard,
  paintTableBoard,
  type BoardPainter,
  type BoardTheme,
} from '../board/board-painters';
import { paintHoloBoard, paintInteriorWall, paintRosterGrid, ROSTER_TEX_H, ROSTER_TEX_W, type RosterTile } from '../desk-painters';
import { ctaText, fieldBoardPage, plaquePages, resolveRuleSet } from '../gate-painters';
import { KIOSK_SCREEN_GLYPHS, kioskScreenLines } from '../kiosk-screen';
import { crestAceLine, crestKicker, crestSlides, paintLeagueMark, type CrestSlide } from '../LedScreen';

const tools: BoardPaintTools = { fontPx: (n: number) => Math.max(Math.ceil(n), 29), fontFloorPx: 29 };

/** A 2D context that records every painted string (measure: 0.55 em per glyph). */
function recorder(texts: string[]): CanvasRenderingContext2D {
  let font = '16px sans-serif';
  const px = () => Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16);
  const noop = () => undefined;
  const ctx: Record<string, unknown> = {
    measureText: (text: string) => ({ width: String(text).length * px() * 0.55 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    fillText: (text: string) => texts.push(String(text)),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    textAlign: 'left',
    textBaseline: 'alphabetic',
  };
  for (const name of [
    'arc', 'fillRect', 'strokeRect', 'save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arcTo',
    'quadraticCurveTo', 'rect', 'stroke', 'fill', 'clip', 'translate', 'rotate', 'scale', 'setLineDash', 'drawImage',
  ]) {
    ctx[name] = noop;
  }
  Object.defineProperty(ctx, 'font', {
    get: () => font,
    set: (value: string) => {
      font = value;
    },
  });
  return ctx as unknown as CanvasRenderingContext2D;
}

const fixture = (home: string, away: string, status: BoardFixture['status'], matchday: number): BoardFixture => ({
  home,
  away,
  date: '17.9.',
  time: '18:00',
  status,
  matchday,
});

function content(locale: BoardContent['locale'], overrides: Partial<BoardContent> = {}): BoardContent {
  return {
    league: 'EvoLiga Saison 3',
    stage: 'Rückrunde',
    round: 2,
    participants: 8,
    completed: 16,
    top: [{ name: 'FELDKAMP', points: 12, wins: 4, losses: 0, draws: 0, diff: 9, rankChange: null }],
    table: [{ name: 'FELDKAMP', points: 12, wins: 4, losses: 0, draws: 0, diff: 9, rankChange: 1 }],
    live: { home: 'WELLS', away: 'AY' },
    upcoming: [fixture('WELLS', 'AY', 'live', 2), fixture('REED', 'BELL', 'upcoming', 2)],
    later: [fixture('HART', 'COLE', 'upcoming', 3), fixture('OTT', 'BRANDT', 'upcoming', 3)],
    laterTotal: 2,
    results: [],
    lastMatchday: [],
    lastMatchdayLabel: null,
    next: null,
    locale,
    ...overrides,
  };
}

const THEME: Omit<BoardTheme, 'kind'> = { accent: '#f5b400', red: '#e3350d', live: '#166534' };

function paintPage(painter: BoardPainter, kind: BoardTheme['kind'], c: BoardContent): string[] {
  const texts: string[] = [];
  painter(recorder(texts), BOARD_TEX_W, BOARD_TEX_H, c, { kind, ...THEME }, tools);
  return texts;
}

function allPages(c: BoardContent): string {
  return [
    ...paintPage(paintPulseBoard, 'pulse', c),
    ...paintPage(paintTableBoard, 'pulse', c),
    ...paintPage(paintScheduleBoard, 'schedule', c),
    ...paintPage(paintErgebnisseBoard, 'schedule', c),
  ].join(' | ');
}

const GERMAN_BOARD_WORDS = /TABELLE|SPIELPLAN|ERGEBNISSE|TEILNEHMER|SPIELTAG|AKTUELL|DANACH|WEITERE|LÄUFT|OFFEN|PKT|NOCH KEINE/;
const ENGLISH_BOARD_WORDS = /STANDINGS|SCHEDULE|RESULTS|PARTICIPANTS|MATCHDAY|UP NEXT|MORE|OPEN|PTS|NO RESULTS/;

describe('jumbotron pages paint in the viewer language', () => {
  it('English viewer: English words only (data names stay as given)', () => {
    const painted = allPages(content('en'));
    expect(painted).toContain('PULSE');
    expect(painted).toContain('STANDINGS');
    expect(painted).toContain('SCHEDULE');
    expect(painted).toContain('RESULTS');
    expect(painted).toContain('12 PTS');
    expect(painted).toContain('MATCHDAY 3 · UP NEXT · +1 MORE');
    expect(painted).toContain('NO RESULTS YET');
    expect(painted).not.toMatch(GERMAN_BOARD_WORDS);
  });

  it('German viewer: the reviewed plaza wording, data lettered with German caps', () => {
    const painted = allPages(content('de'));
    expect(painted).toContain('PULS');
    expect(painted).toContain('SPIELPLAN');
    expect(painted).toContain('12 PKT');
    expect(painted).toContain('SPIELTAG 3 · DANACH · +1 WEITERE');
    expect(painted).toContain('16 SPIELE GESPIELT · 8 TEILNEHMER · RÜCKRUNDE');
    expect(painted).not.toMatch(ENGLISH_BOARD_WORDS);
  });

  it('status pills letter the neutral keys in the viewer language', () => {
    const en = paintPage(paintScheduleBoard, 'schedule', content('en'));
    expect(en).toEqual(expect.arrayContaining(['LIVE', 'OPEN']));
    const de = paintPage(
      paintScheduleBoard,
      'schedule',
      content('de', { upcoming: [fixture('WELLS', 'AY', 'live', 2), fixture('REED', 'BELL', 'done', 2)] }),
    );
    expect(de).toEqual(expect.arrayContaining(['LÄUFT', 'BEENDET']));
  });

  it('the live ticker counts down in the viewer language', () => {
    const next = { date: '24.9.', time: '18:00', iso: '2026-09-24T18:00:00Z' };
    const now = Date.parse('2026-09-21T14:00:00Z');
    const quiet = { live: null, next, kickoffs: [next] };
    expect(nextKickoffTicker(content('de', quiet), now)).toBe('NÄCHSTER ANPFIFF IN 3 T 04:00:00 · 24.9. 18:00 UHR');
    expect(nextKickoffTicker(content('en', { ...quiet, next: { ...next, date: '9/24' }, kickoffs: [] }), now)).toBe(
      'NEXT KICKOFF IN 3 DAYS 04:00:00 · 9/24 18:00',
    );
    expect(nextKickoffTicker(content('en', { next: null }), now)).toBe('LIVE · WELLS — AY');
  });
});

describe('Rotom PC kiosk and holo', () => {
  const tile: RosterTile = { id: 't1', line: 1, name: 'Charmander', price: null, group: 'guenstig', sprite: null };
  const screen = { tiles: [tile], total: 30, open: 4, accent: '#3fd5c4', red: '#e3350d', selected: 0 };

  it('chrome follows the UI locale, line names the Pokémon-data locale', () => {
    const en: string[] = [];
    paintRosterGrid(recorder(en), ROSTER_TEX_W, ROSTER_TEX_H, { ...screen, locale: 'en', dataLocale: 'en' });
    expect(en).toEqual(expect.arrayContaining(['ROTOM PC · EVOLIGA', 'POINT-BUY LIST', '30 LINES', '4 OPEN', 'LINE · POKÉMON · PRICE', bandWord('en', 'guenstig'), 'Charmander']));

    const de: string[] = [];
    paintRosterGrid(recorder(de), ROSTER_TEX_W, ROSTER_TEX_H, { ...screen, locale: 'de', dataLocale: 'de' });
    expect(de).toEqual(expect.arrayContaining(['ROTOM-PC · EVOLIGA', 'POINT-BUY-LISTE', '30 LINIEN', '4 FREI', bandWord('de', 'guenstig')]));
    expect(de).toContain(localizeSpecies('Charmander', 'de'));
    expect(localizeSpecies('Charmander', 'de')).not.toBe('Charmander');
  });

  it('holo sheet and interior sign', () => {
    const texts: string[] = [];
    paintHoloBoard(recorder(texts), 768, 512, {
      rows: [{ line: 1, name: 'Bulbasaur', price: 30 }],
      total: 30,
      open: 4,
      accent: '#3fd5c4',
      locale: 'en',
      dataLocale: 'de',
    });
    expect(texts).toEqual(expect.arrayContaining(['EVOLIGA · ROSTER', 'POINT-BUY LIST', '30 LINES', '30 PTS', localizeSpecies('Bulbasaur', 'de')]));
    const sign: string[] = [];
    paintInteriorWall(recorder(sign), 1024, 512, '#ffcf8a', 'en');
    expect(sign).toContain('HEALING');
  });
});

describe('rules gate in the viewer language', () => {
  const EPB = { format: 'evolution_point_buy' as const, bestOf: null };
  const SINGLES = { format: 'singles' as const, bestOf: 3 };

  it('English rows, leads and plaque lettering', () => {
    const set = resolveRuleSet(null, null, EPB, 'en');
    expect(set.lead).toEqual({ left: 'Draft budget', right: 'Tera — stage 1' });
    expect(set.sections[0].rows[1]).toEqual({ label: 'Draft budget', value: `${epbPack.defaults.draftBudget} points` });
    const pages = plaquePages(set, 'en');
    expect(pages.left).toMatchObject({ kicker: 'TABLET I', title: 'FORMAT & DRAFT', footer: 'TAP FOR THE FULL RULESET' });
    expect(pages.left.rows.some((row) => row.label === pages.left.lead)).toBe(true);
    expect(fieldBoardPage(set, pages, 'en').kicker).toBe('RULESET');
    expect(ctaText('evolution_point_buy', 'en')).toBe('DRAFT NOW');
    expect(ctaText('singles', 'de')).toBe('JETZT ANTRETEN');
  });

  it('the passage board drops the ruleset row in either language', () => {
    for (const locale of ['de', 'en'] as const) {
      const set = resolveRuleSet(null, 'Liga Standard', SINGLES, locale);
      const rows = fieldBoardPage(set, plaquePages(set, locale), locale).rows;
      expect(rows.some((row) => row.value === 'Liga Standard')).toBe(false);
    }
    const none = resolveRuleSet(null, null, SINGLES, 'en');
    expect(none.sections[1].note).toBe('No ruleset assigned. No clauses, bans or custom rules are on record.');
  });

  it('banned move names follow the Pokémon-data locale; absent, they stay as stored', () => {
    const german = resolveRuleSet(null, null, EPB, 'de', 'de').sections[1].note ?? '';
    expect(german).toContain(localizeMove(DEFAULT_BANNED_MOVES[0], 'de'));
    const stored = resolveRuleSet(null, null, EPB, 'de').sections[1].note ?? '';
    expect(stored).toContain(DEFAULT_BANNED_MOVES[0]);
  });
});

function tracker(over: Partial<EvolutionTracker>): EvolutionTracker {
  return {
    id: 'x',
    season_id: 's',
    player_id: 'p1',
    base_pokemon: 'Charmander',
    current_form: 'Charmander',
    total_kos: 0,
    current_stage: 1,
    evolved_at: null,
    created_at: '',
    updated_at: '',
    real_kills: 0,
    draft_tokens: 0,
    kill_tokens: 0,
    cosmo_points: 0,
    suspended_until_matchday: null,
    evolution_points_awarded: 0,
    locked_stage3_pokemon: null,
    line_id: null,
    transferred_evo_progress: 0,
    redraft_slot_id: null,
    ...over,
  };
}

describe('crest wall and ledger', () => {
  const slide: CrestSlide = { id: 'p1', name: 'Mara Feldkamp', pigment: '#888888', ace: 'Charizard', place: 1 };

  it('kicker and ace line in both languages, the ace in the data language', () => {
    expect(crestKicker(slide, 2, 8, { locale: 'en' })).toBe('TRAINER 3/8 · RANK 1');
    expect(crestKicker(slide, 2, 8, { locale: 'de' })).toBe('TRAINER 3/8 · PLATZ 1');
    expect(crestAceLine(slide, { locale: 'en', dataLocale: 'en' })).toBe('ACE · CHARIZARD');
    expect(crestAceLine(slide, { locale: 'de', dataLocale: 'de' })).toBe(`ASS · ${localizeSpecies('Charizard', 'de').toLocaleUpperCase('de-DE')}`);
  });

  it('the no-data slide carries the tagline in the viewer language', () => {
    const texts: string[] = [];
    paintLeagueMark(recorder(texts), 1024, 640, true, { locale: 'en' });
    expect(texts).toContain('YOUR ARENA. YOUR GLORY.');
  });

  it('aces sort by display order: a tie on stage goes to self-earned KOs, not the merged total', () => {
    const tokens = tracker({ id: 'a', current_form: 'Charmander', total_kos: 6, real_kills: 1, draft_tokens: 5 });
    const kills = tracker({ id: 'b', base_pokemon: 'Squirtle', current_form: 'Squirtle', total_kos: 4, real_kills: 4 });
    expect(pickAceTracker([tokens, kills])?.id).toBe('b');
    const participants = [{ id: 'p1', name: 'Mara', gym_type: null }] as unknown as Parameters<typeof crestSlides>[0];
    expect(crestSlides(participants, [tokens, kills], [])[0].ace).toBe('Squirtle');
  });

  it('ledger words and the locale decimal sign', () => {
    expect(heightText(1.8, 'de')).toBe('1,8 m');
    expect(heightText(1.8, 'en')).toBe('1.8 m');
    expect(ledgerKicker('de')).toBe('TRAINER');
    expect(ledgerRankSpan(8, 'en')).toBe('RANKS 1–8');
    expect(setBackWord('de')).toBe('hinten');
  });
});

describe('wayfinding kiosk', () => {
  it('every grapheme of both languages has a dot-matrix glyph', () => {
    for (const locale of ['de', 'en'] as const) {
      for (const line of kioskScreenLines(locale)) {
        for (const ch of line) expect(KIOSK_SCREEN_GLYPHS[ch], `${locale}: "${ch}" in "${line}"`).toBeDefined();
      }
    }
    // No "Kaderliste"; the 5×7 raster has no C/Y/- glyphs, so the kiosk points at the "Liste".
    expect(kioskScreenLines('de')).toEqual(['PULS · TABELLE', 'LISTE ← WEST', 'REGELN ↓ SÜD']);
    expect(kioskScreenLines('en')).toEqual(['PULSE · STANDINGS', 'LIST ← WEST', 'RULES ↓ SOUTH']);
  });
});

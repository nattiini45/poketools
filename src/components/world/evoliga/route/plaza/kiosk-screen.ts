/**
 * The wayfinding kiosk's dot-matrix copy (C-064; i18n D11, T20): the three
 * lines in the viewer's language (`paint.kiosk`, lettered in capitals) and
 * the 5×7 glyph raster that letters them. Pure — `HeroProps` paints, the
 * tests check that every grapheme of both languages has a glyph.
 *
 * Directions are plaza-true (`layout.ts`: boards north, roster desk west,
 * gate south) and reader-relative (the screen faces south, so its reader
 * faces north: west is left, south is behind/below).
 */
import type { Locale } from '@/i18n/config';
import { paintCaps } from '@/lib/route-world/paint-copy';

/** The kiosk's three lines in `locale`, in the boards' caps idiom. */
export function kioskScreenLines(locale: Locale): readonly string[] {
  return [paintCaps(locale, 'kiosk.pulseTable'), paintCaps(locale, 'kiosk.rosterWest'), paintCaps(locale, 'kiosk.rulesSouth')];
}

/**
 * 5×7 dot-matrix glyph raster, drawn as hard blocks: real station-LED
 * lettering, deterministic across platforms (no system-font variance in an
 * emissive map), and it survives the ~1 texel-per-dot minification through
 * the glass's scattered UV patches. Covers every grapheme of
 * `kioskScreenLines` in both languages (pinned by a unit test).
 */
export const KIOSK_SCREEN_GLYPHS: Readonly<Record<string, readonly string[]>> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  G: ['01110', '10001', '10000', '10011', '10001', '10001', '01110'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  Ü: ['01010', '10001', '10001', '10001', '10001', '10001', '01110'],
  '·': ['00000', '00000', '00000', '01100', '01100', '00000', '00000'],
  '←': ['00000', '00100', '01000', '11111', '01000', '00100', '00000'],
  '↓': ['00000', '00100', '00100', '11111', '01010', '00100', '00000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

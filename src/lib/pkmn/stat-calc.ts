/**
 * Shared Pokémon stat calculation utilities.
 *
 * Standard Gen 3+ formulas with nature modifiers.
 * Extracted from StatDisplay so both StatDisplay and TeamSlotCard can reuse.
 */

import type { StatSpread } from '@/types/team';
import { localizeNatureLabel } from './i18n/names/misc';
import type { DataLocale } from './i18n/types';

/* ─── Shared stat constants ───────────────────────────────────────── */

export const STAT_KEYS: (keyof StatSpread)[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

export const STAT_LABELS: Record<keyof StatSpread, string> = {
  hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe',
};

/* ─── Nature stat modifiers ────────────────────────────────────────── */

export const NATURE_MODIFIERS: Record<string, { plus?: keyof StatSpread; minus?: keyof StatSpread }> = {
  Adamant: { plus: 'atk', minus: 'spa' },
  Bold:    { plus: 'def', minus: 'atk' },
  Brave:   { plus: 'atk', minus: 'spe' },
  Calm:    { plus: 'spd', minus: 'atk' },
  Careful: { plus: 'spd', minus: 'spa' },
  Gentle:  { plus: 'spd', minus: 'def' },
  Hasty:   { plus: 'spe', minus: 'def' },
  Impish:  { plus: 'def', minus: 'spa' },
  Jolly:   { plus: 'spe', minus: 'spa' },
  Lax:     { plus: 'def', minus: 'spd' },
  Lonely:  { plus: 'atk', minus: 'def' },
  Mild:    { plus: 'spa', minus: 'def' },
  Modest:  { plus: 'spa', minus: 'atk' },
  Naive:   { plus: 'spe', minus: 'spd' },
  Naughty: { plus: 'atk', minus: 'spd' },
  Quiet:   { plus: 'spa', minus: 'spe' },
  Rash:    { plus: 'spa', minus: 'spd' },
  Relaxed: { plus: 'def', minus: 'spe' },
  Sassy:   { plus: 'spd', minus: 'spe' },
  Timid:   { plus: 'spe', minus: 'atk' },
  // Neutral natures: Hardy, Docile, Serious, Bashful, Quirky — no modifier
};

/** All 25 nature names, alphabetical. */
export const ALL_NATURE_NAMES: string[] = [
  'Adamant', 'Bashful', 'Bold', 'Brave', 'Calm',
  'Careful', 'Docile', 'Gentle', 'Hardy', 'Hasty',
  'Impish', 'Jolly', 'Lax', 'Lonely', 'Mild',
  'Modest', 'Naive', 'Naughty', 'Quiet', 'Quirky',
  'Rash', 'Relaxed', 'Sassy', 'Serious', 'Timid',
];

export interface NatureData {
  name: string;
  plus: keyof StatSpread | null;
  minus: keyof StatSpread | null;
}

/** All 25 natures with stat modifiers, derived from NATURE_MODIFIERS. */
export const NATURES: NatureData[] = ALL_NATURE_NAMES.map((name) => {
  const mod = NATURE_MODIFIERS[name];
  return { name, plus: mod?.plus ?? null, minus: mod?.minus ?? null };
});

export function getNatureModifier(nature: string, stat: keyof StatSpread): number {
  const mod = NATURE_MODIFIERS[nature];
  if (!mod) return 1.0;
  if (mod.plus === stat) return 1.1;
  if (mod.minus === stat) return 0.9;
  return 1.0;
}

/**
 * Display label of a nature with its stat modifiers: "Adamant (+Atk / -SpA)" (default 'en', unchanged) or
 * "Hart (+Angr. / -Sp.-Angr.)" ('de'). Neutral and unknown natures return just the (localized) name.
 * `nature` stays the English key; only the label is localized. Imports only the misc name map (client-safe).
 */
export function getNatureLabel(nature: string, locale: DataLocale = 'en'): string {
  const mod = NATURE_MODIFIERS[nature];
  return localizeNatureLabel(nature, mod?.plus ?? '', mod?.minus ?? '', locale);
}

/* ─── Stat calculation ─────────────────────────────────────────────── */

export function calcStat(
  stat: keyof StatSpread,
  base: number,
  iv: number,
  ev: number,
  level: number,
  natureMod: number,
): number {
  if (stat === 'hp') {
    // Shedinja special case
    if (base === 1) return 1;
    return Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100) + level + 10;
  }
  return Math.floor(
    (Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100) + 5) * natureMod,
  );
}

/* ─── Stat bar colors (Pokemon Showdown HSL gradient) ─────────────── */

/**
 * Stats bar color interface — used everywhere base-stats or calculated-stats
 * bars are rendered in PokeTools.
 */
export interface StatBarColorResult {
  background: string;
  /** TODO: Wire up for stat-bar hover/focus border effect (has dedicated --stat-bar-light-hover CSS var). */
  border: string;
  /** TODO: Wire up for colored stat labels on/near bars (has dedicated --stat-bar-text-light CSS var). */
  text: string;
}

/** Fallback colors returned when maxStat is invalid (<= 0 or non-finite). */
const STAT_BAR_FALLBACK: StatBarColorResult = {
  background: '#666',
  border: '#666',
  text: '#fff',
};

/**
 * Returns stat-bar colors using Pokemon Showdown's continuous HSL hue gradient.
 *
 * Showdown's exact formula (client-teambuilder.js):
 *   hue = min(floor(stat * 180 / maxStat), 360)
 *
 * Colors are theme-aware via CSS custom properties:
 *   - Light theme: hsl(hue, 85%, 45%)  (saturated on white)
 *   - Dark theme:  hsl(hue, 85%, 55%)  (brighter on dark navy)
 *
 * For **base stats** (0–255), pass maxStat = 255 (default).
 * For **calculated stats** at level 100, use maxStat = 714 for HP, 499 for others.
 *
 * Hue reference (base stat → color, maxStat = 255):
 *   0   → 0°   Red
 *  30   → 21°  Red-orange
 *  50   → 35°  Orange-red
 *  65   → 46°  Orange
 *  80   → 56°  Orange-yellow
 *  95   → 67°  Yellow
 * 100   → 71°  Yellow
 * 130   → 92°  Chartreuse
 * 150   → 106° Spring green
 * 180   → 127° Teal
 * 230   → 162° Cyan
 * 255   → 180° Cyan (max)
 */
export function getStatBarColor(
  stat: number,
  maxStat: number = 255,
): StatBarColorResult {
  if (maxStat <= 0 || !Number.isFinite(maxStat)) return STAT_BAR_FALLBACK;
  const hue = Math.min(Math.floor((stat * 180) / maxStat), 360);
  return {
    background: `hsl(${hue} var(--stat-bar-sat) var(--stat-bar-light))`,
    border: `hsl(${hue} var(--stat-bar-sat) var(--stat-bar-light-hover))`,
    text: `hsl(${hue} var(--stat-bar-sat) var(--stat-bar-text-light))`,
  };
}

/**
 * Showdown's exact bar width formula.
 *
 *   width = min(stat * 180 / maxStat, maxWidth)
 *
 * Where maxWidth is 179 for large bars, 75 for small bars.
 * In CSS terms we return a percentage (0–100).
 */
export function getStatBarWidth(stat: number, maxStat: number = 255): number {
  if (maxStat <= 0 || !Number.isFinite(maxStat)) return 0;
  return Math.min((stat * 180) / maxStat, 180);
}

/**
 * Maximum reference stats used by Showdown for scaling.
 *
 * These represent the highest practical stat values at level 100
 * (e.g. Blissey HP = 714, Deoxys-A Atk = 499).
 */
export const SHOWDOWN_MAX_STATS = {
  hp: 714,
  atk: 499,
  def: 499,
  spa: 499,
  spd: 499,
  spe: 499,
} as const;

/** Convenience: calculate all 6 stats at once. */
export function calcAllStats(
  baseStats: StatSpread,
  ivs: Partial<StatSpread> | undefined,
  evs: Partial<StatSpread> | undefined,
  nature: string,
  level: number,
): StatSpread {
  const result = {} as StatSpread;
  for (const stat of STAT_KEYS) {
    result[stat] = calcStat(
      stat,
      baseStats[stat],
      ivs?.[stat] ?? 31,
      evs?.[stat] ?? 0,
      level,
      getNatureModifier(nature, stat),
    );
  }
  return result;
}

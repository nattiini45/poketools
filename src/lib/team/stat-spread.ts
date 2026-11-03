import type { Locale } from '@/i18n/config';
import { localizeStat } from '@/lib/pkmn/i18n/names/misc';
import type { StatSpread } from '@/types/team';

const STAT_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const satisfies readonly (keyof StatSpread)[];

/**
 * "252 Atk / 4 SpD / 252 Spe" with the stat abbreviations of `locale`
 * ("252 Angr. / …" in German). Pass `'en'` for Showdown paste text, which
 * stays English. `include` picks the stats to list (EVs: `> 0`, IVs: `!== 31`).
 */
export function formatStatSpread(spread: StatSpread, include: (value: number) => boolean, locale: Locale): string {
  const parts: string[] = [];
  for (const key of STAT_KEYS) {
    if (include(spread[key])) parts.push(`${spread[key]} ${localizeStat(key, locale, 'short')}`);
  }
  return parts.join(' / ');
}

export const hasEv = (value: number): boolean => value > 0;
export const hasCustomIv = (value: number): boolean => value !== 31;

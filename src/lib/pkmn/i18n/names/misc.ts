/**
 * Types, natures, stats, status, weather, terrain and move categories (design pkmn-l10n.md §3.2).
 * Client-safe; imports only `data/misc.de.json` (0.8 KB gzip), so `TypeBadge` & co. stay small.
 *
 * Inputs are the English keys the app stores ('Fire', 'Adamant', 'atk', 'brn', 'Sun', 'Electric', 'Physical').
 * 'en' returns the English label; 'de' the German one, else the input.
 */
import misc from '../data/misc.de.json';
import type { DataLocale, MoveCategory, StatKey, StatusKey, TerrainKey, WeatherKey } from '../types';
import { makeLookup, makeSearchKeys } from './lookup';
import type { SearchKeys } from '../search';

const typeLookup = makeLookup(misc.types);
const natureLookup = makeLookup(misc.natures);

const EN_STAT_SHORT: Readonly<Record<StatKey, string>> = {
  hp: 'HP',
  atk: 'Atk',
  def: 'Def',
  spa: 'SpA',
  spd: 'SpD',
  spe: 'Spe',
};
const EN_STAT_LONG: Readonly<Record<StatKey, string>> = {
  hp: 'HP',
  atk: 'Attack',
  def: 'Defense',
  spa: 'Sp. Atk',
  spd: 'Sp. Def',
  spe: 'Speed',
};
const EN_STATUS_SHORT: Readonly<Record<StatusKey, string>> = {
  brn: 'BRN',
  par: 'PAR',
  psn: 'PSN',
  tox: 'TOX',
  slp: 'SLP',
  frz: 'FRZ',
};
const EN_STATUS_LONG: Readonly<Record<StatusKey, string>> = {
  brn: 'Burn',
  par: 'Paralysis',
  psn: 'Poison',
  tox: 'Bad Poison',
  slp: 'Sleep',
  frz: 'Freeze',
};

/** German type name, or undefined. `'???'` (empty id) has none. */
export function germanType(englishNameOrId: string): string | undefined {
  return typeLookup(englishNameOrId);
}

/** 'Fire' → 'Feuer'; 'Stellar' → 'Stellar'; '???' → '???'. */
export function localizeType(name: string, l: DataLocale): string {
  if (l === 'en') return name;
  return germanType(name) ?? name;
}

export function germanNature(englishNameOrId: string): string | undefined {
  return natureLookup(englishNameOrId);
}

/** 'Adamant' → 'Hart'. */
export function localizeNature(name: string, l: DataLocale): string {
  if (l === 'en') return name;
  return germanNature(name) ?? name;
}

/** en short HP/Atk/Def/SpA/SpD/Spe (= `stat-calc.ts` STAT_LABELS); en long HP/Attack/Defense/Sp. Atk/Sp. Def/Speed. */
export function localizeStat(stat: StatKey, l: DataLocale, form: 'short' | 'long' = 'short'): string {
  if (l === 'en') return form === 'short' ? EN_STAT_SHORT[stat] : EN_STAT_LONG[stat];
  return misc.stats[form][stat];
}

/** en short BRN/PAR/PSN/TOX/SLP/FRZ; en long Burn/Paralysis/Poison/Bad Poison/Sleep/Freeze. */
export function localizeStatus(s: StatusKey, l: DataLocale, form: 'short' | 'long' = 'short'): string {
  if (l === 'en') return form === 'short' ? EN_STATUS_SHORT[s] : EN_STATUS_LONG[s];
  return misc.status[s][form];
}

/** The English key itself in 'en' ('Sun', 'Harsh Sunshine'); 'Sonne', 'Extremes Sonnenlicht' in 'de'. */
export function localizeWeather(w: WeatherKey, l: DataLocale): string {
  if (l === 'en') return w;
  return misc.weather[w];
}

/** The English key itself in 'en' ('Electric'); the terrain move name in 'de' ('Elektrofeld'). */
export function localizeTerrain(t: TerrainKey, l: DataLocale): string {
  if (l === 'en') return t;
  return misc.terrain[t];
}

/** 'Physical' → 'Physisch', 'Special' → 'Spezial', 'Status' → 'Status'. */
export function localizeMoveCategory(c: MoveCategory, l: DataLocale): string {
  if (l === 'en') return c;
  return misc.categories[c];
}

/**
 * "Adamant (+Atk / -SpA)" | "Hart (+Angr. / -Sp.-Angr.)". A neutral nature (no plus or minus, or plus = minus)
 * returns just the localized name. Same shape as `getNatureLabel` (`src/lib/pkmn/stat-calc.ts`).
 */
export function localizeNatureLabel(nature: string, plus: StatKey | '', minus: StatKey | '', l: DataLocale): string {
  const name = localizeNature(nature, l);
  if (!plus || !minus || plus === minus) return name;
  return `${name} (+${localizeStat(plus, l, 'short')} / -${localizeStat(minus, l, 'short')})`;
}

/** English + German + transliteration keys of a type. */
export const typeSearchKeys: (englishName: string) => SearchKeys = makeSearchKeys(germanType);

/** English + German + transliteration keys of a nature. */
export const natureSearchKeys: (englishName: string) => SearchKeys = makeSearchKeys(germanNature);

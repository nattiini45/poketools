/**
 * Barrel of the Pokémon name layer plus the cross-kind helpers (design pkmn-l10n.md §3.2).
 *
 * Imports all five name maps (~32 KB gzip). A module that needs one kind imports `./names/<kind>` instead
 * (import rule §3.1, enforced by `client-boundary.test.ts` and PK-4's chokepoint test). The barrel is for code
 * that genuinely needs several kinds: the draft finder, `PkmnName`, param localization, server code.
 *
 * Stored values, URLs, Showdown text, calc input and AI prompts stay English; only display translates.
 */
import type { PkmnNameKind, PkmnParamLocalizer } from '@/i18n/pkmn-seam';
import { searchVariantsOf, type SearchKeys } from './search';
import type { DataLocale, MoveCategory, PkmnKind, StatKey, StatusKey, TerrainKey, WeatherKey } from './types';
import { abilitySearchKeys, germanAbility, localizeAbility } from './names/abilities';
import { germanItem, itemSearchKeys, localizeItem } from './names/items';
import {
  germanNature,
  germanType,
  localizeMoveCategory,
  localizeNature,
  localizeStat,
  localizeStatus,
  localizeTerrain,
  localizeType,
  localizeWeather,
  natureSearchKeys,
  typeSearchKeys,
} from './names/misc';
import { germanMove, localizeMove, moveSearchKeys } from './names/moves';
import { germanSpecies, localizeSpecies, speciesSearchKeys } from './names/species';

export * from './names/species';
export * from './names/moves';
export * from './names/items';
export * from './names/abilities';
export * from './names/misc';
export { toID } from './id';
export type { SearchKeys } from './search';
export type { DataLocale, MoveCategory, PkmnKind, StatKey, StatusKey, TerrainKey, WeatherKey } from './types';

const GERMAN: Readonly<Record<PkmnKind, (englishNameOrId: string) => string | undefined>> = {
  species: germanSpecies,
  move: germanMove,
  item: germanItem,
  ability: germanAbility,
  type: germanType,
  nature: germanNature,
};

const LOCALIZE: Readonly<Record<PkmnKind, (name: string, l: DataLocale) => string>> = {
  species: localizeSpecies,
  move: localizeMove,
  item: localizeItem,
  ability: localizeAbility,
  type: localizeType,
  nature: localizeNature,
};

const SEARCH_KEYS: Readonly<Record<PkmnKind, (englishName: string) => SearchKeys>> = {
  species: speciesSearchKeys,
  move: moveSearchKeys,
  item: itemSearchKeys,
  ability: abilitySearchKeys,
  type: typeSearchKeys,
  nature: natureSearchKeys,
};

/** German name of one entity, or undefined (no fallback). */
export function germanName(kind: PkmnKind, englishNameOrId: string): string | undefined {
  return GERMAN[kind](englishNameOrId);
}

/** The display name of one entity in `l`; 'en' returns the input unchanged. */
export function localizeName(kind: PkmnKind, englishName: string, l: DataLocale): string {
  return LOCALIZE[kind](englishName, l);
}

/** English + German + transliteration keys for one entity. Always both languages, whatever the locale. */
export function pkmnSearchKeys(kind: PkmnKind, englishName: string): SearchKeys {
  return SEARCH_KEYS[kind](englishName);
}

/**
 * The folded name variants, one string per language form, deduped: fold(en), fold(de), transliterateGerman(de).
 * For callers with their own matching rules (the draft finder's word-prefix search, critique S7).
 */
export function pkmnSearchVariants(kind: PkmnKind, englishName: string): readonly string[] {
  return searchVariantsOf([englishName, GERMAN[kind](englishName)]);
}

const STAT_KEYS: ReadonlySet<string> = new Set<StatKey>(['hp', 'atk', 'def', 'spa', 'spd', 'spe']);
const STATUS_KEYS: ReadonlySet<string> = new Set<StatusKey>(['brn', 'par', 'psn', 'tox', 'slp', 'frz']);
const WEATHER_KEYS: ReadonlySet<string> = new Set<WeatherKey>([
  'Sun',
  'Rain',
  'Sand',
  'Snow',
  'Hail',
  'Harsh Sunshine',
  'Heavy Rain',
  'Strong Winds',
]);
const TERRAIN_KEYS: ReadonlySet<string> = new Set<TerrainKey>(['Electric', 'Grassy', 'Misty', 'Psychic']);
const CATEGORY_KEYS: ReadonlySet<string> = new Set<MoveCategory>(['Physical', 'Special', 'Status']);

const isStatKey = (v: string): v is StatKey => STAT_KEYS.has(v);
const isStatusKey = (v: string): v is StatusKey => STATUS_KEYS.has(v);
const isWeatherKey = (v: string): v is WeatherKey => WEATHER_KEYS.has(v);
const isTerrainKey = (v: string): v is TerrainKey => TERRAIN_KEYS.has(v);
const isMoveCategory = (v: string): v is MoveCategory => CATEGORY_KEYS.has(v);

function localizeParam(kind: PkmnNameKind, value: string, l: DataLocale): string {
  switch (kind) {
    case 'species':
    case 'move':
    case 'item':
    case 'ability':
    case 'type':
    case 'nature':
      return LOCALIZE[kind](value, l);
    case 'stat':
      return isStatKey(value) ? localizeStat(value, l, 'long') : value;
    case 'statShort':
      return isStatKey(value) ? localizeStat(value, l, 'short') : value;
    case 'status':
      return isStatusKey(value) ? localizeStatus(value, l, 'long') : value;
    case 'weather':
      return isWeatherKey(value) ? localizeWeather(value, l) : value;
    case 'terrain':
      return isTerrainKey(value) ? localizeTerrain(value, l) : value;
    case 'category':
      return isMoveCategory(value) ? localizeMoveCategory(value, l) : value;
    default:
      return value;
  }
}

/**
 * CORE's `PkmnParamLocalizer` (`src/i18n/pkmn-seam.ts`) for `useApiErrorTextWithPkmn` and server error text.
 * The six `PkmnKind`s take English names; 'stat' / 'statShort' a `StatKey`; 'status' a `StatusKey`;
 * 'weather' / 'terrain' / 'category' their English keys. Unknown input is returned unchanged.
 */
export function pkmnParamLocalizer(l: DataLocale): PkmnParamLocalizer {
  return (kind, englishNameOrId) => localizeParam(kind, englishNameOrId, l);
}

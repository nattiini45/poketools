/**
 * Teambuilder v3 constants. Every list holds canonical English keys (stored in sets, sent to the
 * calc/dex APIs); display labels come from the pkmn layer (`localizeType`, `localizeNature`,
 * `localizeStat` in `@/lib/pkmn/i18n/names/misc`), never from these values (pkmn-l10n §5.2 rule 3).
 */
export const TYPE_NAMES = [
  'Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice',
  'Fighting', 'Poison', 'Ground', 'Flying', 'Psychic', 'Bug',
  'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy',
] as const;

export type TypeName = (typeof TYPE_NAMES)[number];

export const TERA_TYPES = [...TYPE_NAMES, 'Stellar'] as const;

export type TeraType = (typeof TERA_TYPES)[number];

export const NATURE_DATA = [
  ['Hardy', '', ''], ['Lonely', 'atk', 'def'], ['Brave', 'atk', 'spe'],
  ['Adamant', 'atk', 'spa'], ['Naughty', 'atk', 'spd'],
  ['Bold', 'def', 'atk'], ['Docile', '', ''], ['Relaxed', 'def', 'spe'],
  ['Impish', 'def', 'spa'], ['Lax', 'def', 'spd'],
  ['Timid', 'spe', 'atk'], ['Hasty', 'spe', 'def'], ['Serious', '', ''],
  ['Jolly', 'spe', 'spa'], ['Naive', 'spe', 'spd'],
  ['Modest', 'spa', 'atk'], ['Mild', 'spa', 'def'], ['Quiet', 'spa', 'spe'],
  ['Bashful', '', ''], ['Rash', 'spa', 'spd'],
  ['Calm', 'spd', 'atk'], ['Gentle', 'spd', 'def'], ['Sassy', 'spd', 'spe'],
  ['Careful', 'spd', 'spa'], ['Quirky', '', ''],
] as const satisfies readonly (readonly [string, string, string])[];

export type NatureEntry = (typeof NATURE_DATA)[number];

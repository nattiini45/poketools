import type { CatalogEntry, CatalogKind } from '@/lib/pkmn/catalog-index';
import { localizeAbility } from '@/lib/pkmn/i18n/names/abilities';
import { localizeItem } from '@/lib/pkmn/i18n/names/items';
import { localizeMove } from '@/lib/pkmn/i18n/names/moves';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import type { DataLocale } from '@/lib/pkmn/i18n/types';
import type { RulesetCategory } from '@/lib/ruleset-kit/types';

/** The catalog kind a category reads: the ruleset says "pokemon", the catalog says "species". */
export const KIND_OF: Record<RulesetCategory, CatalogKind> = {
  pokemon: 'species',
  moves: 'moves',
  items: 'items',
  abilities: 'abilities',
};

const LOCALIZE: Record<CatalogKind, (name: string, locale: DataLocale) => string> = {
  species: localizeSpecies,
  moves: localizeMove,
  items: localizeItem,
  abilities: localizeAbility,
};

/** The display name of an English name of the given kind in the reader's data language. */
export function displayNameOf(kind: CatalogKind, englishName: string, locale: DataLocale): string {
  return LOCALIZE[kind](englishName, locale);
}

/** The display name of an entry in the reader's data language. */
export function displayName(entry: CatalogEntry, locale: DataLocale): string {
  return displayNameOf(entry.kind, entry.name, locale);
}

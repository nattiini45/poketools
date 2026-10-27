import { SPECIES_FLAG, type CatalogIndex, type ItemRow, type MoveRow, type SpeciesRow } from '@/lib/pkmn/catalog-index';
import { buildEntryIndex } from '../../../editor/picker/entry-index';

/** A small species catalog: a family with formes, tiers of both kinds, a pre-evolution, a German-named species. */
export const SPECIES_ROWS: SpeciesRow[] = [
  ['charizard', 'Charizard', ['Fire', 'Flying'], 'UU', 'DOU', 'UU', 0, [78, 84, 78, 109, 85, 100], 1, 0, 6],
  ['charizardmegax', 'Charizard-Mega-X', ['Fire', 'Dragon'], 'Illegal', 'Illegal', 'Uber', 'charizard', [78, 130, 111, 130, 85, 100], 6, SPECIES_FLAG.FORME | SPECIES_FLAG.MEGA | SPECIES_FLAG.PAST, 7],
  ['charizardmegay', 'Charizard-Mega-Y', ['Fire', 'Flying'], 'Illegal', 'Illegal', 'OU', 'charizard', [78, 104, 78, 159, 115, 100], 6, SPECIES_FLAG.FORME | SPECIES_FLAG.MEGA | SPECIES_FLAG.PAST, 8],
  ['charmander', 'Charmander', ['Fire'], 'LC', 'LC', 'LC', 0, [39, 52, 43, 60, 50, 65], 1, SPECIES_FLAG.NFE, 1],
  ['garchomp', 'Garchomp', ['Dragon', 'Ground'], 'OU', 'DUU', 'OU', 0, [108, 130, 95, 80, 85, 102], 4, 0, 3],
  ['koraidon', 'Koraidon', ['Fighting', 'Dragon'], 'Uber', 'DUber', 'Uber', 0, [100, 135, 115, 85, 100, 135], 9, 0, 4],
  ['pikachu', 'Pikachu', ['Electric'], '(PU)', '(DUU)', 'NFE', 0, [35, 55, 40, 50, 50, 90], 1, SPECIES_FLAG.NFE, 5],
  ['rattata', 'Rattata', ['Normal'], 'Illegal', 'Illegal', 'Illegal', 0, [30, 56, 35, 25, 35, 72], 1, SPECIES_FLAG.NFE, null],
  ['rattataalola', 'Rattata-Alola', ['Dark', 'Normal'], 'Illegal', 'Illegal', 'Illegal', 'rattata', [30, 56, 35, 25, 35, 72], 7, SPECIES_FLAG.FORME | SPECIES_FLAG.NFE, null],
];

export const MOVE_ROWS: MoveRow[] = [
  ['earthquake', 'Earthquake', 'Ground', 0, 100, 100, 10, 1, 0],
  ['swift', 'Swift', 'Normal', 1, 60, 0, 20, 1, 0],
  ['spore', 'Spore', 'Grass', 2, 0, 100, 15, 1, 0],
  ['flamethrower', 'Flamethrower', 'Fire', 1, 90, 100, 15, 1, 0],
];

export const ITEM_ROWS: ItemRow[] = [
  ['leftovers', 'Leftovers', 6, 2, 242, 0],
  ['choiceband', 'Choice Band', 5, 3, 100, 0],
  ['oranberry', 'Oran Berry', 0, 3, 50, 0],
  // Names that interleave the categories when the list is sorted by name alone.
  ['absorbbulb', 'Absorb Bulb', 6, 5, null, 0],
  ['aguavberry', 'Aguav Berry', 0, 3, null, 0],
  ['airballoon', 'Air Balloon', 6, 5, null, 0],
];

export function speciesIndex() {
  const index: CatalogIndex<'species'> = { v: 1, kind: 'species', gen: 9, scope: 'national', preset: null, rows: SPECIES_ROWS };
  return buildEntryIndex(index);
}

export function moveIndex() {
  const index: CatalogIndex<'moves'> = { v: 1, kind: 'moves', gen: 9, scope: 'standard', preset: null, rows: MOVE_ROWS };
  return buildEntryIndex(index);
}

export function itemIndex() {
  const index: CatalogIndex<'items'> = { v: 1, kind: 'items', gen: 9, scope: 'standard', preset: null, rows: ITEM_ROWS };
  return buildEntryIndex(index);
}

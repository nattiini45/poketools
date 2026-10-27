import 'server-only';
/**
 * The cell numbers of the Showdown icon sheets, computed from the installed `@pkmn/img` (the only place that knows
 * them). The catalog index ships the number (`ic`) and the browser draws the cell with CSS (`SheetIcon`), so `@pkmn/img`
 * never reaches a client bundle and no icon needs a request of its own.
 *
 * `@pkmn/img` answers cell 0 for a name it does not know, which is indistinguishable from the real first cell. Cell 0 of
 * both sheets is a placeholder, so 0 is reported as `null` ("no art"): the picker then draws its own fallback. Known
 * gaps (measured against the installed version): 18 Pokémon and the 16 Legends Z-A Mega Stones have no icon.
 *
 * The cells follow the installed `@pkmn/img`; if Showdown rebuilds a sheet and the package lags, icons drift. The
 * tests pin a few known cells (Charizard, Leftovers) and `docs/pkmn.md` says to re-check after upgrading the package.
 */
import { Icons } from '@pkmn/img';
import { ITEM_SHEET, POKEMON_SHEET, sheetCell } from './catalog-index';

const pokemonCells = new Map<string, number | null>();
const itemCells = new Map<string, number | null>();

function cellOf(left: number, top: number, sheet: typeof POKEMON_SHEET | typeof ITEM_SHEET): number | null {
  const cell = sheetCell(sheet, left, top);
  return Number.isInteger(cell) && cell > 0 ? cell : null;
}

/** The cell of a Pokémon's icon (a canonical English name such as `Charizard-Mega-X`), or `null` when the sheet has none. */
export function pokemonIconCell(name: string): number | null {
  let cell = pokemonCells.get(name);
  if (cell === undefined) {
    const icon = Icons.getPokemon(name);
    cell = cellOf(icon.left, icon.top, POKEMON_SHEET);
    pokemonCells.set(name, cell);
  }
  return cell;
}

/** The cell of an item's icon (a canonical English name such as `Choice Band`), or `null` when the sheet has none. */
export function itemIconCell(name: string): number | null {
  let cell = itemCells.get(name);
  if (cell === undefined) {
    const icon = Icons.getItem(name);
    cell = cellOf(icon.left, icon.top, ITEM_SHEET);
    itemCells.set(name, cell);
  }
  return cell;
}

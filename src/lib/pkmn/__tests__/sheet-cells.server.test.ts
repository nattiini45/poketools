import { describe, expect, it } from 'vitest';
import { ITEM_SHEET, POKEMON_SHEET, sheetCell, sheetOffset } from '../catalog-index';
import { itemIconCell, pokemonIconCell } from '../sheet-cells.server';

describe('sheet cells', () => {
  it('turns the installed @pkmn/img offsets into cell numbers', () => {
    // Charizard: left -240, top 0 on the 12-column Pokémon sheet.
    expect(pokemonIconCell('Charizard')).toBe(6);
    // Leftovers: left -48, top -360 on the 16-column item sheet.
    expect(itemIconCell('Leftovers')).toBe(15 * 16 + 2);
    // Charizard-Mega-X: left -40, top -3300.
    expect(pokemonIconCell('Charizard-Mega-X')).toBe(110 * 12 + 1);
  });

  it('reports cell 0 (the sheets\' answer for a name they do not know) as no art', () => {
    expect(pokemonIconCell('Definitely Not A Pokemon')).toBeNull();
    expect(itemIconCell('Definitely Not An Item')).toBeNull();
    // A Legends Z-A Mega Stone has no icon on the sheet.
    expect(itemIconCell('Baxcalibrite')).toBeNull();
  });

  it('the offset helpers invert each other', () => {
    for (const sheet of [POKEMON_SHEET, ITEM_SHEET]) {
      for (const cell of [1, 5, 11, 12, 13, 255, 1000]) {
        const { left, top } = sheetOffset(sheet, cell);
        expect(sheetCell(sheet, left, top)).toBe(cell);
      }
    }
  });
});

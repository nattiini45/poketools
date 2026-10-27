import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import SheetIcon from '../SheetIcon';

describe('SheetIcon', () => {
  it('draws one cell of the Pokémon sheet with CSS: offset, size and sheet width scale together', () => {
    // Cell 13: column 1, row 1 of the 12-column sheet of 40x30 cells.
    const html = renderToStaticMarkup(<SheetIcon sheet="pokemon" cell={13} scale={2} />);
    expect(html).toContain('width:80px');
    expect(html).toContain('height:60px');
    expect(html).toContain('background-position:-80px -60px');
    expect(html).toContain('background-size:960px auto');
    expect(html).toContain('pokemonicons-sheet.png');
    expect(html).toContain('image-rendering:pixelated');
    expect(html).toContain('aria-hidden="true"');
  });

  it('draws one cell of the item sheet (16 columns of 24 pixels)', () => {
    // Leftovers: column 2, row 15.
    const html = renderToStaticMarkup(<SheetIcon sheet="item" cell={242} />);
    expect(html).toContain('width:24px');
    expect(html).toContain('background-position:-48px -360px');
    expect(html).toContain('background-size:384px auto');
    expect(html).toContain('itemicons-sheet.png');
  });

  it('is decoration unless it is given a name', () => {
    const named = renderToStaticMarkup(<SheetIcon sheet="item" cell={1} label="Leftovers" />);
    expect(named).toContain('role="img"');
    expect(named).toContain('aria-label="Leftovers"');
    expect(named).not.toContain('aria-hidden');
  });
});

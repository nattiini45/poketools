import { ITEM_SHEET, POKEMON_SHEET, sheetOffset } from '@/lib/pkmn/catalog-index';

interface SheetIconProps {
  /** Which Showdown icon sheet the cell is on. */
  sheet: 'pokemon' | 'item';
  /** The cell number the catalog index ships (`ic`). */
  cell: number;
  /** Whole-number scale of the pixel art (1 = native 40x30 / 24x24). */
  scale?: number;
  /** An accessible name; without one the icon is decoration (`aria-hidden`). */
  label?: string;
  className?: string;
}

/**
 * One icon of a Showdown icon sheet, drawn with CSS: the sheet is a single image (cached after the first request), so a
 * list of a thousand icons costs one download and no `@pkmn` code in the browser. The cell number comes from the server
 * (`sheet-cells.server.ts`). Pixel art stays crisp (`image-rendering: pixelated`) at whole-number scales.
 */
export default function SheetIcon({ sheet, cell, scale = 1, label, className }: SheetIconProps) {
  const geometry = sheet === 'pokemon' ? POKEMON_SHEET : ITEM_SHEET;
  const { left, top } = sheetOffset(geometry, cell);
  return (
    <span
      role={label === undefined ? undefined : 'img'}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
      className={`inline-block shrink-0 ${className ?? ''}`}
      style={{
        width: geometry.cellWidth * scale,
        height: geometry.cellHeight * scale,
        backgroundImage: `url(${geometry.url})`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: `${left * scale}px ${top * scale}px`,
        backgroundSize: `${geometry.columns * geometry.cellWidth * scale}px auto`,
        imageRendering: 'pixelated',
      }}
    />
  );
}

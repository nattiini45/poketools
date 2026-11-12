/**
 * The table of the admin overview and system pages (redesign A13): one frame, one head, one row and one cell recipe,
 * the same ones the competition list uses, so every admin table reads as the same table. Below `xl` every table
 * display value is switched off and a row is a stacked card: a two-column grid with the name and the row's action
 * on the first line, and the other cells below it, each printing its column name from `data-label`. From `xl` it
 * is an ordinary table.
 */

/** A button or link control is a full 44 px target on a phone and text-sized from `sm` up. */
export const TOUCH = 'min-h-11 sm:min-h-0';

export const TABLE_FRAME = 'rounded-poke-lg border border-hairline bg-surface xl:overflow-x-auto';

export const TABLE = 'block w-full border-collapse text-left text-body xl:table';

export const THEAD = 'sr-only xl:not-sr-only xl:table-header-group';

export const TH = 'bg-elevated px-3 py-2 text-caption font-[550] text-fg-muted first:rounded-tl-poke-lg last:rounded-tr-poke-lg';

export const TBODY = 'block divide-y divide-hairline xl:table-row-group';

export const ROW = 'grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-3 py-3 xl:table-row xl:p-0 xl:hover:bg-hover';

/** A cell: below `xl` it spans the card and prints its column name in front of its value. */
export const CELL =
  'flex items-baseline gap-3 py-0.5 max-xl:col-span-2 before:w-24 before:shrink-0 before:text-caption before:text-fg-muted before:content-[attr(data-label)] xl:table-cell xl:px-3 xl:py-3 xl:align-top xl:before:content-none';

/** The name cell: the row header, never labelled, at the start of the card's first line. */
export const NAME_CELL = 'block min-w-0 pb-2 text-left font-normal max-xl:col-start-1 max-xl:row-start-1 xl:table-cell xl:px-3 xl:py-3 xl:align-top';

/** The last cell: the row's action, never labelled, at the end of the card's first line. */
export const ACTION_CELL = 'block max-xl:col-start-2 max-xl:row-start-1 max-xl:self-start xl:table-cell xl:px-3 xl:py-3 xl:align-top xl:text-right';

/** A text link inside a table or a list row. */
export const ROW_LINK =
  'font-[550] text-fg underline-offset-2 hover:text-accent-ink hover:underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]';

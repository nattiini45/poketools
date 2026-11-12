/**
 * The table of the competition list and of the league trash: one frame, one head, one row and one cell recipe, so the
 * five lists and the trash read as the same table. Below `xl` every table display value is switched off and a row
 * is a stacked card: a two-column grid with the name and the row's action on the first line, and the other cells
 * below it, each printing its column name from `data-label`. From `xl` it is an ordinary table.
 */

/** A button or link control is a full 44 px target on a phone and text-sized from `sm` up. */
export const TOUCH = 'min-h-11 sm:min-h-0';

export const TABLE_FRAME = 'rounded-poke-lg border border-hairline bg-surface xl:overflow-x-auto';

export const TABLE = 'block w-full border-collapse text-left text-body xl:table xl:min-w-[60rem]';

export const THEAD = 'sr-only xl:not-sr-only xl:table-header-group';

export const TH = 'bg-elevated px-3 py-2 text-caption font-[550] text-fg-muted';

export const TBODY = 'block divide-y divide-hairline xl:table-row-group';

export const ROW = 'grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-3 py-3 xl:table-row xl:p-0 xl:hover:bg-hover';

/** A cell: below `xl` it spans the card and prints its column name in front of its value. */
export const CELL =
  'flex items-baseline gap-3 py-0.5 max-xl:col-span-2 before:w-24 before:shrink-0 before:text-caption before:text-fg-muted before:content-[attr(data-label)] xl:table-cell xl:px-3 xl:py-3 xl:align-middle xl:before:content-none';

/** The name cell: the row header, never labelled, at the start of the card's first line. */
export const NAME_CELL = 'block min-w-0 pb-2 text-subtitle max-xl:col-start-1 max-xl:row-start-1 xl:table-cell xl:px-3 xl:py-3 xl:align-middle xl:text-body';

/** The last cell: the row's action, never labelled, at the end of the card's first line. */
export const ACTION_CELL = 'block max-xl:col-start-2 max-xl:row-start-1 max-xl:self-start xl:table-cell xl:px-3 xl:py-3 xl:align-middle';

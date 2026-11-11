/**
 * The league hub's surfaces (redesign B2). The hub sits above the themed world on the site's own tokens, so these
 * replace the world panel recipes (`components/world/panel.ts`, frozen with the worlds) inside the hub. The
 * `arena-*` utilities the panels still use resolve to the same site tokens outside a world root.
 */

/** The hub card. */
export const HUB_PANEL = 'rounded-poke-lg border border-hairline bg-surface';

/** A block inside the hub card (a group table, a match row, a phase card). */
export const HUB_INSET = 'rounded-poke-md border border-hairline bg-elevated';

/** A table head row: sentence case, the caption role. */
export const HUB_TABLE_HEAD = 'border-b border-hairline-strong bg-elevated text-caption font-[550] text-fg-muted';

/** A small heading over a block inside a panel. */
export const HUB_SUBHEADING = 'text-subtitle font-[550] text-fg';

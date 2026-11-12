/**
 * Shared surface class strings — the app-wide twin of the world panel
 * contract (`src/components/world/panel.ts`). Same recipes expressed with
 * `poke-*` tokens instead of `arena-*`; since the base palette and the world
 * tokens share values, the two layers stay visually identical.
 *
 * Every panel, table header and focusable control composes from these so
 * radius, border and fill never drift page to page. Pure strings — no
 * runtime, safe to import from server components.
 */

/** Primary panel: the main content surface in a section. */
export const PANEL = 'rounded-poke-lg border border-poke-border bg-poke-surface';

/** Inset panel: a raised block sitting inside a primary panel, or a chip row. */
export const PANEL_INSET = 'rounded-poke-md border border-poke-border bg-poke-elevated';

/** Focus ring used by every interactive element. */
export const FOCUS_RING =
  'focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'focus-visible:outline-poke-focus';

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

/** Empty-state / notice panel. Same surface, roomier padding, quieter ink. */
export const PANEL_NOTICE =
  'rounded-poke-lg border border-poke-border bg-poke-elevated p-6 text-sm text-poke-text-secondary';

/**
 * Interactive lift for a panel that is itself a link or button target.
 * Transform is suppressed under reduced motion; the border and shadow change
 * remain so the affordance never disappears.
 */
export const PANEL_HOVER =
  'transition-[transform,box-shadow,border-color] duration-150 ease-out ' +
  'hover:-translate-y-0.5 hover:border-poke-accent hover:shadow-poke-card-hover ' +
  'motion-reduce:transform-none motion-reduce:transition-none';

/** Focus ring used by every interactive element. */
export const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'focus-visible:outline-poke-focus';

/** Table header row treatment. */
export const TABLE_HEAD =
  'border-b border-poke-border bg-poke-elevated text-xs uppercase tracking-wide text-poke-text-secondary';

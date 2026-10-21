/**
 * Shared arena surface class strings for the EvoLiga world.
 *
 * Every panel in the scrollworld and its overlays composes from these so
 * radius, border and fill never drift section to section. Pure strings — no
 * runtime, safe to import from server components.
 */

/** Primary panel: the main content surface inside a section. */
export const PANEL = 'rounded-xl border border-arena-border bg-arena-surface';

/** Inset panel: a raised block sitting inside a primary panel, or a chip row. */
export const PANEL_INSET = 'rounded-lg border border-arena-border bg-arena-elevated';

/** Empty-state / notice panel. Same surface, roomier padding, quieter ink. */
export const PANEL_NOTICE =
  'rounded-xl border border-arena-border bg-arena-elevated p-6 text-sm text-arena-ink-secondary';

/**
 * Interactive lift for a panel that is itself a link or button target.
 * Transform is suppressed under reduced motion; the border and shadow change
 * remain so the affordance never disappears.
 */
export const PANEL_HOVER =
  'transition-[transform,box-shadow,border-color] duration-150 ease-out ' +
  'hover:-translate-y-0.5 hover:border-arena-accent hover:shadow-lg ' +
  'motion-reduce:transform-none motion-reduce:transition-none';

/** Focus ring used by every interactive element inside the world. */
export const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'focus-visible:outline-arena-focus';

/** Table header row treatment shared by the roster and standings tables. */
export const TABLE_HEAD =
  'border-b border-arena-border bg-arena-elevated text-xs uppercase tracking-wide text-arena-ink-secondary';

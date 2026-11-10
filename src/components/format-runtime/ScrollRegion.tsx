import type { ReactNode } from 'react';

export interface ScrollRegionProps {
  /** Names the region for assistive tech; reuse the table's caption. */
  label: string;
  children: ReactNode;
  className?: string;
  /** Extra data attributes of the old wrapper (`data-live-domains`, ...). */
  [dataAttribute: `data-${string}`]: string | boolean | undefined;
}

/**
 * The bordered, horizontally scrolling box around a wide data table. A scroll container without a focusable child is
 * not in the tab order, so a keyboard-only user could never reach the cut-off columns; `tabIndex={0}` with a region
 * role and a name makes it focusable and announced (axe: scrollable-region-focusable). Tables that hold buttons
 * need no wrapper like this: their controls already take focus and scroll the box into view.
 */
export default function ScrollRegion({ label, children, className = '', ...rest }: ScrollRegionProps) {
  return (
    <div
      {...rest}
      role="region"
      aria-label={label}
      tabIndex={0}
      className={`overflow-x-auto rounded-poke-md border border-poke-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-transparent focus-visible:ring-2 focus-visible:ring-poke-border-focus ${className}`.trim()}
    >
      {children}
    </div>
  );
}

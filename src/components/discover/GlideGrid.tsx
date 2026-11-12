'use client';

import { createContext, useContext, useRef, type ReactNode } from 'react';
import { FluidHoverHighlight } from '@/components/ui/fluid/fluid-hover-highlight';
import { useFluidHover, useRegisterFluidHoverItem } from '@/hooks/fluid/use-fluid-hover';
import { cn } from '@/lib/utils/cn';

type RegisterItem = (index: number, element: HTMLElement | null) => void;

const GlideGridContext = createContext<RegisterItem | undefined>(undefined);

/**
 * A grid of link tiles with one @fluid hover highlight that glides from tile to tile (the roster of a character
 * select). The highlight is drawn over the tiles' own ground and under their content, so each `GlideGridItem` keeps
 * its surface and the lit tile reads as the same tile, raised. Keyboard focus keeps the tiles' own focus ring.
 */
export function GlideGrid({ className, children }: { className?: string; children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hover = useFluidHover(containerRef, { axis: 'xy', gapClick: false });
  return (
    <GlideGridContext.Provider value={hover.registerItem}>
      <div ref={containerRef} className={cn('relative', className)} {...hover.handlers}>
        <FluidHoverHighlight hover={hover} className="z-10 rounded-poke-lg border border-hairline-strong bg-hover" />
        {children}
      </div>
    </GlideGridContext.Provider>
  );
}

/** One tile of a `GlideGrid`. `className` styles the tile's ground; the content sits above the highlight. */
export function GlideGridItem({ index, className, children }: { index: number; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useRegisterFluidHoverItem(useContext(GlideGridContext), index, ref);
  return (
    <div ref={ref} className={cn('rounded-poke-lg border border-hairline bg-surface', className)}>
      <div className="relative z-20 h-full">{children}</div>
    </div>
  );
}

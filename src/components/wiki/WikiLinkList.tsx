'use client';

import { useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { FluidHoverHighlight } from '@/components/ui/fluid/fluid-hover-highlight';
import { useFluidHover, useRegisterFluidHoverItem } from '@/hooks/fluid/use-fluid-hover';

export interface WikiLinkListItem {
  key: string;
  href: string;
  label: ReactNode;
  /** A sprite or icon before the label. */
  leading?: ReactNode;
  /** A short note after the label, right-aligned. */
  meta?: ReactNode;
}

function Row({
  item,
  index,
  registerItem,
}: {
  item: WikiLinkListItem;
  index: number;
  registerItem: (index: number, element: HTMLElement | null) => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  useRegisterFluidHoverItem(registerItem, index, ref);
  return (
    <li ref={ref} className="border-b border-hairline last:border-b-0">
      <Link
        href={item.href}
        className="flex min-h-11 items-center gap-3 px-4 py-2 text-body text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-ink"
      >
        {item.leading}
        <span className="min-w-0 flex-1 font-[550]">{item.label}</span>
        {item.meta && <span className="shrink-0 text-caption text-fg-muted">{item.meta}</span>}
      </Link>
    </li>
  );
}

/** A list of entry links on one surface; the @fluid hover highlight glides from row to row. */
export default function WikiLinkList({ items }: { items: readonly WikiLinkListItem[] }) {
  const ref = useRef<HTMLUListElement>(null);
  const hover = useFluidHover(ref);
  return (
    <ul
      ref={ref}
      className="relative isolate overflow-hidden rounded-poke-lg border border-hairline bg-surface"
      onMouseEnter={hover.handlers.onMouseEnter}
      onMouseMove={hover.handlers.onMouseMove}
      onMouseLeave={hover.handlers.onMouseLeave}
    >
      <FluidHoverHighlight hover={hover} className="-z-10" />
      {items.map((item, index) => (
        <Row key={item.key} item={item} index={index} registerItem={hover.registerItem} />
      ))}
    </ul>
  );
}

'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import SkewPlate from '@/components/ui/SkewPlate';
import { cn } from '@/lib/utils/cn';

export interface LinkTab {
  key: string;
  href: string;
  label: string;
  /** A leading item icon (`ItemIcon`, 24 px). */
  icon?: ReactNode;
  /** A count shown after the label. */
  count?: number;
}

/** Which edges of a sideways-scrolling strip have tabs beyond them (1 px tolerance for fractional widths). */
export function scrollEdges(scrollLeft: number, clientWidth: number, scrollWidth: number): { start: boolean; end: boolean } {
  return { start: scrollLeft > 1, end: scrollLeft + clientWidth < scrollWidth - 1 };
}

interface LinkTabsProps {
  tabs: readonly LinkTab[];
  activeKey: string;
  /** Names the strip for assistive technology ("Filter by status", "League sections"). */
  label: string;
  /** Shared by the tabs of one strip, so the accent underside glides between them. */
  glideId: string;
  className?: string;
}

/**
 * One strip of link tabs on skewed plates (docs/design.md, "Skewed plates"): each tab is a link, so the state
 * lives in the URL and the server renders only the selected view. The strip scrolls sideways on a phone
 * instead of wrapping, brings the current tab into view, and fades the edge that has more tabs beyond it.
 */
export default function LinkTabs({ tabs, activeKey, label, glideId, className }: LinkTabsProps) {
  const strip = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = strip.current;
    const current = nav?.querySelector('[aria-current="page"]');
    if (!nav || !current) return;
    const box = nav.getBoundingClientRect();
    const tab = current.getBoundingClientRect();
    if (tab.right > box.right) nav.scrollLeft += tab.right - box.right + 8;
    else if (tab.left < box.left) nav.scrollLeft -= box.left - tab.left + 8;
  }, [activeKey]);
  const [fade, setFade] = useState({ start: false, end: false });
  useEffect(() => {
    const nav = strip.current;
    if (!nav) return;
    const update = () => {
      const next = scrollEdges(nav.scrollLeft, nav.clientWidth, nav.scrollWidth);
      setFade((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
    };
    update();
    nav.addEventListener('scroll', update, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(nav);
    return () => {
      nav.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, [tabs.length]);
  // A mask fades the tabs themselves, so the cue works on any ground (page, surface, a themed world).
  const mask =
    fade.start || fade.end
      ? `linear-gradient(to right, ${fade.start ? 'transparent' : '#000'}, #000 28px, #000 calc(100% - 28px), ${fade.end ? 'transparent' : '#000'})`
      : undefined;

  return (
    <nav
      ref={strip}
      aria-label={label}
      style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
      className={cn('-mx-1 overflow-x-auto px-1 py-1 [scrollbar-width:none]', className)}
    >
      <ul className="flex w-max items-center gap-2">
        {tabs.map((tab) => {
          const active = tab.key === activeKey;
          return (
            <li key={tab.key}>
              <Link
                href={tab.href}
                scroll={false}
                aria-current={active ? 'page' : undefined}
                className="relative inline-flex items-center whitespace-nowrap rounded-[3px] text-body max-sm:min-h-11"
              >
                <SkewPlate variant="tab" active={active} glideId={glideId} icon={tab.icon}>
                  <span className="inline-flex items-baseline gap-1.5">
                    {tab.label}
                    {tab.count !== undefined && <span className="font-mono text-caption tabular-nums text-fg-muted">{tab.count}</span>}
                  </span>
                </SkewPlate>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

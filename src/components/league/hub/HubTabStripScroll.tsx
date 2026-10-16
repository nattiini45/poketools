'use client';

import { useEffect, useRef } from 'react';

/** Where a horizontal strip and one of its items sit, from getBoundingClientRect plus the strip's scroll offset. */
export interface StripBox {
  left: number;
  width: number;
  scrollLeft: number;
}

/**
 * The strip's new scroll offset that brings the item into view, centred, or
 * null when the item is already fully visible (nothing moves).
 */
export function tabStripScrollLeft(strip: StripBox, item: { left: number; width: number }): number | null {
  const visible = item.left >= strip.left && item.left + item.width <= strip.left + strip.width;
  if (visible) return null;
  const itemInContent = item.left - strip.left + strip.scrollLeft;
  return Math.max(0, Math.round(itemInContent - (strip.width - item.width) / 2));
}

/**
 * Keeps the active hub tab visible in the tab strip. On a phone the strip
 * scrolls sideways, and a tab opened by link (`?tab=rules#league-hub`) or
 * past the first few sits off its right edge. On mount and on every tab
 * switch this scrolls the strip itself (never the page) so the active tab is
 * in view. Renders an empty hidden marker inside the hub's tab `<nav>`.
 */
export default function HubTabStripScroll({ activeTab }: { activeTab: string }) {
  const marker = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const strip = marker.current?.closest('nav')?.querySelector<HTMLElement>('[data-hub-tab-strip]');
    const active = strip?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!strip || !active || strip.scrollWidth <= strip.clientWidth) return;
    const stripRect = strip.getBoundingClientRect();
    const tabRect = active.getBoundingClientRect();
    const next = tabStripScrollLeft(
      { left: stripRect.left, width: stripRect.width, scrollLeft: strip.scrollLeft },
      { left: tabRect.left, width: tabRect.width },
    );
    if (next !== null) strip.scrollLeft = next;
  }, [activeTab]);

  return <span ref={marker} hidden />;
}

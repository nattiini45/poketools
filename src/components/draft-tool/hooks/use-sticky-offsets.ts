'use client';

/**
 * Measures the sticky bars of the screen and publishes their heights as custom properties on the screen
 * root, for the sticky price tabs, the sticky phone clock row, the cards' scroll margins and the left stage's
 * fit (`draft-tool.module.css`):
 *
 * - `--nav-h`: the site NavBar (`#site-nav`, sticky at the top of every public page). Measured instead of
 *   assumed, so a taller or hidden nav never leaves the tabs under it or floating below a gap.
 * - `--draft-clock-h`: the clock row, sticky under the nav on phones.
 * - `--draft-dock-h`: the DRAFT dock of the left column, sticky at the bottom of its scroller from 1024 px.
 *   The stage card is capped to the scroller minus this height, so the line picture shrinks to fit above the
 *   dock instead of ending under it.
 * - `--draft-lower-top`: how far the wall's scroller starts below the top of the screen (header, clock bar,
 *   order strip and the wall's own controls, all of which wrap with the language and the width). From 1024 px
 *   the screen's floor height adds two card rows to it, so the wall always shows two full rows.
 *
 * Until the first measurement (and where `ResizeObserver` is missing) the CSS defaults on `.root` apply.
 * A missing `#site-nav` (a page without the NavBar) means a 0 px nav. Purely presentational: no state, no
 * re-render; the observers follow resizes (fonts, wrapping, the mobile menu, a longer verdict under the
 * button) and disconnect on unmount.
 */
import { useEffect, type RefObject } from 'react';

export const SITE_NAV_ID = 'site-nav';

/** The measured bars; a missing one keeps its CSS default (the nav alone means 0 px). */
export interface StickyBars {
  nav: Element | null;
  clock: Element | null;
  dock: Element | null;
  wall?: Element | null;
}

const heightOf = (bar: Element): string => `${Math.ceil(bar.getBoundingClientRect().height)}px`;

/** Writes the bars' heights, rounded up, onto `root`. Exported for the unit test. */
export function applyStickyOffsets(root: { style: Pick<CSSStyleDeclaration, 'setProperty'> }, bars: StickyBars): void {
  root.style.setProperty('--nav-h', bars.nav ? heightOf(bars.nav) : '0px');
  if (bars.clock) root.style.setProperty('--draft-clock-h', heightOf(bars.clock));
  if (bars.dock) root.style.setProperty('--draft-dock-h', heightOf(bars.dock));
  if (bars.wall && 'getBoundingClientRect' in root) {
    const lowerTop = bars.wall.getBoundingClientRect().top - (root as HTMLElement).getBoundingClientRect().top;
    root.style.setProperty('--draft-lower-top', `${Math.ceil(lowerTop)}px`);
  }
}

type ObserverCtor = new (callback: () => void) => Pick<ResizeObserver, 'observe' | 'disconnect'>;

/**
 * Measures once, then re-measures whenever a bar resizes. Returns the clean-up (a no-op when
 * `ResizeObserver` is unavailable: the first measurement stands). `bars.nav` is resolved by the caller at
 * mount, so a page without `#site-nav` keeps `--nav-h: 0px` and observes only the other bars. Exported for the
 * unit test, which passes a stub observer.
 */
export function observeStickyOffsets(
  root: HTMLElement,
  bars: StickyBars,
  Observer: ObserverCtor | undefined = typeof ResizeObserver === 'undefined' ? undefined : ResizeObserver,
): () => void {
  const measure = () => applyStickyOffsets(root, bars);
  measure();
  if (!Observer) return () => {};
  const observer = new Observer(measure);
  for (const bar of [bars.nav, bars.clock, bars.dock, bars.wall]) if (bar) observer.observe(bar);
  return () => observer.disconnect();
}

export function useStickyOffsets(
  root: RefObject<HTMLElement | null>,
  clockRow: RefObject<HTMLElement | null>,
  dock: RefObject<HTMLElement | null>,
  wall?: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    return observeStickyOffsets(el, { nav: document.getElementById(SITE_NAV_ID), clock: clockRow.current, dock: dock.current, wall: wall?.current ?? null });
  }, [root, clockRow, dock, wall]);
}

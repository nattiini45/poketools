'use client';

/**
 * Measures the sticky bars above the roster wall and publishes their heights as custom properties on the
 * screen root, for the sticky price tabs, the sticky phone clock row and the cards' scroll margins
 * (`draft-tool.module.css`):
 *
 * - `--nav-h`: the site NavBar (`#site-nav`, sticky at the top of every public page). Measured instead of
 *   assumed, so a taller or hidden nav never leaves the tabs under it or floating below a gap.
 * - `--draft-clock-h`: the clock row, sticky under the nav on phones.
 *
 * Until the first measurement (and where `ResizeObserver` is missing) the CSS defaults on `.root` apply.
 * A missing `#site-nav` (a page without the NavBar) means a 0 px nav. Purely presentational: no state, no
 * re-render; the observers follow resizes (fonts, wrapping, the mobile menu) and disconnect on unmount.
 */
import { useEffect, type RefObject } from 'react';

export const SITE_NAV_ID = 'site-nav';

type Measured = Pick<HTMLElement, 'getBoundingClientRect'>;

/**
 * Writes `--nav-h` (0 px without a nav) and `--draft-clock-h` (left to the CSS default without a clock row)
 * onto `root`. Exported for the unit test.
 */
export function applyStickyOffsets(root: { style: Pick<CSSStyleDeclaration, 'setProperty'> }, nav: Measured | null, clock: Measured | null): void {
  root.style.setProperty('--nav-h', `${nav ? Math.ceil(nav.getBoundingClientRect().height) : 0}px`);
  if (clock) root.style.setProperty('--draft-clock-h', `${Math.ceil(clock.getBoundingClientRect().height)}px`);
}

type ObserverCtor = new (callback: () => void) => Pick<ResizeObserver, 'observe' | 'disconnect'>;

/**
 * Measures once, then re-measures whenever the nav or the clock row resizes. Returns the clean-up (a no-op
 * when `ResizeObserver` is unavailable: the first measurement stands). `nav` is resolved by the caller at
 * mount, so a page without `#site-nav` keeps `--nav-h: 0px` and observes only the clock row. Exported for the
 * unit test, which passes a stub observer.
 */
export function observeStickyOffsets(
  root: HTMLElement,
  nav: HTMLElement | null,
  clock: HTMLElement | null,
  Observer: ObserverCtor | undefined = typeof ResizeObserver === 'undefined' ? undefined : ResizeObserver,
): () => void {
  const measure = () => applyStickyOffsets(root, nav, clock);
  measure();
  if (!Observer) return () => {};
  const observer = new Observer(measure);
  if (nav) observer.observe(nav);
  if (clock) observer.observe(clock);
  return () => observer.disconnect();
}

export function useStickyOffsets(root: RefObject<HTMLElement | null>, clockRow: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    return observeStickyOffsets(el, document.getElementById(SITE_NAV_ID), clockRow.current);
  }, [root, clockRow]);
}

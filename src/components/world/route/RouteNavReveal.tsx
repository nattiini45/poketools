'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  NAV_REVEAL_CLOSED,
  navFocusReturn,
  navRevealWakeAt,
  stepNavReveal,
  type NavRevealEvent,
  type NavRevealState,
} from '@/lib/route-world/nav-reveal';

/** The site NavBar's id (NavBar.tsx) — the menu chip's `aria-controls`. */
export const SITE_NAV_ID = 'site-nav';
/** `<html data-route-nav="open">` while the bar is revealed over the world. */
export const ROUTE_NAV_ATTR = 'data-route-nav';
/** The NavBar's mobile drawer and its backdrop (a press there is "inside"). */
const DRAWER_SELECTOR = '[data-navbar-drawer]';

function worldIsPage(): boolean {
  const root = document.documentElement;
  return root.classList.contains('world-route-live') || root.hasAttribute('data-route-handoff');
}

function siteNav(): HTMLElement | null {
  return document.getElementById(SITE_NAV_ID);
}

function focusableNow(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement) || !element.isConnected) return false;
  if (element.closest('[inert]')) return false;
  // Hidden section content (content-visibility / visibility) cannot take focus.
  return element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
}

function tryFocus(element: HTMLElement | null): boolean {
  if (!focusableNow(element)) return false;
  element.focus({ preventScroll: true });
  return document.activeElement === element;
}

export interface RouteNavReveal {
  /** The bar is revealed. */
  open: boolean;
  /** The HUD menu chip holds it open (its `aria-expanded`). */
  chipHeld: boolean;
  /** The HUD menu chip was activated (toggle). */
  toggleFromChip: () => void;
  /** A station chip was chosen: the chip-opened bar gets out of the way. */
  stationChosen: () => void;
}

/**
 * D33 — reveal the site NavBar over the live world (pure machine:
 * `@/lib/route-world/nav-reveal`). Mounted by the route-tier WorldNav; inert
 * until the world is the page (`world-route-live` / `data-route-handoff`),
 * so Lite and every non-world page are untouched. Pointer moves never
 * re-render React: the machine lives in a ref, the reveal is one attribute
 * on <html> (globals.css, D33 block), and only `open` / `chipHeld` — the
 * chip's `aria-expanded` — are React state.
 */
export function useRouteNavReveal(enabled: boolean, menuChip: RefObject<HTMLButtonElement | null>): RouteNavReveal {
  const machine = useRef<NavRevealState>(NAV_REVEAL_CLOSED);
  const [view, setView] = useState({ open: false, chipHeld: false });
  const wake = useRef<number | null>(null);
  const barBottom = useRef(64);
  /** The last element focused OUTSIDE the bar (Esc returns there). */
  const lastOutside = useRef<HTMLElement | null>(null);

  /** The wake's own dispatch (a ref, so the scheduled tick never closes over a stale callback). */
  const tickRef = useRef<() => void>(() => {});
  const dispatch = useCallback((event: NavRevealEvent) => {
    const prev = machine.current;
    const next = stepNavReveal(prev, event);
    if (wake.current !== null) {
      window.clearTimeout(wake.current);
      wake.current = null;
    }
    const wakeAt = navRevealWakeAt(next);
    if (wakeAt !== null) {
      wake.current = window.setTimeout(
        () => {
          wake.current = null;
          tickRef.current();
        },
        Math.max(0, wakeAt - performance.now()),
      );
    }
    if (next === prev) return;
    machine.current = next;
    if (next.open !== prev.open) {
      const root = document.documentElement;
      if (next.open) {
        root.setAttribute(ROUTE_NAV_ATTR, 'open');
        const nav = siteNav();
        if (nav) barBottom.current = nav.offsetHeight;
      } else {
        root.removeAttribute(ROUTE_NAV_ATTR);
      }
    }
    if (next.open !== prev.open || next.chipHeld !== prev.chipHeld) {
      setView({ open: next.open, chipHeld: next.chipHeld });
    }
  }, []);
  useEffect(() => {
    tickRef.current = () => dispatch({ type: 'tick', now: performance.now() });
  }, [dispatch]);

  /** Move focus out of the closing bar (Esc / chip), where the visitor came from. */
  const returnFocus = useCallback((source: NavRevealState['source']) => {
    const nav = siteNav();
    const active = document.activeElement;
    if (!nav || !(active instanceof HTMLElement) || !nav.contains(active)) return;
    const stationChip = document.querySelector<HTMLElement>('.world-nav-hud-chip.is-active');
    const choice = navFocusReturn({
      source,
      previousFocusable: focusableNow(lastOutside.current),
      stationChipFocusable: focusableNow(stationChip),
      menuChipFocusable: focusableNow(menuChip.current),
    });
    const moved =
      (choice === 'previous' && tryFocus(lastOutside.current)) ||
      (choice === 'station-chip' && tryFocus(stationChip)) ||
      (choice === 'menu-chip' && tryFocus(menuChip.current));
    if (!moved) active.blur();
  }, [menuChip]);

  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    const inside = (target: EventTarget | null): boolean => {
      if (!(target instanceof Node)) return false;
      const nav = siteNav();
      if (nav?.contains(target)) return true;
      if (menuChip.current?.contains(target)) return true;
      return target instanceof Element && target.closest(DRAWER_SELECTOR) !== null;
    };

    const onPointerMove = (event: PointerEvent) => {
      // Fine pointers only: touch has no hover (the HUD chip serves it).
      if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
      if (!worldIsPage()) return;
      // Over the bar or anything hanging from it (the palette panel) counts as on the bar.
      dispatch({ type: 'pointer', now: performance.now(), y: siteNav()?.contains(event.target as Node) ? 0 : event.clientY, barBottom: barBottom.current });
    };
    const onMouseOut = (event: MouseEvent) => {
      if (event.relatedTarget !== null || !worldIsPage()) return;
      dispatch({ type: 'pointer-exit', now: performance.now() });
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      const nav = siteNav();
      if (!(target instanceof HTMLElement) || !nav) return;
      if (nav.contains(target)) {
        if (!worldIsPage()) return;
        // Keyboard focus only: a mouse click on a bar button (the theme
        // toggle) must not pin the bar open after the pointer leaves.
        let visible = false;
        try {
          visible = target.matches(':focus-visible');
        } catch {
          visible = true;
        }
        if (visible) dispatch({ type: 'focus-in', now: performance.now() });
        return;
      }
      lastOutside.current = target;
      if (machine.current.focusInside) dispatch({ type: 'focus-out', now: performance.now() });
    };
    const onFocusOut = (event: FocusEvent) => {
      // Focus left the document (another window, the browser chrome).
      if (event.relatedTarget === null && machine.current.focusInside) {
        const nav = siteNav();
        if (nav && event.target instanceof Node && nav.contains(event.target)) {
          dispatch({ type: 'focus-out', now: performance.now() });
        }
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !machine.current.open) return;
      const source = machine.current.source;
      dispatch({ type: 'escape', now: performance.now() });
      returnFocus(source);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!machine.current.open || inside(event.target)) return;
      dispatch({ type: 'outside', now: performance.now() });
    };

    // The world stopped being the page (Lite, a new world): closed, no mark.
    const marks = new MutationObserver(() => {
      if (!worldIsPage() && machine.current !== NAV_REVEAL_CLOSED) dispatch({ type: 'reset' });
    });
    marks.observe(root, { attributes: true, attributeFilter: ['class', 'data-route-handoff'] });

    document.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('mouseout', onMouseOut, { passive: true });
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
    return () => {
      marks.disconnect();
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('mouseout', onMouseOut);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, { capture: true });
      if (wake.current !== null) window.clearTimeout(wake.current);
      wake.current = null;
      machine.current = NAV_REVEAL_CLOSED;
      root.removeAttribute(ROUTE_NAV_ATTR);
      setView((current) => (current.open || current.chipHeld ? { open: false, chipHeld: false } : current));
    };
  }, [enabled, dispatch, returnFocus, menuChip]);

  const toggleFromChip = useCallback(() => {
    const wasHeld = machine.current.open && machine.current.chipHeld;
    dispatch({ type: 'chip', now: performance.now() });
    if (wasHeld) returnFocus('chip');
  }, [dispatch, returnFocus]);

  const stationChosen = useCallback(() => {
    if (machine.current.open) dispatch({ type: 'station', now: performance.now() });
  }, [dispatch]);

  return { open: view.open, chipHeld: view.chipHeld, toggleFromChip, stationChosen };
}

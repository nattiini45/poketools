'use client';

import { useEffect, useRef, type MouseEvent } from 'react';
import { Menu } from 'lucide-react';
import { motion, useReducedMotion } from '@/components/shared/motion';
import { SITE_NAV_ID, useRouteNavReveal } from '@/components/world/route/RouteNavReveal';
import { useConductorState, useWorldState } from '@/components/world/route/WorldStateProvider';
import { useNearestStation } from '@/components/world/route/useNearestStation';
import WorldThemeSwitcher from '@/components/world/WorldThemeSwitcher';
import { SPRING } from '@/lib/motion/tokens';
import type { WorldSection } from '@/lib/worlds/types';
import { useT } from '@/i18n/client';
import { worldClientMessages } from '@/i18n/messages/world/client';

interface WorldNavProps {
  sections: readonly WorldSection[];
  /** Accessible name for the nav landmark; defaults to the viewer-language "Sections". */
  label?: string;
  /** Route tier: wordmark leading the glass pill (e.g. the league name). */
  brand?: string;
  /**
   * 'auto' follows the device tier (HUD pill when a route scene is live);
   * 'lite' forces the sticky top bar — for worlds without a 3D scene, where
   * a floating pill would hover over readable content.
   */
  variant?: 'auto' | 'lite';
}

/**
 * Map the conductor's active station onto the nav's OWN section list. The two
 * lists can disagree — the default world drops content-less sections, and the
 * tournament sections layout anchors panels that are not world stations — so
 * the raw `activeIndex` would highlight the wrong chip (PR #63 review). Walks
 * back to the nearest station the nav actually renders; -1 when it renders
 * none of them (no highlight beats a wrong one).
 */
function navHighlightIndex(
  stationIds: readonly string[],
  activeIndex: number,
  sections: readonly WorldSection[],
): number {
  for (let i = Math.min(activeIndex, stationIds.length - 1); i >= 0; i -= 1) {
    const found = sections.findIndex((section) => section.id === stationIds[i]);
    if (found >= 0) return found;
  }
  return -1;
}

/**
 * In-page anchor nav across a world's sections. Anchor links give native
 * keyboard accessibility (tab to focus, Enter to jump); the sticky bar has a
 * fixed height so there is no layout shift when the highlight moves.
 *
 * Route-tier: a layered ZA teal-glass pill floating over the plaza — outer
 * frosted shell, inner darker track carrying the station chips — so the
 * chrome reads as a HUD in the world rather than a page header. The pill sits
 * bottom-centre on desktop and spans the bottom edge on narrow screens
 * (C-031); the nav landmark keeps its 56 px band (the capture harness stamps
 * it). Lite: the arena sticky bar.
 */
export default function WorldNav({ sections, label, brand, variant = 'auto' }: WorldNavProps) {
  const { conductor, tier } = useWorldState();
  // The world follows the viewer (i18n D11): chrome and registry labels in the UI language.
  const t = useT(worldClientMessages);
  const navLabel = label ?? t('nav.sections');
  const chipLabel = (section: WorldSection) =>
    section.navKey ? t.dynamic(`nav.worlds.${section.navKey}`, undefined, section.navLabel) : section.navLabel;
  // ENGINE r3: the render-facing conductor state has its own context (the
  // world-state value no longer changes at every station crossing).
  const conductorState = useConductorState();
  const reduced = useReducedMotion() ?? false;
  const route = variant === 'auto' && tier === 'route';
  const lastIndex = Math.max(0, sections.length - 1);
  // Route tier highlights the conductor's hysteretic NEAREST station (W6) —
  // `floor(exact)` would leave roster (exact≈0.99) on Puls, and a bare round
  // flickered the chip on noise around x.5. Plateau stations (pulse,
  // schedule) sit exactly on their integer, so no pin override is needed.
  const nearest = useNearestStation();
  const routeStation = Math.min(lastIndex, Math.max(0, nearest));
  const activeChip = route && conductorState.measured ? routeStation : -1;
  const trackRef = useRef<HTMLUListElement>(null);
  // D33: the site NavBar stays reachable over the live world (top-edge
  // hover, keyboard focus, and this HUD's menu chip on touch).
  const menuRef = useRef<HTMLButtonElement>(null);
  const navReveal = useRouteNavReveal(route, menuRef);

  /**
   * Fidelity wave 2 (2B): the active chip is never cut off. On every
   * nearest-station change (and on a resize) the track scrolls the active
   * chip to its centre, and `data-fade` marks which edges hide more chips
   * (16 px mask fades, W1 hud block in globals.css). DOM writes only — no
   * React state, so a scroll of the track never re-renders the nav.
   */
  useEffect(() => {
    const track = trackRef.current;
    if (!route || !track) return;
    const fade = () => {
      const max = track.scrollWidth - track.clientWidth;
      const start = max > 1 && track.scrollLeft > 1;
      const end = max > 1 && track.scrollLeft < max - 1;
      const value = start && end ? 'both' : start ? 'start' : end ? 'end' : null;
      if (value) track.dataset.fade = value;
      else delete track.dataset.fade;
    };
    const centre = (smooth: boolean) => {
      const chip = activeChip >= 0 ? track.querySelector<HTMLElement>('.world-nav-hud-chip.is-active') : null;
      if (chip) {
        const trackBox = track.getBoundingClientRect();
        const chipBox = chip.getBoundingClientRect();
        const max = Math.max(0, track.scrollWidth - track.clientWidth);
        const left = chipBox.left - trackBox.left + track.scrollLeft - (track.clientWidth - chipBox.width) / 2;
        track.scrollTo({ left: Math.min(max, Math.max(0, left)), behavior: smooth ? 'smooth' : 'auto' });
      }
      fade();
    };
    centre(!reduced);
    const onResize = () => centre(false);
    track.addEventListener('scroll', fade, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onResize);
    observer?.observe(track);
    return () => {
      track.removeEventListener('scroll', fade);
      observer?.disconnect();
    };
  }, [route, activeChip, reduced]);

  if (sections.length === 0) return null;

  const highlightIndex = route
    ? routeStation
    : navHighlightIndex(conductorState.stationIds, conductorState.activeIndex, sections);

  /**
   * W6 round 3: a chip lands on the conductor's station offset, not the
   * browser's fragment offset (which sits 0.2 station past a plain station —
   * rules → roster read exact 1.22 and never settled). The link stays a real
   * `#id` anchor (keyboard, no-JS, open-in-new-tab); a plain primary click or
   * Enter is taken over and the hash is still recorded in history.
   */
  const onChipClick = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    // D33: choosing a station puts a chip-opened site bar away.
    navReveal.stationChosen();
    if (!conductor.goToStation(id)) return;
    event.preventDefault();
    if (window.location.hash !== `#${id}`) {
      try {
        window.history.pushState(window.history.state, '', `#${id}`);
      } catch {
        // History is optional here; the landing itself already happened.
      }
    }
  };

  if (route) {
    const menuLabel = t('nav.menu');
    return (
      <nav aria-label={navLabel} className="world-nav-hud fixed inset-x-0 bottom-0 z-30 flex">
        <div className="world-nav-hud-bar">
          {/* D33: touch / coarse pointers only (globals.css) — reveals the
              site NavBar, which has no hover target on a phone. */}
          <button
            ref={menuRef}
            type="button"
            className="world-nav-hud-chip world-nav-hud-menu cursor-pointer"
            aria-label={menuLabel}
            title={menuLabel}
            aria-controls={SITE_NAV_ID}
            aria-expanded={navReveal.open}
            onClick={navReveal.toggleFromChip}
          >
            <Menu aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
          {brand ? <span className="world-nav-hud-brand">{brand}</span> : null}
          <ul ref={trackRef} className="world-nav-hud-track">
            {sections.map((section, index) => {
              const active = conductorState.measured && index === highlightIndex;
              return (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    aria-current={active ? 'true' : undefined}
                    onClick={(event) => onChipClick(event, section.id)}
                    className={`world-nav-hud-chip${active ? ' is-active' : ''}`}
                  >
                    {chipLabel(section)}
                  </a>
                </li>
              );
            })}
          </ul>
          <WorldThemeSwitcher className="world-nav-hud-chip cursor-pointer" />
        </div>
      </nav>
    );
  }

  return (
    <nav
      aria-label={label}
      className="sticky top-0 z-20 h-12 border-b border-arena-border bg-arena-ground/80 backdrop-blur-md"
    >
      <ul className="flex h-full items-center gap-1 overflow-x-auto">
        {sections.map((section, index) => {
          const active = conductorState.measured && index === highlightIndex;
          return (
            <li key={section.id} className="relative">
              <a
                href={`#${section.id}`}
                aria-current={active ? 'true' : undefined}
                className={`inline-flex h-12 items-center whitespace-nowrap px-3 font-heading text-sm font-semibold transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-arena-focus ${
                  active ? 'text-arena-accent-strong' : 'text-arena-ink hover:text-arena-accent-strong'
                }`}
              >
                {chipLabel(section)}
              </a>
              {active && (
                <motion.div
                  layoutId="world-nav-indicator"
                  aria-hidden="true"
                  className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-arena-accent"
                  transition={reduced ? { duration: 0 } : SPRING.default}
                />
              )}
            </li>
          );
        })}
      </ul>
      <div className="absolute right-2 top-0 flex h-12 items-center bg-arena-ground/80 pl-2">
        <WorldThemeSwitcher className="inline-flex h-12 cursor-pointer items-center gap-1.5 whitespace-nowrap px-3 font-heading text-sm font-semibold text-arena-ink transition-colors duration-150 hover:text-arena-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-arena-focus" />
      </div>
    </nav>
  );
}

import { Suspense, type ReactNode } from 'react';
import WorldStateProvider from '@/components/world/route/WorldStateProvider';
import RouteSceneRecovery from '@/components/world/route/RouteSceneRecovery';
import BallLoader from '@/components/world/route/BallLoader';
import StationCard from '@/components/world/route/StationCard';
import FocusHoverOverlay from '@/components/world/route/focus/FocusHoverOverlay';
import HoloBeam from '@/components/world/route/focus/HoloBeam';
import { stationDigestFacts } from '@/lib/route-world/station-digest';
import type { WorldRouteData } from '@/lib/worlds/route-data';
import type { SeasonWorld } from '@/lib/worlds/types';
import type { WorldExperience } from '@/types/player';

interface WorldShellProps {
  world: SeasonWorld;
  /**
   * The signed-in viewer's persisted 3D world preference, threaded from the
   * page's server read. Optional — when omitted (tournaments, draft room) the
   * provider applies DEFAULT_WORLD_EXPERIENCE ('off', the simple version); the
   * dev route-preview passes 'auto' to keep capability detection.
   */
  worldExperience?: WorldExperience;
  /**
   * The page-loaded route payload (fidelity wave 2, 2B). Optional: when a
   * route world hands it over, the shell reduces it on the server to the
   * Station Card's plain digest facts (`stationDigestFacts` — row 1 of the
   * boards' own painter input), so the client card never receives the full
   * payload a second time. Without it the card shows its honest empty-state
   * lines.
   */
  routeData?: WorldRouteData;
  children: ReactNode;
}

/**
 * Applies a world's token namespace to its subtree via the `data-world`
 * attribute (plus a scoped class hook). The `--world-*` CSS variables in
 * globals.css are keyed off `[data-world="<tokenNamespace>"]`, so all
 * descendants resolve the correct world palette in both themes.
 *
 * A themed world also paints its own ground across the full viewport: a
 * fixed, negatively-stacked backdrop. Negative z-index paints below in-flow
 * content and below positioned siblings such as the site header, so the
 * world replaces the app background without touching page layout — and it
 * is the layer the route canvas later slots in front of.
 *
 * The shell is also where the scroll conductor is installed, so route
 * progress exists for every world whether or not a 3D canvas ever mounts.
 * That is what lets the anchor nav and the camera read the same number
 * instead of each deriving its own idea of the current section.
 *
 * The world inherits the page's `<html lang>`: its copy follows the viewer's
 * language (i18n D11; `worldLang()` is retired), so the shell sets no `lang`
 * of its own.
 *
 * Server-component compatible — no interactivity of its own.
 */
export default function WorldShell({ world, worldExperience, routeData, children }: WorldShellProps) {
  const themed = world.tokenNamespace !== 'default';
  const stationIds = world.sections.map((section) => section.id);
  const route = Boolean(world.routeThemeId);
  const digestFacts = route && routeData ? stationDigestFacts(routeData) : undefined;

  return (
    <div
      data-world={world.tokenNamespace}
      {...(world.routeThemeId ? { 'data-world-route': '' } : {})}
      className={`world world-${world.tokenNamespace} ${themed ? 'relative text-arena-ink' : ''}`}
    >
      {themed && (
        <div
          aria-hidden="true"
          data-world-ground=""
          className="pointer-events-none fixed inset-0 -z-10 bg-arena-ground"
        />
      )}
      <WorldStateProvider
        stationIds={stationIds}
        routeThemeId={world.routeThemeId}
        worldExperience={worldExperience}
      >
        {children}
        {/* Mounted here rather than per theme so every world gets the same
            bounded manual retry after a recoverable scene failure; it renders
            nothing unless Lite was forced by an error or a timeout. */}
        <RouteSceneRecovery />
        {/* The Pokéball loading ceremony (W7). Mounted beside the retry for the
            same reason — one per world — and inert on DOM-only worlds, which
            never have a route theme to load. */}
        <BallLoader />
        {route ? (
          <>
            {/* Fidelity wave 2 (2B; D15): the Station Card — where you are, the
                beat, one fact at 390 and one CTA. Route tier only; it renders
                nothing until the ball is done and the station has settled.
                Suspense: it reads the panel params (useSearchParams). */}
            <Suspense fallback={null}>
              <StationCard facts={digestFacts} />
            </Suspense>
            {/* Fidelity wave 2 (2C): hover brackets + label pill (desktop), the
                once-per-station breathe (touch), and the holo beam from a
                focused subject to its docked panel. Page-side DOM, 0 draws;
                both render null off the route tier or before the scene is
                live. z-index 24: under the docked panel (25) and the HUD (30). */}
            <FocusHoverOverlay />
            <HoloBeam />
          </>
        ) : null}
      </WorldStateProvider>
    </div>
  );
}

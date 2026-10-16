'use client';

import { useMemo } from 'react';
import ThemeFigures, { type FigureSlot } from '@/components/world/route/figures/ThemeFigures';
import { type ThemeFigurePlan } from '@/lib/route-world/figure-contract';
import { figureHeightM, useFigureIndex } from '@/lib/route-world/model-manifest';
import { useRouteData } from '@/components/world/route/RouteDataProvider';
import type { MountainRouteData } from '../types';
import { pickAceTracker } from './CairnCircle';
import { SUMMIT_PODIUM, WILD_SPOTS } from './layout';
import { DormancyScope, ResidentSuspense } from '@/components/world/route/residency-store';
import { useMountainStationWindow, useMountainStationWindowState } from './useMountainStationWindow';

/**
 * The pass's Pokémon habitation (C-103 criterion 1), mounted through the
 * C-100 figure contract: `<ThemeFigures plan slots/>` — the engine's shared
 * pipeline (KTX2-armed loader, fitted/animated `Figure`, manifest fallbacks,
 * colossal/tiny stances from the recorded bounds). NO abstract statue
 * substitutes at hero stations: every hero-station figure here is a manifest
 * GLB (the podium declaration only admits aces that RESOLVE in the manifest
 * index — the CairnCircle/AcesLine derivation).
 *
 *  - Summit-podium aces at #pulse: up to 7 roster figures in two staggered
 *    ranks ON the viewing deck below the summit board, each turned to the
 *    authored pulse eye. Resolvable + stature ≤ 1.5 m only (the deck stands
 *    1.94 m up the knoll — the ray to the board's bottom edge passes
 *    3.80-4.03 m over it, so the cap keeps every crown under the ray; the
 *    full stature range demos at the teams statuary and in the wilds).
 *  - Trail-side spotters + fitted rock/ice wilds (pool-driven): the deck's
 *    resident Nacli and Frigibax (both idle-clipped, IN the pulse frame —
 *    the motion proof), register-wall Sneasel/Teddiursa spotters, the cairn
 *    terrace's Arctibax + Swinub, the sign meadow's frozen mammoth pair
 *    (grounded 2.5 m Mamoswine = the colossal demo) and the pass's
 *    Avalugg-Hisui ice-breaker.
 *
 * Budget lever (criterion 5; since D23 every group is resident from load): per-station counts, once gated by the
 * in-package residency latch (`useMountainStationWindow`) — pulse 7+2, then
 * +2/+2/+2/+1 as the windows latch = 16 mounted figures at full residency;
 * the store payload is SHARED with CairnCircle's #teams picks (the same
 * resolved GLB URLs, one cache).
 */

/** Podium slots, turned to the authored pulse eye, standing on the deck. */
const PODIUM_SLOTS: readonly FigureSlot[] = SUMMIT_PODIUM.slots.map((slot) => ({
  position: [slot.x, SUMMIT_PODIUM.standY, slot.z],
  yaw: Math.atan2(SUMMIT_PODIUM.eye.x - slot.x, SUMMIT_PODIUM.eye.z - slot.z),
}));

/** Pulse-window wilds (the deck's residents). */
const PULSE_WILD_SLOTS: readonly FigureSlot[] = WILD_SPOTS.filter((w) => w.station === 0).map((w) => ({
  position: [w.x, w.y, w.z],
  yaw: w.yaw,
}));
const PULSE_WILD_POOL = WILD_SPOTS.filter((w) => w.station === 0).map((w) => w.species);

/** Statures above this keep their teams statuary, not the deck ranks. */
const PODIUM_MAX_HEIGHT_M = SUMMIT_PODIUM.maxHeightM;

/** The participants' ace line, capped to the authored podium (7). */
function usePodiumPlan(): ThemeFigurePlan {
  const { participants, trackers } = useRouteData<MountainRouteData>();
  const index = useFigureIndex();
  return useMemo<ThemeFigurePlan>(() => {
    const roster = participants
      .map((player) => {
        const ace = pickAceTracker(trackers.filter((t) => t.player_id === player.id));
        return {
          id: player.id,
          label: player.name,
          species: ace?.current_form ?? null,
          baseSpecies: ace?.base_pokemon ?? null,
        };
      })
      // Only resolvable aces stand on the podium — the mounter's non-entry
      // fallback is a placeholder mass, i.e. exactly the abstract statue
      // substitute the bar forbids at hero stations. Unresolvable players
      // keep their cairn statuary at #teams instead.
      .filter((entry) => index.resolve(entry.species, entry.baseSpecies) !== null)
      // Standard stature only: the deck stands 1.94 m up the knoll and the
      // eye→board-bottom ray passes ≈ 3.8 m over it at the LANDED 390 pose
      // (angle-check the LANDED pose), so aces taller than
      // the cap crown the board face. Tall lines keep their cairn statuary
      // at #teams, where colossal handling is the design.
      .filter((entry) => {
        const resolved = index.resolve(entry.species, entry.baseSpecies);
        return resolved !== null && figureHeightM(resolved) <= PODIUM_MAX_HEIGHT_M;
      })
      .slice(0, SUMMIT_PODIUM.slots.length);
    return { roster };
  }, [participants, trackers, index]);
}

/**
 * One windowed pool group (D23): mounted from the first render, so its GLBs,
 * programs and uploads land in the Pokéball ceremony. The window decides:
 * - `shown`: shown through the ceremony (the warm pass sees it) and, from
 *   live, once the visitor has been inside the window — today's frames
 *   exactly, as a visibility flip of resident content. While hidden, three
 *   skips the subtree in the colour AND shadow passes, and the wrapper carries
 *   the theme's prop-family prefix so the static batcher (which tests
 *   `mesh.visible`, not ancestor visibility) never merges a hidden figure
 *   into a visible batch;
 * - `dormant`: off-window (one station of lead each side) the figures stop
 *   their per-frame work.
 */
function WildGroup({ station }: { station: number }) {
  const { mounted, shown, dormant } = useMountainStationWindowState(station, 4);
  const plan = useMemo<ThemeFigurePlan>(
    () => ({ pool: WILD_SPOTS.filter((w) => w.station === station).map((w) => w.species) }),
    [station],
  );
  const slots = useMemo<readonly FigureSlot[]>(
    () =>
      WILD_SPOTS.filter((w) => w.station === station).map((w) => ({
        position: [w.x, w.y, w.z],
        yaw: w.yaw,
      })),
    [station],
  );
  if (!mounted) return null;
  return (
    <group visible={shown} name={shown ? '' : `mountain-prop-premount-wilds-${station}`}>
      <DormancyScope dormant={dormant}>
        <ResidentSuspense id={`mountain:wilds-${station}`}>
          <ThemeFigures plan={plan} slots={slots} />
        </ResidentSuspense>
      </DormancyScope>
    </group>
  );
}

/**
 * The habitation layer. Every group mounts at load (D23); the pulse group
 * (its first judged station's population) is never hidden or dormant.
 */
export default function PassFigures() {
  const pulseResident = useMountainStationWindow(0, 4);
  const podiumPlan = usePodiumPlan();

  if (!pulseResident) return null;

  return (
    <group>
      <ResidentSuspense id="mountain:pulse-podium">
        <ThemeFigures plan={podiumPlan} slots={PODIUM_SLOTS} />
      </ResidentSuspense>
      <ResidentSuspense id="mountain:wilds-0">
        <ThemeFigures plan={{ pool: PULSE_WILD_POOL }} slots={PULSE_WILD_SLOTS} />
      </ResidentSuspense>
      <WildGroup station={1} />
      <WildGroup station={2} />
      <WildGroup station={3} />
      <WildGroup station={4} />
    </group>
  );
}

'use client';

import { useMemo } from 'react';
import ThemeFigures, { type FigureSlot } from '@/components/world/route/figures/ThemeFigures';
import { type ThemeFigurePlan } from '@/lib/route-world/figure-contract';
import { figureHeightM, useFigureIndex } from '@/lib/route-world/model-manifest';
import { useRouteData } from '@/components/world/route/RouteDataProvider';
import type { SakuraRouteData } from '../types';
import { pickAceTracker } from './AcesLine';
import { GRANDSTAND, WILD_SPOTS } from './layout';
import { DormancyScope, ResidentSuspense } from '@/components/world/route/residency-store';
import { useSakuraStationWindow, useSakuraStationWindowState } from './useSakuraStationWindow';

/**
 * The park's Pokémon habitation (C-102 criterion 1), mounted through the
 * C-100 figure contract: `<ThemeFigures plan slots/>` — the engine's shared
 * pipeline (KTX2-armed loader, fitted/animated `Figure`, manifest fallbacks,
 * colossal/tiny stances from the recorded bounds). NO abstract statue
 * substitutes at hero stations: every hero-station figure here is a manifest
 * GLB (or, never, a placeholder — the grandstand declaration only admits
 * aces that RESOLVE in the manifest index, the AcesLine derivation).
 *
 *  - Grandstand aces at #pulse (the StatueRow pattern): up to 8 roster
 *    figures on the north shore between the rock and the banner row, each
 *    turned to the authored pulse eye. Standard/tiny stature only (see the
 *    plan filter below); Floette-class aces rise on tiny pedestals —
 *    engine-applied stance handling.
 *  - Pool wilds (pool-driven, thematically fitted): water lines at the lake
 *    shores, a bug line along the south tree band, two plus two
 *    crossing-path flankers — every species verified resolvable; Vaporeon,
 *    Lombre, Ariados and Marill carry real `idle` clips so animated idles
 *    read in the pulse frame, and grounded Gyarados (6.5 m, colossal) looms
 *    behind the #schedule banner row.
 *
 * Budget lever (criterion 5; since D23 every group is resident from load): per-station counts, once gated by the
 * in-package residency latch (`useSakuraStationWindow`) — with the preview
 * fixture's five grandstand-eligible aces: pulse 7, roster +2, teams +2,
 * schedule +4, rules +4 = 19 mounted figures at full residency (at most
 * 22 with a full 8-ace grandstand); the store payload is shared with
 * AcesLine's #teams picks (the same resolved GLB URLs, one cache).
 */

/** Grandstand slots, turned to the authored pulse eye. */
const GRANDSTAND_SLOTS: readonly FigureSlot[] = GRANDSTAND.slots.map((slot) => ({
  position: [slot.x, 0, slot.z],
  yaw: Math.atan2(GRANDSTAND.eye.x - slot.x, GRANDSTAND.eye.z - slot.z),
}));

/** Pulse-window wilds (west shore gap + the rock's east shoulder). */
const PULSE_WILD_SLOTS: readonly FigureSlot[] = WILD_SPOTS.filter((w) => w.station === 0).map((w) => ({
  position: [w.x, 0, w.z],
  yaw: w.yaw,
}));
const PULSE_WILD_POOL = WILD_SPOTS.filter((w) => w.station === 0).map((w) => w.species);

/** Statures above this stand with their team statuary, not in the ranks. */
const GRANDSTAND_MAX_HEIGHT_M = 1.8;

/** The participants' ace line, capped to the authored grandstand (8). */
function useGrandstandPlan(): ThemeFigurePlan {
  const { participants, trackers } = useRouteData<SakuraRouteData>();
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
      // Only resolvable aces stand in the grandstand — the mounter's
      // non-entry fallback is a placeholder mass, i.e. exactly the abstract
      // statue substitute the bar forbids at hero stations. Unresolvable
      // players keep their AcesLine statuary at #teams instead.
      .filter((entry) => index.resolve(entry.species, entry.baseSpecies) !== null)
      // Standard/tiny stature only: a 2 m+ ace crowns the board face at the
      // LANDED 390 pulse pose (angle-check the LANDED pose),
      // so tall lines keep their own AcesLine statuary at #teams, where
      // colossal handling is the design. Colossal/tiny stance handling stays
      // demonstrated here by the tiny pedestal (and by the pool wilds'
      // grounded Gyarados at #schedule).
      .filter((entry) => {
        const resolved = index.resolve(entry.species, entry.baseSpecies);
        return resolved !== null && figureHeightM(resolved) <= GRANDSTAND_MAX_HEIGHT_M;
      })
      .slice(0, GRANDSTAND.slots.length);
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
  const { mounted, shown, dormant } = useSakuraStationWindowState(station, 4);
  const plan = useMemo<ThemeFigurePlan>(
    () => ({ pool: WILD_SPOTS.filter((w) => w.station === station).map((w) => w.species) }),
    [station],
  );
  const slots = useMemo<readonly FigureSlot[]>(
    () =>
      WILD_SPOTS.filter((w) => w.station === station).map((w) => ({
        position: [w.x, 0, w.z],
        yaw: w.yaw,
      })),
    [station],
  );
  if (!mounted) return null;
  return (
    <group visible={shown} name={shown ? '' : `sakura-prop-premount-wilds-${station}`}>
      <DormancyScope dormant={dormant}>
        <ResidentSuspense id={`sakura:wilds-${station}`}>
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
export default function ParkFigures() {
  const pulseResident = useSakuraStationWindow(0, 4);
  const grandstandPlan = useGrandstandPlan();

  if (!pulseResident) return null;

  return (
    <group>
      <ResidentSuspense id="sakura:pulse-grandstand">
        <ThemeFigures plan={grandstandPlan} slots={GRANDSTAND_SLOTS} />
      </ResidentSuspense>
      <ResidentSuspense id="sakura:wilds-0">
        <ThemeFigures plan={{ pool: PULSE_WILD_POOL }} slots={PULSE_WILD_SLOTS} />
      </ResidentSuspense>
      <WildGroup station={1} />
      <WildGroup station={2} />
      <WildGroup station={3} />
      <WildGroup station={4} />
    </group>
  );
}
